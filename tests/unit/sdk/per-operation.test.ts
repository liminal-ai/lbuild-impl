import { describe, expect, test } from "vitest";

import {
	epicCleanup,
	epicSynthesize,
	epicVerify,
	inspect,
	preflight,
	quickFix,
	storyContinue,
	storyImplement,
	storyOrchestrateValidate,
	storySelfReview,
	storyVerify,
} from "../../../src/sdk/index";
import { createSpecPack } from "../../support/test-helpers";

describe("sdk per-operation envelopes", () => {
	test("inspect returns a persisted envelope", async () => {
		const specPackRoot = await createSpecPack("sdk-op-inspect");
		const envelope = await inspect({
			specPackRoot,
		});

		expect(envelope.command).toBe("inspect");
		expect(envelope.status).toBe("ok");
		expect(envelope.artifacts[0]?.path).toContain("/artifacts/inspect/");
		expect(await Bun.file(envelope.artifacts[0]?.path ?? "").exists()).toBe(
			true,
		);
	});

	test("preflight returns a structured envelope on invalid run-config", async () => {
		const specPackRoot = await createSpecPack("sdk-op-preflight");
		const envelope = await preflight({
			specPackRoot,
		});

		expect(envelope.command).toBe("preflight");
		expect(envelope.status).toBe("blocked");
		expect(envelope.errors[0]?.code).toBe("INVALID_RUN_CONFIG");
	});

	test("epic-synthesize returns a structured envelope on invalid run-config", async () => {
		const specPackRoot = await createSpecPack("sdk-op-epic-synthesize");
		const envelope = await epicSynthesize({
			specPackRoot,
			verifierReportPaths: ["missing-report.json"],
		});

		expect(envelope.command).toBe("epic-synthesize");
		expect(envelope.status).toBe("blocked");
	});

	test("epic-verify returns a structured envelope on invalid run-config", async () => {
		const specPackRoot = await createSpecPack("sdk-op-epic-verify");
		const envelope = await epicVerify({
			specPackRoot,
		});

		expect(envelope.command).toBe("epic-verify");
		expect(envelope.status).toBe("blocked");
	});

	test("epic-cleanup returns a structured envelope on invalid run-config", async () => {
		const specPackRoot = await createSpecPack("sdk-op-epic-cleanup");
		const envelope = await epicCleanup({
			specPackRoot,
			cleanupBatchPath: `${specPackRoot}/cleanup-batch.md`,
		});

		expect(envelope.command).toBe("epic-cleanup");
		expect(envelope.status).toBe("blocked");
	});

	test("quick-fix returns a structured envelope on invalid run-config", async () => {
		const specPackRoot = await createSpecPack("sdk-op-quick-fix");
		const envelope = await quickFix({
			specPackRoot,
			request: "Apply a small fix",
		});

		expect(envelope.command).toBe("quick-fix");
		expect(envelope.status).toBe("blocked");
	});

	test("story-implement returns a structured envelope on invalid run-config", async () => {
		const specPackRoot = await createSpecPack("sdk-op-story-implement");
		const envelope = await storyImplement({
			specPackRoot,
			storyId: "00-foundation",
		});

		expect(envelope.command).toBe("story-implement");
		expect(envelope.status).toBe("blocked");
	});

	test("story-continue returns a structured envelope on invalid continuation", async () => {
		const specPackRoot = await createSpecPack("sdk-op-story-continue");
		const envelope = await storyContinue({
			specPackRoot,
			storyId: "00-foundation",
			continuationHandle: {
				provider: "claude-code",
				sessionId: "missing-session",
				storyId: "00-foundation",
			},
			followupRequest: "Continue",
		});

		expect(envelope.command).toBe("story-continue");
		expect(envelope.status).toBe("blocked");
		expect(envelope.errors[0]?.code).toBeTruthy();
	});

	test("story-self-review returns a structured envelope on invalid continuation", async () => {
		const specPackRoot = await createSpecPack("sdk-op-story-self-review");
		const envelope = await storySelfReview({
			specPackRoot,
			storyId: "00-foundation",
			continuationHandle: {
				provider: "claude-code",
				sessionId: "missing-session",
				storyId: "00-foundation",
			},
			passes: 1,
			passArtifactPaths: [],
		});

		expect(envelope.command).toBe("story-self-review");
		expect(envelope.status).toBe("blocked");
		expect(envelope.errors[0]?.code).toBeTruthy();
	});

	test("story-verify returns a structured envelope on invalid run-config", async () => {
		const specPackRoot = await createSpecPack("sdk-op-story-verify");
		const envelope = await storyVerify({
			specPackRoot,
			storyId: "00-foundation",
		});

		expect(envelope.command).toBe("story-verify");
		expect(envelope.status).toBe("blocked");
	});

	test("story-orchestrate validate returns a structured envelope on invalid run-config", async () => {
		const specPackRoot = await createSpecPack("sdk-op-story-orchestrate-validate");
		const envelope = await storyOrchestrateValidate({
			specPackRoot,
			storyId: "00-foundation",
		});

		expect(envelope.command).toBe("story-orchestrate validate");
		expect(envelope.status).toBe("blocked");
	});
});
