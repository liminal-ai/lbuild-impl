import { join } from "node:path";

import { createStoryRunLedger } from "../../src/core/story-run-ledger.js";
import type {
	ArtifactRef,
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
		replayBoundary: null,
		logHandoff: {
			recommendedState: "BETWEEN_STORIES",
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
		rulingRequest: null,
		recommendedImplLeadAction: "accept",
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
		currentSummary: `Fixture status ${input.status}.`,
		currentPhase:
			input.status === "running" ? "story-orchestrate-run" : "terminal",
		currentChildOperation: null,
		latestArtifacts: input.latestArtifacts ?? [],
		latestContinuationHandles: {},
		latestEventSequence: input.latestEventSequence ?? 1,
		callerInputHistory: {
			reviewRequests: [],
			rulings: [],
		},
		nextIntent: null,
		replayBoundary: null,
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
			timestamp: input.updatedAt ?? "2026-05-01T00:00:00.000Z",
			type: input.status,
			summary: `Fixture event for ${input.status}.`,
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
