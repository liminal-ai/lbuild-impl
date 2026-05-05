import { runStoryLead } from "../../core/story-lead.js";
import { captureStoryBaselineSeed } from "../../core/story-orchestrate-validate.js";
import {
	storyOrchestrateValidateResultSchema,
	storyOrchestrateResumeResultSchema,
	storyOrchestrateRunResultSchema,
	storyOrchestrateStatusResultSchema,
} from "../../core/story-orchestrate-contracts.js";
import { discoverStoryRunState } from "../../core/story-run-discovery.js";
import { createStoryRunLedger } from "../../core/story-run-ledger.js";
import { createRuntimeIdentity } from "../../core/runtime-identity.js";
import { resolveProviderCwd } from "../../core/git-repo.js";
import {
	type StoryOrchestrateResumeInput,
	type StoryOrchestrateResumeResult,
	type StoryOrchestrateRunInput,
	type StoryOrchestrateRunResult,
	type StoryOrchestrateStatusInput,
	type StoryOrchestrateStatusResult,
	type StoryOrchestrateValidateInput,
	type StoryOrchestrateValidateResult,
	storyOrchestrateResumeInputSchema,
	storyOrchestrateRunInputSchema,
	storyOrchestrateStatusInputSchema,
	storyOrchestrateValidateInputSchema,
} from "../contracts/story-orchestrate.js";
import {
	buildUnexpectedEnvelope,
	finalizeEnvelope,
	parseSdkInput,
	resolveOperationArtifactPath,
	withSdkExecutionContext,
} from "./shared.js";
import { preflight } from "./preflight.js";

function resultArtifacts(input: {
	currentSnapshotPath?: string;
	eventHistoryPath?: string;
	statusArtifactPath?: string;
	finalPackagePath?: string;
	acceptedReviewRequestArtifactPath?: string;
	acceptedRulingArtifactPath?: string;
}) {
	return [
		...(input.currentSnapshotPath
			? [{ kind: "story-run-current", path: input.currentSnapshotPath }]
			: []),
		...(input.eventHistoryPath
			? [{ kind: "story-run-events", path: input.eventHistoryPath }]
			: []),
		...(input.statusArtifactPath
			? [{ kind: "story-run-status", path: input.statusArtifactPath }]
			: []),
		...(input.finalPackagePath
			? [{ kind: "story-run-final-package", path: input.finalPackagePath }]
			: []),
		...(input.acceptedReviewRequestArtifactPath
			? [
					{
						kind: "review-request",
						path: input.acceptedReviewRequestArtifactPath,
					},
				]
			: []),
		...(input.acceptedRulingArtifactPath
			? [
					{
						kind: "ruling-response",
						path: input.acceptedRulingArtifactPath,
					},
				]
			: []),
	];
}

function selectionArtifacts(
	result: StoryOrchestrateValidateResult["storyRunSelection"],
) {
	switch (result.case) {
		case "resume-required":
		case "active-attempt-exists":
			return resultArtifacts({
				currentSnapshotPath: result.currentSnapshotPath,
			});
		case "existing-accepted-attempt":
			return resultArtifacts({
				finalPackagePath: result.finalPackagePath,
			});
		default:
			return [];
	}
}

function runOutcome(result: StoryOrchestrateRunResult): string {
	switch (result.case) {
		case "completed":
		case "interrupted":
			return result.outcome;
		default:
			return result.case;
	}
}

function resumeOutcome(result: StoryOrchestrateResumeResult): string {
	switch (result.case) {
		case "completed":
		case "interrupted":
			return result.outcome;
		default:
			return result.case;
	}
}

function runAdditionalArtifacts(result: StoryOrchestrateRunResult) {
	switch (result.case) {
		case "completed":
			return resultArtifacts({
				currentSnapshotPath: result.currentSnapshotPath,
				eventHistoryPath: result.eventHistoryPath,
				finalPackagePath: result.finalPackagePath,
			});
		case "interrupted":
			return resultArtifacts({
				currentSnapshotPath: result.currentSnapshotPath,
				eventHistoryPath: result.eventHistoryPath,
				finalPackagePath: result.finalPackagePath,
			});
		case "existing-accepted-attempt":
			return resultArtifacts({
				finalPackagePath: result.finalPackagePath,
			});
		case "resume-required":
		case "active-attempt-exists":
			return resultArtifacts({
				currentSnapshotPath: result.currentSnapshotPath,
			});
		default:
			return [];
	}
}

