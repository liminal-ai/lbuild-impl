import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
	buildRuntimeProgressPaths,
	buildStreamOutputPaths,
} from "../../../src/core/artifact-writer";
import { runProviderCommand } from "../../../src/core/provider-adapters/shared";
import {
	RuntimeProgressTracker,
	runtimeProgressEventSchema,
	runtimeStatusSchema,
} from "../../../src/core/runtime-progress";
import { createTempDir, ROOT, readJsonLines } from "../../support/test-helpers";

describe("runtime progress artifacts", () => {
	test("creates status.json and progress.jsonl and preserves the final snapshot after success", async () => {
		const tempDir = await createTempDir("runtime-progress-success");
		const artifactPath = join(
			tempDir,
			"artifacts",
			"story-01",
			"001-implementor.json",
		);
		const streamPaths = buildStreamOutputPaths(artifactPath);
		const progressPaths = buildRuntimeProgressPaths(artifactPath);
		const tracker = await RuntimeProgressTracker.start({
			command: "story-implement",
			phase: "initial-implement",
			provider: "codex",
			cwd: ROOT,
			timeoutMs: 1_000,
			artifactPath,
			streamPaths,
			progressPaths,
			selfReviewPassesCompleted: 0,
			selfReviewPassesPlanned: 3,
		});

		const execution = await runProviderCommand({
			provider: "codex",
			executable: "sh",
			args: ["-lc", "echo progress-ok"],
			cwd: ROOT,
			timeoutMs: 1_000,
			streamOutputPaths: streamPaths,
			lifecycleCallback: (event) => tracker.handleProviderLifecycle(event),
		});
		expect(execution.exitCode).toBe(0);
		expect(tracker.getSnapshot().phase).toBe("initial-implement");

		await tracker.markCompleted("story-implement completed successfully.", {
			outcome: "ready-for-verification",
			selfReviewPassesCompleted: 0,
		});
		await tracker.flush();

		const runtimeStatus = runtimeStatusSchema.parse(
			JSON.parse(await Bun.file(progressPaths.statusPath).text()),
		);
		const progressEvents = (
			await readJsonLines(progressPaths.progressPath)
		).map((line) => runtimeProgressEventSchema.parse(line));

		expect(runtimeStatus.status).toBe("completed");
		expect(runtimeStatus.providerLiveness).toBe("completed");
		expect(runtimeStatus.artifactPath).toBe(artifactPath);
		expect(runtimeStatus.lastOutputAt).not.toBeNull();
		expect(runtimeStatus.streamPaths).toEqual(streamPaths);
		expect(runtimeStatus.progressPaths).toEqual(progressPaths);
		expect(progressEvents.map((event) => event.event)).toEqual(
			expect.arrayContaining([
				"command-started",
				"provider-spawned",
				"first-output-received",
				"provider-exit",
				"completed",
			]),
		);
	});

	test("preserves the final snapshot after provider failure", async () => {
		const tempDir = await createTempDir("runtime-progress-failure");
		const artifactPath = join(
			tempDir,
			"artifacts",
			"story-02",
			"001-verify.json",
		);
		const streamPaths = buildStreamOutputPaths(artifactPath);
		const progressPaths = buildRuntimeProgressPaths(artifactPath);
		const tracker = await RuntimeProgressTracker.start({
			command: "story-verify",
			phase: "verifier-initial",
			provider: "codex",
			cwd: ROOT,
			timeoutMs: 1_000,
			artifactPath,
			streamPaths,
			progressPaths,
			verifiersCompleted: 0,
			verifiersPlanned: 1,
		});

		const execution = await runProviderCommand({
			provider: "codex",
			executable: "sh",
			args: ["-lc", "echo failing >&2; exit 1"],
			cwd: ROOT,
			timeoutMs: 1_000,
			streamOutputPaths: streamPaths,
			lifecycleCallback: (event) => tracker.handleProviderLifecycle(event),
		});
		expect(execution.exitCode).toBe(1);

		await tracker.markFailed("story-verify failed during provider execution.", {
			errorCode: execution.errorCode ?? "PROVIDER_UNAVAILABLE",
		});
		await tracker.flush();

		const runtimeStatus = runtimeStatusSchema.parse(
			JSON.parse(await Bun.file(progressPaths.statusPath).text()),
		);
		const progressEvents = (
			await readJsonLines(progressPaths.progressPath)
		).map((line) => runtimeProgressEventSchema.parse(line));

		expect(runtimeStatus.status).toBe("failed");
		expect(runtimeStatus.providerLiveness).toBe("active-with-output");
		expect(progressEvents.map((event) => event.event)).toEqual(
			expect.arrayContaining(["provider-exit", "failed"]),
		);
	});

	test("records timeout events and a failed final snapshot", async () => {
		const tempDir = await createTempDir("runtime-progress-timeout");
		const artifactPath = join(
			tempDir,
			"artifacts",
			"epic",
			"001-epic-reverify.json",
		);
		const streamPaths = buildStreamOutputPaths(artifactPath);
		const progressPaths = buildRuntimeProgressPaths(artifactPath);
		const tracker = await RuntimeProgressTracker.start({
			command: "epic-reverify",
			phase: "epic-reverify",
			provider: "codex",
			cwd: ROOT,
			timeoutMs: 50,
			artifactPath,
			streamPaths,
			progressPaths,
		});

		const execution = await runProviderCommand({
			provider: "codex",
			executable: "sh",
			args: ["-lc", "sleep 2"],
			cwd: ROOT,
			timeoutMs: 50,
			streamOutputPaths: streamPaths,
			lifecycleCallback: (event) => tracker.handleProviderLifecycle(event),
		});
		expect(execution.errorCode).toBe("PROVIDER_TIMEOUT");

		await tracker.markFailed("epic-reverify timed out.", {
			errorCode: execution.errorCode,
		});
		await tracker.flush();

		const runtimeStatus = runtimeStatusSchema.parse(
			JSON.parse(await Bun.file(progressPaths.statusPath).text()),
		);
		const progressEvents = (
			await readJsonLines(progressPaths.progressPath)
		).map((line) => runtimeProgressEventSchema.parse(line));

		expect(runtimeStatus.status).toBe("failed");
		expect(runtimeStatus.providerLiveness).toBe("timed-out");
		expect(progressEvents.map((event) => event.event)).toEqual(
			expect.arrayContaining(["timeout", "provider-exit", "failed"]),
		);
	});

	test("records startup-failed events when a provider never produces startup output before the startup timeout", async () => {
		const tempDir = await createTempDir("runtime-progress-startup-failed");
		const artifactPath = join(
			tempDir,
			"artifacts",
			"story-03",
			"001-verify.json",
		);
		const streamPaths = buildStreamOutputPaths(artifactPath);
		const progressPaths = buildRuntimeProgressPaths(artifactPath);
		const tracker = await RuntimeProgressTracker.start({
			command: "story-verify",
			phase: "verifier-initial",
			provider: "codex",
			cwd: ROOT,
			timeoutMs: 1_000,
			configuredStartupTimeoutMs: 50,
			configuredSilenceTimeoutMs: 100,
			artifactPath,
			streamPaths,
			progressPaths,
			verifiersCompleted: 0,
			verifiersPlanned: 1,
		});

		const execution = await runProviderCommand({
			provider: "codex",
			executable: "sh",
			args: ["-lc", "sleep 2"],
			cwd: ROOT,
			timeoutMs: 1_000,
			startupTimeoutMs: 50,
			silenceTimeoutMs: 100,
			streamOutputPaths: streamPaths,
			lifecycleCallback: (event) => tracker.handleProviderLifecycle(event),
		});
		expect(execution.errorCode).toBe("PROVIDER_STARTUP_FAILED");

		await tracker.markFailed(
			"story-verify failed startup before any provider output.",
			{
				errorCode: execution.errorCode,
			},
		);
		await tracker.flush();

		const runtimeStatus = runtimeStatusSchema.parse(
			JSON.parse(await Bun.file(progressPaths.statusPath).text()),
		);
		const progressEvents = (
			await readJsonLines(progressPaths.progressPath)
		).map((line) => runtimeProgressEventSchema.parse(line));

		expect(runtimeStatus.status).toBe("failed");
		expect(runtimeStatus.providerLiveness).toBe("startup-failed");
		expect(runtimeStatus.configuredStartupTimeoutMs).toBe(50);
		expect(runtimeStatus.configuredSilenceTimeoutMs).toBe(100);
		expect(progressEvents.map((event) => event.event)).toEqual(
			expect.arrayContaining(["startup-failed", "provider-exit", "failed"]),
		);
	});

	test("rejects invalid runtime status values through the contract schema", () => {
		expect(() =>
			runtimeStatusSchema.parse({
				version: 1,
				command: "story-implement",
				status: "unknown",
				phase: "initial-implement",
				startedAt: "2026-04-22T10:12:34Z",
				updatedAt: "2026-04-22T10:12:34Z",
				lastOutputAt: null,
				providerLiveness: "starting",
				provider: "codex",
				pid: null,
				cwd: ROOT,
				timeoutMs: 1_000,
				artifactPath: "/tmp/example.json",
				streamPaths: {
					stdoutPath: "/tmp/example.stdout.log",
					stderrPath: "/tmp/example.stderr.log",
				},
				progressPaths: {
					statusPath: "/tmp/example.status.json",
					progressPath: "/tmp/example.progress.jsonl",
				},
				lastEvent: "command-started",
				lastEventSummary: "story-implement started.",
			}),
		).toThrow();
	});
});
