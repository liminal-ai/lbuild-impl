import { describe, expect, test } from "vitest";

import { storyOrchestrateValidate } from "../../../src/sdk/operations/story-orchestrate";
import {
	createStoryOrchestrateSpecPack,
	seedStoryRunAttempt,
} from "../../support/story-orchestrate-fixtures";

describe("story-orchestrate validate sdk operation", () => {
	test("returns ready validation with a captured baseline seed when the story is startable", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-validate-ready",
			{
				includeStoryLead: true,
			},
		);

		const envelope = await storyOrchestrateValidate({
			specPackRoot,
			storyId,
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
		expect(envelope.artifacts[0]?.path).toContain(
			"/artifacts/00-foundation/",
		);
	});

	test("blocks validation when a resumable attempt already exists", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-sdk-validate-resume-required",
			{
				includeStoryLead: true,
			},
		);
		const attempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "blocked",
		});

		const envelope = await storyOrchestrateValidate({
			specPackRoot,
			storyId,
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
