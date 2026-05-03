import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
	buildRuntimeProgressPaths,
	buildStreamOutputPaths,
} from "../../../src/core/artifact-writer.js";
import {
	RuntimeProgressTracker,
	runtimeStatusSchema,
} from "../../../src/core/runtime-progress.js";
import { createTempDir, ROOT } from "../../support/test-helpers.js";

describe("epic verifier lane accounting", () => {
	test("TC-4.8a reports lane-specific status for quiet, completed, and active verifier lanes", async () => {
		const artifactPath = join(
			await createTempDir("epic-verifier-lane-status"),
			"artifacts",
			"epic",
			"001-epic-verifier-batch.json",
		);
		const tracker = await RuntimeProgressTracker.start({
			command: "epic-verify",
			phase: "epic-verifier-1",
			provider: "codex",
			cwd: ROOT,
			timeoutMs: 1_000,
			artifactPath,
			streamPaths: buildStreamOutputPaths(artifactPath),
			progressPaths: buildRuntimeProgressPaths(artifactPath),
			verifiersCompleted: 0,
			verifiersPlanned: 3,
			verifierLanes: [
				{
					label: "epic-verifier-1",
					provider: "codex",
				},
				{
					label: "epic-verifier-2",
					provider: "claude-code",
				},
				{
					label: "epic-verifier-3",
					provider: "copilot",
				},
			],
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-verifier-1",
			provider: "codex",
			phase: "epic-verifier-1",
			summary: "epic-verifier-1 started.",
		});
		tracker.handleVerifierLaneLifecycle("epic-verifier-1", {
			type: "provider-spawned",
			pid: 101,
			timestamp: "2026-05-03T12:00:00.000Z",
		});
		tracker.handleVerifierLaneLifecycle("epic-verifier-1", {
			type: "active-silent",
			silenceMs: 40,
			configuredSilenceTimeoutMs: 200,
			configuredStartupTimeoutMs: 50,
			timestamp: "2026-05-03T12:00:00.040Z",
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-verifier-2",
			provider: "claude-code",
			phase: "epic-verifier-2",
			summary: "epic-verifier-2 started.",
		});
		await tracker.recordVerifierLaneCompleted({
			label: "epic-verifier-2",
			provider: "claude-code",
			phase: "epic-verifier-2",
			summary: "epic-verifier-2 completed.",
			verifiersCompleted: 1,
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-verifier-3",
			provider: "copilot",
			phase: "epic-verifier-3",
			summary: "epic-verifier-3 started.",
		});
		tracker.handleVerifierLaneLifecycle("epic-verifier-3", {
			type: "provider-spawned",
			pid: 303,
			timestamp: "2026-05-03T12:00:00.000Z",
		});
		tracker.handleVerifierLaneLifecycle("epic-verifier-3", {
			type: "output",
			stream: "stderr",
			timestamp: "2026-05-03T12:00:00.080Z",
		});

		await tracker.flush();

		const runtimeStatus = runtimeStatusSchema.parse(tracker.getSnapshot());
		expect(runtimeStatus.status).toBe("running");
		expect(runtimeStatus.verifierLanes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: "epic-verifier-1",
					state: "running",
					providerLiveness: "active-silent",
				}),
				expect.objectContaining({
					label: "epic-verifier-2",
					state: "completed",
					providerLiveness: "completed",
				}),
				expect.objectContaining({
					label: "epic-verifier-3",
					state: "running",
					providerLiveness: "active-with-output",
				}),
			]),
		);
	});

	test("TC-4.8b keeps the batch non-terminal while at least one verifier lane is still active", async () => {
		const artifactPath = join(
			await createTempDir("epic-verifier-lane-mixed"),
			"artifacts",
			"epic",
			"001-epic-verifier-batch.json",
		);
		const tracker = await RuntimeProgressTracker.start({
			command: "epic-verify",
			phase: "epic-verifier-1",
			provider: "codex",
			cwd: ROOT,
			timeoutMs: 1_000,
			artifactPath,
			streamPaths: buildStreamOutputPaths(artifactPath),
			progressPaths: buildRuntimeProgressPaths(artifactPath),
			verifiersCompleted: 0,
			verifiersPlanned: 2,
			verifierLanes: [
				{
					label: "epic-verifier-1",
					provider: "codex",
				},
				{
					label: "epic-verifier-2",
					provider: "claude-code",
				},
			],
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-verifier-1",
			provider: "codex",
			phase: "epic-verifier-1",
			summary: "epic-verifier-1 started.",
		});
		tracker.handleVerifierLaneLifecycle("epic-verifier-1", {
			type: "timeout",
			elapsedMs: 120,
			configuredTimeoutMs: 100,
			timestamp: "2026-05-03T12:00:00.120Z",
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-verifier-2",
			provider: "claude-code",
			phase: "epic-verifier-2",
			summary: "epic-verifier-2 started.",
		});
		tracker.handleVerifierLaneLifecycle("epic-verifier-2", {
			type: "output",
			stream: "stdout",
			timestamp: "2026-05-03T12:00:00.090Z",
		});

		await tracker.flush();

		const runningSnapshot = runtimeStatusSchema.parse(tracker.getSnapshot());
		expect(runningSnapshot.status).toBe("running");
		expect(runningSnapshot.verifierLanes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: "epic-verifier-1",
					state: "failed",
					providerLiveness: "timed-out",
				}),
				expect.objectContaining({
					label: "epic-verifier-2",
					state: "running",
					providerLiveness: "active-with-output",
				}),
			]),
		);

		await tracker.markFailed(
			"epic-verify failed after terminal lane aggregation.",
		);
		await tracker.flush();

		expect(runtimeStatusSchema.parse(tracker.getSnapshot()).status).toBe(
			"failed",
		);
	});
});
