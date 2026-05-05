import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, test } from "vitest";

import {
	storyOrchestrateResume,
	storyOrchestrateRun,
} from "../../../src/sdk/operations/story-orchestrate.js";
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

function processMissing(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code === "ESRCH"
	);
}

function expectProcessStopped(pid: number): void {
	try {
		process.kill(pid, 0);
		throw new Error(`Expected pid ${pid} to be stopped.`);
	} catch (error) {
		if (processMissing(error)) {
			return;
		}
		throw error;
	}
}

async function waitForActiveTrackedChildOperation(input: {
	currentSnapshotPath: string;
	timeoutMs: number;
}): Promise<void> {
	const deadline = Date.now() + input.timeoutMs;

	while (Date.now() < deadline) {
		if (await Bun.file(input.currentSnapshotPath).exists()) {
			try {
				const snapshot = JSON.parse(
					await Bun.file(input.currentSnapshotPath).text(),
				) as {
					lifecycleState?: string;
					currentChildOperation?: {
						command?: string;
						artifactPath?: string;
					} | null;
				};
				if (
					snapshot.lifecycleState === "running_child_operation" &&
					typeof snapshot.currentChildOperation?.command === "string" &&
					typeof snapshot.currentChildOperation?.artifactPath === "string"
				) {
					return;
				}
			} catch {
				// Snapshot writes are atomic but the empty reservation file can exist
				// briefly before the first real JSON payload lands. Keep polling.
			}
		}

		await sleep(25);
	}

	throw new Error(
		`Timed out waiting for ${input.currentSnapshotPath} to reach running_child_operation with a tracked child artifact.`,
	);
}

