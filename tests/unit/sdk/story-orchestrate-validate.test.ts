import { describe, expect, test } from "vitest";

import { storyOrchestrateValidate } from "../../../src/sdk/operations/story-orchestrate";
import {
	createStoryOrchestrateSpecPack,
	seedStoryRunAttempt,
} from "../../support/story-orchestrate-fixtures";
import {
	createTempDir,
	writeFakeProviderExecutable,
} from "../../support/test-helpers";

describe("story-orchestrate validate sdk operation", () => {
	test("returns ready validation with a captured baseline seed when the story is startable", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-validate-ready",
			{
				includeStoryLead: true,
			},
		);
		const providerBinDir = await createTempDir(
			"story-orchestrate-sdk-validate-ready-provider",
		);
		const claudeProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			version: "2.1.128 (Claude Code)",
			authStdout: "authenticated",
		});
		const codexProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			version: "codex-cli 0.128.0",
		});

		const envelope = await storyOrchestrateValidate({
			specPackRoot,
			storyId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...claudeProvider.env,
				...codexProvider.env,
			},
		});

		expect(envelope.command).toBe("story-orchestrate validate");
		expect(envelope.status).toBe("ok");
		expect(envelope.outcome).toBe("ready");
		expect(envelope.result).toEqual(
			expect.objectContaining({
				status: "ready",
				storyId,
				storyRunSelection: expect.objectContaining({
					case: "start-new",
				}),
				baselineSeed: expect.objectContaining({
					workspaceRoot: expect.any(String),
					baselineBeforeCurrentStory: expect.any(Number),
					testFilePattern: expect.any(String),
				}),
			}),
		);
		expect(
			envelope.result?.checks.find((check) => check.name === "baseline-seed")
				?.status,
		).toBe("pass");
		expect(envelope.artifacts[0]?.path).toContain("/artifacts/00-foundation/");
	});

	test("blocks validation when a resumable attempt already exists", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-validate-resume-required",
			{
				includeStoryLead: true,
			},
		);
		const providerBinDir = await createTempDir(
			"story-orchestrate-sdk-validate-resume-provider",
		);
		const claudeProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			version: "2.1.128 (Claude Code)",
			authStdout: "authenticated",
		});
		const codexProvider = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			version: "codex-cli 0.128.0",
		});
		const attempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "blocked",
		});

		const envelope = await storyOrchestrateValidate({
			specPackRoot,
			storyId,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...claudeProvider.env,
				...codexProvider.env,
			},
		});

		expect(envelope.outcome).toBe("blocked");
		expect(envelope.result).toEqual(
			expect.objectContaining({
				status: "blocked",
				storyRunSelection: expect.objectContaining({
					case: "resume-required",
					storyRunId: attempt.storyRunId,
				}),
			}),
		);
		expect(envelope.errors[0]?.message).toContain("resumable story-run");
	});
});
