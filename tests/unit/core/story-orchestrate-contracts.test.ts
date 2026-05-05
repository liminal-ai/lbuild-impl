import { describe, expect, test } from "vitest";

import {
	logHandoffSchema,
	storyLeadActionSchema,
	storyLeadFinalPackageSchema,
	storyOrchestrateResumeResultSchema,
	storyOrchestrateRunResultSchema,
	storyOrchestrateStatusResultSchema,
} from "../../../src/core/story-orchestrate-contracts";

function createFinalPackage() {
	return {
		outcome: "needs-ruling" as const,
		storyRunId: "story-run-001",
		storyId: "00-foundation",
		attempt: 1,
		summary: {
			storyTitle: "Story 0: Foundation",
			implementedScope: "Established contracts and validation scaffolding.",
			acceptanceRationale:
				"Runtime contracts are in place, but the caller still owes a ruling on one deviation.",
		},
		evidence: {
			implementorArtifacts: [
				{
					kind: "implementor-result",
					path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
				},
			],
			selfReviewArtifacts: [],
			verifierArtifacts: [],
			quickFixArtifacts: [],
			callerInputArtifacts: [],
			gateRuns: [
				{
					command: "npm run green-verify",
					result: "pass" as const,
				},
			],
		},
		verification: {
			finalVerifierOutcome: "pass" as const,
			findings: [
				{
					id: "F-001",
					status: "accepted-risk" as const,
					evidence: [
						"/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
					],
				},
			],
		},
		riskAndDeviationReview: {
			specDeviations: [],
			assumedRisks: [
				{
					description: "Resume semantics remain for a later story.",
					reasoning:
						"Story 0 only establishes the shared contracts and validation gate.",
					evidence: [
						"/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
					],
					approvalStatus: "needs-ruling" as const,
					approvalSource: null,
				},
			],
			scopeChanges: [],
			productionPathDecisionItems: [],
		},
		diffReview: {
			changedFiles: [
				{
					path: "src/core/story-orchestrate-contracts.ts",
					reason: "Define the canonical story-orchestrate schemas.",
				},
			],
			storyScopedAssessment:
				"Changes stay inside foundation contracts and story-id validation scaffolding.",
		},
		acceptanceChecks: [
			{
				name: "Story contracts are schema-validated",
				status: "pass" as const,
				evidence: ["src/core/story-orchestrate-contracts.ts"],
				reasoning:
					"All public contract shapes parse through the canonical schemas.",
			},
		],
		callerInputHistory: {
			reviewRequests: [],
			rulings: [],
		},
		runtimeIdentity: {
			version: "0.3.0",
			invocationSource: "local-source" as const,
			entryPath: "/tmp/lbuild-impl/src/bin/lbuild-impl.ts",
		},
		replayBoundary: null,
		logHandoff: {
			recommendedState: "NEEDS_RULING",
			recommendedCurrentStory: "00-foundation",
			recommendedCurrentPhase: "story-orchestrate",
			continuationHandles: {
				storyLead: {
					provider: "codex" as const,
					sessionId: "codex-session-123",
					storyId: "00-foundation",
				},
			},
			storyReceiptDraft: {
				storyId: "00-foundation",
				storyTitle: "Story 0: Foundation",
				implementorEvidenceRefs: [
					"/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
				],
				verifierEvidenceRefs: [],
				gateCommand: "npm run green-verify",
				gateResult: "pass" as const,
				dispositions: [
					{
						id: "F-001",
						status: "accepted-risk" as const,
						evidence: [
							"/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
						],
					},
				],
				baselineBeforeStory: 100,
				baselineAfterStory: 104,
				openRisks: ["Resume semantics still need a caller ruling."],
			},
			cumulativeBaseline: {
				baselineBeforeCurrentStory: 100,
				expectedAfterCurrentStory: 104,
				latestActualTotal: 104,
			},
			commitReadiness: {
				state: "not-ready" as const,
				reason: "Awaiting caller ruling before impl-lead commit.",
			},
			openRisks: ["Resume semantics still need a caller ruling."],
		},
		cleanupHandoff: {
			acceptedRiskItems: [],
			deferredItems: [
				{
					description: "Deferred cleanup follow-up remains for a later story.",
					reasoning: "Story 0 leaves this cleanup follow-up out of scope.",
					evidence: [
						"docs/spec-build/epics/03-orchestration-enhancements/stories/00-foundation-and-contract-alignment.md",
					],
					approvalStatus: "not-required" as const,
					approvalSource: null,
				},
			],
			cleanupRequired: true,
		},
		rulingRequest: {
			id: "ruling-001",
			decisionType: "scope-approval",
			question:
				"Should resume-specific attempt selection stay in a later story?",
			defaultRecommendation: "Yes, keep it for the runtime stories.",
			evidence: ["Story 0 scope excludes running story-lead attempts."],
			allowedResponses: ["approve", "reject"],
		},
		recommendedImplLeadAction: "ask-ruling" as const,
	};
}