describe("story-lead child-process interruption handling", () => {
	test("TC-4.9a stops tracked child provider processes when whole-run interruption happens mid-operation", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-process-cleanup-stop",
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
					story_orchestrate_ms: 1_500,
				},
			}),
		);

		const providerBinDir = await createTempDir(
			"story-lead-process-cleanup-stop-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			responses: [
				{
					stdout: providerWrapper("codex-process-cleanup-stop-001", {
						action: "run-implement",
						rationale:
							"Hold the implementor lane open so interruption cleanup has to stop it.",
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
					delayMs: 5_000,
					stdout: providerWrapper("codex-process-cleanup-stop-001", {
						outcome: "ready-for-verification",
						planSummary:
							"This result should never complete before interruption cleanup.",
						changedFiles: [],
						tests: {
							added: [],
							modified: [],
							removed: [],
							totalAfterStory: 1,
							deltaFromPriorBaseline: 0,
						},
						gatesRun: [],
						selfReview: {
							findingsFixed: [],
							findingsSurfaced: [],
						},
						openQuestions: [],
						specDeviations: [],
						recommendedNextStep: "Not reached.",
					}),
				},
			],
		});

		const currentSnapshotPath = join(
			specPackRoot,
			"artifacts",
			storyId,
			"story-lead",
			"001-current.json",
		);
		const runPromise = storyOrchestrateRun({
			specPackRoot,
			storyId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
				...childProvider.env,
			},
		});
		await waitForActiveTrackedChildOperation({
			currentSnapshotPath,
			timeoutMs: 1_000,
		});
		const runEnvelope = await runPromise;

		if (runEnvelope.result?.case !== "interrupted") {
			throw new Error(
				`Expected an interrupted cleanup run, received ${runEnvelope.result?.case ?? runEnvelope.status}.`,
			);
		}

		const events = await readJsonLines<
			Array<{
				type: string;
				data?: {
					command?: string;
					pid?: number;
					statusArtifactPath?: string;
				};
			}>[number]
		>(runEnvelope.result.eventHistoryPath);
		const cleanupEvent = events.find(
			(event) =>
				event.type === "child-process-stopped" ||
				event.type === "child-process-abandoned",
		);

		expect(cleanupEvent).toBeTruthy();
		expect(cleanupEvent?.data?.command).toBe("story-implement");
		expect(cleanupEvent?.data?.statusArtifactPath).toContain(".status.json");
		if (
			cleanupEvent?.type === "child-process-stopped" &&
			typeof cleanupEvent.data?.pid === "number"
		) {
			expectProcessStopped(cleanupEvent.data.pid);
		} else {
			expect(cleanupEvent?.data?.pid).toBeDefined();
		}
	});

	test("TC-4.9b ignores orphaned prior-run artifacts when a resumed story-lead turn rebuilds current evidence", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-process-cleanup-orphan-artifacts",
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
					story_orchestrate_ms: 1_500,
				},
			}),
		);

		const providerBinDir = await createTempDir(
			"story-lead-process-cleanup-orphan-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			responses: [
				{
					stdout: providerWrapper("codex-process-cleanup-orphan-001", {
						action: "run-implement",
						rationale:
							"Force an interruption so we can leave an orphan artifact behind.",
						inputs: {},
					}),
				},
				{
					stdout: providerWrapper("codex-process-cleanup-orphan-001", {
						action: "accept-story",
						rationale:
							"Resume from the durable ledger and ignore orphan artifacts that were never recorded in latestArtifacts.",
						inputs: {
							summary:
								"Resume from the durable ledger and ignore orphan artifacts that were never recorded in latestArtifacts.",
							acceptanceCheckRefs: ["orphan-artifact-ignored"],
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
					delayMs: 5_000,
					stdout: providerWrapper("codex-process-cleanup-orphan-001", {
						outcome: "ready-for-verification",
						planSummary: "OLD_PROVIDER_OUTPUT_SENTINEL",
						changedFiles: [],
						tests: {
							added: [],
							modified: [],
							removed: [],
							totalAfterStory: 1,
							deltaFromPriorBaseline: 0,
						},
						gatesRun: [],
						selfReview: {
							findingsFixed: [],
							findingsSurfaced: [],
						},
						openQuestions: [],
						specDeviations: [],
						recommendedNextStep: "Not reached.",
					}),
				},
			],
		});

		const firstCurrentSnapshotPath = join(
			specPackRoot,
			"artifacts",
			storyId,
			"story-lead",
			"001-current.json",
		);
		const firstRunPromise = storyOrchestrateRun({
			specPackRoot,
			storyId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
				...childProvider.env,
			},
		});
		await waitForActiveTrackedChildOperation({
			currentSnapshotPath: firstCurrentSnapshotPath,
			timeoutMs: 1_000,
		});
		const firstRun = await firstRunPromise;

		if (firstRun.result?.case !== "interrupted") {
			throw new Error(
				`Expected an interrupted first run, received ${firstRun.result?.case ?? firstRun.status}.`,
			);
		}

		const orphanArtifactPath = join(
			specPackRoot,
			"artifacts",
			storyId,
			"999-implementor.json",
		);
		await writeTextFile(
			orphanArtifactPath,
			`${JSON.stringify(
				{
					command: "story-implement",
					planSummary: "OLD_PROVIDER_OUTPUT_SENTINEL",
				},
				null,
				2,
			)}\n`,
		);

		const resumeEnvelope = await storyOrchestrateResume({
			specPackRoot,
			storyId,
			storyRunId: firstRun.result.storyRunId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...storyLead.env,
				...childProvider.env,
			},
		});

		if (resumeEnvelope.result?.case !== "completed") {
			throw new Error(
				`Expected the resumed run to complete, received ${resumeEnvelope.result?.case ?? resumeEnvelope.status}.`,
			);
		}

		const storyLeadInvocations = await readJsonLines<{
			args: string[];
		}>(storyLead.logPath);
		const resumedPrompt = storyLeadInvocations.at(-1)?.args.at(-1) ?? "";
		const currentSnapshot = JSON.parse(
			await Bun.file(resumeEnvelope.result.currentSnapshotPath).text(),
		) as {
			latestArtifacts: Array<{
				path: string;
			}>;
		};

		expect(resumedPrompt).not.toContain("OLD_PROVIDER_OUTPUT_SENTINEL");
		expect(
			currentSnapshot.latestArtifacts.map((artifact) => artifact.path),
		).not.toContain(orphanArtifactPath);
	});
});
