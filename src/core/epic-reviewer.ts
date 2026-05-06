import { randomUUID } from "node:crypto";

import type { z } from "zod";

import {
	type CallerHarnessConfigRecord,
	loadRunConfig,
	resolveConfiguredVerificationGates,
	resolveRunTimeouts,
} from "./config-schema";
import { resolveVerificationGates } from "./gate-discovery";
import { resolveProviderCwd } from "./git-repo";
import {
	type AttachedProgressEvent,
	type CallerHarness,
	createPrimitiveHeartbeatEmitter,
} from "./heartbeat";
import { assemblePrompt } from "./prompt-assembly";
import {
	createProviderAdapter,
	type ProviderLifecycleEvent,
	type ProviderName,
	type ProviderStreamOutputPaths,
} from "./provider-adapters";
import {
	aggregateEpicVerifierBatchOutcome,
	type CliError,
	type EpicCanonicalReview,
	type EpicVerifierBatchResult,
	type EpicVerifierResult,
	epicCanonicalReviewSchema,
	epicVerifierResultSchema,
} from "./result-contracts";
import {
	type RuntimeProgressPaths,
	RuntimeProgressTracker,
} from "./runtime-progress";
import { inspectSpecPack } from "./spec-pack";

export const epicVerifierProviderPayloadSchema = epicVerifierResultSchema
	.omit({
		resultId: true,
		provider: true,
		model: true,
		reviewerLabel: true,
	})
	.strict();

type ProviderPayload = z.infer<typeof epicVerifierProviderPayloadSchema>;

interface PreparedVerifier {
	label: string;
	provider: ProviderName;
	model: string;
	reasoningEffort: string;
}

interface PreparedEpicContext {
	specPackRoot: string;
	gateCommands: {
		story: string;
		epic: string;
	};
	paths: {
		epicPath: string;
		techDesignPath: string;
		techDesignCompanionPaths: string[];
		testPlanPath: string;
	};
	providerCwd: string;
	verifiers: PreparedVerifier[];
	reconciler: PreparedVerifier;
	timeoutMs: number;
	reconcileTimeoutMs: number;
	startupTimeoutMs: number;
	silenceTimeoutMs: number;
	reconcileSilenceTimeoutMs: number;
	callerHarnessConfig?: CallerHarnessConfigRecord;
}

interface WorkflowFailure {
	errors: CliError[];
}

interface VerifierExecutionSuccess {
	payload: ProviderPayload;
}

interface VerifierExecutionFailure {
	errors: CliError[];
}

interface ReconciliationExecutionSuccess {
	canonicalReview: EpicCanonicalReview;
}

export interface EpicReviewWorkflowResult {
	outcome: "pass" | "revise" | "block";
	result?: EpicVerifierBatchResult;
	errors: CliError[];
	warnings: string[];
}

function blockedError(
	code: string,
	message: string,
	detail?: string,
): CliError {
	return {
		code,
		message,
		...(detail ? { detail } : {}),
	};
}

function providerForHarness(harness: "codex" | "none"): ProviderName {
	if (harness === "none") {
		return "claude-code";
	}

	return harness;
}