describe("story-orchestrate contracts", () => {
	test("accepts terminal story-lead actions that carry verifier dispositions and shim/mock risk decisions", () => {
		const action = storyLeadActionSchema.parse({
			action: "accept-story",
			rationale:
				"Verifier findings are classified and shim/mock decisions are preserved for Flow 3 handoff.",
			inputs: {
				summary:
					"Verifier findings are classified and shim/mock decisions are preserved for Flow 3 handoff.",
				acceptanceCheckRefs: ["finding-dispositions-classified"],
				acceptanceChecks: [
					{
						name: "finding-dispositions-classified",
						status: "pass",
						evidence: ["verifier-result"],
						reasoning:
							"Story-lead classified the verifier findings before terminal packaging.",
					},
				],
				recommendedImplLeadAction: "accept",
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [
					{
						id: "F-accepted-risk",
						status: "accepted-risk",
						evidence: ["risk-ruling.md"],
					},
				],
			},
			riskAndDeviationReview: {
				productionPathDecisionItems: [
					{
						description: "Production shim remains in the implementation path.",
						reasoning: "Verifier requires explicit approval.",
						evidence: ["verifier-result"],
						approvalStatus: "needs-ruling",
						approvalSource: null,
					},
				],
			},
		});

		expect(action.action).toBe("accept-story");
		if (action.action !== "accept-story") {
			throw new Error("Expected accept-story action.");
		}
		expect(action.verification?.findings[0]?.status).toBe("accepted-risk");
		expect(
			action.riskAndDeviationReview?.productionPathDecisionItems?.[0]
				?.approvalStatus,
		).toBe("needs-ruling");
	});

	test("accepts a story-lead final package with log and cleanup handoff scaffolding", () => {
		const parsed = storyLeadFinalPackageSchema.parse(createFinalPackage());

		expect(parsed.outcome).toBe("needs-ruling");
		expect(parsed.cleanupHandoff.cleanupRequired).toBe(true);
	});

	test("rejects cleanup handoff entries that still carry needs-ruling approval states", () => {
		expect(() =>
			storyLeadFinalPackageSchema.parse({
				...createFinalPackage(),
				cleanupHandoff: {
					acceptedRiskItems: [],
					deferredItems: [
						{
							description:
								"Ruling-only item should not be exported as cleanup debt.",
							reasoning: "Needs-ruling items stay on the ruling path.",
							evidence: ["scope.md"],
							approvalStatus: "needs-ruling",
							approvalSource: null,
						},
					],
					cleanupRequired: true,
				},
			}),
		).toThrow(/cleanup/i);
	});

	test("rejects committed log handoff entries that omit a commit sha", () => {
		expect(() =>
			logHandoffSchema.parse({
				...createFinalPackage().logHandoff,
				commitReadiness: {
					state: "committed",
				},
			}),
		).toThrow(/commitSha/i);
	});

	test("accepts run and status result unions that embed the canonical final package and current snapshot", () => {
		const finalPackage = createFinalPackage();
		const runResult = storyOrchestrateRunResultSchema.parse({
			case: "completed",
			outcome: finalPackage.outcome,
			storyId: finalPackage.storyId,
			storyRunId: finalPackage.storyRunId,
			currentSnapshotPath:
				"/tmp/spec-pack/artifacts/00-foundation/story-orchestrate/current.json",
			eventHistoryPath:
				"/tmp/spec-pack/artifacts/00-foundation/story-orchestrate/events.jsonl",
			finalPackagePath:
				"/tmp/spec-pack/artifacts/00-foundation/story-orchestrate/final-package.json",
			finalPackage,
		});
		const statusResult = storyOrchestrateStatusResultSchema.parse({
			case: "single-attempt",
			storyId: finalPackage.storyId,
			storyRunId: finalPackage.storyRunId,
			currentSnapshotPath:
				"/tmp/spec-pack/artifacts/00-foundation/story-orchestrate/current.json",
			eventHistoryPath:
				"/tmp/spec-pack/artifacts/00-foundation/story-orchestrate/events.jsonl",
			statusArtifactPath:
				"/tmp/spec-pack/artifacts/00-foundation/story-orchestrate/status.json",
			currentSnapshot: {
				storyRunId: finalPackage.storyRunId,
				storyId: finalPackage.storyId,
				attempt: 1,
				status: "needs-ruling",
				lifecycleState: "terminal",
				currentSummary: "Waiting for caller ruling.",
				currentPhase: "awaiting-ruling",
				currentChildOperation: null,
				latestArtifacts: [
					{
						kind: "final-package",
						path: "/tmp/spec-pack/artifacts/00-foundation/story-orchestrate/final-package.json",
					},
				],
				latestContinuationHandles: {
					storyLead: {
						provider: "codex",
						sessionId: "codex-session-123",
						storyId: "00-foundation",
					},
				},
				latestEventSequence: 3,
				callerInputHistory: {
					reviewRequests: [],
					rulings: [],
				},
				nextIntent: {
					actionType: "await-ruling",
					summary: "Pause for caller ruling.",
				},
				replayBoundary: null,
				updatedAt: "2026-05-01T00:00:00.000Z",
			},
			currentStatus: "needs-ruling",
			lifecycleState: "terminal",
			latestEventSequence: 3,
			latestEvent: {
				storyRunId: finalPackage.storyRunId,
				sequence: 3,
				timestamp: "2026-05-01T00:00:00.000Z",
				type: "needs-ruling",
				summary: "Waiting for caller ruling.",
				artifact:
					"/tmp/spec-pack/artifacts/00-foundation/story-orchestrate/final-package.json",
			},
			latestChildOperation: null,
			runtimeIdentity: {
				version: "0.3.0",
				invocationSource: "local-source",
				entryPath: "/tmp/lbuild-impl/src/bin/lbuild-impl.ts",
			},
			elapsedTime: "0s",
			terminalResult: "needs-ruling",
			finalPackagePath:
				"/tmp/spec-pack/artifacts/00-foundation/story-orchestrate/final-package.json",
			finalPackage,
		});

		if (runResult.case !== "completed") {
			throw new Error("Expected a completed run result in the contract test.");
		}

		if (statusResult.case !== "single-attempt") {
			throw new Error(
				"Expected a single-attempt status result in the contract test.",
			);
		}

		expect(runResult.finalPackage.storyId).toBe("00-foundation");
		expect(statusResult.currentSnapshot.status).toBe("needs-ruling");
	});

	test("accepts invalid explicit storyRunId result cases for resume and status", () => {
		expect(() =>
			storyOrchestrateStatusResultSchema.parse({
				case: "invalid-story-run-id",
				storyId: "00-foundation",
				storyRunId: "00-foundation-story-run-999",
			}),
		).not.toThrow();
		expect(() =>
			storyOrchestrateResumeResultSchema.parse({
				case: "invalid-story-run-id",
				storyId: "00-foundation",
				storyRunId: "00-foundation-story-run-999",
			}),
		).not.toThrow();
	});

	test("accepts interrupted run and resume result cases that surface final packages and recovery guidance", () => {
		const interruptedFinalPackage = {
			...createFinalPackage(),
			outcome: "interrupted" as const,
			replayBoundary: {
				smallestSafeStep: "resume-current-attempt",
				reasoning:
					"The interrupted story-run should resume from the current durable snapshot.",
				validArtifactPaths: [
					"/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
				],
				requiresFreshStoryLeadSession: false,
				requiresFreshChildProviderSession: false,
			},
		};

		expect(() =>
			storyOrchestrateRunResultSchema.parse({
				case: "interrupted",
				outcome: "interrupted",
				storyId: "00-foundation",
				storyRunId: "00-foundation-story-run-001",
				currentSnapshotPath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/001-current.json",
				eventHistoryPath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/001-events.jsonl",
				finalPackagePath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/001-final-package.json",
				finalPackage: interruptedFinalPackage,
				recoveryGuidance:
					"Use story-orchestrate resume to continue this interrupted attempt.",
				latestEventSequence: 3,
			}),
		).not.toThrow();
		expect(() =>
			storyOrchestrateResumeResultSchema.parse({
				case: "interrupted",
				outcome: "interrupted",
				storyId: "00-foundation",
				storyRunId: "00-foundation-story-run-001",
				currentSnapshotPath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/001-current.json",
				eventHistoryPath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/001-events.jsonl",
				finalPackagePath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/001-final-package.json",
				finalPackage: interruptedFinalPackage,
				recoveryGuidance:
					"Use story-orchestrate resume to continue this interrupted attempt.",
				latestEventSequence: 3,
			}),
		).not.toThrow();
	});

	test("accepts resume result cases that surface persisted caller-input artifact references", () => {
		expect(() =>
			storyOrchestrateResumeResultSchema.parse({
				case: "completed",
				outcome: "blocked",
				storyId: "00-foundation",
				storyRunId: "00-foundation-story-run-002",
				currentSnapshotPath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/002-current.json",
				eventHistoryPath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/002-events.jsonl",
				finalPackagePath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/002-final-package.json",
				finalPackage: {
					...createFinalPackage(),
					outcome: "blocked",
					storyRunId: "00-foundation-story-run-002",
					attempt: 2,
				},
				acceptedReviewRequestId: "impl-lead",
				acceptedReviewRequestArtifact: {
					kind: "review-request",
					path: "/tmp/spec-pack/artifacts/00-foundation/story-lead/002-review-request-001.json",
				},
			}),
		).not.toThrow();
	});

	test("accepts the accepted-attempt resume no-op result shape", () => {
		expect(() =>
			storyOrchestrateResumeResultSchema.parse({
				case: "existing-accepted-attempt",
				storyId: "00-foundation",
				storyRunId: "00-foundation-story-run-002",
				finalPackagePath:
					"/tmp/spec-pack/artifacts/00-foundation/story-lead/002-final-package.json",
				suggestedNext: "resume-with-review-request",
			}),
		).not.toThrow();
	});
});
