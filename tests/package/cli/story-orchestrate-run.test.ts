import { describe, expect, test } from "vitest";

import {
	createTempDir,
	parseJsonOutput,
	runSourceCli,
	writeFakeProviderExecutable,
} from "../../support/test-helpers";
import { createStoryOrchestrateSpecPack } from "../../support/story-orchestrate-fixtures";

function providerWrapper(sessionId: string, payload: unknown): string {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

describe("story-orchestrate run CLI", () => {
	test("TC-2.7a and TC-2.7b emits story-level heartbeats with the 10-minute default cadence", async () => {
		const { specPackRoot } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-run-heartbeat",
			{
				includeStoryLead: true,
			},
		);
		const providerBinDir = await createTempDir(
			"story-orchestrate-run-heartbeat-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-orchestrate-run-001", {
						action: "accept-story",
						rationale:
							"Finish the fixture with a single bounded acceptance action after heartbeat emission.",
						inputs: {
							summary:
								"Heartbeat fixture completed through one bounded acceptance action.",
							acceptanceCheckRefs: ["heartbeat-fixture"],
							recommendedImplLeadAction: "accept" as const,
						},
					}),
				},
			],
		});

		const run = await runSourceCli(
			[
				"story-orchestrate",
				"run",
				"--spec-pack-root",
				specPackRoot,
				"--story-id",
				"00-foundation",
				"--json",
			],
			{
				env: {
					LBUILD_IMPL_HEARTBEAT_INTERVAL_MS: "20",
					LBUILD_IMPL_STORY_ORCHESTRATE_DELAY_MS: "80",
					PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
					...storyLead.env,
				},
			},
		);
		const envelope = parseJsonOutput<{
			result: {
				storyId: string;
				storyRunId: string;
				currentSnapshotPath: string;
			};
		}>(run.stdout);

		expect(run.exitCode).toBe(3);
		expect(run.stderr).toContain("[heartbeat] story-orchestrate run");
		expect(run.stderr).toContain("Story id: 00-foundation.");
		expect(run.stderr).toContain(`Story run: ${envelope.result.storyRunId}.`);
		expect(run.stderr).toContain("Phase: story-orchestrate-run.");
		expect(run.stderr).toContain(
			`Current snapshot: ${envelope.result.currentSnapshotPath}.`,
		);
		expect(run.stderr).toContain("after 10 minute(s)");
	});

	test("TC-2.8a emits a terminal marker with outcome, story run id, and final package", async () => {
		const { specPackRoot } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-run-terminal",
			{
				includeStoryLead: true,
			},
		);
		const providerBinDir = await createTempDir(
			"story-orchestrate-run-terminal-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper("codex-story-orchestrate-terminal-001", {
						action: "accept-story",
						rationale:
							"Complete the fixture so the CLI emits a terminal marker.",
						inputs: {
							summary:
								"Terminal marker fixture completed through one bounded acceptance action.",
							acceptanceCheckRefs: ["terminal-fixture"],
							recommendedImplLeadAction: "accept" as const,
						},
					}),
				},
			],
		});

		const run = await runSourceCli(
			[
				"story-orchestrate",
				"run",
				"--spec-pack-root",
				specPackRoot,
				"--story-id",
				"00-foundation",
				"--json",
			],
			{
				env: {
					PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
					...storyLead.env,
				},
			},
		);
		const envelope = parseJsonOutput<{
			result: {
				outcome: string;
				storyRunId: string;
				finalPackagePath: string;
			};
		}>(run.stdout);

		expect(run.exitCode).toBe(3);
		expect(run.stderr).toContain("[terminal] story-orchestrate run");
		expect(run.stderr).toContain(
			`outcome ${envelope.result.outcome}. storyRunId=${envelope.result.storyRunId}.`,
		);
		expect(run.stderr).toContain(
			`Final package: ${envelope.result.finalPackagePath}`,
		);
	});

	test("TC-2.8b records interrupted terminal runs with a final package and recovery guidance", async () => {
		const { specPackRoot } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-run-incomplete",
			{
				includeStoryLead: true,
			},
		);

		const run = await runSourceCli(
			[
				"story-orchestrate",
				"run",
				"--spec-pack-root",
				specPackRoot,
				"--story-id",
				"00-foundation",
				"--json",
			],
			{
				env: {
					LBUILD_IMPL_STORY_ORCHESTRATE_INCOMPLETE: "1",
				},
			},
		);
		const envelope = parseJsonOutput<{
			result: {
				case: string;
				storyRunId: string;
				currentSnapshotPath: string;
				finalPackagePath: string;
				finalPackage: {
					outcome: string;
					replayBoundary: {
						smallestSafeStep: string;
					} | null;
				};
				recoveryGuidance: string;
			};
		}>(run.stdout);

		expect(run.exitCode).toBe(2);
		expect(envelope.result.case).toBe("interrupted");
		expect(envelope.result.finalPackagePath).toContain("final-package.json");
		expect(envelope.result.finalPackage.outcome).toBe("interrupted");
		expect(envelope.result.finalPackage.replayBoundary).toEqual(
			expect.objectContaining({
				smallestSafeStep: "resume-current-attempt",
			}),
		);
		expect(envelope.result.recoveryGuidance).toContain(
			"story-orchestrate resume",
		);
		expect(run.stderr).toContain("finished with outcome interrupted");
		expect(run.stderr).toContain(
			`Final package: ${envelope.result.finalPackagePath}`,
		);

		const status = await runSourceCli([
			"story-orchestrate",
			"status",
			"--spec-pack-root",
			specPackRoot,
			"--story-id",
			"00-foundation",
			"--json",
		]);
		const statusEnvelope = parseJsonOutput<{
			result: {
				case: string;
				storyRunId: string;
				currentStatus: string;
				currentSnapshotPath: string;
				terminalResult?: string;
				finalPackagePath: string;
				finalPackage: {
					outcome: string;
				};
			};
		}>(status.stdout);

		expect(statusEnvelope.result).toEqual(
			expect.objectContaining({
				case: "single-attempt",
				storyRunId: envelope.result.storyRunId,
				currentStatus: "interrupted",
				currentSnapshotPath: envelope.result.currentSnapshotPath,
				terminalResult: "interrupted",
				finalPackagePath: envelope.result.finalPackagePath,
				finalPackage: expect.objectContaining({
					outcome: "interrupted",
				}),
			}),
		);
	});
});
