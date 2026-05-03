import { describe, expect, test } from "vitest";

import { createStoryRunLedger } from "../../../src/core/story-run-ledger";
import { readJsonLines } from "../../support/test-helpers";
import { createStoryOrchestrateSpecPack } from "../../support/story-orchestrate-fixtures";

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
});
