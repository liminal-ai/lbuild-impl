import { describe, expect, test } from "vitest";

import { createStoryRunLedger } from "../../../src/core/story-run-ledger";
import { storyOrchestrateStatus } from "../../../src/sdk/operations/story-orchestrate";
import {
	createStoryOrchestrateSpecPack,
	seedStoryRunAttempt,
} from "../../support/story-orchestrate-fixtures";

describe("story-orchestrate status sdk operation", () => {
	test("TC-2.5a returns single-attempt status by story id when one attempt exists", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-status-single",
		);
		const attempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "running",
			updatedAt: "2026-05-01T00:05:00.000Z",
			currentChildOperation: {
				command: "story-implement",
				artifactPath: `${specPackRoot}/artifacts/${storyId}/001-implementor.json`,
			},
			event: {
				type: "child-operation-started",
				summary: "Story implementor started and is still running.",
				timestamp: "2026-05-01T00:00:00.000Z",
			},
		});

		const envelope = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
		});

		expect(envelope.outcome).toBe("single-attempt");
		expect(envelope.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				storyRunId: attempt.storyRunId,
				currentStatus: "running",
				lifecycleState: "awaiting_story_lead_action",
				latestEvent: expect.objectContaining({
					type: "child-operation-started",
				}),
				latestChildOperation: expect.objectContaining({
					command: "story-implement",
				}),
				runtimeIdentity: expect.objectContaining({
					version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
					invocationSource: "local-source",
					entryPath: expect.any(String),
				}),
				statusArtifactPath: expect.stringContaining(
					"story-lead/progress/001-story-lead.status.json",
				),
				elapsedTime: "5m 0s",
			}),
		);
	});

	test("TC-2.5b returns ambiguity by story id when multiple plausible attempts exist", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-status-ambiguous",
		);
		await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "running",
			updatedAt: "2026-05-01T02:00:00.000Z",
			finalPackage: null,
		});
		await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "interrupted",
			updatedAt: "2026-05-01T01:00:00.000Z",
			finalPackageOutcome: "interrupted",
		});

		const envelope = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
		});

		expect(envelope.outcome).toBe("ambiguous-story-run");
		expect(envelope.result).toEqual(
			expect.objectContaining({
				case: "ambiguous-story-run",
				candidates: expect.arrayContaining([
					expect.objectContaining({
						status: "running",
					}),
				]),
			}),
		);
	});

	test("TC-2.5c returns the final package for a prior accepted attempt", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-status-accepted",
		);
		await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "accepted",
			finalPackageOutcome: "accepted",
		});

		const envelope = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
		});

		expect(envelope.outcome).toBe("single-attempt");
		expect(envelope.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				currentStatus: "accepted",
				terminalResult: "accepted",
				finalPackage: expect.objectContaining({
					outcome: "accepted",
				}),
			}),
		);
	});

	test("preserves the latest bounded child operation for terminal status reads", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-status-terminal-child-operation",
		);
		const implementorArtifact = `${specPackRoot}/artifacts/${storyId}/001-implementor.json`;
		const attempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "accepted",
			finalPackageOutcome: "accepted",
			updatedAt: "2026-05-01T00:01:00.000Z",
			latestArtifacts: [
				{
					kind: "implementor-result",
					path: implementorArtifact,
				},
			],
		});
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const snapshot = await ledger.readCurrentSnapshot(
			attempt.currentSnapshotPath,
		);

		await ledger.writeCurrentSnapshot({
			storyId,
			storyRunId: attempt.storyRunId,
			snapshot: {
				...snapshot,
				latestEventSequence: 2,
				currentChildOperation: null,
				latestArtifacts: [
					...snapshot.latestArtifacts,
					{
						kind: "final-package",
						path: attempt.finalPackagePath,
					},
				],
				updatedAt: "2026-05-01T00:01:00.000Z",
			},
		});
		await Bun.write(
			attempt.eventHistoryPath,
			`${[
				JSON.stringify({
					storyRunId: attempt.storyRunId,
					sequence: 1,
					timestamp: "2026-05-01T00:00:00.000Z",
					type: "child-operation-completed",
					summary: "story-implement produced a ready-for-verification result.",
					artifact: implementorArtifact,
					data: {
						command: "story-implement",
						actionType: "run-implement",
						outcome: "ready-for-verification",
						status: "ok",
					},
				}),
				JSON.stringify({
					storyRunId: attempt.storyRunId,
					sequence: 2,
					timestamp: "2026-05-01T00:01:00.000Z",
					type: "accepted",
					summary: `Story-lead finalized ${attempt.storyRunId} with outcome accepted.`,
					artifact: attempt.finalPackagePath,
				}),
			].join("\n")}\n`,
		);

		const envelope = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
			storyRunId: attempt.storyRunId,
		});

		expect(envelope.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				terminalResult: "accepted",
				latestChildOperation: expect.objectContaining({
					command: "story-implement",
					artifactPath: implementorArtifact,
				}),
			}),
		);
	});

	test("returns invalid-story-run-id when status is asked for an explicit unknown attempt", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-status-invalid-run-id",
		);
		await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "interrupted",
			finalPackageOutcome: "interrupted",
		});

		const envelope = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
			storyRunId: "00-foundation-story-run-999",
		});

		expect(envelope.outcome).toBe("invalid-story-run-id");
		expect(envelope.result).toEqual({
			case: "invalid-story-run-id",
			storyId,
			storyRunId: "00-foundation-story-run-999",
		});
	});
});