async function prepareEpicReviewContext(input: {
	specPackRoot: string;
	configPath?: string;
}): Promise<PreparedEpicContext | WorkflowFailure> {
	const inspection = await inspectSpecPack(input.specPackRoot);
	if (inspection.status !== "ready") {
		return {
			errors: [
				blockedError(
					"INVALID_SPEC_PACK",
					"Spec-pack inspection must be ready before epic review can start.",
					inspection.blockers.join("; ") || inspection.notes.join("; "),
				),
			],
		};
	}

	const config = await loadRunConfig({
		specPackRoot: inspection.specPackRoot,
		configPath: input.configPath,
	});
	const gateResolution = await resolveVerificationGates({
		specPackRoot: inspection.specPackRoot,
		persistedVerificationGates: resolveConfiguredVerificationGates(config),
	});
	if (gateResolution.status !== "ready" || !gateResolution.verificationGates) {
		return {
			errors: gateResolution.errors.length
				? gateResolution.errors
				: [
						blockedError(
							"VERIFICATION_GATE_UNRESOLVED",
							"Verification gates must be resolved before epic review can start.",
						),
					],
		};
	}

	return {
		specPackRoot: inspection.specPackRoot,
		gateCommands: {
			story: gateResolution.verificationGates.storyGate,
			epic: gateResolution.verificationGates.epicGate,
		},
		paths: {
			epicPath: inspection.artifacts.epicPath,
			techDesignPath: inspection.artifacts.techDesignPath,
			techDesignCompanionPaths: inspection.artifacts.techDesignCompanionPaths,
			testPlanPath: inspection.artifacts.testPlanPath,
		},
		providerCwd: await resolveProviderCwd(inspection.specPackRoot),
		verifiers: config.epic_verifiers.map((verifier) => ({
			label: verifier.label,
			provider: providerForHarness(verifier.secondary_harness),
			model: verifier.model,
			reasoningEffort: verifier.reasoning_effort,
		})),
		reconciler: {
			label: "epic-review-reconciler",
			provider: providerForHarness(config.epic_reverifier.secondary_harness),
			model: config.epic_reverifier.model,
			reasoningEffort: config.epic_reverifier.reasoning_effort,
		},
		timeoutMs: resolveRunTimeouts(config).epic_reviewer_ms,
		reconcileTimeoutMs: resolveRunTimeouts(config).epic_reverifier_ms,
		startupTimeoutMs: resolveRunTimeouts(config).provider_startup_timeout_ms,
		silenceTimeoutMs:
			resolveRunTimeouts(config).epic_reviewer_silence_timeout_ms,
		reconcileSilenceTimeoutMs:
			resolveRunTimeouts(config).epic_reverifier_silence_timeout_ms,
		callerHarnessConfig: config.caller_harness,
	};
}

function executionFailureError(input: {
	provider: ProviderName;
	stderr: string;
	errorCode?: string;
}): CliError {
	if (input.errorCode === "INVALID_OUTPUT_SCHEMA") {
		return blockedError(
			"PROVIDER_OUTPUT_INVALID",
			`Provider output schema was invalid for ${input.provider}.`,
			input.stderr,
		);
	}

	if (input.errorCode === "PROVIDER_TIMEOUT") {
		return blockedError(
			"PROVIDER_TIMEOUT",
			`Provider execution timed out for ${input.provider}.`,
			input.stderr,
		);
	}

	if (input.errorCode === "PROVIDER_STALLED") {
		return blockedError(
			"PROVIDER_STALLED",
			`Provider execution stalled for ${input.provider}.`,
			input.stderr,
		);
	}

	if (
		input.errorCode === "PROVIDER_STARTUP_FAILED" ||
		input.errorCode === "ENOENT"
	) {
		return blockedError(
			"PROVIDER_STARTUP_FAILED",
			`Provider failed startup for ${input.provider}.`,
			input.stderr,
		);
	}

	return blockedError(
		"PROVIDER_UNAVAILABLE",
		`Provider execution failed for ${input.provider}.`,
		input.stderr,
	);
}

async function executeReconciliation(input: {
	provider: ProviderName;
	cwd: string;
	model: string;
	reasoningEffort: string;
	prompt: string;
	env?: Record<string, string | undefined>;
	timeoutMs: number;
	startupTimeoutMs?: number;
	silenceTimeoutMs?: number;
	streamOutputPaths?: ProviderStreamOutputPaths;
	lifecycleCallback?: (event: ProviderLifecycleEvent) => void | Promise<void>;
}): Promise<ReconciliationExecutionSuccess | VerifierExecutionFailure> {
	const adapter = createProviderAdapter(input.provider, {
		env: input.env,
	});
	const execution = await adapter.execute({
		prompt: input.prompt,
		cwd: input.cwd,
		model: input.model,
		reasoningEffort: input.reasoningEffort,
		timeoutMs: input.timeoutMs,
		startupTimeoutMs: input.startupTimeoutMs,
		silenceTimeoutMs: input.silenceTimeoutMs,
		resultSchema: epicCanonicalReviewSchema,
		streamOutputPaths: input.streamOutputPaths,
		lifecycleCallback: input.lifecycleCallback,
	});

	if (execution.exitCode !== 0) {
		return {
			errors: [
				executionFailureError({
					provider: input.provider,
					stderr: execution.stderr,
					errorCode: execution.errorCode,
				}),
			],
		};
	}

	if (execution.parseError || !execution.parsedResult) {
		return {
			errors: [
				blockedError(
					"PROVIDER_OUTPUT_INVALID",
					`Provider output was invalid for ${input.provider}.`,
					execution.parseError,
				),
			],
		};
	}

	return {
		canonicalReview: execution.parsedResult,
	};
}

