import { join } from "node:path";

import { createStoryRunLedger } from "../../src/core/story-run-ledger.js";
import type {
	ArtifactRef,
	CurrentChildOperation,
	StoryLeadFinalPackage,
	StoryRunCurrentSnapshot,
	StoryRunStatus,
} from "../../src/core/story-orchestrate-contracts.js";
import {
	createRunConfig,
	createSpecPack,
	writeRunConfig,
	writeTextFile,
} from "./test-helpers.js";

export async function createStoryOrchestrateSpecPack(
	scope: string,
	options: {
		includeStoryLead?: boolean;
	} = {},
): Promise<{ specPackRoot: string; storyId: string }> {
	const specPackRoot = await createSpecPack(scope, {
		companionMode: "four-file",
	});
	const storyId = "00-foundation";
	await writeTextFile(
		join(specPackRoot, "package.json"),
		`${JSON.stringify(
			{
				name: "fixture-spec-pack",
				private: true,
				scripts: {
					"green-verify": "npm run test",
					"verify-all": "npm run test",
				},
			},
			null,
			2,
		)}\n`,
	);
	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			caller_harness: {
				harness: "codex",
				story_heartbeat_cadence_minutes: 10,
			},
			...(options.includeStoryLead
				? {
						story_lead_provider: {
							secondary_harness: "codex" as const,
							model: "gpt-5.4",
							reasoning_effort: "high" as const,
						},
					}
				: {}),
		}),
	);

	return {
		specPackRoot,
		storyId,
	};
}

export async function seedPrimitiveArtifact(input: {
	specPackRoot: string;
	storyId: string;
	fileName: string;
	payload?: unknown;
}) {
	await writeTextFile(
		join(input.specPackRoot, "artifacts", input.storyId, input.fileName),
		`${JSON.stringify(
			input.payload ?? {
				ok: true,
				fileName: input.fileName,
			},
			null,
			2,
		)}\n`,
	);
}

function buildFinalPackage(input: {
	storyId: string;
	storyRunId: string;
	attempt: number;
	outcome: StoryLeadFinalPackage["outcome"];
}): StoryLeadFinalPackage {
	const interruptedReplayBoundary =
		input.outcome === "interrupted"
			? {
					smallestSafeStep: "resume-current-attempt" as const,
					reasoning:
						"Interrupted fixtures should surface the same resume guidance as the production runtime.",
					validArtifactPaths: [
						`/tmp/spec-pack/artifacts/${input.storyId}/001-implementor.json`,
					],
					requiresFreshStoryLeadSession: false,
					requiresFreshChildProviderSession: false,
				}
			: null;

	return {
		outcome: input.outcome,
		storyRunId: input.storyRunId,
		storyId: input.storyId,
		attempt: input.attempt,
		summary: {
			storyTitle: "Story 0: Foundation",
			implementedScope: "Fixture story-run attempt.",
			acceptanceRationale: "Fixture acceptance rationale.",
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
		replayBoundary: interruptedReplayBoundary,
		logHandoff: {
			recommendedState:
				input.outcome === "needs-ruling"
					? "NEEDS_RULING"
					: input.outcome === "accepted"
						? "BETWEEN_STORIES"
						: "STORY_IN_PROGRESS",
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
				...(input.outcome === "accepted"
					? { state: "ready-for-impl-lead-commit" as const }
					: {
							state: "not-ready" as const,
							reason:
								"Interrupted and non-accepted fixtures require explicit impl-lead follow-up before commit.",
						}),
			},
			openRisks: [],
		},
		cleanupHandoff: {
			acceptedRiskItems: [],
			deferredItems: [],
			cleanupRequired: false,
		},
		rulingRequest: null,
		recommendedImplLeadAction:
			input.outcome === "accepted"
				? "accept"
				: input.outcome === "needs-ruling"
					? "ask-ruling"
					: "reopen",
	};
}

function defaultOutcomeForStatus(
	status: StoryRunStatus,
): StoryLeadFinalPackage["outcome"] {
	switch (status) {
		case "accepted":
		case "needs-ruling":
		case "blocked":
		case "interrupted":
		case "failed":
			return status;
		default:
			return "interrupted";
	}
}

function lifecycleStateForStatus(
	status: StoryRunStatus,
): StoryRunCurrentSnapshot["lifecycleState"] {
	return status === "running" ? "awaiting_story_lead_action" : "terminal";
}

