import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { buildStoryLeadPlannerContext } from "../../../src/core/story-lead-context.js";
import { assembleStoryLeadPrompt } from "../../../src/core/story-lead-prompt.js";
import { createStoryRunLedger } from "../../../src/core/story-run-ledger.js";
import { createStoryOrchestrateSpecPack } from "../../support/story-orchestrate-fixtures.js";
import { writeTextFile } from "../../support/test-helpers.js";

async function createCurrentSnapshotFixture(input: {
	specPackRoot: string;
	storyId: string;
	latestArtifacts?: Array<{ kind: string; path: string }>;
}) {
	const ledger = createStoryRunLedger({
		specPackRoot: input.specPackRoot,
		storyId: input.storyId,
	});
	const attempt = await ledger.createAttempt();
	const snapshot = {
		storyRunId: attempt.storyRunId,
		storyId: input.storyId,
		attempt: attempt.attempt,
		status: "running" as const,
		lifecycleState: "awaiting_story_lead_action" as const,
		currentSummary: "Planner is ready for the next bounded action.",
		currentPhase: "story-lead-awaiting-action",
		currentChildOperation: null,
		latestArtifacts: input.latestArtifacts ?? [],
		latestContinuationHandles: {},
		latestEventSequence: 0,
		callerInputHistory: {
			reviewRequests: [],
			rulings: [],
		},
		nextIntent: {
			actionType: "await-story-lead-action",
			summary: "Wait for the next bounded planner decision.",
		},
		replayBoundary: null,
		updatedAt: "2026-05-03T00:00:00.000Z",
	};

	await ledger.writeCurrentSnapshot({
		storyId: input.storyId,
		storyRunId: attempt.storyRunId,
		snapshot,
	});

	return {
		ledger,
		attempt,
		snapshot,
	};
}

