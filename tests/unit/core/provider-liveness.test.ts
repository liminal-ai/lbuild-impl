import { join } from "node:path";

import { describe, expect, test } from "vitest";
import { z } from "zod";

import {
	buildRuntimeProgressPaths,
	buildStreamOutputPaths,
} from "../../../src/core/artifact-writer.js";
import { createClaudeCodeAdapter } from "../../../src/core/provider-adapters/claude-code.js";
import { runProviderCommand } from "../../../src/core/provider-adapters/shared.js";
import {
	RuntimeProgressTracker,
	runtimeProgressEventSchema,
	runtimeStatusSchema,
} from "../../../src/core/runtime-progress.js";
import { runStoryImplement } from "../../../src/core/story-implementor.js";
import {
	createImplementorSpecPack,
	createRunConfig,
	createTempDir,
	ROOT,
	readJsonLines,
	writeFakeProviderExecutable,
	writeRunConfig,
} from "../../support/test-helpers.js";

function providerWrapper(sessionId: string, payload: unknown): string {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

describe("provider liveness handling", () => {
	test("TC-4.6a, TC-4.7a, and TC-4.7b keep quiet Claude -p calls alive and report active-silent before terminal completion", async () => {
		const providerBinDir = await createTempDir(
			"provider-liveness-claude-quiet",
		);
		const fakeClaude = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "claude",
			responses: [
				{
					delayMs: 120,
					stdout: providerWrapper("claude-quiet-001", {
						ok: true,
					}),
				},
			],
		});
		const artifactPath = join(
			providerBinDir,
			"artifacts",
			"story-quiet",
			"001-claude-quiet.json",
		);
		const streamPaths = buildStreamOutputPaths(artifactPath);
		const progressPaths = buildRuntimeProgressPaths(artifactPath);
		const tracker = await RuntimeProgressTracker.start({
			command: "story-implement",
			phase: "initial-implement",
			provider: "claude-code",
			cwd: ROOT,
			timeoutMs: 500,
			configuredStartupTimeoutMs: 40,
			artifactPath,
			streamPaths,
			progressPaths,
		});
		const lifecycleEvents: string[] = [];
		const adapter = createClaudeCodeAdapter({
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...fakeClaude.env,
			},
		});

		const execution = await adapter.execute({
			prompt: 'Return {"ok":true}.',
			cwd: ROOT,
			model: "claude-sonnet",
			reasoningEffort: "high",
			timeoutMs: 500,
			startupTimeoutMs: 40,
			silenceTimeoutMs: 40,
			resultSchema: z
				.object({
					ok: z.boolean(),
				})
				.strict(),
			streamOutputPaths: streamPaths,
			lifecycleCallback: (event) => {
				lifecycleEvents.push(event.type);
				tracker.handleProviderLifecycle(event);
			},
		});

		expect(execution.exitCode).toBe(0);
		expect(execution.parsedResult).toEqual({
			ok: true,
		});
		expect(lifecycleEvents).toEqual(
			expect.arrayContaining([
				"provider-spawned",
				"active-silent",
				"output",
				"provider-exit",
			]),
		);
		expect(lifecycleEvents).not.toContain("startup-failed");
		expect(lifecycleEvents).not.toContain("stalled");

		await tracker.markCompleted(
			"story-implement completed after a quiet Claude call.",
		);
		await tracker.flush();

		const runtimeStatus = runtimeStatusSchema.parse(
			JSON.parse(await Bun.file(progressPaths.statusPath).text()),
		);
		const progressEvents = (
			await readJsonLines(progressPaths.progressPath)
		).map((line) => runtimeProgressEventSchema.parse(line));

		expect(runtimeStatus.status).toBe("completed");
		expect(runtimeStatus.providerLiveness).toBe("completed");
		expect(progressEvents.map((event) => event.event)).toEqual(
			expect.arrayContaining([
				"provider-spawned",
				"active-silent",
				"first-output-received",
				"provider-exit",
				"completed",
			]),
		);
	});

	test("TC-4.6b and TC-4.7a fail true startup problems explicitly instead of collapsing them into stall handling", async () => {
		const artifactPath = join(
			await createTempDir("provider-liveness-startup-failure"),
			"artifacts",
			"story-startup",
			"001-startup-failure.json",
		);
		const streamPaths = buildStreamOutputPaths(artifactPath);
		const progressPaths = buildRuntimeProgressPaths(artifactPath);
		const tracker = await RuntimeProgressTracker.start({
			command: "story-verify",
			phase: "verifier-initial",
			provider: "codex",
			cwd: ROOT,
			timeoutMs: 500,
			configuredStartupTimeoutMs: 40,
			configuredSilenceTimeoutMs: 200,
			artifactPath,
			streamPaths,
			progressPaths,
			verifiersCompleted: 0,
			verifiersPlanned: 1,
		});
		const lifecycleEvents: string[] = [];

		const execution = await runProviderCommand({
			provider: "codex",
			executable: "sh",
			args: ["-lc", "sleep 1"],
			cwd: ROOT,
			timeoutMs: 500,
			startupTimeoutMs: 40,
			silenceTimeoutMs: 200,
			streamOutputPaths: streamPaths,
			lifecycleCallback: (event) => {
				lifecycleEvents.push(event.type);
				tracker.handleProviderLifecycle(event);
			},
		});

		expect(execution.errorCode).toBe("PROVIDER_STARTUP_FAILED");
		expect(lifecycleEvents).toEqual(
			expect.arrayContaining([
				"provider-spawned",
				"startup-failed",
				"provider-exit",
			]),
		);
		expect(lifecycleEvents).not.toContain("stalled");

		await tracker.markFailed("story-verify failed startup before any output.");
		await tracker.flush();

		const runtimeStatus = runtimeStatusSchema.parse(
			JSON.parse(await Bun.file(progressPaths.statusPath).text()),
		);
		expect(runtimeStatus.status).toBe("failed");
		expect(runtimeStatus.providerLiveness).toBe("startup-failed");
	});

	test("TC-4.6b maps actual process spawn failures to startup-failed in both the shared runner and downstream workflow errors", async () => {
		const lifecycleEvents: string[] = [];
		const execution = await runProviderCommand({
			provider: "codex",
			executable: "definitely-not-a-real-binary",
			args: [],
			cwd: ROOT,
			timeoutMs: 500,
			startupTimeoutMs: 40,
			lifecycleCallback: (event) => {
				lifecycleEvents.push(event.type);
			},
		});

		expect(execution.errorCode).toBe("PROVIDER_STARTUP_FAILED");
		expect(lifecycleEvents).toEqual(expect.arrayContaining(["startup-failed"]));

		const fixture = await createImplementorSpecPack(
			"provider-liveness-spawn-failure-implementor",
		);
		await writeRunConfig(
			fixture.specPackRoot,
			createRunConfig({
				story_implementor: {
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "high",
				},
			}),
		);
		const emptyBinDir = await createTempDir("provider-liveness-empty-bin");
		const outcome = await runStoryImplement({
			specPackRoot: fixture.specPackRoot,
			storyId: fixture.storyId,
			env: {
				PATH: emptyBinDir,
			},
		});

		expect(outcome.outcome).toBe("blocked");
		expect(outcome.errors).toContainEqual(
			expect.objectContaining({
				code: "PROVIDER_STARTUP_FAILED",
				detail: expect.stringContaining("ENOENT"),
			}),
		);
	});
});
