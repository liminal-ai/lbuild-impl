import { describe, expect, test } from "vitest";
import { readTextFile } from "../../../src/core/fs-utils";
import type { StoryLeadFinalPackage } from "../../../src/core/story-orchestrate-contracts";
import {
	storyOrchestrateRun,
	storyOrchestrateResume,
	storyOrchestrateStatus,
} from "../../../src/sdk/operations/story-orchestrate";
import {
	createStoryOrchestrateSpecPack,
	seedStoryRunAttempt,
} from "../../support/story-orchestrate-fixtures";
import { readJsonLines } from "../../support/test-helpers";

describe("story-orchestrate resume sdk operation", () => {
	function createNeedsRulingFinalPackage(input: {
		storyId: string;
		storyRunId: string;
		attempt: number;
	}): StoryLeadFinalPackage {
		return {
			outcome: "needs-ruling",
			storyId: input.storyId,
			storyRunId: input.storyRunId,
			attempt: input.attempt,
			summary: {
				storyTitle: "Story 0: Foundation",
				implementedScope: "Needs-ruling fixture.",
				acceptanceRationale: "Fixture ruling required.",
			},
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: `/tmp/spec-pack/artifacts/${input.storyId}/001-implementor.json`,
					},
				],
				selfReviewArtifacts: [],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: `/tmp/spec-pack/artifacts/${input.storyId}/002-verifier.json`,
					},
				],
				quickFixArtifacts: [],
				callerInputArtifacts: [],
				gateRuns: [
					{
						command: "npm run green-verify",
						result: "pass",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
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
				storyScopedAssessment: "Fixture assessment.",
			},
			acceptanceChecks: [],
			callerInputHistory: {
				reviewRequests: [],
				rulings: [],
			},
			replayBoundary: null,
			logHandoff: {
				recommendedState: "NEEDS_RULING",
				recommendedCurrentStory: input.storyId,
				recommendedCurrentPhase: "story-orchestrate",
				continuationHandles: {},
				storyReceiptDraft: {
					storyId: input.storyId,
					storyTitle: "Story 0: Foundation",
					implementorEvidenceRefs: [
						`/tmp/spec-pack/artifacts/${input.storyId}/001-implementor.json`,
					],
					verifierEvidenceRefs: [
						`/tmp/spec-pack/artifacts/${input.storyId}/002-verifier.json`,
					],
					gateCommand: "npm run green-verify",
					gateResult: "pass",
					dispositions: [],
					baselineBeforeStory: 10,
					baselineAfterStory: 12,
					openRisks: [],
				},
				cumulativeBaseline: {
					baselineBeforeCurrentStory: 10,
					expectedAfterCurrentStory: 12,
					latestActualTotal: 12,
				},
				commitReadiness: {
					state: "ready-for-impl-lead-commit",
				},
				openRisks: [],
			},
			cleanupHandoff: {
				acceptedRiskItems: [],
				deferredItems: [],
				cleanupRequired: false,
			},
			rulingRequest: {
				id: "ruling-001",
				decisionType: "scope-change",
				question: "Can this proceed?",
				defaultRecommendation: "Wait for approval.",
				evidence: ["evidence.md"],
				allowedResponses: ["approve", "reject"],
			},
			recommendedImplLeadAction: "ask-ruling",
		};
	}

	test("surfaces interrupted terminal packages and recovery guidance for both run and resume flows", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-resume-interrupted-terminal",
		);
		const priorIncompleteMode =
			process.env.LBUILD_IMPL_STORY_ORCHESTRATE_INCOMPLETE;
		process.env.LBUILD_IMPL_STORY_ORCHESTRATE_INCOMPLETE = "1";

		try {
			const runEnvelope = await storyOrchestrateRun({
				specPackRoot,
				storyId,
			});

			if (!runEnvelope.result || runEnvelope.result.case !== "interrupted") {
				throw new Error(
					"Expected the initial run to return an interrupted result.",
				);
			}

			expect(runEnvelope.result.finalPackagePath).toContain(
				"final-package.json",
			);
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

			const resumeEnvelope = await storyOrchestrateResume({
				specPackRoot,
				storyId,
				storyRunId: runEnvelope.result.storyRunId,
			});

			expect(resumeEnvelope.outcome).toBe("interrupted");
			expect(resumeEnvelope.result).toEqual(
				expect.objectContaining({
					case: "interrupted",
					storyRunId: runEnvelope.result.storyRunId,
					finalPackagePath: expect.stringContaining("final-package.json"),
					recoveryGuidance: expect.stringContaining("story-orchestrate resume"),
					finalPackage: expect.objectContaining({
						outcome: "interrupted",
					}),
				}),
			);

			const statusEnvelope = await storyOrchestrateStatus({
				specPackRoot,
				storyId,
				storyRunId: runEnvelope.result.storyRunId,
			});

			expect(statusEnvelope.result).toEqual(
				expect.objectContaining({
					case: "single-attempt",
					currentStatus: "interrupted",
					terminalResult: "interrupted",
					finalPackagePath: expect.stringContaining("final-package.json"),
					finalPackage: expect.objectContaining({
						outcome: "interrupted",
					}),
					currentSnapshot: expect.objectContaining({
						nextIntent: expect.objectContaining({
							summary:
								"Use story-orchestrate resume to continue this interrupted attempt.",
						}),
					}),
				}),
			);
		} finally {
			if (typeof priorIncompleteMode === "string") {
				process.env.LBUILD_IMPL_STORY_ORCHESTRATE_INCOMPLETE =
					priorIncompleteMode;
			} else {
				delete process.env.LBUILD_IMPL_STORY_ORCHESTRATE_INCOMPLETE;
			}
		}
	});

	test("preserves prior artifact history and appends monotonic events when resuming an existing attempt", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-resume-sequencing",
		);
		const checkpointArtifact = `${specPackRoot}/artifacts/${storyId}/001-implementor.json`;
		const attempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "interrupted",
			finalPackageOutcome: "interrupted",
			latestEventSequence: 3,
			latestArtifacts: [
				{
					kind: "implementor-result",
					path: checkpointArtifact,
				},
			],
		});

		const resumeEnvelope = await storyOrchestrateResume({
			specPackRoot,
			storyId,
			storyRunId: attempt.storyRunId,
		});
		const statusEnvelope = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
			storyRunId: attempt.storyRunId,
		});
		const events = await readJsonLines<Array<{ sequence: number }>[number]>(
			attempt.eventHistoryPath,
		);

		expect(resumeEnvelope.outcome).toBe("blocked");
		expect(resumeEnvelope.result).toEqual(
			expect.objectContaining({
				case: "completed",
				storyRunId: attempt.storyRunId,
			}),
		);
		expect(events.map((event) => event.sequence)).toEqual([3, 4, 5]);
		expect(statusEnvelope.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				storyRunId: attempt.storyRunId,
				latestEventSequence: 5,
				currentSnapshot: expect.objectContaining({
					latestArtifacts: expect.arrayContaining([
						expect.objectContaining({
							path: checkpointArtifact,
						}),
					]),
				}),
			}),
		);
	});

	test("returns the persisted review-request artifact reference when a reopen request is accepted", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-resume-review-artifact",
		);
		const acceptedAttempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "accepted",
			finalPackageOutcome: "accepted",
		});

		const envelope = await storyOrchestrateResume({
			specPackRoot,
			storyId,
			storyRunId: acceptedAttempt.storyRunId,
			reviewRequest: {
				source: "impl-lead",
				decision: "reopen",
				summary: "Reopen for one more receipt pass.",
				items: [
					{
						id: "review-001",
						severity: "major",
						concern: "Receipt notes are missing.",
						requiredResponse: "Add the missing receipt notes.",
					},
				],
			},
		});

		if (
			!envelope.result ||
			envelope.result.case !== "completed" ||
			!envelope.result.acceptedReviewRequestArtifact
		) {
			throw new Error(
				"Expected a completed resume result with review artifact.",
			);
		}

		expect(envelope.result.acceptedReviewRequestId).toBe("impl-lead");
		expect(envelope.result.acceptedReviewRequestArtifact.kind).toBe(
			"review-request",
		);
		expect(envelope.result.acceptedReviewRequestArtifact.path).toContain(
			"review-request-001.json",
		);

		const persisted = JSON.parse(
			await readTextFile(envelope.result.acceptedReviewRequestArtifact.path),
		) as { summary: string };
		expect(persisted.summary).toBe("Reopen for one more receipt pass.");
	});

	test("returns an explicit no-op result when resume targets an accepted attempt without new review or ruling input", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-resume-accepted-noop",
		);
		const acceptedAttempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "accepted",
			finalPackageOutcome: "accepted",
			latestEventSequence: 2,
		});

		const envelope = await storyOrchestrateResume({
			specPackRoot,
			storyId,
			storyRunId: acceptedAttempt.storyRunId,
		});
		const statusEnvelope = await storyOrchestrateStatus({
			specPackRoot,
			storyId,
			storyRunId: acceptedAttempt.storyRunId,
		});
		const events = await readJsonLines<Array<{ sequence: number }>[number]>(
			acceptedAttempt.eventHistoryPath,
		);

		expect(envelope.outcome).toBe("existing-accepted-attempt");
		expect(envelope.result).toEqual({
			case: "existing-accepted-attempt",
			storyId,
			storyRunId: acceptedAttempt.storyRunId,
			finalPackagePath: acceptedAttempt.finalPackagePath,
			suggestedNext: "resume-with-review-request",
		});
		expect(statusEnvelope.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				storyRunId: acceptedAttempt.storyRunId,
				currentStatus: "accepted",
				latestEventSequence: 2,
			}),
		);
		expect(events.map((event) => event.sequence)).toEqual([2]);
	});

	test("returns invalid-story-run-id when resume is asked to reopen an unknown explicit attempt", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-resume-invalid-run-id",
		);
		await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "interrupted",
			finalPackageOutcome: "interrupted",
		});

		const envelope = await storyOrchestrateResume({
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

	test("returns invalid-ruling when the supplied ruling does not match an outstanding ruling request", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-invalid-ruling",
		);
		const attempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "needs-ruling",
			finalPackage: createNeedsRulingFinalPackage({
				storyId,
				storyRunId: "00-foundation-story-run-001",
				attempt: 1,
			}),
		});

		const envelope = await storyOrchestrateResume({
			specPackRoot,
			storyId,
			storyRunId: attempt.storyRunId,
			ruling: {
				rulingRequestId: "ruling-999",
				decision: "approve",
				rationale: "Mismatched on purpose.",
				source: "impl-lead",
			},
		});

		expect(envelope.outcome).toBe("invalid-ruling");
		expect(envelope.result).toEqual({
			case: "invalid-ruling",
			storyId,
		});
	});
});