async function executeVerifier(input: {
	provider: ProviderName;
	cwd: string;
	model: string;
	reasoningEffort: string;
	prompt: string;
	env?: Record<string, string | undefined>;
	timeoutMs: number;
	startupTimeoutMs?: number;
	silenceTimeoutMs?: number;
	streamOutputPaths?: ProviderStreamOutputPaths;
	lifecycleCallback?: (event: ProviderLifecycleEvent) => void | Promise<void>;
}): Promise<VerifierExecutionSuccess | VerifierExecutionFailure> {
	const adapter = createProviderAdapter(input.provider, {
		env: input.env,
	});
	const execution = await adapter.execute({
		prompt: input.prompt,
		cwd: input.cwd,
		model: input.model,
		reasoningEffort: input.reasoningEffort,
		timeoutMs: input.timeoutMs,
		startupTimeoutMs: input.startupTimeoutMs,
		silenceTimeoutMs: input.silenceTimeoutMs,
		resultSchema: epicVerifierProviderPayloadSchema,
		streamOutputPaths: input.streamOutputPaths,
		lifecycleCallback: input.lifecycleCallback,
	});

	if (execution.exitCode !== 0) {
		return {
			errors: [
				executionFailureError({
					provider: input.provider,
					stderr: execution.stderr,
					errorCode: execution.errorCode,
				}),
			],
		};
	}

	if (execution.parseError || !execution.parsedResult) {
		return {
			errors: [
				blockedError(
					"PROVIDER_OUTPUT_INVALID",
					`Provider output was invalid for ${input.provider}.`,
					execution.parseError,
				),
			],
		};
	}

	return {
		payload: execution.parsedResult,
	};
}

function buildVerifierResult(input: {
	verifier: PreparedVerifier;
	payload: ProviderPayload;
}): EpicVerifierResult {
	return {
		resultId: randomUUID(),
		outcome: input.payload.outcome,
		provider: input.verifier.provider,
		model: input.verifier.model,
		reviewerLabel: input.verifier.label,
		crossStoryFindings: input.payload.crossStoryFindings,
		architectureFindings: input.payload.architectureFindings,
		epicCoverageAssessment: input.payload.epicCoverageAssessment,
		productionPathFindings: input.payload.productionPathFindings,
		blockingFindings: input.payload.blockingFindings,
		nonBlockingFindings: input.payload.nonBlockingFindings,
		unresolvedItems: input.payload.unresolvedItems,
		gateResult: input.payload.gateResult,
	};
}