export async function seedStoryRunAttempt(input: {
	specPackRoot: string;
	storyId: string;
	status: StoryRunStatus;
	updatedAt?: string;
	finalPackageOutcome?: StoryLeadFinalPackage["outcome"];
	finalPackage?: StoryLeadFinalPackage | null;
	latestEventSequence?: number;
	latestArtifacts?: ArtifactRef[];
	currentSummary?: string;
	currentPhase?: string;
	currentChildOperation?: CurrentChildOperation | null;
	nextIntent?: StoryRunCurrentSnapshot["nextIntent"];
	replayBoundary?: StoryRunCurrentSnapshot["replayBoundary"];
	event?: {
		type?: string;
		summary?: string;
		artifact?: string;
		data?: Record<string, unknown>;
		timestamp?: string;
	};
}) {
	const ledger = createStoryRunLedger({
		specPackRoot: input.specPackRoot,
		storyId: input.storyId,
	});
	const attemptPaths = await ledger.createAttempt();
	const snapshot: StoryRunCurrentSnapshot = {
		storyRunId: attemptPaths.storyRunId,
		storyId: input.storyId,
		attempt: attemptPaths.attempt,
		status: input.status,
		lifecycleState: lifecycleStateForStatus(input.status),
		currentSummary: input.currentSummary ?? `Fixture status ${input.status}.`,
		currentPhase:
			input.currentPhase ??
			(input.status === "running" ? "story-orchestrate-run" : "terminal"),
		currentChildOperation: input.currentChildOperation ?? null,
		latestArtifacts: input.latestArtifacts ?? [],
		latestContinuationHandles: {},
		latestEventSequence: input.latestEventSequence ?? 1,
		callerInputHistory: {
			reviewRequests: [],
			rulings: [],
		},
		nextIntent:
			input.nextIntent ??
			(input.status === "interrupted"
				? {
						actionType: "replay-smallest-safe-step",
						summary:
							"Use story-orchestrate resume to continue this interrupted attempt.",
						artifactRef: attemptPaths.finalPackagePath,
					}
				: null),
		replayBoundary:
			input.replayBoundary ??
			(input.status === "interrupted"
				? {
						smallestSafeStep: "resume-from-last-valid-artifact",
						reasoning:
							"Interrupted fixture should expose the same replay guidance surface as the runtime.",
						validArtifactPaths: (input.latestArtifacts ?? []).map(
							(artifact) => artifact.path,
						),
						requiresFreshStoryLeadSession: false,
						requiresFreshChildProviderSession: true,
					}
				: null),
		updatedAt: input.updatedAt ?? "2026-05-01T00:00:00.000Z",
	};
	await ledger.writeCurrentSnapshot({
		storyId: input.storyId,
		storyRunId: attemptPaths.storyRunId,
		snapshot,
	});
	await ledger.appendEvent({
		storyId: input.storyId,
		storyRunId: attemptPaths.storyRunId,
		event: {
			storyRunId: attemptPaths.storyRunId,
			sequence: input.latestEventSequence ?? 1,
			timestamp:
				input.event?.timestamp ?? input.updatedAt ?? "2026-05-01T00:00:00.000Z",
			type: input.event?.type ?? input.status,
			summary: input.event?.summary ?? `Fixture event for ${input.status}.`,
			...((input.event?.artifact ??
			(input.status !== "running" && input.finalPackage !== null
				? attemptPaths.finalPackagePath
				: undefined))
				? {
						artifact:
							input.event?.artifact ??
							(input.status !== "running" && input.finalPackage !== null
								? attemptPaths.finalPackagePath
								: undefined),
					}
				: {}),
			...(input.event?.data ? { data: input.event.data } : {}),
		},
	});

	if (input.finalPackage !== null) {
		const finalPackage =
			input.finalPackage ??
			buildFinalPackage({
				storyId: input.storyId,
				storyRunId: attemptPaths.storyRunId,
				attempt: attemptPaths.attempt,
				outcome:
					input.finalPackageOutcome ?? defaultOutcomeForStatus(input.status),
			});
		await ledger.writeFinalPackage({
			storyId: input.storyId,
			storyRunId: attemptPaths.storyRunId,
			finalPackage,
		});
	}

	return attemptPaths;
}
