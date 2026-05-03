import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
	assertStoryRunArtifactsReady,
	createStoryRunLedger,
} from "../../../src/core/story-run-ledger";
import { readJsonLines } from "../../support/test-helpers";
import {
	createStoryOrchestrateSpecPack,
	seedStoryRunAttempt,
} from "../../support/story-orchestrate-fixtures";
import { writeTextFile } from "../../support/test-helpers";

describe("story-run ledger", () => {
	test("TC-2.4a, TC-2.4b, and TC-2.4c persist current snapshot, append-only events, and a terminal final package", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-run-ledger-persistence",
		);
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const attempt = await ledger.createAttempt();

		await ledger.writeCurrentSnapshot({
			storyId,
			storyRunId: attempt.storyRunId,
			snapshot: {
				storyRunId: attempt.storyRunId,
				storyId,
				attempt: attempt.attempt,
				status: "running",
				lifecycleState: "awaiting_story_lead_action",
				currentSummary: "Fixture run started.",
				currentPhase: "story-orchestrate-run",
				currentChildOperation: null,
				latestArtifacts: [],
				latestContinuationHandles: {},
				latestEventSequence: 0,
				callerInputHistory: {
					reviewRequests: [],
					rulings: [],
				},
				nextIntent: null,
				replayBoundary: null,
				updatedAt: "2026-05-01T00:00:00.000Z",
			},
		});
		await ledger.appendEvent({
			storyId,
			storyRunId: attempt.storyRunId,
			event: {
				storyRunId: attempt.storyRunId,
				sequence: 1,
				timestamp: "2026-05-01T00:00:00.000Z",
				type: "story-run-started",
				summary: "Story run started.",
			},
		});
		await ledger.appendEvent({
			storyId,
			storyRunId: attempt.storyRunId,
			event: {
				storyRunId: attempt.storyRunId,
				sequence: 2,
				timestamp: "2026-05-01T00:01:00.000Z",
				type: "interrupted",
				summary: "Story run interrupted.",
			},
		});
		await ledger.writeFinalPackage({
			storyId,
			storyRunId: attempt.storyRunId,
			finalPackage: {
				outcome: "interrupted",
				storyRunId: attempt.storyRunId,
				storyId,
				attempt: attempt.attempt,
				summary: {
					storyTitle: "Story 0: Foundation",
					implementedScope: "Ledger fixture.",
					acceptanceRationale: "Ledger writes are durable.",
				},
				evidence: {
					implementorArtifacts: [],
					selfReviewArtifacts: [],
					verifierArtifacts: [],
					quickFixArtifacts: [],
					callerInputArtifacts: [],
					gateRuns: [],
				},
				verification: {
					finalVerifierOutcome: "not-run",
					findings: [],
				},
				riskAndDeviationReview: {
					specDeviations: [],
					assumedRisks: [],
					scopeChanges: [],
					shimMockFallbackDecisions: [],
				},
				diffReview: {
					changedFiles: [],
					storyScopedAssessment: "Ledger-only fixture.",
				},
				acceptanceChecks: [],
				callerInputHistory: {
					reviewRequests: [],
					rulings: [],
				},
				replayBoundary: null,
				logHandoff: {
					recommendedState: "BETWEEN_STORIES",
					recommendedCurrentStory: storyId,
					recommendedCurrentPhase: "story-orchestrate",
					continuationHandles: {},
					storyReceiptDraft: {
						storyId,
						storyTitle: "Story 0: Foundation",
						implementorEvidenceRefs: [],
						verifierEvidenceRefs: [],
						gateCommand: "npm run green-verify",
						gateResult: "fail",
						dispositions: [],
						baselineBeforeStory: null,
						baselineAfterStory: null,
						openRisks: [],
					},
					cumulativeBaseline: {
						baselineBeforeCurrentStory: null,
						expectedAfterCurrentStory: null,
						latestActualTotal: null,
					},
					commitReadiness: {
						state: "not-ready",
						reason: "Fixture.",
					},
					openRisks: [],
				},
				cleanupHandoff: {
					acceptedRiskItems: [],
					deferredItems: [],
					cleanupRequired: false,
				},
				rulingRequest: null,
				recommendedImplLeadAction: "reopen",
			},
		});

		expect(await Bun.file(attempt.currentSnapshotPath).exists()).toBe(true);
		expect(await Bun.file(attempt.eventHistoryPath).exists()).toBe(true);
		expect(await Bun.file(attempt.finalPackagePath).exists()).toBe(true);
		expect(
			await ledger.readCurrentSnapshot(attempt.currentSnapshotPath),
		).toEqual(
			expect.objectContaining({
				storyRunId: attempt.storyRunId,
				status: "running",
			}),
		);
		expect(await readJsonLines(attempt.eventHistoryPath)).toEqual([
			expect.objectContaining({
				sequence: 1,
				type: "story-run-started",
			}),
			expect.objectContaining({
				sequence: 2,
				type: "interrupted",
			}),
		]);
		expect(await ledger.readFinalPackage(attempt.finalPackagePath)).toEqual(
			expect.objectContaining({
				outcome: "interrupted",
			}),
		);
	});

	test("TC-2.10b records context-window failure metadata in durable event history and progress mirrors", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-run-ledger-failure",
		);
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const attempt = await ledger.createAttempt();
		await ledger.writeCurrentSnapshot({
			storyId,
			storyRunId: attempt.storyRunId,
			snapshot: {
				storyRunId: attempt.storyRunId,
				storyId,
				attempt: attempt.attempt,
				status: "failed",
				lifecycleState: "terminal",
				currentSummary: "Context window exceeded.",
				currentPhase: "failure",
				currentChildOperation: null,
				latestArtifacts: [],
				latestContinuationHandles: {},
				latestEventSequence: 1,
				callerInputHistory: {
					reviewRequests: [],
					rulings: [],
				},
				nextIntent: {
					actionType: "resume-story-run",
					summary: "Replay from the last durable checkpoint.",
				},
				replayBoundary: null,
				updatedAt: "2026-05-01T01:00:00.000Z",
			},
		});
		await ledger.appendEvent({
			storyId,
			storyRunId: attempt.storyRunId,
			event: {
				storyRunId: attempt.storyRunId,
				sequence: 1,
				timestamp: "2026-05-01T01:00:00.000Z",
				type: "failed",
				summary: "Story-lead hit a context-window limit.",
				data: {
					reason: "context-window-limit",
					recoveryBoundary: {
						storyRunId: attempt.storyRunId,
						checkpoint: "last-durable-snapshot",
					},
				},
			},
		});

		const events = await readJsonLines<{
			data?: {
				reason?: string;
				recoveryBoundary?: {
					checkpoint?: string;
				};
			};
		}>(attempt.eventHistoryPath);

		expect(events[0]?.data?.reason).toBe("context-window-limit");
		expect(events[0]?.data?.recoveryBoundary?.checkpoint).toBe(
			"last-durable-snapshot",
		);
		expect(await Bun.file(attempt.progressHistoryPath).exists()).toBe(true);
		expect(await Bun.file(attempt.progressStatusPath).exists()).toBe(true);
	});

	test("ignores deprecated storyLeadSession fields when reading older snapshots", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-run-ledger-deprecated-session",
		);
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const attempt = await ledger.createAttempt();

		await Bun.write(
			attempt.currentSnapshotPath,
			`${JSON.stringify({
				storyRunId: attempt.storyRunId,
				storyId,
				attempt: attempt.attempt,
				status: "running",
				lifecycleState: "awaiting_story_lead_action",
				currentSummary:
					"Old snapshot still carries a deprecated planner session.",
				currentPhase: "story-lead-awaiting-action",
				currentChildOperation: null,
				latestArtifacts: [],
				latestContinuationHandles: {},
				storyLeadSession: {
					provider: "codex",
					sessionId: "deprecated-session",
					model: "gpt-5.4",
					reasoningEffort: "high",
				},
				latestEventSequence: 0,
				callerInputHistory: {
					reviewRequests: [],
					rulings: [],
				},
				nextIntent: null,
				replayBoundary: null,
				updatedAt: "2026-05-03T00:00:00.000Z",
			})}\n`,
		);

		const snapshot = await ledger.readCurrentSnapshot(
			attempt.currentSnapshotPath,
		);

		expect(snapshot).not.toHaveProperty("storyLeadSession");
		expect(snapshot.lifecycleState).toBe("awaiting_story_lead_action");
	});

	test("TC-3.6a and TC-3.6b preserve prior final packages and record reopen rationale as new history", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-run-ledger-reopen-history",
		);
		const priorAttempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "accepted",
			finalPackageOutcome: "accepted",
			updatedAt: "2026-05-01T00:00:00.000Z",
		});
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const reopenedAttempt = await ledger.createAttempt();
		const priorFinalPackageArtifact = {
			kind: "prior-final-package",
			path: priorAttempt.finalPackagePath,
		} as const;

		await ledger.writeCurrentSnapshot({
			storyId,
			storyRunId: reopenedAttempt.storyRunId,
			snapshot: {
				storyRunId: reopenedAttempt.storyRunId,
				storyId,
				attempt: reopenedAttempt.attempt,
				status: "running",
				lifecycleState: "awaiting_story_lead_action",
				currentSummary: "Reopened attempt is waiting for story-lead action.",
				currentPhase: "reopen-accepted-attempt",
				currentChildOperation: null,
				latestArtifacts: [priorFinalPackageArtifact],
				latestContinuationHandles: {},
				latestEventSequence: 1,
				callerInputHistory: {
					reviewRequests: [
						{
							source: "impl-lead",
							decision: "reopen",
							summary: "Please reopen and add the missing receipt notes.",
							items: [
								{
									id: "review-001",
									severity: "major",
									concern: "Receipt notes are missing.",
									requiredResponse: "Add the missing receipt notes.",
								},
							],
						},
					],
					rulings: [],
				},
				nextIntent: {
					actionType: "reopen-story-run",
					summary: "Review the reopen rationale before the next planner turn.",
					artifactRef: priorAttempt.finalPackagePath,
				},
				replayBoundary: null,
				updatedAt: "2026-05-01T00:05:00.000Z",
			},
		});
		await ledger.appendEvent({
			storyId,
			storyRunId: reopenedAttempt.storyRunId,
			event: {
				storyRunId: reopenedAttempt.storyRunId,
				sequence: 1,
				timestamp: "2026-05-01T00:05:00.000Z",
				type: "story-run-reopened",
				summary:
					"Story orchestration reopened the accepted attempt for additional work.",
				artifact: join(
					specPackRoot,
					"artifacts",
					storyId,
					"story-lead",
					"002-review-request-001.json",
				),
				data: {
					reopenedFromStoryRunId: priorAttempt.storyRunId,
					priorFinalPackagePath: priorAttempt.finalPackagePath,
					rationale: "Please reopen and add the missing receipt notes.",
				},
			},
		});

		const attempts = await ledger.listAttempts();
		const reopenedEvents = await ledger.readEventHistory(
			reopenedAttempt.eventHistoryPath,
		);

		expect(attempts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					storyRunId: priorAttempt.storyRunId,
					finalPackagePath: priorAttempt.finalPackagePath,
					finalPackage: expect.objectContaining({
						outcome: "accepted",
					}),
				}),
				expect.objectContaining({
					storyRunId: reopenedAttempt.storyRunId,
					currentSnapshot: expect.objectContaining({
						latestArtifacts: expect.arrayContaining([
							expect.objectContaining({
								kind: "prior-final-package",
								path: priorAttempt.finalPackagePath,
							}),
						]),
					}),
				}),
			]),
		);
		expect(reopenedEvents).toEqual([
			expect.objectContaining({
				type: "story-run-reopened",
				data: expect.objectContaining({
					reopenedFromStoryRunId: priorAttempt.storyRunId,
					priorFinalPackagePath: priorAttempt.finalPackagePath,
					rationale: "Please reopen and add the missing receipt notes.",
				}),
			}),
		]);
	});

	test("TC-5.1a, TC-5.1b, and TC-5.1c accept only non-empty completed child-operation artifacts", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-run-ledger-non-empty-artifacts",
		);
		const artifactDir = join(specPackRoot, "artifacts", storyId);
		const implementorPath = join(artifactDir, "001-implementor.json");
		const verifierPath = join(artifactDir, "002-verify.json");
		const quickFixPath = join(
			specPackRoot,
			"artifacts",
			"quick-fix",
			"001-quick-fix.json",
		);

		await writeTextFile(implementorPath, '{"ok":"implementor"}\n');
		await writeTextFile(verifierPath, '{"ok":"verifier"}\n');
		await writeTextFile(quickFixPath, '{"ok":"quick-fix"}\n');

		await expect(
			assertStoryRunArtifactsReady([
				{
					kind: "implementor-result",
					path: implementorPath,
					provenance: "current-run",
				},
				{
					kind: "verifier-result",
					path: verifierPath,
					provenance: "current-run",
				},
				{
					kind: "quick-fix-result",
					path: quickFixPath,
					provenance: "current-run",
				},
			]),
		).resolves.toBeUndefined();
	});

	test("TC-5.2a advances child-operation state only after the required artifact is durably present", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-run-ledger-artifact-before-state",
		);
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const attempt = await ledger.createAttempt();
		const artifactPath = join(
			specPackRoot,
			"artifacts",
			storyId,
			"001-implementor.json",
		);
		await writeTextFile(artifactPath, '{"ok":"durable"}\n');

		await ledger.writeCurrentSnapshot({
			storyId,
			storyRunId: attempt.storyRunId,
			snapshot: {
				storyRunId: attempt.storyRunId,
				storyId,
				attempt: attempt.attempt,
				status: "running",
				lifecycleState: "running_child_operation",
				currentSummary: "Implementor is running.",
				currentPhase: "run-implement",
				currentChildOperation: {
					command: "story-implement",
					artifactPath,
				},
				latestArtifacts: [],
				latestContinuationHandles: {},
				latestEventSequence: 0,
				callerInputHistory: {
					reviewRequests: [],
					rulings: [],
				},
				nextIntent: {
					actionType: "await-story-implement",
					summary: "Wait for implementor completion.",
				},
				replayBoundary: null,
				updatedAt: "2026-05-03T12:00:00.000Z",
			},
		});

		await ledger.recordChildOperationCompletion({
			storyRunId: attempt.storyRunId,
			event: {
				storyRunId: attempt.storyRunId,
				sequence: 1,
				timestamp: "2026-05-03T12:01:00.000Z",
				type: "child-operation-completed",
				summary: "story-implement completed with durable output.",
				artifact: artifactPath,
			},
			snapshot: {
				storyRunId: attempt.storyRunId,
				storyId,
				attempt: attempt.attempt,
				status: "running",
				lifecycleState: "awaiting_story_lead_action",
				currentSummary: "story-implement completed with durable output.",
				currentPhase: "story-lead-awaiting-action",
				currentChildOperation: null,
				latestArtifacts: [
					{
						kind: "implementor-result",
						path: artifactPath,
						provenance: "current-run",
					},
				],
				latestContinuationHandles: {},
				latestEventSequence: 1,
				callerInputHistory: {
					reviewRequests: [],
					rulings: [],
				},
				nextIntent: {
					actionType: "await-story-lead-action",
					summary: "Inspect the durable implementor artifact.",
					artifactRef: artifactPath,
				},
				replayBoundary: null,
				updatedAt: "2026-05-03T12:01:00.000Z",
			},
			requiredArtifacts: [
				{
					kind: "implementor-result",
					path: artifactPath,
					provenance: "current-run",
				},
			],
		});

		await expect(
			ledger.readCurrentSnapshot(attempt.currentSnapshotPath),
		).resolves.toEqual(
			expect.objectContaining({
				lifecycleState: "awaiting_story_lead_action",
				latestArtifacts: [
					expect.objectContaining({
						path: artifactPath,
						provenance: "current-run",
					}),
				],
			}),
		);
		await expect(readJsonLines(attempt.eventHistoryPath)).resolves.toEqual([
			expect.objectContaining({
				type: "child-operation-completed",
				artifact: artifactPath,
			}),
		]);
	});

	test("TC-5.2b blocks child-operation state advancement when the required artifact is empty", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-run-ledger-empty-artifact-blocks-state",
		);
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const attempt = await ledger.createAttempt();
		const artifactPath = join(
			specPackRoot,
			"artifacts",
			storyId,
			"001-implementor.json",
		);
		await writeTextFile(artifactPath, "");

		await ledger.writeCurrentSnapshot({
			storyId,
			storyRunId: attempt.storyRunId,
			snapshot: {
				storyRunId: attempt.storyRunId,
				storyId,
				attempt: attempt.attempt,
				status: "running",
				lifecycleState: "running_child_operation",
				currentSummary: "Implementor is still running.",
				currentPhase: "run-implement",
				currentChildOperation: {
					command: "story-implement",
					artifactPath,
				},
				latestArtifacts: [],
				latestContinuationHandles: {},
				latestEventSequence: 0,
				callerInputHistory: {
					reviewRequests: [],
					rulings: [],
				},
				nextIntent: {
					actionType: "await-story-implement",
					summary: "Wait for implementor completion.",
				},
				replayBoundary: null,
				updatedAt: "2026-05-03T12:10:00.000Z",
			},
		});

		await expect(
			ledger.recordChildOperationCompletion({
				storyRunId: attempt.storyRunId,
				event: {
					storyRunId: attempt.storyRunId,
					sequence: 1,
					timestamp: "2026-05-03T12:11:00.000Z",
					type: "child-operation-completed",
					summary: "story-implement returned an empty artifact.",
					artifact: artifactPath,
				},
				snapshot: {
					storyRunId: attempt.storyRunId,
					storyId,
					attempt: attempt.attempt,
					status: "running",
					lifecycleState: "awaiting_story_lead_action",
					currentSummary: "This state advance should be blocked.",
					currentPhase: "story-lead-awaiting-action",
					currentChildOperation: null,
					latestArtifacts: [
						{
							kind: "implementor-result",
							path: artifactPath,
							provenance: "current-run",
						},
					],
					latestContinuationHandles: {},
					latestEventSequence: 1,
					callerInputHistory: {
						reviewRequests: [],
						rulings: [],
					},
					nextIntent: {
						actionType: "await-story-lead-action",
						summary: "This state advance should be blocked.",
						artifactRef: artifactPath,
					},
					replayBoundary: null,
					updatedAt: "2026-05-03T12:11:00.000Z",
				},
				requiredArtifacts: [
					{
						kind: "implementor-result",
						path: artifactPath,
						provenance: "current-run",
					},
				],
			}),
		).rejects.toThrow(/empty/u);

		await expect(
			ledger.readCurrentSnapshot(attempt.currentSnapshotPath),
		).resolves.toEqual(
			expect.objectContaining({
				lifecycleState: "running_child_operation",
				currentChildOperation: expect.objectContaining({
					artifactPath,
				}),
			}),
		);
		expect(await Bun.file(attempt.eventHistoryPath).exists()).toBe(false);
	});
});