function buildVerifierBatchResult(input: {
	outcome: "pass" | "revise" | "block";
	verifierResults: EpicVerifierResult[];
	canonicalReview: EpicCanonicalReview;
}): EpicVerifierBatchResult {
	return {
		outcome: input.outcome,
		canonicalReview: input.canonicalReview,
		verifierResults: input.verifierResults,
	};
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueFindings(
	values: EpicVerifierResult["blockingFindings"],
): EpicVerifierResult["blockingFindings"] {
	const byId = new Map<
		string,
		EpicVerifierResult["blockingFindings"][number]
	>();
	for (const finding of values) {
		if (!byId.has(finding.id)) {
			byId.set(finding.id, finding);
		}
	}
	return [...byId.values()].sort((left, right) =>
		left.id.localeCompare(right.id),
	);
}

function reconcileGateResult(
	results: EpicVerifierResult[],
): EpicCanonicalReview["gateResult"] {
	if (results.some((result) => result.gateResult === "fail")) {
		return "fail";
	}
	if (results.some((result) => result.gateResult === "not-run")) {
		return "not-run";
	}
	return "pass";
}

function reconcileEpicReview(
	results: EpicVerifierResult[],
	outcome: "pass" | "revise" | "block",
): EpicCanonicalReview {
	return {
		outcome,
		reviewerLabels: results.map((result) => result.reviewerLabel),
		reconciliationSummary:
			results.length === 1
				? `Canonical review uses the single reviewer result from ${results[0]?.reviewerLabel}.`
				: `Canonical review reconciled ${results.length} independent reviewer results by preserving every unique finding and assessment.`,
		crossStoryFindings: uniqueStrings(
			results.flatMap((result) => result.crossStoryFindings),
		),
		architectureFindings: uniqueStrings(
			results.flatMap((result) => result.architectureFindings),
		),
		epicCoverageAssessment: uniqueStrings(
			results.flatMap((result) => result.epicCoverageAssessment),
		),
		productionPathFindings: uniqueStrings(
			results.flatMap((result) => result.productionPathFindings),
		),
		blockingFindings: uniqueFindings(
			results.flatMap((result) => result.blockingFindings),
		),
		nonBlockingFindings: uniqueFindings(
			results.flatMap((result) => result.nonBlockingFindings),
		),
		unresolvedItems: uniqueStrings(
			results.flatMap((result) => result.unresolvedItems),
		),
		gateResult: reconcileGateResult(results),
	};
}

async function buildCanonicalReview(input: {
	context: PreparedEpicContext;
	verifierResults: EpicVerifierResult[];
	rawReviewerAggregateOutcome: "pass" | "revise" | "block";
	env?: Record<string, string | undefined>;
	streamOutputPaths?: ProviderStreamOutputPaths;
	progressTracker?: RuntimeProgressTracker;
}): Promise<{ canonicalReview?: EpicCanonicalReview; errors: CliError[] }> {
	if (input.verifierResults.length === 1) {
		return {
			canonicalReview: reconcileEpicReview(
				input.verifierResults,
				input.rawReviewerAggregateOutcome,
			),
			errors: [],
		};
	}

	const reviewerLabels = input.verifierResults.map(
		(result) => result.reviewerLabel,
	);
	const blockedReviewerCount = input.verifierResults.filter(
		(result) => result.outcome === "block",
	).length;
	const prompt = await assemblePrompt({
		role: "epic_review_reconciler",
		epicPath: input.context.paths.epicPath,
		techDesignPath: input.context.paths.techDesignPath,
		techDesignCompanionPaths: input.context.paths.techDesignCompanionPaths,
		testPlanPath: input.context.paths.testPlanPath,
		gateCommands: input.context.gateCommands,
		reviewerResultsJson: JSON.stringify(
			{
				rawReviewerAggregateOutcome: input.rawReviewerAggregateOutcome,
				blockedReviewerCount,
				reviewerLabels,
				verifierResults: input.verifierResults,
			},
			null,
			2,
		),
	});
	await input.progressTracker?.recordVerifierLaneStarted({
		label: input.context.reconciler.label,
		provider: input.context.reconciler.provider,
		phase: "epic-review-reconcile",
		summary: "Internal epic review reconciliation started.",
	});
	const execution = await executeReconciliation({
		provider: input.context.reconciler.provider,
		cwd: input.context.providerCwd,
		model: input.context.reconciler.model,
		reasoningEffort: input.context.reconciler.reasoningEffort,
		prompt: prompt.prompt,
		env: input.env,
		timeoutMs: input.context.reconcileTimeoutMs,
		startupTimeoutMs: input.context.startupTimeoutMs,
		silenceTimeoutMs: input.context.reconcileSilenceTimeoutMs,
		streamOutputPaths: input.streamOutputPaths,
		lifecycleCallback: (event) =>
			input.progressTracker?.handleVerifierLaneLifecycle(
				input.context.reconciler.label,
				event,
			),
	});

	if ("errors" in execution) {
		await input.progressTracker?.recordVerifierLaneFailed({
			label: input.context.reconciler.label,
			provider: input.context.reconciler.provider,
			phase: "epic-review-reconcile",
			summary: "Internal epic review reconciliation failed.",
			metadata: {
				errorCodes: execution.errors.map((error) => error.code),
			},
		});
		return {
			errors: execution.errors,
		};
	}

	await input.progressTracker?.recordVerifierLaneCompleted({
		label: input.context.reconciler.label,
		provider: input.context.reconciler.provider,
		phase: "epic-review-reconcile",
		summary: "Internal epic review reconciliation completed.",
		metadata: {
			gateResult: execution.canonicalReview.gateResult,
			reviewerLabels,
		},
		verifiersCompleted: input.verifierResults.length,
	});

	const returnedLabels = [...execution.canonicalReview.reviewerLabels].sort();
	if (returnedLabels.join("\n") !== [...reviewerLabels].sort().join("\n")) {
		return {
			errors: [
				blockedError(
					"PROVIDER_OUTPUT_INVALID",
					"Internal epic review reconciliation returned reviewerLabels that do not match the completed reviewer results.",
					`expected=${reviewerLabels.join(", ")}; actual=${execution.canonicalReview.reviewerLabels.join(", ")}`,
				),
			],
		};
	}

	return {
		canonicalReview: execution.canonicalReview,
		errors: [],
	};
}

export async function runEpicReview(input: {
	specPackRoot: string;
	configPath?: string;
	env?: Record<string, string | undefined>;
	artifactPath?: string;
	streamOutputPaths?: ProviderStreamOutputPaths;
	runtimeProgressPaths?: RuntimeProgressPaths;
	callerHarness?: CallerHarness;
	heartbeatCadenceMinutes?: number;
	disableHeartbeats?: boolean;
	progressListener?: (event: AttachedProgressEvent) => void;
}): Promise<EpicReviewWorkflowResult> {
	const context = await prepareEpicReviewContext(input);
	if ("errors" in context) {
		return {
			outcome: "block",
			errors: context.errors,
			warnings: [],
		};
	}

	const progressTracker = input.runtimeProgressPaths
		? await RuntimeProgressTracker.start({
				command: "epic-review",
				phase: "epic-verifier-1",
				provider: context.verifiers[0]?.provider ?? "claude-code",
				cwd: context.providerCwd,
				timeoutMs: context.timeoutMs,
				configuredStartupTimeoutMs: context.startupTimeoutMs,
				configuredSilenceTimeoutMs: context.silenceTimeoutMs,
				artifactPath:
					input.artifactPath ?? input.runtimeProgressPaths.statusPath,
				streamPaths: {
					stdoutPath: input.streamOutputPaths?.stdoutPath ?? "",
					stderrPath: input.streamOutputPaths?.stderrPath ?? "",
				},
				progressPaths: input.runtimeProgressPaths,
				verifiersCompleted: 0,
				verifiersPlanned: context.verifiers.length,
				verifierLanes: context.verifiers.map((verifier) => ({
					label: verifier.label,
					provider: verifier.provider,
				})),
			})
		: undefined;

	const heartbeat = progressTracker
		? createPrimitiveHeartbeatEmitter({
				command: "epic-review",
				config: context.callerHarnessConfig,
				callerHarness: input.callerHarness,
				heartbeatCadenceMinutes: input.heartbeatCadenceMinutes,
				disableHeartbeats: input.disableHeartbeats,
				progressListener: input.progressListener,
				readSnapshot: () => progressTracker.getSnapshot(),
			})
		: null;
	heartbeat?.start();
	let completedVerifiers = 0;
	try {
		const executions = await Promise.all(
			context.verifiers.map(async (verifier, index) => {
				const prompt = await assemblePrompt({
					role: "epic_verifier",
					reviewerLabel: verifier.label,
					epicPath: context.paths.epicPath,
					techDesignPath: context.paths.techDesignPath,
					techDesignCompanionPaths: context.paths.techDesignCompanionPaths,
					testPlanPath: context.paths.testPlanPath,
					gateCommands: context.gateCommands,
				});
				await progressTracker?.recordVerifierLaneStarted({
					label: verifier.label,
					provider: verifier.provider,
					phase: `epic-verifier-${index + 1}`,
					summary: `${verifier.label} started for epic review.`,
				});
				const execution = await executeVerifier({
					provider: verifier.provider,
					cwd: context.providerCwd,
					model: verifier.model,
					reasoningEffort: verifier.reasoningEffort,
					prompt: prompt.prompt,
					env: input.env,
					timeoutMs: context.timeoutMs,
					startupTimeoutMs: context.startupTimeoutMs,
					silenceTimeoutMs: context.silenceTimeoutMs,
					streamOutputPaths: input.streamOutputPaths,
					lifecycleCallback: (event) =>
						progressTracker?.handleVerifierLaneLifecycle(verifier.label, event),
				});

				if ("errors" in execution) {
					await progressTracker?.recordVerifierLaneFailed({
						label: verifier.label,
						provider: verifier.provider,
						phase: `epic-verifier-${index + 1}`,
						summary: `${verifier.label} failed for epic review.`,
						metadata: {
							errorCodes: execution.errors.map((error) => error.code),
						},
					});
					return execution;
				}

				completedVerifiers += 1;
				await progressTracker?.recordVerifierLaneCompleted({
					label: verifier.label,
					provider: verifier.provider,
					phase: `epic-verifier-${index + 1}`,
					summary: `${verifier.label} completed for epic review.`,
					metadata: {
						gateResult: execution.payload.gateResult,
					},
					verifiersCompleted: completedVerifiers,
				});

				return {
					result: buildVerifierResult({
						verifier,
						payload: execution.payload,
					}),
				};
			}),
		);

		const errors = executions.flatMap((execution) =>
			"errors" in execution ? execution.errors : [],
		);
		const verifierResults = executions.flatMap((execution) =>
			"result" in execution ? [execution.result] : [],
		);
		if (errors.length > 0) {
			await progressTracker?.markFailed(
				"epic-review failed during provider execution.",
				{
					errors: errors.map((error) => error.code),
					verifiersCompleted: completedVerifiers,
				},
			);
			await progressTracker?.flush();
			return {
				outcome: "block",
				result:
					verifierResults.length > 0
						? buildVerifierBatchResult({
								outcome: "block",
								verifierResults,
								canonicalReview: reconcileEpicReview(verifierResults, "block"),
							})
						: undefined,
				errors,
				warnings: [],
			};
		}

		const rawReviewerAggregateOutcome =
			aggregateEpicVerifierBatchOutcome(verifierResults);
		const canonicalReview = await buildCanonicalReview({
			context,
			verifierResults,
			rawReviewerAggregateOutcome,
			env: input.env,
			streamOutputPaths: input.streamOutputPaths,
			progressTracker,
		});
		if (canonicalReview.errors.length > 0 || !canonicalReview.canonicalReview) {
			await progressTracker?.markFailed(
				"epic-review failed during internal reconciliation.",
				{
					errors: canonicalReview.errors.map((error) => error.code),
					verifiersCompleted: completedVerifiers,
				},
			);
			await progressTracker?.flush();
			return {
				outcome: "block",
				errors: canonicalReview.errors,
				warnings: [],
			};
		}

		const outcome = canonicalReview.canonicalReview.outcome;
		await progressTracker?.markCompleted(
			`epic-review completed with outcome ${outcome}.`,
			{
				outcome,
				rawReviewerAggregateOutcome,
				verifiersCompleted: completedVerifiers,
			},
		);
		await progressTracker?.flush();

		return {
			outcome,
			result: buildVerifierBatchResult({
				outcome,
				verifierResults,
				canonicalReview: canonicalReview.canonicalReview,
			}),
			errors: [],
			warnings: [],
		};
	} finally {
		heartbeat?.stop();
	}
}
