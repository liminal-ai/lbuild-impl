import { describe, expect, test } from "vitest";
import { runStoryLead } from "../../../src/core/story-lead";
import { createStoryRunLedger } from "../../../src/core/story-run-ledger";
import {
	storyOrchestrateResume,
	storyOrchestrateRun,
	storyOrchestrateStatus,
} from "../../../src/sdk/operations/story-orchestrate";
import {
	createMiniStoryRuntimeProofFixture,
	installMiniStoryRuntimeProofProviders,
} from "../../support/story-lead-runtime-proof-fixture";
import {
	createStoryOrchestrateSpecPack,
	seedPrimitiveArtifact,
	seedStoryRunAttempt,
} from "../../support/story-orchestrate-fixtures";
import {
	createTempDir,
	readJsonLines,
	writeFakeProviderExecutable,
	writeTextFile,
} from "../../support/test-helpers";

function providerWrapper(sessionId: string, payload: unknown): string {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

describe("story-lead loop", () => {
	test("proof: story-orchestrate should dispatch child operations and persist their artifacts for a fresh mini runtime fixture", async () => {
		const fixture = await createMiniStoryRuntimeProofFixture(
			"story-lead-loop-proof-runtime-dispatch",
		);
		const providers = await installMiniStoryRuntimeProofProviders(fixture);
		const childArtifactPaths = Object.values(fixture.childArtifactPaths);

		for (const artifactPath of childArtifactPaths) {
			expect(await Bun.file(artifactPath).exists()).toBe(false);
		}

		const runEnvelope = await storyOrchestrateRun({
			specPackRoot: fixture.specPackRoot,
			storyId: fixture.storyId,
			env: providers.env,
		});

		if (runEnvelope.result?.case !== "completed") {
			throw new Error(
				`Expected the mini runtime proof fixture to complete, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		const storyLeadInvocations = await readJsonLines<
			Array<{ provider: string; args: string[] }>[number]
		>(providers.storyLeadLogPath);
		const childInvocations = (await Bun.file(
			providers.childProviderLogPath,
		).exists())
			? await readJsonLines<
					Array<{ provider: string; args: string[] }>[number]
				>(providers.childProviderLogPath)
			: [];
		const currentSnapshot = JSON.parse(
			await Bun.file(runEnvelope.result.currentSnapshotPath).text(),
		) as {
			latestArtifacts: Array<{ kind: string; path: string }>;
			latestContinuationHandles: Record<
				string,
				{ provider: string; sessionId: string; storyId: string }
			>;
		};
		const events = await readJsonLines<
			Array<{ type: string; artifact?: string }>[number]
		>(runEnvelope.result.eventHistoryPath);

		expect(storyLeadInvocations).toHaveLength(4);
		expect(childInvocations).toHaveLength(3);
		expect(
			storyLeadInvocations.some((invocation) =>
				invocation.args.includes("resume"),
			),
		).toBe(false);
		expect(
			childInvocations.some((invocation) =>
				invocation.args.some((arg) => arg.includes("--resume=")),
			),
		).toBe(true);
		for (const artifactPath of childArtifactPaths) {
			expect(await Bun.file(artifactPath).exists()).toBe(true);
		}
		expect(
			runEnvelope.result.finalPackage.evidence.implementorArtifacts,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: fixture.childArtifactPaths.implementor,
				}),
			]),
		);
		expect(
			runEnvelope.result.finalPackage.evidence.selfReviewArtifacts,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: fixture.childArtifactPaths.selfReviewBatch,
				}),
			]),
		);
		expect(runEnvelope.result.finalPackage.evidence.verifierArtifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: fixture.childArtifactPaths.verifier,
				}),
			]),
		);
		expect(currentSnapshot.latestArtifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: fixture.childArtifactPaths.implementor,
				}),
				expect.objectContaining({
					path: fixture.childArtifactPaths.selfReviewBatch,
				}),
				expect.objectContaining({
					path: fixture.childArtifactPaths.verifier,
				}),
			]),
		);
		expect(Object.values(currentSnapshot.latestContinuationHandles)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					storyId: fixture.storyId,
				}),
			]),
		);
		expect(
			events.some((event) => childArtifactPaths.includes(event.artifact ?? "")),
		).toBe(true);
	});

	test("collects current-run quick-fix artifacts into the final package when the story-lead chooses run-quick-fix", async () => {
		const fixture = await createMiniStoryRuntimeProofFixture(
			"story-lead-loop-quick-fix-evidence",
		);
		const providerBinDir = await createTempDir(
			`story-lead-loop-quick-fix-${fixture.storyId}`,
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-quick-fix-001", {
						action: "run-quick-fix",
						rationale:
							"Exercise the quick-fix lane and require the runtime to collect fresh quick-fix evidence.",
						inputs: {
							remediationGoal:
								"Apply one bounded quick-fix change for the mini runtime proof fixture only.",
						},
					}),
				},
				{
					stdout: providerWrapper("codex-story-lead-quick-fix-001", {
						action: "accept-story",
						rationale:
							"The quick-fix artifact is present and ready for scoped acceptance packaging.",
						inputs: {
							summary:
								"The quick-fix artifact is present and ready for scoped acceptance packaging.",
							acceptanceCheckRefs: ["quick-fix-artifact-created"],
							acceptanceChecks: [
								{
									name: "quick-fix-artifact-created",
									status: "pass" as const,
									evidence: ["quick-fix-result"],
									reasoning:
										"The bounded quick-fix operation produced a fresh artifact during the story-lead run.",
								},
							],
							recommendedImplLeadAction: "accept" as const,
						},
					}),
				},
			],
		});
		const childProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "copilot",
			responses: [
				{
					stdout:
						"Applied the bounded quick-fix correction for the mini runtime proof fixture.\n",
				},
			],
		});

		const runEnvelope = await storyOrchestrateRun({
			specPackRoot: fixture.specPackRoot,
			storyId: fixture.storyId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
				...childProvider.env,
			},
		});

		if (runEnvelope.result?.case !== "completed") {
			throw new Error(
				`Expected the quick-fix fixture to complete, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		expect(runEnvelope.result.finalPackage.evidence.quickFixArtifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: expect.stringContaining("/artifacts/quick-fix/"),
				}),
			]),
		);
		expect(runEnvelope.result.finalPackage.acceptanceChecks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "quick-fix-artifact-created",
				}),
			]),
		);
		expect(runEnvelope.result.finalPackage.recommendedImplLeadAction).toBe(
			"reopen",
		);
	});

	test("preserves verifier dispositions and shim/mock audit findings through final package handoffs", async () => {
		const fixture = await createMiniStoryRuntimeProofFixture(
			"story-lead-loop-flow-3-verifier-risk-handoff",
		);
		const providerBinDir = await createTempDir(
			`story-lead-loop-flow-3-${fixture.storyId}`,
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-flow-3-001", {
						action: "run-implement",
						rationale: "Create implementor evidence before verification.",
						inputs: {},
					}),
				},
				{
					stdout: providerWrapper("codex-story-lead-flow-3-001", {
						action: "run-self-review",
						rationale: "Create self-review evidence before verification.",
						inputs: {
							artifactRefs: [fixture.childArtifactPaths.implementor],
							continuationRef: "storyImplementor",
							passes: 1,
						},
					}),
				},
				{
					stdout: providerWrapper("codex-story-lead-flow-3-001", {
						action: "run-verify",
						rationale:
							"Run story verification so verifier findings and shim audit data exist.",
						inputs: {
							artifactRefs: [fixture.childArtifactPaths.selfReviewBatch],
						},
					}),
				},
				{
					stdout: providerWrapper("codex-story-lead-flow-3-001", {
						action: "accept-story",
						rationale:
							"Preserve explicit verifier dispositions into Flow 3 handoffs.",
						verification: {
							finalVerifierOutcome: "pass" as const,
							findings: [
								{
									id: "F-fixed",
									status: "fixed" as const,
									evidence: ["quick-fix-result"],
								},
								{
									id: "F-risk",
									status: "accepted-risk" as const,
									evidence: ["risk-ruling.md"],
								},
								{
									id: "F-defer",
									status: "defer" as const,
									evidence: ["cleanup-followup.md"],
								},
							],
						},
						inputs: {
							summary:
								"Preserve explicit verifier dispositions into Flow 3 handoffs.",
							acceptanceCheckRefs: ["flow-3-disposition-handoff"],
							acceptanceChecks: [
								{
									name: "flow-3-disposition-handoff",
									status: "pass" as const,
									evidence: ["story-lead-action"],
									reasoning:
										"Story-lead explicitly classified verifier finding dispositions for handoff packaging.",
								},
							],
							recommendedImplLeadAction: "accept" as const,
						},
					}),
				},
			],
		});
		const childProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "copilot",
			responses: [
				{
					stdout: providerWrapper("copilot-flow-3-implement-001", {
						outcome: "ready-for-verification",
						planSummary: "Prepared Flow 3 risk handoff evidence.",
						changedFiles: [
							{
								path: "integration-fixture.txt",
								reason: "Keep the mini story deterministic.",
							},
						],
						tests: {
							added: [],
							modified: [],
							removed: [],
							totalAfterStory: 3,
							deltaFromPriorBaseline: 0,
						},
						gatesRun: [
							{ command: "npm run green-verify", result: "pass" as const },
						],
						selfReview: {
							findingsFixed: [],
							findingsSurfaced: [],
						},
						openQuestions: [],
						specDeviations: [],
						recommendedNextStep: "Run self-review.",
					}),
				},
				{
					stdout: providerWrapper("copilot-flow-3-implement-001", {
						outcome: "ready-for-verification",
						planSummary: "Self-reviewed Flow 3 risk handoff evidence.",
						changedFiles: [
							{
								path: "integration-fixture.txt",
								reason: "Keep the mini story deterministic.",
							},
						],
						tests: {
							added: [],
							modified: [],
							removed: [],
							totalAfterStory: 3,
							deltaFromPriorBaseline: 0,
						},
						gatesRun: [
							{ command: "npm run green-verify", result: "pass" as const },
						],
						selfReview: {
							findingsFixed: ["F-fixed"],
							findingsSurfaced: [],
						},
						openQuestions: [],
						specDeviations: [],
						recommendedNextStep: "Run verification.",
					}),
				},
				{
					stdout: providerWrapper("copilot-flow-3-verify-001", {
						artifactsRead: [
							fixture.storyPath,
							fixture.techDesignPath,
							fixture.childArtifactPaths.implementor,
							fixture.childArtifactPaths.selfReviewBatch,
						],
						reviewScopeSummary:
							"Reviewed Flow 3 disposition and shim/mock handoff behavior.",
						priorFindingStatuses: [],
						newFindings: [
							{
								id: "F-risk",
								severity: "major" as const,
								title: "Accepted risk needs receipt carry-forward.",
								evidence: "risk-ruling.md",
								affectedFiles: ["src/core/story-lead.ts"],
								requirementIds: ["AC-3.7"],
								recommendedFixScope: "human-ruling" as const,
								blocking: false,
							},
							{
								id: "F-defer",
								severity: "minor" as const,
								title: "Deferred finding needs cleanup carry-forward.",
								evidence: "cleanup-followup.md",
								affectedFiles: ["src/core/cleanup-handoff.ts"],
								requirementIds: ["AC-3.10"],
								recommendedFixScope: "fresh-fix-path" as const,
								blocking: false,
							},
						],
						openFindings: [
							{
								id: "F-risk",
								severity: "major" as const,
								title: "Accepted risk needs receipt carry-forward.",
								evidence: "risk-ruling.md",
								affectedFiles: ["src/core/story-lead.ts"],
								requirementIds: ["AC-3.7"],
								recommendedFixScope: "human-ruling" as const,
								blocking: false,
							},
							{
								id: "F-defer",
								severity: "minor" as const,
								title: "Deferred finding needs cleanup carry-forward.",
								evidence: "cleanup-followup.md",
								affectedFiles: ["src/core/cleanup-handoff.ts"],
								requirementIds: ["AC-3.10"],
								recommendedFixScope: "fresh-fix-path" as const,
								blocking: false,
							},
						],
						requirementCoverage: {
							verified: ["AC-3.7", "AC-3.10"],
							unverified: [],
						},
						gatesRun: [
							{ command: "npm run green-verify", result: "pass" as const },
						],
						mockOrShimAuditFindings: [
							"Verifier found a production-path mock fallback that requires explicit approval.",
						],
						recommendedNextStep: "pass" as const,
						recommendedFixScope: "same-session-implementor" as const,
						openQuestions: [],
						additionalObservations: [],
					}),
				},
			],
		});

		const runEnvelope = await storyOrchestrateRun({
			specPackRoot: fixture.specPackRoot,
			storyId: fixture.storyId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
				...childProvider.env,
			},
		});

		if (runEnvelope.result?.case !== "completed") {
			throw new Error(
				`Expected Flow 3 handoff fixture to complete, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		const finalPackage = runEnvelope.result.finalPackage;
		expect(finalPackage.verification.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "F-fixed", status: "fixed" }),
				expect.objectContaining({ id: "F-risk", status: "accepted-risk" }),
				expect.objectContaining({ id: "F-defer", status: "defer" }),
			]),
		);
		expect(finalPackage.logHandoff.storyReceiptDraft.dispositions).toEqual(
			finalPackage.verification.findings,
		);
		expect(finalPackage.cleanupHandoff.acceptedRiskItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					description: "Verification finding F-risk accepted as risk.",
				}),
			]),
		);
		expect(finalPackage.cleanupHandoff.deferredItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					description:
						"Verification finding F-defer deferred for follow-up cleanup.",
				}),
			]),
		);
		expect(
			finalPackage.riskAndDeviationReview.shimMockFallbackDecisions,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					description:
						"Verifier found a production-path mock fallback that requires explicit approval.",
					approvalStatus: "needs-ruling",
				}),
			]),
		);
		expect(
			finalPackage.acceptanceChecks.find(
				(check) => check.name === "shim-mock-fallback-status",
			)?.status,
		).toBe("fail");
	});

	test("keeps production shim/mock needs-ruling decisions on the ruling path instead of exporting them as cleanup debt", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-loop-shim-ruling",
			{
				includeStoryLead: true,
			},
		);
		await seedPrimitiveArtifact({
			specPackRoot,
			storyId,
			fileName: "001-implementor.json",
			payload: {
				command: "story-implement",
				outcome: "ready-for-verification",
			},
		});
		await seedPrimitiveArtifact({
			specPackRoot,
			storyId,
			fileName: "002-verifier.json",
			payload: {
				command: "story-verify",
				outcome: "pass",
			},
		});

		const providerBinDir = await createTempDir(
			`story-lead-loop-shim-ruling-${storyId}`,
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-shim-ruling-001", {
						action: "accept-story",
						rationale:
							"Acceptance can proceed only if the caller explicitly approves the production fallback.",
						inputs: {
							summary:
								"Acceptance can proceed only if the caller explicitly approves the production fallback.",
							acceptanceCheckRefs: ["shim-ruling-required"],
							acceptanceChecks: [
								{
									name: "shim-ruling-required",
									status: "pass" as const,
									evidence: ["fallback.md"],
									reasoning:
										"Story-lead preserved the shim/mock authority boundary instead of silently accepting it.",
								},
							],
							recommendedImplLeadAction: "accept" as const,
						},
						riskAndDeviationReview: {
							shimMockFallbackDecisions: [
								{
									description:
										"Production fallback still needs caller approval.",
									reasoning:
										"Story-lead cannot silently approve a production fallback in the acceptance path.",
									evidence: ["fallback.md"],
									approvalStatus: "needs-ruling" as const,
									approvalSource: null,
								},
							],
						},
					}),
				},
			],
		});

		const runEnvelope = await storyOrchestrateRun({
			specPackRoot,
			storyId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
			},
		});

		if (runEnvelope.result?.case !== "completed") {
			throw new Error(
				`Expected shim/mock ruling fixture to complete, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		expect(runEnvelope.result.finalPackage.outcome).toBe("needs-ruling");
		expect(runEnvelope.result.finalPackage.rulingRequest).toEqual(
			expect.objectContaining({
				decisionType: "shim-mock-fallback",
			}),
		);
		expect(
			runEnvelope.result.finalPackage.cleanupHandoff.acceptedRiskItems,
		).toEqual([]);
		expect(
			runEnvelope.result.finalPackage.cleanupHandoff.deferredItems,
		).toEqual([]);
		expect(runEnvelope.result.finalPackage.cleanupHandoff.cleanupRequired).toBe(
			false,
		);
	});

	test("records an interrupted story-run when a child operation crashes before a recoverable follow-up turn can complete", async () => {
		const fixture = await createMiniStoryRuntimeProofFixture(
			"story-lead-loop-failed-outcome",
		);
		const providerBinDir = await createTempDir(
			`story-lead-loop-failed-${fixture.storyId}`,
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-failed-001", {
						action: "run-implement",
						rationale:
							"Attempt the bounded implementor step so the runtime can surface a terminal child-operation failure.",
						inputs: {},
					}),
				},
			],
		});
		const childProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "copilot",
			responses: [
				{
					stderr: "simulated child provider failure",
					exitCode: 1,
				},
			],
		});

		const runEnvelope = await storyOrchestrateRun({
			specPackRoot: fixture.specPackRoot,
			storyId: fixture.storyId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
				...childProvider.env,
			},
		});

		if (runEnvelope.result?.case !== "interrupted") {
			throw new Error(
				`Expected the failed-outcome fixture to interrupt, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		const currentSnapshot = JSON.parse(
			await Bun.file(runEnvelope.result.currentSnapshotPath).text(),
		) as {
			status: string;
		};
		const events = await readJsonLines<Array<{ type: string }>[number]>(
			runEnvelope.result.eventHistoryPath,
		);

		expect(runEnvelope.outcome).toBe("interrupted");
		expect(currentSnapshot.status).toBe("interrupted");
		expect(runEnvelope.result.finalPackagePath).toContain("final-package.json");
		expect(runEnvelope.result.finalPackage).toEqual(
			expect.objectContaining({
				outcome: "interrupted",
				replayBoundary: expect.objectContaining({
					smallestSafeStep: "resume-current-attempt",
				}),
			}),
		);
		expect(runEnvelope.result.recoveryGuidance).toContain(
			"story-orchestrate resume",
		);
		expect(events.map((event) => event.type)).toContain(
			"story-lead-turn-limit",
		);
	});

	test("TC-2.6b, TC-3.5d, TC-3.9a, and TC-3.9b preserve review history across a reopened accepted attempt", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-loop-reopen",
			{
				includeStoryLead: true,
			},
		);
		const providerBinDir = await createTempDir("story-lead-loop-reopen-bin");
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-reopen-001", {
						action: "block-story",
						rationale:
							"Keep the reopened attempt blocked until the impl-lead review request is addressed.",
						inputs: {
							reason: "Please reopen and address the missing package notes.",
							evidence: ["review-001"],
						},
					}),
				},
			],
		});
		const acceptedAttempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "accepted",
			finalPackageOutcome: "accepted",
		});
		for (const artifact of [
			{
				kind: "implementor-result",
				path: `/tmp/spec-pack/artifacts/${storyId}/001-implementor.json`,
			},
			{
				kind: "verifier-result",
				path: `/tmp/spec-pack/artifacts/${storyId}/002-verifier.json`,
			},
		]) {
			await writeTextFile(
				artifact.path,
				`${JSON.stringify(
					{
						command:
							artifact.kind === "verifier-result"
								? "story-verify"
								: "story-implement",
						ok: true,
					},
					null,
					2,
				)}\n`,
			);
		}

		const resumeEnvelope = await storyOrchestrateResume({
			specPackRoot,
			storyId,
			storyRunId: acceptedAttempt.storyRunId,
			reviewRequest: {
				source: "impl-lead",
				decision: "reopen",
				summary: "Please reopen and address the missing package notes.",
				items: [
					{
						id: "review-001",
						severity: "major",
						concern: "Package notes are missing.",
						requiredResponse: "Add the missing notes to the handoff package.",
					},
				],
			},
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
			},
		});

		if (resumeEnvelope.result?.case !== "completed") {
			throw new Error("Expected the reopened resume envelope to complete.");
		}

		const reopenedStoryRunId = resumeEnvelope.result.storyRunId;
		const explicitStatus = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
			storyRunId: reopenedStoryRunId,
		});
		const priorAcceptedStatus = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
			storyRunId: acceptedAttempt.storyRunId,
		});
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const reopenedAttempt =
			await ledger.getAttemptByStoryRunId(reopenedStoryRunId);
		const events = reopenedAttempt
			? await readJsonLines<Array<{ type: string }>[number]>(
					reopenedAttempt.eventHistoryPath,
				)
			: [];

		expect(resumeEnvelope.outcome).toBe("blocked");
		expect(reopenedStoryRunId).not.toBe(acceptedAttempt.storyRunId);
		expect(
			resumeEnvelope.result.finalPackage.callerInputHistory.reviewRequests,
		).toHaveLength(1);
		expect(resumeEnvelope.result.finalPackage.verification.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "review-001",
					status: "unresolved",
				}),
			]),
		);
		expect(
			resumeEnvelope.result.finalPackage.evidence.callerInputArtifacts,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "prior-final-package",
				}),
				expect.objectContaining({
					kind: "review-request",
				}),
			]),
		);
		expect(explicitStatus.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				storyRunId: reopenedStoryRunId,
				currentSnapshot: expect.objectContaining({
					callerInputHistory: expect.objectContaining({
						reviewRequests: [
							expect.objectContaining({
								summary: "Please reopen and address the missing package notes.",
							}),
						],
					}),
				}),
			}),
		);
		expect(priorAcceptedStatus.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				storyRunId: acceptedAttempt.storyRunId,
				currentStatus: "accepted",
			}),
		);
		expect(events.map((event) => event.type)).toEqual(
			expect.arrayContaining(["story-run-reopened", "review-request-received"]),
		);
	});

	test("TC-3.5a and TC-3.5c classify primitive implementor and verifier artifacts into the correct final-package evidence buckets", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-loop-evidence-split",
			{
				includeStoryLead: true,
			},
		);
		const implementorPath = `${specPackRoot}/artifacts/${storyId}/001-implementor.json`;
		const verifierPath = `${specPackRoot}/artifacts/${storyId}/002-verifier.json`;
		const providerBinDir = await createTempDir(
			"story-lead-loop-evidence-split-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-evidence-split-001", {
						action: "accept-story",
						rationale:
							"The primitive implementor and verifier artifacts are sufficient for scoped acceptance packaging.",
						inputs: {
							summary:
								"The primitive implementor and verifier artifacts are sufficient for scoped acceptance packaging.",
							acceptanceCheckRefs: ["primitive-evidence-split"],
							recommendedImplLeadAction: "accept" as const,
						},
					}),
				},
			],
		});
		await seedPrimitiveArtifact({
			specPackRoot,
			storyId,
			fileName: "001-implementor.json",
			payload: {
				command: "story-implement",
				outcome: "ready-for-verification",
			},
		});
		await seedPrimitiveArtifact({
			specPackRoot,
			storyId,
			fileName: "002-verifier.json",
			payload: {
				command: "story-verify",
				outcome: "pass",
			},
		});
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});

		const runtime = await runStoryLead({
			specPackRoot,
			storyId,
			ledger,
			mode: "run",
			startedFromPrimitiveArtifacts: [implementorPath, verifierPath],
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
			},
		});

		if (runtime.case !== "completed" || !runtime.finalPackage) {
			throw new Error(
				"Expected a completed final package for evidence-split coverage.",
			);
		}

		expect(runtime.finalPackage.evidence.implementorArtifacts).toEqual([
			expect.objectContaining({
				path: implementorPath,
			}),
		]);
		expect(runtime.finalPackage.evidence.verifierArtifacts).toEqual([
			expect.objectContaining({
				path: verifierPath,
			}),
		]);
		expect(runtime.finalPackage.verification.finalVerifierOutcome).toBe("pass");
		expect(
			runtime.finalPackage.acceptanceChecks.find(
				(check) => check.name === "final-verifier-result",
			)?.status,
		).toBe("pass");
	});

	test("derives a revise verifier outcome from recorded verifier evidence instead of artifact presence", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-loop-verifier-revise",
			{
				includeStoryLead: true,
			},
		);
		const implementorPath = `${specPackRoot}/artifacts/${storyId}/001-implementor.json`;
		const verifierPath = `${specPackRoot}/artifacts/${storyId}/002-verifier.json`;
		const providerBinDir = await createTempDir(
			"story-lead-loop-verifier-revise-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-verifier-revise-001", {
						action: "accept-story",
						rationale:
							"Finalize from the recorded primitive verifier evidence so the runtime can derive the latest verifier outcome.",
						inputs: {
							summary:
								"Finalize from the recorded primitive verifier evidence so the runtime can derive the latest verifier outcome.",
							acceptanceCheckRefs: ["primitive-verifier-revise"],
							recommendedImplLeadAction: "reopen" as const,
						},
					}),
				},
			],
		});
		await seedPrimitiveArtifact({
			specPackRoot,
			storyId,
			fileName: "001-implementor.json",
			payload: {
				command: "story-implement",
				outcome: "ready-for-verification",
			},
		});
		await seedPrimitiveArtifact({
			specPackRoot,
			storyId,
			fileName: "002-verifier.json",
			payload: {
				command: "story-verify",
				outcome: "revise",
			},
		});

		const runtime = await runStoryLead({
			specPackRoot,
			storyId,
			ledger: createStoryRunLedger({
				specPackRoot,
				storyId,
			}),
			mode: "run",
			startedFromPrimitiveArtifacts: [implementorPath, verifierPath],
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
			},
		});

		if (runtime.case !== "completed" || !runtime.finalPackage) {
			throw new Error(
				"Expected a completed final package for verifier revise coverage.",
			);
		}

		expect(runtime.finalPackage.verification.finalVerifierOutcome).toBe(
			"revise",
		);
		expect(
			runtime.finalPackage.acceptanceChecks.find(
				(check) => check.name === "final-verifier-result",
			)?.status,
		).toBe("fail");
	});

	test("keeps verifier acceptance unknown when recorded verifier outcomes are missing or ambiguous", async () => {
		const missingFixture = await createStoryOrchestrateSpecPack(
			"story-lead-loop-verifier-missing",
			{
				includeStoryLead: true,
			},
		);
		const missingImplementorPath = `${missingFixture.specPackRoot}/artifacts/${missingFixture.storyId}/001-implementor.json`;
		const missingProviderBinDir = await createTempDir(
			"story-lead-loop-verifier-missing-bin",
		);
		const missingStoryLead = await writeFakeProviderExecutable({
			binDir: missingProviderBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-verifier-missing-001", {
						action: "accept-story",
						rationale:
							"Finalize from the primitive artifact set even though verifier evidence is missing.",
						inputs: {
							summary:
								"Finalize from the primitive artifact set even though verifier evidence is missing.",
							acceptanceCheckRefs: ["primitive-verifier-missing"],
							recommendedImplLeadAction: "reopen" as const,
						},
					}),
				},
			],
		});
		await seedPrimitiveArtifact({
			specPackRoot: missingFixture.specPackRoot,
			storyId: missingFixture.storyId,
			fileName: "001-implementor.json",
			payload: {
				command: "story-implement",
				outcome: "ready-for-verification",
			},
		});

		const missingRuntime = await runStoryLead({
			specPackRoot: missingFixture.specPackRoot,
			storyId: missingFixture.storyId,
			ledger: createStoryRunLedger({
				specPackRoot: missingFixture.specPackRoot,
				storyId: missingFixture.storyId,
			}),
			mode: "run",
			startedFromPrimitiveArtifacts: [missingImplementorPath],
			env: {
				PATH: `${missingProviderBinDir}:${process.env.PATH ?? ""}`,
				...missingStoryLead.env,
			},
		});

		if (missingRuntime.case !== "completed" || !missingRuntime.finalPackage) {
			throw new Error(
				"Expected a completed final package for missing verifier coverage.",
			);
		}

		expect(missingRuntime.finalPackage.verification.finalVerifierOutcome).toBe(
			"not-run",
		);
		expect(
			missingRuntime.finalPackage.acceptanceChecks.find(
				(check) => check.name === "final-verifier-result",
			)?.status,
		).toBe("unknown");

		const ambiguousFixture = await createStoryOrchestrateSpecPack(
			"story-lead-loop-verifier-ambiguous",
			{
				includeStoryLead: true,
			},
		);
		const ambiguousImplementorPath = `${ambiguousFixture.specPackRoot}/artifacts/${ambiguousFixture.storyId}/001-implementor.json`;
		const verifierPassPath = `${ambiguousFixture.specPackRoot}/artifacts/${ambiguousFixture.storyId}/002-verifier.json`;
		const verifierRevisePath = `${ambiguousFixture.specPackRoot}/artifacts/${ambiguousFixture.storyId}/003-verifier-followup.json`;
		const ambiguousProviderBinDir = await createTempDir(
			"story-lead-loop-verifier-ambiguous-bin",
		);
		const ambiguousStoryLead = await writeFakeProviderExecutable({
			binDir: ambiguousProviderBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-verifier-ambiguous-001", {
						action: "accept-story",
						rationale:
							"Finalize from the primitive artifact set even though the verifier outcomes are ambiguous.",
						inputs: {
							summary:
								"Finalize from the primitive artifact set even though the verifier outcomes are ambiguous.",
							acceptanceCheckRefs: ["primitive-verifier-ambiguous"],
							recommendedImplLeadAction: "reopen" as const,
						},
					}),
				},
			],
		});
		await seedPrimitiveArtifact({
			specPackRoot: ambiguousFixture.specPackRoot,
			storyId: ambiguousFixture.storyId,
			fileName: "001-implementor.json",
			payload: {
				command: "story-implement",
				outcome: "ready-for-verification",
			},
		});
		await seedPrimitiveArtifact({
			specPackRoot: ambiguousFixture.specPackRoot,
			storyId: ambiguousFixture.storyId,
			fileName: "002-verifier.json",
			payload: {
				command: "story-verify",
				outcome: "pass",
			},
		});
		await seedPrimitiveArtifact({
			specPackRoot: ambiguousFixture.specPackRoot,
			storyId: ambiguousFixture.storyId,
			fileName: "003-verifier-followup.json",
			payload: {
				command: "story-verify",
				outcome: "revise",
			},
		});

		const ambiguousRuntime = await runStoryLead({
			specPackRoot: ambiguousFixture.specPackRoot,
			storyId: ambiguousFixture.storyId,
			ledger: createStoryRunLedger({
				specPackRoot: ambiguousFixture.specPackRoot,
				storyId: ambiguousFixture.storyId,
			}),
			mode: "run",
			startedFromPrimitiveArtifacts: [
				ambiguousImplementorPath,
				verifierPassPath,
				verifierRevisePath,
			],
			env: {
				PATH: `${ambiguousProviderBinDir}:${process.env.PATH ?? ""}`,
				...ambiguousStoryLead.env,
			},
		});

		if (
			ambiguousRuntime.case !== "completed" ||
			!ambiguousRuntime.finalPackage
		) {
			throw new Error(
				"Expected a completed final package for ambiguous verifier coverage.",
			);
		}

		expect(
			ambiguousRuntime.finalPackage.verification.finalVerifierOutcome,
		).toBe("not-run");
		expect(
			ambiguousRuntime.finalPackage.acceptanceChecks.find(
				(check) => check.name === "final-verifier-result",
			)?.status,
		).toBe("unknown");
	});

	test("TC-3.11a and TC-3.11b record the smallest safe replay boundary for provider-output-invalid and context-window failures", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-loop-replay-boundaries",
			{
				includeStoryLead: true,
			},
		);
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const priorFailureMode =
			process.env.LBUILD_IMPL_STORY_ORCHESTRATE_FAILURE_MODE;

		process.env.LBUILD_IMPL_STORY_ORCHESTRATE_FAILURE_MODE =
			"provider-output-invalid";
		const providerFailure = await runStoryLead({
			specPackRoot,
			storyId,
			ledger,
			mode: "run",
			startedFromPrimitiveArtifacts: [
				`${specPackRoot}/artifacts/${storyId}/001-implementor.json`,
			],
		});

		process.env.LBUILD_IMPL_STORY_ORCHESTRATE_FAILURE_MODE =
			"context-window-limit";
		const contextLedger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const contextFailure = await runStoryLead({
			specPackRoot,
			storyId,
			ledger: contextLedger,
			mode: "run",
			startedFromPrimitiveArtifacts: [
				`${specPackRoot}/artifacts/${storyId}/001-implementor.json`,
			],
		});

		if (typeof priorFailureMode === "string") {
			process.env.LBUILD_IMPL_STORY_ORCHESTRATE_FAILURE_MODE = priorFailureMode;
		} else {
			delete process.env.LBUILD_IMPL_STORY_ORCHESTRATE_FAILURE_MODE;
		}

		if (
			providerFailure.case !== "interrupted" ||
			contextFailure.case !== "interrupted"
		) {
			throw new Error("Expected both failure paths to interrupt.");
		}

		const providerStatus = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
			storyRunId: providerFailure.storyRunId,
		});
		const contextStatus = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
			storyRunId: contextFailure.storyRunId,
		});

		expect(providerStatus.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				currentSnapshot: expect.objectContaining({
					replayBoundary: expect.objectContaining({
						smallestSafeStep: "resume-from-last-valid-artifact",
						requiresFreshChildProviderSession: true,
					}),
				}),
			}),
		);
		expect(contextStatus.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				currentSnapshot: expect.objectContaining({
					replayBoundary: expect.objectContaining({
						smallestSafeStep: "rehydrate-from-durable-ledger",
						requiresFreshStoryLeadSession: true,
					}),
				}),
			}),
		);
	});
});
