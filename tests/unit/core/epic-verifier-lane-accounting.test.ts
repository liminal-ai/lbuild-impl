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

describe("epic reviewer lane accounting", () => {
	test("TC-4.8a reports lane-specific status for quiet, completed, and active verifier lanes", async () => {
		const artifactPath = join(
			await createTempDir("epic-reviewer-lane-status"),
			"artifacts",
			"epic",
			"001-epic-reviewer-batch.json",
		);
		const tracker = await RuntimeProgressTracker.start({
			command: "epic-review",
			phase: "epic-reviewer-1",
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
					label: "epic-reviewer-1",
					provider: "codex",
				},
				{
					label: "epic-reviewer-2",
					provider: "claude-code",
				},
				{
					label: "epic-reviewer-3",
					provider: "codex",
				},
			],
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-reviewer-1",
			provider: "codex",
			phase: "epic-reviewer-1",
			summary: "epic-reviewer-1 started.",
		});
		tracker.handleVerifierLaneLifecycle("epic-reviewer-1", {
			type: "provider-spawned",
			pid: 101,
			timestamp: "2026-05-03T12:00:00.000Z",
		});
		tracker.handleVerifierLaneLifecycle("epic-reviewer-1", {
			type: "active-silent",
			silenceMs: 40,
			configuredSilenceTimeoutMs: 200,
			configuredStartupTimeoutMs: 50,
			timestamp: "2026-05-03T12:00:00.040Z",
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-reviewer-2",
			provider: "claude-code",
			phase: "epic-reviewer-2",
			summary: "epic-reviewer-2 started.",
		});
		await tracker.recordVerifierLaneCompleted({
			label: "epic-reviewer-2",
			provider: "claude-code",
			phase: "epic-reviewer-2",
			summary: "epic-reviewer-2 completed.",
			verifiersCompleted: 1,
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-reviewer-3",
			provider: "codex",
			phase: "epic-reviewer-3",
			summary: "epic-reviewer-3 started.",
		});
		tracker.handleVerifierLaneLifecycle("epic-reviewer-3", {
			type: "provider-spawned",
			pid: 303,
			timestamp: "2026-05-03T12:00:00.000Z",
		});
		tracker.handleVerifierLaneLifecycle("epic-reviewer-3", {
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
					label: "epic-reviewer-1",
					state: "running",
					providerLiveness: "active-silent",
				}),
				expect.objectContaining({
					label: "epic-reviewer-2",
					state: "completed",
					providerLiveness: "completed",
				}),
				expect.objectContaining({
					label: "epic-reviewer-3",
					state: "running",
					providerLiveness: "active-with-output",
				}),
			]),
		);
	});

	test("TC-4.8b keeps the batch non-terminal while at least one verifier lane is still active", async () => {
		const artifactPath = join(
			await createTempDir("epic-reviewer-lane-mixed"),
			"artifacts",
			"epic",
			"001-epic-reviewer-batch.json",
		);
		const tracker = await RuntimeProgressTracker.start({
			command: "epic-review",
			phase: "epic-reviewer-1",
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
					label: "epic-reviewer-1",
					provider: "codex",
				},
				{
					label: "epic-reviewer-2",
					provider: "claude-code",
				},
			],
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-reviewer-1",
			provider: "codex",
			phase: "epic-reviewer-1",
			summary: "epic-reviewer-1 started.",
		});
		tracker.handleVerifierLaneLifecycle("epic-reviewer-1", {
			type: "timeout",
			elapsedMs: 120,
			configuredTimeoutMs: 100,
			timestamp: "2026-05-03T12:00:00.120Z",
		});

		await tracker.recordVerifierLaneStarted({
			label: "epic-reviewer-2",
			provider: "claude-code",
			phase: "epic-reviewer-2",
			summary: "epic-reviewer-2 started.",
		});
		tracker.handleVerifierLaneLifecycle("epic-reviewer-2", {
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
					label: "epic-reviewer-1",
					state: "failed",
					providerLiveness: "timed-out",
				}),
				expect.objectContaining({
					label: "epic-reviewer-2",
					state: "running",
					providerLiveness: "active-with-output",
				}),
			]),
		);

		await tracker.markFailed(
			"epic-review failed after terminal lane aggregation.",
		);
		await tracker.flush();

		expect(runtimeStatusSchema.parse(tracker.getSnapshot()).status).toBe(
			"failed",
		);
	});
});
