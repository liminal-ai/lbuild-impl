import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { runStoryLead } from "../../../src/core/story-lead.js";
import { createStoryRunLedger } from "../../../src/core/story-run-ledger.js";
import { storyOrchestrateRun } from "../../../src/sdk/operations/story-orchestrate.js";
import {
	createRunConfig,
	createTempDir,
	readJsonLines,
	writeFakeProviderExecutable,
	writeRunConfig,
	writeTextFile,
} from "../../support/test-helpers.js";
import { createStoryOrchestrateSpecPack } from "../../support/story-orchestrate-fixtures.js";

function providerWrapper(sessionId: string, payload: unknown): string {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

describe("story-lead stateless runtime", () => {
	test("TC-2.1a, TC-2.1b, TC-2.7a, TC-2.8a, TC-2.8b, and TC-3.7a keep planner turns stateless while replaying child failure artifacts and self-notes through later prompts", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-stateless-child-failure",
			{
				includeStoryLead: true,
			},
		);
		await writeRunConfig(
			specPackRoot,
			createRunConfig({
				story_implementor: {
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "high",
				},
				story_lead_provider: {
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
			}),
		);

		const providerBinDir = await createTempDir(
			"story-lead-stateless-child-failure-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-stateless-001", {
						action: "run-implement",
						rationale:
							"Run one implementor step so the durable record captures the blocked child result.",
						inputs: {},
						selfNote:
							"Remember blocked implementor evidence before the next turn.",
					}),
				},
				{
					stdout: providerWrapper("codex-story-lead-stateless-001", {
						action: "accept-story",
						rationale:
							"The blocked implementor artifact and self-note are both visible in the fresh second planner turn.",
						inputs: {
							summary:
								"The blocked implementor artifact and self-note are both visible in the fresh second planner turn.",
							acceptanceCheckRefs: ["blocked-child-artifact-replayed"],
							acceptanceChecks: [
								{
									name: "blocked-child-artifact-replayed",
									status: "pass" as const,
									evidence: ["implementor-result"],
									reasoning:
										"The second stateless planner turn received the prior child artifact in full.",
								},
							],
							recommendedImplLeadAction: "reopen" as const,
						},
					}),
				},
			],
		});
		const childProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-implement-stateless-001", {
						outcome: "blocked",
						planSummary: "CHILD_FAILURE_CONTEXT_SENTINEL",
						changedFiles: [],
						tests: {
							added: [],
							modified: [],
							removed: [],
							totalAfterStory: 3,
							deltaFromPriorBaseline: 0,
						},
						gatesRun: [
							{
								command: "npm run green-verify",
								result: "not-run" as const,
							},
						],
						selfReview: {
							findingsFixed: [],
							findingsSurfaced: ["STATLESS_CHILD_FAILURE_FINDING"],
						},
						openQuestions: ["Does the maintainer want to unblock this lane?"],
						specDeviations: [],
						recommendedNextStep: "Pause for maintainer review.",
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
				...childProvider.env,
			},
		});

		if (runEnvelope.result?.case !== "completed") {
			throw new Error(
				`Expected a completed story run, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		const storyLeadInvocations = await readJsonLines<{
			args: string[];
		}>(storyLead.logPath);
		const events = await readJsonLines<
			Array<{ type: string; data?: Record<string, unknown> }>[number]
		>(runEnvelope.result.eventHistoryPath);
		const currentSnapshot = JSON.parse(
			await Bun.file(runEnvelope.result.currentSnapshotPath).text(),
		) as Record<string, unknown>;
		const secondArgs = storyLeadInvocations[1]?.args ?? [];
		const secondPrompt =
			secondArgs[secondArgs.findIndex((arg) => arg === "-p") + 1] ?? "";

		expect(storyLeadInvocations).toHaveLength(2);
		expect(
			storyLeadInvocations.every(
				(invocation) =>
					!invocation.args.includes("resume") &&
					!invocation.args.some((arg) => arg.includes("--resume")),
			),
		).toBe(true);
		expect(secondPrompt).toContain("CHILD_FAILURE_CONTEXT_SENTINEL");
		expect(secondPrompt).toContain(
			"Remember blocked implementor evidence before the next turn.",
		);
		expect(secondPrompt).toContain("All prior runtime self-notes");
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "child-operation-completed",
				}),
				expect.objectContaining({
					type: "story-lead-self-note-recorded",
					data: expect.objectContaining({
						note: "Remember blocked implementor evidence before the next turn.",
					}),
				}),
			]),
		);
		expect(currentSnapshot).not.toHaveProperty("storyLeadSession");
	});

	test("TC-2.11b routes insufficient story-local context to a ruling path without pulling in tech design by default", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-stateless-needs-ruling",
			{
				includeStoryLead: true,
			},
		);
		const storyPath = join(specPackRoot, "stories", `${storyId}.md`);
		const testPlanPath = join(specPackRoot, "test-plan.md");
		const techDesignPath = join(specPackRoot, "tech-design.md");
		await writeTextFile(
			storyPath,
			"# Story 0: Foundation\n\nThe story text is intentionally sparse.\n",
		);
		await writeTextFile(
			testPlanPath,
			"# Test Plan\n\nThe test plan is intentionally sparse.\n",
		);
		await writeTextFile(
			techDesignPath,
			"# Technical Design\n\nTECH_DESIGN_SHOULD_NOT_APPEAR_IN_PROMPT\n",
		);

		const providerBinDir = await createTempDir(
			"story-lead-stateless-needs-ruling-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-ruling-001", {
						action: "request-ruling",
						rationale:
							"The story file and test plan do not supply enough story-local detail for a safe next step.",
						inputs: {
							id: "ruling-001",
							decisionType: "missing-story-local-context",
							question:
								"Should the maintainer provide more story-local acceptance detail before work continues?",
							defaultRecommendation:
								"Pause and ask for story-local clarification rather than pulling in tech design by default.",
							evidence: [storyPath, testPlanPath],
							allowedResponses: ["clarify", "stop"],
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
				`Expected a completed story run, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		const storyLeadInvocations = await readJsonLines<{
			args: string[];
		}>(storyLead.logPath);
		const firstArgs = storyLeadInvocations[0]?.args ?? [];
		const prompt =
			firstArgs[firstArgs.findIndex((arg) => arg === "-p") + 1] ?? "";

		expect(runEnvelope.result.finalPackage.outcome).toBe("needs-ruling");
		expect(prompt).toContain("The story text is intentionally sparse.");
		expect(prompt).toContain("The test plan is intentionally sparse.");
		expect(prompt).not.toContain("TECH_DESIGN_SHOULD_NOT_APPEAR_IN_PROMPT");
	});

	test("TC-2.10a maps provider-side input-length rejection to explicit story-lead context overflow", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-stateless-provider-context-overflow",
			{
				includeStoryLead: true,
			},
		);
		const storyPath = join(specPackRoot, "stories", `${storyId}.md`);
		await writeTextFile(
			storyPath,
			`# Story 0: Foundation\n\n${"PROVIDER_OVERFLOW_STORY_SOURCE ".repeat(200)}\n`,
		);
		const providerBinDir = await createTempDir(
			"story-lead-stateless-provider-context-overflow-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			responses: [
				{
					stderr:
						"provider rejected input: context limit exceeded, prompt too long",
					exitCode: 1,
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
				`Expected a completed failed package, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		const events = await readJsonLines<
			Array<{
				type: string;
				data?: {
					code?: string;
					provider?: string;
					storyId?: string;
					storyRunId?: string;
					largestSources?: Array<{ kind: string; path?: string }>;
				};
			}>[number]
		>(runEnvelope.result.eventHistoryPath);
		const overflowEvent = events.find(
			(event) => event.type === "story-lead-context-overflow",
		);

		expect(runEnvelope.result.finalPackage.outcome).toBe("failed");
		expect(overflowEvent?.data).toMatchObject({
			code: "STORY_LEAD_CONTEXT_OVERFLOW",
			provider: "claude-code",
			storyId,
			storyRunId: runEnvelope.result.storyRunId,
		});
		expect(overflowEvent?.data?.largestSources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "story-file",
					path: storyPath,
				}),
			]),
		);
		expect(
			overflowEvent?.data?.largestSources?.map((source) => source.kind),
		).not.toContain("provider-rejected-planner-prompt");
	});

	test("TC-4.4b reports planner timeout failures against the dedicated planner-turn budget", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-planner-timeout",
			{
				includeStoryLead: true,
			},
		);
		await writeRunConfig(
			specPackRoot,
			createRunConfig({
				story_lead_provider: {
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
				timeouts: {
					story_lead_planner_ms: 25,
					story_orchestrate_ms: 500,
				},
			}),
		);

		const providerBinDir = await createTempDir(
			"story-lead-planner-timeout-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			responses: [
				{
					delayMs: 60,
					stdout: providerWrapper("codex-story-lead-timeout-001", {
						action: "accept-story",
						rationale:
							"This response should arrive too late for the planner timeout.",
						inputs: {
							summary: "Timed out planner turn should never reach acceptance.",
							acceptanceCheckRefs: ["planner-timeout"],
							recommendedImplLeadAction: "reopen" as const,
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

		if (runEnvelope.result?.case !== "interrupted") {
			throw new Error(
				`Expected an interrupted planner-timeout run, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		const events = await readJsonLines<
			Array<{
				type: string;
				summary: string;
				data?: {
					configuredPlannerTimeoutMs?: number;
					configuredWholeRunTimeoutMs?: number;
				};
			}>[number]
		>(runEnvelope.result.eventHistoryPath);
		const timeoutEvent = events.find(
			(event) => event.type === "story-lead-planner-timeout",
		);

		expect(runEnvelope.result.finalPackage.outcome).toBe("interrupted");
		expect(runEnvelope.result.finalPackage.replayBoundary?.reasoning).toContain(
			"planner turn exceeded its configured timeout",
		);
		expect(
			runEnvelope.result.finalPackage.replayBoundary?.reasoning,
		).not.toContain("context window");
		expect(timeoutEvent?.summary).toContain("planner timeout");
		expect(timeoutEvent?.data?.configuredPlannerTimeoutMs).toBe(25);
		expect(timeoutEvent?.data?.configuredWholeRunTimeoutMs).toBeUndefined();
		expect(events.map((event) => event.type)).not.toContain(
			"story-orchestrate-timeout",
		);
	});

	test("TC-4.5a and TC-4.5b report whole-run timeout separately from planner and child budgets", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-whole-run-timeout",
			{
				includeStoryLead: true,
			},
		);
		await writeRunConfig(
			specPackRoot,
			createRunConfig({
				story_implementor: {
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "high",
				},
				story_lead_provider: {
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
				timeouts: {
					story_lead_planner_ms: 500,
					story_orchestrate_ms: 120,
				},
			}),
		);

		const providerBinDir = await createTempDir(
			"story-orchestrate-whole-run-timeout-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-whole-run-001", {
						action: "run-implement",
						rationale:
							"Run one child step so the overall attempt crosses the whole-run budget before child work can complete.",
						inputs: {},
					}),
				},
			],
		});
		const childProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					delayMs: 800,
					stdout: providerWrapper("codex-story-implement-whole-run-001", {
						outcome: "ready-for-verification",
						planSummary: "WHOLE_RUN_TIMEOUT_SENTINEL",
						changedFiles: [],
						tests: {
							added: [],
							modified: [],
							removed: [],
							totalAfterStory: 5,
							deltaFromPriorBaseline: 1,
						},
						gatesRun: [
							{
								command: "npm run green-verify",
								result: "not-run" as const,
							},
						],
						selfReview: {
							findingsFixed: [],
							findingsSurfaced: [],
						},
						openQuestions: [],
						specDeviations: [],
						recommendedNextStep: "Run verifier after the implementor step.",
					}),
				},
			],
		});

		const startedAtMs = Date.now();
		const runEnvelope = await storyOrchestrateRun({
			specPackRoot,
			storyId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
				...childProvider.env,
			},
		});
		const elapsedMs = Date.now() - startedAtMs;

		if (runEnvelope.result?.case !== "interrupted") {
			throw new Error(
				`Expected an interrupted whole-run-timeout result, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		const events = await readJsonLines<
			Array<{
				type: string;
				data?: {
					configuredPlannerTimeoutMs?: number;
					configuredWholeRunTimeoutMs?: number;
				};
			}>[number]
		>(runEnvelope.result.eventHistoryPath);
		const wholeRunTimeoutEvent = events.find(
			(event) => event.type === "story-orchestrate-timeout",
		);

		expect(runEnvelope.result.finalPackage.outcome).toBe("interrupted");
		expect(elapsedMs).toBeLessThan(700);
		expect(
			runEnvelope.result.finalPackage.evidence.implementorArtifacts,
		).toHaveLength(0);
		expect(wholeRunTimeoutEvent?.data?.configuredWholeRunTimeoutMs).toBe(120);
		expect(
			wholeRunTimeoutEvent?.data?.configuredPlannerTimeoutMs,
		).toBeUndefined();
		expect(events.map((event) => event.type)).not.toContain(
			"story-lead-planner-timeout",
		);
		expect(events.map((event) => event.type)).not.toContain(
			"child-operation-completed",
		);
	});

	test("TC-3.7b leaves the latest completed child result recoverable when the runtime crashes before the next planner turn", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-stateless-crash-after-child",
			{
				includeStoryLead: true,
			},
		);
		await writeRunConfig(
			specPackRoot,
			createRunConfig({
				story_implementor: {
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "high",
				},
				story_lead_provider: {
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
			}),
		);

		const providerBinDir = await createTempDir(
			"story-lead-stateless-crash-after-child-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			responses: [
				{
					stdout: providerWrapper("codex-story-lead-crash-001", {
						action: "run-implement",
						rationale:
							"Run implementation before the runtime crash simulation.",
						inputs: {},
					}),
				},
			],
		});
		const childProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-implement-crash-001", {
						outcome: "ready-for-verification",
						planSummary: "CRASH_RECOVERY_CHILD_RESULT_SENTINEL",
						changedFiles: [],
						tests: {
							added: [],
							modified: [],
							removed: [],
							totalAfterStory: 4,
							deltaFromPriorBaseline: 1,
						},
						gatesRun: [
							{
								command: "npm run green-verify",
								result: "not-run" as const,
							},
						],
						selfReview: {
							findingsFixed: [],
							findingsSurfaced: [],
						},
						openQuestions: [],
						specDeviations: [],
						recommendedNextStep: "Run verifier after crash recovery.",
					}),
				},
			],
		});
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const previousCrashEnv =
			process.env.LBUILD_IMPL_STORY_ORCHESTRATE_CRASH_AFTER_CHILD_RESULT;
		process.env.LBUILD_IMPL_STORY_ORCHESTRATE_CRASH_AFTER_CHILD_RESULT = "1";
		try {
			await expect(
				runStoryLead({
					specPackRoot,
					storyId,
					ledger,
					mode: "run",
					env: {
						PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
						...storyLead.env,
						...childProvider.env,
					},
				}),
			).rejects.toThrow(/Simulated runtime crash/u);
		} finally {
			if (previousCrashEnv === undefined) {
				delete process.env
					.LBUILD_IMPL_STORY_ORCHESTRATE_CRASH_AFTER_CHILD_RESULT;
			} else {
				process.env.LBUILD_IMPL_STORY_ORCHESTRATE_CRASH_AFTER_CHILD_RESULT =
					previousCrashEnv;
			}
		}

		const attempts = await ledger.listAttempts();
		const latestAttempt = attempts.at(-1);
		if (!latestAttempt) {
			throw new Error("Expected the crashed run to leave an attempt record.");
		}
		const implementorArtifact =
			latestAttempt.currentSnapshot.latestArtifacts.find(
				(artifact) => artifact.kind === "implementor-result",
			);
		if (!implementorArtifact) {
			throw new Error("Expected a recoverable implementor result artifact.");
		}
		const artifactContent = await Bun.file(implementorArtifact.path).text();
		const events = await readJsonLines<Array<{ type: string }>[number]>(
			latestAttempt.eventHistoryPath,
		);

		expect(artifactContent).toContain("CRASH_RECOVERY_CHILD_RESULT_SENTINEL");
		expect(events.map((event) => event.type)).toContain(
			"child-operation-completed",
		);
		expect(latestAttempt.currentSnapshot.nextIntent?.artifactRef).toBe(
			implementorArtifact.path,
		);
	});
});