describe("story-lead context", () => {
	test("TC-2.2a, TC-2.3a, TC-2.4a, TC-2.4b, TC-2.5a, TC-2.5b, TC-2.5c, TC-2.6a, TC-2.6b, TC-2.6c, TC-2.8a, TC-2.8b, and TC-2.11a build a full story-local planner prompt without forbidden sources", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-context-full-durable-record",
		);
		const storyPath = join(specPackRoot, "stories", `${storyId}.md`);
		const epicPath = join(specPackRoot, "epic.md");
		const techDesignPath = join(specPackRoot, "tech-design.md");
		const testPlanPath = join(specPackRoot, "test-plan.md");
		const implementorPath = join(
			specPackRoot,
			"artifacts",
			storyId,
			"001-implementor.json",
		);
		const verifierPath = join(
			specPackRoot,
			"artifacts",
			storyId,
			"002-verifier.json",
		);
		const quickFixPath = join(
			specPackRoot,
			"artifacts",
			storyId,
			"003-quick-fix.json",
		);
		const callerInputPath = join(
			specPackRoot,
			"artifacts",
			storyId,
			"004-caller-input.json",
		);

		await writeTextFile(
			storyPath,
			"# Story 0: Foundation\n\nSTORY_SENTINEL: keep the planner grounded in the story file.\n",
		);
		await writeTextFile(
			epicPath,
			"# Epic\n\nEPIC_SENTINEL: this must stay out of planner context by default.\n",
		);
		await writeTextFile(
			techDesignPath,
			"# Technical Design\n\nTECH_DESIGN_SENTINEL: this must stay out of planner context by default.\n",
		);
		await writeTextFile(
			testPlanPath,
			"# Test Plan\n\nTEST_PLAN_SENTINEL: the story-local gate details live here.\n",
		);
		await writeTextFile(
			implementorPath,
			JSON.stringify(
				{
					command: "story-implement",
					outcome: "blocked",
					result: {
						planSummary: "IMPLEMENTOR_ARTIFACT_FULL_CONTENT",
					},
				},
				null,
				2,
			),
		);
		await writeTextFile(
			verifierPath,
			JSON.stringify(
				{
					command: "story-verify",
					outcome: "revise",
					result: {
						additionalObservations: ["VERIFIER_ARTIFACT_FULL_CONTENT"],
					},
				},
				null,
				2,
			),
		);
		await writeTextFile(
			quickFixPath,
			JSON.stringify(
				{
					command: "quick-fix",
					outcome: "completed",
					result: {
						summary: "QUICK_FIX_ARTIFACT_FULL_CONTENT",
					},
				},
				null,
				2,
			),
		);
		await writeTextFile(
			callerInputPath,
			JSON.stringify(
				{
					kind: "review-request",
					summary: "CALLER_INPUT_FULL_CONTENT",
				},
				null,
				2,
			),
		);

		const { ledger, attempt, snapshot } = await createCurrentSnapshotFixture({
			specPackRoot,
			storyId,
			latestArtifacts: [
				{
					kind: "implementor-result",
					path: implementorPath,
				},
				{
					kind: "verifier-result",
					path: verifierPath,
				},
				{
					kind: "quick-fix-result",
					path: quickFixPath,
				},
				{
					kind: "caller-input",
					path: callerInputPath,
				},
			],
		});

		await ledger.appendEvent({
			storyId,
			storyRunId: attempt.storyRunId,
			event: {
				storyRunId: attempt.storyRunId,
				sequence: 1,
				timestamp: "2026-05-03T00:01:00.000Z",
				type: "story-run-started",
				summary:
					"Story run started without any git workspace summary in its durable record.",
			},
		});
		await ledger.appendEvent({
			storyId,
			storyRunId: attempt.storyRunId,
			event: {
				storyRunId: attempt.storyRunId,
				sequence: 2,
				timestamp: "2026-05-03T00:02:00.000Z",
				type: "story-lead-self-note-recorded",
				summary: "Earlier durable reminder recorded.",
				data: {
					note: "earlier durable reminder",
					actionSequence: 1,
					actionType: "run-implement",
					turn: 1,
				},
			},
		});
		await ledger.appendEvent({
			storyId,
			storyRunId: attempt.storyRunId,
			event: {
				storyRunId: attempt.storyRunId,
				sequence: 3,
				timestamp: "2026-05-03T00:03:00.000Z",
				type: "story-lead-self-note-recorded",
				summary: "Latest durable reminder recorded.",
				data: {
					note: "latest durable reminder",
					actionSequence: 2,
					actionType: "run-verify",
					turn: 2,
				},
			},
		});

		const context = await buildStoryLeadPlannerContext({
			specPackRoot,
			storyId,
			storyRunId: attempt.storyRunId,
			mode: "resume",
			currentSnapshot: {
				...snapshot,
				latestArtifacts: [
					{
						kind: "implementor-result",
						path: implementorPath,
					},
					{
						kind: "verifier-result",
						path: verifierPath,
					},
					{
						kind: "quick-fix-result",
						path: quickFixPath,
					},
					{
						kind: "caller-input",
						path: callerInputPath,
					},
				],
				latestEventSequence: 3,
			},
			currentSnapshotPath: attempt.currentSnapshotPath,
			eventHistoryPath: attempt.eventHistoryPath,
			provider: "codex",
			model: "gpt-5.4",
			runtimeSettings: {
				storyGate: "npm run green-verify",
				epicGate: "npm run verify-all",
				plannerTimeoutMs: 600_000,
				wholeRunTimeoutMs: 7_200_000,
				providerStartupTimeoutMs: 300_000,
				providerActiveSilenceTimeoutMs: 600_000,
			},
		});
		const prompt = assembleStoryLeadPrompt(context);

		expect(context.storyFile.content).toContain("STORY_SENTINEL");
		expect(context.testPlan.content).toContain("TEST_PLAN_SENTINEL");
		expect(context.currentSnapshot.content).toContain(
			"awaiting_story_lead_action",
		);
		expect(context.eventHistory.content).toContain(
			"story-lead-self-note-recorded",
		);
		expect(context.resultArtifacts.map((artifact) => artifact.content)).toEqual(
			expect.arrayContaining([
				expect.stringContaining("IMPLEMENTOR_ARTIFACT_FULL_CONTENT"),
				expect.stringContaining("VERIFIER_ARTIFACT_FULL_CONTENT"),
				expect.stringContaining("QUICK_FIX_ARTIFACT_FULL_CONTENT"),
			]),
		);
		expect(context.callerInputArtifacts[0]?.content).toContain(
			"CALLER_INPUT_FULL_CONTENT",
		);
		expect(context.priorSelfNotes.map((note) => note.note)).toEqual([
			"earlier durable reminder",
			"latest durable reminder",
		]);
		expect(context.seededSelfNoteInstruction).toBeUndefined();
		expect(prompt).toContain("STORY_SENTINEL");
		expect(prompt).toContain("TEST_PLAN_SENTINEL");
		expect(prompt).toContain("IMPLEMENTOR_ARTIFACT_FULL_CONTENT");
		expect(prompt).toContain("VERIFIER_ARTIFACT_FULL_CONTENT");
		expect(prompt).toContain("QUICK_FIX_ARTIFACT_FULL_CONTENT");
		expect(prompt).toContain("CALLER_INPUT_FULL_CONTENT");
		expect(prompt).toContain("earlier durable reminder");
		expect(prompt).toContain("latest durable reminder");
		expect(prompt).not.toContain("EPIC_SENTINEL");
		expect(prompt).not.toContain("TECH_DESIGN_SENTINEL");
		expect(prompt).not.toContain("GIT_STATUS_SENTINEL");
	});

	test("TC-2.9a includes a seeded self-note example on the first planner turn", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-context-seeded-note",
		);
		const { attempt, snapshot } = await createCurrentSnapshotFixture({
			specPackRoot,
			storyId,
		});

		const context = await buildStoryLeadPlannerContext({
			specPackRoot,
			storyId,
			storyRunId: attempt.storyRunId,
			mode: "run",
			currentSnapshot: snapshot,
			currentSnapshotPath: attempt.currentSnapshotPath,
			eventHistoryPath: attempt.eventHistoryPath,
			provider: "codex",
			model: "gpt-5.4",
			runtimeSettings: {
				plannerTimeoutMs: 600_000,
				wholeRunTimeoutMs: 7_200_000,
				providerStartupTimeoutMs: 300_000,
			},
		});
		const prompt = assembleStoryLeadPrompt(context);

		expect(context.priorSelfNotes).toEqual([]);
		expect(context.seededSelfNoteInstruction).toContain(
			"not a prior runtime self-note",
		);
		expect(prompt).toContain("## Seeded Self-Note Example");
		expect(prompt).toContain("include `selfNote`");
	});

	test("TC-2.4b and TC-2.8a fail loudly when event history is malformed instead of reseeding first-turn guidance", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-context-malformed-event-history",
		);
		const { attempt, snapshot } = await createCurrentSnapshotFixture({
			specPackRoot,
			storyId,
		});
		await writeTextFile(
			attempt.eventHistoryPath,
			[
				JSON.stringify({
					storyRunId: attempt.storyRunId,
					sequence: 1,
					timestamp: "2026-05-03T00:01:00.000Z",
					type: "story-lead-self-note-recorded",
					summary: "A prior note that must not be dropped silently.",
					data: {
						note: "KEEP_THIS_PRIOR_SELF_NOTE",
						actionSequence: 1,
					},
				}),
				"{malformed-jsonl-event",
			].join("\n"),
		);

		await expect(
			buildStoryLeadPlannerContext({
				specPackRoot,
				storyId,
				storyRunId: attempt.storyRunId,
				mode: "resume",
				currentSnapshot: {
					...snapshot,
					latestEventSequence: 2,
				},
				currentSnapshotPath: attempt.currentSnapshotPath,
				eventHistoryPath: attempt.eventHistoryPath,
				provider: "codex",
				model: "gpt-5.4",
				runtimeSettings: {
					plannerTimeoutMs: 600_000,
					wholeRunTimeoutMs: 7_200_000,
					providerStartupTimeoutMs: 300_000,
				},
			}),
		).rejects.toMatchObject({
			code: "STORY_LEAD_EVENT_HISTORY_MALFORMED",
			path: attempt.eventHistoryPath,
			line: 2,
		});
	});

	test("TC-2.10a and TC-2.10b fail loudly with overflow diagnostics instead of truncating required context", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-context-overflow",
		);
		const storyPath = join(specPackRoot, "stories", `${storyId}.md`);
		await writeTextFile(
			storyPath,
			`# Story 0: Foundation\n\n${"OVERFLOW_STORY_SENTINEL ".repeat(30)}\n`,
		);
		const { attempt, snapshot } = await createCurrentSnapshotFixture({
			specPackRoot,
			storyId,
		});

		try {
			await buildStoryLeadPlannerContext({
				specPackRoot,
				storyId,
				storyRunId: attempt.storyRunId,
				mode: "run",
				currentSnapshot: snapshot,
				currentSnapshotPath: attempt.currentSnapshotPath,
				eventHistoryPath: attempt.eventHistoryPath,
				provider: "codex",
				model: "gpt-5.4",
				runtimeSettings: {
					plannerTimeoutMs: 600_000,
					wholeRunTimeoutMs: 7_200_000,
					providerStartupTimeoutMs: 300_000,
				},
				providerLimitBytes: 120,
			});
			throw new Error("Expected planner context overflow.");
		} catch (error) {
			expect(error).toMatchObject({
				code: "STORY_LEAD_CONTEXT_OVERFLOW",
				storyId,
				storyRunId: attempt.storyRunId,
				provider: "codex",
				model: "gpt-5.4",
				providerLimit: 120,
			});
			if (
				typeof error !== "object" ||
				error === null ||
				!("largestSources" in error)
			) {
				throw error;
			}
			const largestSources = (
				error as { largestSources: Array<{ kind: string }> }
			).largestSources;
			expect(largestSources.length).toBeGreaterThan(0);
			expect(largestSources.map((source) => source.kind)).toContain(
				"story-file",
			);
		}
	});
});