function resumeAdditionalArtifacts(result: StoryOrchestrateResumeResult) {
	switch (result.case) {
		case "completed":
			return resultArtifacts({
				currentSnapshotPath: result.currentSnapshotPath,
				eventHistoryPath: result.eventHistoryPath,
				finalPackagePath: result.finalPackagePath,
				acceptedReviewRequestArtifactPath:
					result.acceptedReviewRequestArtifact?.path,
				acceptedRulingArtifactPath: result.acceptedRulingArtifact?.path,
			});
		case "interrupted":
			return resultArtifacts({
				currentSnapshotPath: result.currentSnapshotPath,
				eventHistoryPath: result.eventHistoryPath,
				finalPackagePath: result.finalPackagePath,
				acceptedReviewRequestArtifactPath:
					result.acceptedReviewRequestArtifact?.path,
				acceptedRulingArtifactPath: result.acceptedRulingArtifact?.path,
			});
		case "existing-accepted-attempt":
			return resultArtifacts({
				finalPackagePath: result.finalPackagePath,
			});
		default:
			return [];
	}
}

function formatElapsedTime(
	startedAtIso: string,
	finishedAtIso: string,
): string {
	const startedAt = Date.parse(startedAtIso);
	const finishedAt = Date.parse(finishedAtIso);
	const elapsedMs =
		Number.isFinite(startedAt) && Number.isFinite(finishedAt)
			? Math.max(0, finishedAt - startedAt)
			: 0;
	const totalSeconds = Math.floor(elapsedMs / 1_000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function deriveLatestChildOperation(input: {
	currentChildOperation: {
		command: string;
		artifactPath?: string;
		continuationHandleRef?: string;
	} | null;
	events: Array<{
		type: string;
		artifact?: string;
		data?: Record<string, unknown>;
	}>;
}) {
	if (input.currentChildOperation) {
		return input.currentChildOperation;
	}

	for (let index = input.events.length - 1; index >= 0; index -= 1) {
		const event = input.events[index];
		if (event?.type !== "child-operation-completed") {
			continue;
		}

		const command =
			typeof event.data?.command === "string" ? event.data.command : null;
		if (!command) {
			continue;
		}

		return {
			command,
			...(event.artifact ? { artifactPath: event.artifact } : {}),
		};
	}

	return null;
}

export async function storyOrchestrateRun(input: StoryOrchestrateRunInput) {
	const parsedInput = parseSdkInput(storyOrchestrateRunInputSchema, input);

	return await withSdkExecutionContext(parsedInput, async () => {
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveOperationArtifactPath({
			command: "story-orchestrate-run",
			specPackRoot: parsedInput.specPackRoot,
			artifactPath: parsedInput.artifactPath,
			group: parsedInput.storyId,
			fileName: "story-orchestrate-run",
		});

		try {
			const selection = await discoverStoryRunState({
				specPackRoot: parsedInput.specPackRoot,
				storyId: parsedInput.storyId,
			});
			let result: StoryOrchestrateRunResult;

			switch (selection.case) {
				case "start-new":
				case "start-from-primitive-artifacts": {
					const ledger = createStoryRunLedger({
						specPackRoot: parsedInput.specPackRoot,
						storyId: parsedInput.storyId,
					});
					const runtime = await runStoryLead({
						specPackRoot: parsedInput.specPackRoot,
						storyId: parsedInput.storyId,
						configPath: parsedInput.configPath,
						env: parsedInput.env,
						ledger,
						mode: "run",
						startedFromPrimitiveArtifacts:
							selection.case === "start-from-primitive-artifacts"
								? selection.sourceArtifactPaths
								: undefined,
						callerHarness: parsedInput.callerHarness,
						heartbeatCadenceMinutes: parsedInput.heartbeatCadenceMinutes,
						disableHeartbeats: parsedInput.disableHeartbeats,
						progressListener: parsedInput.progressListener,
					});
					if (runtime.case === "completed") {
						if (!runtime.finalPackage || !runtime.finalPackagePath) {
							throw new Error(
								"Story runtime completed without a final package.",
							);
						}
						result = storyOrchestrateRunResultSchema.parse({
							case: "completed",
							outcome: runtime.finalPackage.outcome,
							storyId: runtime.storyId,
							storyRunId: runtime.storyRunId,
							currentSnapshotPath: runtime.currentSnapshotPath,
							eventHistoryPath: runtime.eventHistoryPath,
							finalPackagePath: runtime.finalPackagePath,
							finalPackage: runtime.finalPackage,
							...(runtime.startedFromPrimitiveArtifacts
								? {
										startedFromPrimitiveArtifacts:
											runtime.startedFromPrimitiveArtifacts,
									}
								: {}),
						});
					} else {
						result = storyOrchestrateRunResultSchema.parse({
							case: "interrupted",
							outcome: "interrupted",
							storyId: runtime.storyId,
							storyRunId: runtime.storyRunId,
							currentSnapshotPath: runtime.currentSnapshotPath,
							eventHistoryPath: runtime.eventHistoryPath,
							finalPackagePath: runtime.finalPackagePath,
							finalPackage: runtime.finalPackage,
							recoveryGuidance:
								runtime.recoveryGuidance ??
								"Use story-orchestrate resume to continue this interrupted attempt.",
							latestEventSequence: runtime.latestEventSequence,
						});
					}
					break;
				}
				case "existing-accepted-attempt":
					result = storyOrchestrateRunResultSchema.parse({
						case: "existing-accepted-attempt",
						storyId: parsedInput.storyId,
						storyRunId: selection.storyRunId,
						finalPackagePath: selection.finalPackagePath,
						suggestedNext: "status",
					});
					break;
				case "resume-required":
					result = storyOrchestrateRunResultSchema.parse({
						case: "resume-required",
						storyId: parsedInput.storyId,
						storyRunId: selection.storyRunId,
						currentSnapshotPath: selection.currentSnapshotPath,
						suggestedCommand: `lbuild-impl story-orchestrate resume --spec-pack-root ${parsedInput.specPackRoot} --story-id ${parsedInput.storyId} --story-run-id ${selection.storyRunId}`,
					});
					break;
				case "active-attempt-exists":
					result = storyOrchestrateRunResultSchema.parse({
						case: "active-attempt-exists",
						storyId: parsedInput.storyId,
						storyRunId: selection.storyRunId,
						currentSnapshotPath: selection.currentSnapshotPath,
					});
					break;
				case "ambiguous-story-run":
					result = storyOrchestrateRunResultSchema.parse({
						case: "ambiguous-story-run",
						storyId: parsedInput.storyId,
						candidates: selection.candidates,
					});
					break;
				case "invalid-story-id":
					result = storyOrchestrateRunResultSchema.parse(selection);
					break;
				case "invalid-story-run-id":
					throw new Error(
						"Run discovery should never receive an explicit storyRunId.",
					);
			}

			return await finalizeEnvelope({
				command: "story-orchestrate run",
				artifactPath,
				startedAt,
				outcome: runOutcome(result),
				resultSchema: storyOrchestrateRunResultSchema,
				result,
				additionalArtifacts: runAdditionalArtifacts(result),
			});
		} catch (error) {
			const envelope = buildUnexpectedEnvelope({
				command: "story-orchestrate run",
				artifactPath,
				startedAt,
				error,
			});
			return await finalizeEnvelope({
				command: envelope.command,
				artifactPath,
				startedAt,
				outcome: envelope.outcome,
				resultSchema: storyOrchestrateRunResultSchema,
				errors: envelope.errors,
			});
		}
	});
}

export async function storyOrchestrateValidate(
	input: StoryOrchestrateValidateInput,
) {
	const parsedInput = parseSdkInput(storyOrchestrateValidateInputSchema, input);

	return await withSdkExecutionContext(parsedInput, async () => {
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveOperationArtifactPath({
			command: "story-validate",
			specPackRoot: parsedInput.specPackRoot,
			artifactPath: parsedInput.artifactPath,
			group: parsedInput.storyId,
			fileName: "story-validate",
		});

		try {
			const preflightEnvelope = await preflight({
				specPackRoot: parsedInput.specPackRoot,
				configPath: parsedInput.configPath,
				env: parsedInput.env,
			});
			const selection = await discoverStoryRunState({
				specPackRoot: parsedInput.specPackRoot,
				storyId: parsedInput.storyId,
			});
			const checks: StoryOrchestrateValidateResult["checks"] = [];
			const blockers: string[] = [];
			const notes: string[] = [];
			let outcome: StoryOrchestrateValidateResult["status"] = "ready";
			let baselineSeed:
				| StoryOrchestrateValidateResult["baselineSeed"]
				| undefined;

			checks.push({
				name: "preflight-readiness",
				status:
					preflightEnvelope.outcome === "ready"
						? "pass"
						: preflightEnvelope.outcome === "needs-user-decision"
							? "unknown"
							: "fail",
				summary: `Preflight returned ${preflightEnvelope.outcome}.`,
				evidence: preflightEnvelope.artifacts.map((artifact) => artifact.path),
			});
			if (preflightEnvelope.outcome === "needs-user-decision") {
				outcome = "needs-user-decision";
				blockers.push(
					...preflightEnvelope.errors.map((error) => error.message),
				);
				notes.push(...preflightEnvelope.warnings);
			} else if (preflightEnvelope.outcome !== "ready") {
				outcome = "blocked";
				blockers.push(
					...preflightEnvelope.errors.map((error) => error.message),
				);
				notes.push(...preflightEnvelope.warnings);
			}

			const selectionReady =
				selection.case === "start-new" ||
				selection.case === "start-from-primitive-artifacts";
			checks.push({
				name: "story-run-selection",
				status: selectionReady ? "pass" : "fail",
				summary: selectionReady
					? `Story ${parsedInput.storyId} is ready to start a composed run.`
					: `Story ${parsedInput.storyId} is not startable: ${selection.case}.`,
				evidence: selectionArtifacts(selection).map(
					(artifact) => artifact.path,
				),
			});
			if (!selectionReady) {
				outcome = "blocked";
				switch (selection.case) {
					case "invalid-story-id":
						blockers.push(`Unknown story id: ${selection.storyId}`);
						break;
					case "invalid-story-run-id":
						blockers.push(
							`Unknown story-run id ${selection.storyRunId} for story ${selection.storyId}.`,
						);
						break;
					case "ambiguous-story-run":
						blockers.push(
							"Multiple plausible story-run attempts exist; use story-orchestrate status or resume explicitly.",
						);
						break;
					case "active-attempt-exists":
						blockers.push(
							`An active story-run already exists: ${selection.storyRunId}. Resume it instead of starting a new run.`,
						);
						break;
					case "resume-required":
						blockers.push(
							`A resumable story-run already exists: ${selection.storyRunId}. Resume it instead of starting a new run.`,
						);
						break;
					case "existing-accepted-attempt":
						blockers.push(
							`Story ${parsedInput.storyId} already has an accepted attempt: ${selection.storyRunId}. Reopen explicitly if needed.`,
						);
						break;
					default:
						break;
				}
			}

			if (preflightEnvelope.outcome === "ready" && selectionReady) {
				const workspaceRoot = await resolveProviderCwd(
					parsedInput.specPackRoot,
				);
				baselineSeed = await captureStoryBaselineSeed({
					workspaceRoot,
				});
				checks.push({
					name: "baseline-seed",
					status: "pass",
					summary: `Captured deterministic pre-story baseline seed (${baselineSeed.baselineBeforeCurrentStory} matching test file(s)).`,
					evidence: [baselineSeed.workspaceRoot],
				});
			} else {
				checks.push({
					name: "baseline-seed",
					status: "unknown",
					summary:
						"Baseline seed capture skipped because readiness blockers remain.",
					evidence: [],
				});
			}

			const result = storyOrchestrateValidateResultSchema.parse({
				status: outcome,
				storyId: parsedInput.storyId,
				storyRunSelection: selection,
				...(preflightEnvelope.result?.validatedConfig
					? { validatedConfig: preflightEnvelope.result.validatedConfig }
					: {}),
				...(preflightEnvelope.result?.providerMatrix
					? { providerMatrix: preflightEnvelope.result.providerMatrix }
					: {}),
				...(preflightEnvelope.result?.verificationGates
					? { verificationGates: preflightEnvelope.result.verificationGates }
					: {}),
				...(baselineSeed ? { baselineSeed } : {}),
				checks,
				blockers,
				notes: [...notes, ...(preflightEnvelope.result?.notes ?? [])],
			});

			return await finalizeEnvelope({
				command: "story-orchestrate validate",
				artifactPath,
				startedAt,
				outcome,
				resultSchema: storyOrchestrateValidateResultSchema,
				result,
				errors:
					outcome === "ready"
						? []
						: blockers.map((message) => ({
								code:
									outcome === "needs-user-decision"
										? "VALIDATION_NEEDS_USER_DECISION"
										: "VALIDATION_BLOCKED",
								message,
							})),
				additionalArtifacts: selectionArtifacts(selection),
			});
		} catch (error) {
			const envelope = buildUnexpectedEnvelope({
				command: "story-orchestrate validate",
				artifactPath,
				startedAt,
				outcome: "blocked",
				error,
			});
			return await finalizeEnvelope({
				command: envelope.command,
				artifactPath,
				startedAt,
				outcome: envelope.outcome,
				resultSchema: storyOrchestrateValidateResultSchema,
				errors: envelope.errors,
			});
		}
	});
}

export async function storyOrchestrateResume(
	input: StoryOrchestrateResumeInput,
) {
	const parsedInput = parseSdkInput(storyOrchestrateResumeInputSchema, input);

	return await withSdkExecutionContext(parsedInput, async () => {
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveOperationArtifactPath({
			command: "story-orchestrate-resume",
			specPackRoot: parsedInput.specPackRoot,
			artifactPath: parsedInput.artifactPath,
			group: parsedInput.storyId,
			fileName: "story-orchestrate-resume",
		});

		try {
			const ledger = createStoryRunLedger({
				specPackRoot: parsedInput.specPackRoot,
				storyId: parsedInput.storyId,
			});
			const selection = await discoverStoryRunState({
				specPackRoot: parsedInput.specPackRoot,
				storyId: parsedInput.storyId,
				storyRunId: parsedInput.storyRunId,
			});
			let result: StoryOrchestrateResumeResult;

			switch (selection.case) {
				case "invalid-story-id":
					result = storyOrchestrateResumeResultSchema.parse(selection);
					break;
				case "invalid-story-run-id":
					result = storyOrchestrateResumeResultSchema.parse(selection);
					break;
				case "ambiguous-story-run":
					result = storyOrchestrateResumeResultSchema.parse({
						case: "ambiguous-story-run",
						storyId: parsedInput.storyId,
						candidates: selection.candidates,
					});
					break;
				case "existing-accepted-attempt":
				case "resume-required":
				case "active-attempt-exists": {
					if (
						selection.case === "existing-accepted-attempt" &&
						!parsedInput.reviewRequest &&
						!parsedInput.ruling
					) {
						result = storyOrchestrateResumeResultSchema.parse({
							case: "existing-accepted-attempt",
							storyId: parsedInput.storyId,
							storyRunId: selection.storyRunId,
							finalPackagePath: selection.finalPackagePath,
							suggestedNext: "resume-with-review-request",
						});
						break;
					}

					const attempt = await ledger.getAttemptByStoryRunId(
						selection.storyRunId,
					);
					if (!attempt) {
						throw new Error(
							`Unable to resolve story-run ${selection.storyRunId} for resume.`,
						);
					}
					if (parsedInput.ruling) {
						const outstandingRulingRequest =
							attempt.finalPackage?.rulingRequest;
						const hasMatchingOutstandingRequest =
							outstandingRulingRequest?.id ===
								parsedInput.ruling.rulingRequestId &&
							outstandingRulingRequest.allowedResponses.includes(
								parsedInput.ruling.decision,
							);

						if (!hasMatchingOutstandingRequest) {
							result = storyOrchestrateResumeResultSchema.parse({
								case: "invalid-ruling",
								storyId: parsedInput.storyId,
							});
							break;
						}
					}

					const runtime = await runStoryLead({
						specPackRoot: parsedInput.specPackRoot,
						storyId: parsedInput.storyId,
						configPath: parsedInput.configPath,
						env: parsedInput.env,
						ledger,
						mode: "resume",
						existingAttempt: attempt,
						reviewRequest: parsedInput.reviewRequest,
						ruling: parsedInput.ruling,
						callerHarness: parsedInput.callerHarness,
						heartbeatCadenceMinutes: parsedInput.heartbeatCadenceMinutes,
						disableHeartbeats: parsedInput.disableHeartbeats,
						progressListener: parsedInput.progressListener,
					});
					if (runtime.case === "completed") {
						if (!runtime.finalPackage || !runtime.finalPackagePath) {
							throw new Error(
								"Story runtime completed without a final package.",
							);
						}
						const acceptedReviewRequestArtifact =
							runtime.acceptedReviewRequestArtifact ??
							(parsedInput.reviewRequest
								? runtime.finalPackage.evidence.callerInputArtifacts
										.filter((artifact) => artifact.kind === "review-request")
										.at(-1)
								: undefined);
						const acceptedRulingArtifact =
							runtime.acceptedRulingArtifact ??
							(parsedInput.ruling
								? runtime.finalPackage.evidence.callerInputArtifacts
										.filter((artifact) => artifact.kind === "ruling-response")
										.at(-1)
								: undefined);
						result = storyOrchestrateResumeResultSchema.parse({
							case: "completed",
							outcome: runtime.finalPackage.outcome,
							storyId: runtime.storyId,
							storyRunId: runtime.storyRunId,
							currentSnapshotPath: runtime.currentSnapshotPath,
							eventHistoryPath: runtime.eventHistoryPath,
							finalPackagePath: runtime.finalPackagePath,
							finalPackage: runtime.finalPackage,
							...(parsedInput.reviewRequest
								? {
										acceptedReviewRequestId: parsedInput.reviewRequest.source,
										...(acceptedReviewRequestArtifact
											? { acceptedReviewRequestArtifact }
											: {}),
									}
								: {}),
							...(parsedInput.ruling
								? {
										acceptedRulingRequestId: parsedInput.ruling.rulingRequestId,
										...(acceptedRulingArtifact
											? { acceptedRulingArtifact }
											: {}),
									}
								: {}),
						});
					} else {
						result = storyOrchestrateResumeResultSchema.parse({
							case: "interrupted",
							outcome: "interrupted",
							storyId: runtime.storyId,
							storyRunId: runtime.storyRunId,
							currentSnapshotPath: runtime.currentSnapshotPath,
							eventHistoryPath: runtime.eventHistoryPath,
							finalPackagePath: runtime.finalPackagePath,
							finalPackage: runtime.finalPackage,
							recoveryGuidance:
								runtime.recoveryGuidance ??
								"Use story-orchestrate resume to continue this interrupted attempt.",
							latestEventSequence: runtime.latestEventSequence,
							...(runtime.acceptedReviewRequestArtifact
								? {
										acceptedReviewRequestArtifact:
											runtime.acceptedReviewRequestArtifact,
									}
								: {}),
							...(runtime.acceptedRulingArtifact
								? {
										acceptedRulingArtifact: runtime.acceptedRulingArtifact,
									}
								: {}),
						});
					}
					break;
				}
				case "start-new":
				case "start-from-primitive-artifacts":
					throw new Error(
						"No existing story-lead attempt is available to resume for this story.",
					);
			}

			return await finalizeEnvelope({
				command: "story-orchestrate resume",
				artifactPath,
				startedAt,
				outcome: resumeOutcome(result),
				resultSchema: storyOrchestrateResumeResultSchema,
				result,
				additionalArtifacts: resumeAdditionalArtifacts(result),
			});
		} catch (error) {
			const envelope = buildUnexpectedEnvelope({
				command: "story-orchestrate resume",
				artifactPath,
				startedAt,
				error,
			});
			return await finalizeEnvelope({
				command: envelope.command,
				artifactPath,
				startedAt,
				outcome: envelope.outcome,
				resultSchema: storyOrchestrateResumeResultSchema,
				errors: envelope.errors,
			});
		}
	});
}

export async function storyOrchestrateStatus(
	input: StoryOrchestrateStatusInput,
) {
	const parsedInput = parseSdkInput(storyOrchestrateStatusInputSchema, input);

	return await withSdkExecutionContext(parsedInput, async () => {
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveOperationArtifactPath({
			command: "story-orchestrate-status",
			specPackRoot: parsedInput.specPackRoot,
			artifactPath: parsedInput.artifactPath,
			group: parsedInput.storyId,
			fileName: "story-orchestrate-status",
		});

		try {
			const selection = await discoverStoryRunState({
				specPackRoot: parsedInput.specPackRoot,
				storyId: parsedInput.storyId,
				storyRunId: parsedInput.storyRunId,
			});
			let result: StoryOrchestrateStatusResult;

			switch (selection.case) {
				case "invalid-story-id":
					result = storyOrchestrateStatusResultSchema.parse(selection);
					break;
				case "invalid-story-run-id":
					result = storyOrchestrateStatusResultSchema.parse(selection);
					break;
				case "ambiguous-story-run":
					result = storyOrchestrateStatusResultSchema.parse({
						case: "ambiguous-story-run",
						storyId: parsedInput.storyId,
						candidates: selection.candidates,
					});
					break;
				case "start-new":
				case "start-from-primitive-artifacts":
					throw new Error(
						"No durable story-lead attempt exists yet for the requested story.",
					);
				default: {
					const ledger = createStoryRunLedger({
						specPackRoot: parsedInput.specPackRoot,
						storyId: parsedInput.storyId,
					});
					const attempt = await ledger.getAttemptByStoryRunId(
						selection.storyRunId,
					);
					if (!attempt) {
						throw new Error(
							`Unable to resolve story-run ${selection.storyRunId} for status.`,
						);
					}
					const events = await ledger.readEventHistory(
						attempt.eventHistoryPath,
					);
					const latestEvent = events.at(-1) ?? null;
					const startedAtForElapsed =
						events[0]?.timestamp ?? attempt.currentSnapshot.updatedAt;
					const latestChildOperation = deriveLatestChildOperation({
						currentChildOperation:
							attempt.currentSnapshot.currentChildOperation,
						events,
					});

					result = storyOrchestrateStatusResultSchema.parse({
						case: "single-attempt",
						storyId: parsedInput.storyId,
						storyRunId: attempt.storyRunId,
						currentSnapshotPath: attempt.currentSnapshotPath,
						eventHistoryPath: attempt.eventHistoryPath,
						statusArtifactPath: attempt.progressStatusPath,
						currentSnapshot: attempt.currentSnapshot,
						currentStatus: attempt.currentSnapshot.status,
						lifecycleState: attempt.currentSnapshot.lifecycleState,
						latestEventSequence: attempt.currentSnapshot.latestEventSequence,
						latestEvent,
						latestChildOperation,
						runtimeIdentity: createRuntimeIdentity(),
						elapsedTime: formatElapsedTime(
							startedAtForElapsed,
							attempt.currentSnapshot.updatedAt,
						),
						...(attempt.currentSnapshot.lifecycleState === "terminal" &&
						attempt.currentSnapshot.status !== "running"
							? { terminalResult: attempt.currentSnapshot.status }
							: {}),
						...(attempt.finalPackage
							? {
									finalPackagePath: attempt.finalPackagePath,
									finalPackage: attempt.finalPackage,
								}
							: {}),
					});
					break;
				}
			}

			return await finalizeEnvelope({
				command: "story-orchestrate status",
				artifactPath,
				startedAt,
				outcome: result.case,
				resultSchema: storyOrchestrateStatusResultSchema,
				result,
				additionalArtifacts:
					result.case === "single-attempt"
						? resultArtifacts({
								currentSnapshotPath: result.currentSnapshotPath,
								eventHistoryPath: result.eventHistoryPath,
								statusArtifactPath: result.statusArtifactPath,
								finalPackagePath: result.finalPackagePath,
							})
						: [],
			});
		} catch (error) {
			const envelope = buildUnexpectedEnvelope({
				command: "story-orchestrate status",
				artifactPath,
				startedAt,
				error,
			});
			return await finalizeEnvelope({
				command: envelope.command,
				artifactPath,
				startedAt,
				outcome: envelope.outcome,
				resultSchema: storyOrchestrateStatusResultSchema,
				errors: envelope.errors,
			});
		}
	});
}
