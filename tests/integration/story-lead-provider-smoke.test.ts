import { describe, expect, test } from "vitest";

import {
	storyOrchestrateRun,
	storyOrchestrateStatus,
} from "../../src/sdk/operations/story-orchestrate";
import {
	createRunConfig,
	createSpecPack,
	readJsonLines,
	writeRunConfig,
} from "../support/test-helpers";
import { seedPrimitiveArtifact } from "../support/story-orchestrate-fixtures";
import {
	assertExecutableOnPath,
	assertIntegrationPrerequisites,
	assertProviderAuthAvailable,
} from "./helpers";

assertIntegrationPrerequisites();
const providers = ["claude-code", "codex"] as const;

async function createStoryLeadSmokeFixture(
	provider: (typeof providers)[number],
): Promise<{ specPackRoot: string; storyId: string }> {
	const specPackRoot = await createSpecPack(
		`story-lead-provider-smoke-${provider}`,
		{
			companionMode: "four-file",
		},
	);
	const storyId = "00-foundation";

	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			story_lead_provider: {
				secondary_harness: provider === "claude-code" ? "none" : provider,
				model: provider === "claude-code" ? "sonnet" : "gpt-5.4",
				reasoning_effort: "low",
			},
			caller_harness: {
				harness: "codex",
				story_heartbeat_cadence_minutes: 10,
			},
			verification_gates: {
				story: "true",
				epic: "true",
			},
		}),
	);

	await seedPrimitiveArtifact({
		specPackRoot,
		storyId,
		fileName: "001-implementor.json",
		payload: {
			command: "story-implement",
			outcome: "ready-for-verification",
		},
	});
	await seedPrimitiveArtifact({
		specPackRoot,
		storyId,
		fileName: "002-verifier.json",
		payload: {
			command: "story-verify",
			outcome: "pass",
		},
	});

	return { specPackRoot, storyId };
}

describe("story-lead provider smoke coverage", () => {
	for (const provider of providers) {
		test(`TC-2.9a/TC-5.4b/TC-5.4c: ${provider} story-lead selection reaches a terminal outcome and records durable session artifacts without auth skip behavior`, async () => {
			await assertExecutableOnPath(provider);
			const fixture = await createStoryLeadSmokeFixture(provider);
			const envelope = await storyOrchestrateRun({
				specPackRoot: fixture.specPackRoot,
				storyId: fixture.storyId,
			});

			assertProviderAuthAvailable(provider, envelope);

			expect(envelope.command).toBe("story-orchestrate run");
			expect(["completed", "interrupted"]).toContain(envelope.result?.case);

			if (envelope.result?.case !== "completed") {
				if (envelope.result?.case !== "interrupted") {
					throw new Error(
						`Expected a terminal story-lead smoke result for ${provider}, received ${envelope.result?.case ?? envelope.status}.`,
					);
				}
			}

			const status = await storyOrchestrateStatus({
				specPackRoot: fixture.specPackRoot,
				storyId: fixture.storyId,
				storyRunId: envelope.result.storyRunId,
			});
			const events = await readJsonLines<
				Array<{ type: string; data?: Record<string, unknown> }>[number]
			>(envelope.result.eventHistoryPath);

			expect(status.result).toEqual(
				expect.objectContaining({
					case: "single-attempt",
					storyRunId: envelope.result.storyRunId,
				}),
			);
			expect(
				events.some((event) =>
					/story-lead-provider-(started|resumed|failed)/.test(event.type),
				),
			).toBe(true);
			expect(envelope.result.finalPackagePath).toEqual(expect.any(String));
			expect(await Bun.file(envelope.result.finalPackagePath).exists()).toBe(
				true,
			);
		}, 240_000);
	}
});
