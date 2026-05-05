import { join } from "node:path";
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
	writeTextFile,
} from "../support/test-helpers";
import { assertExecutableOnPath, assertProviderAuthAvailable } from "./helpers";

async function createStoryLeadSmokeFixture(): Promise<{
	specPackRoot: string;
	storyId: string;
}> {
	const specPackRoot = await createSpecPack("story-lead-provider-smoke-codex", {
		companionMode: "four-file",
	});
	const storyId = "00-foundation";
	const storyPath = join(specPackRoot, "stories", `${storyId}.md`);
	const fixtureFileName = "integration-fixture.txt";
	const fixtureFilePath = join(specPackRoot, fixtureFileName);
	const fixtureFileContents = "story-orchestrate smoke ready\n";
	const gateCommand = [
		"node",
		"-e",
		JSON.stringify(
			[
				"const fs = require('node:fs');",
				`const target = ${JSON.stringify(fixtureFilePath)};`,
				`const expected = ${JSON.stringify(fixtureFileContents)};`,
				"const ok = fs.existsSync(target) && fs.readFileSync(target, 'utf8') === expected;",
				"process.exit(ok ? 0 : 1);",
			].join(" "),
		),
	].join(" ");

	await writeTextFile(
		join(specPackRoot, "package.json"),
		`${JSON.stringify(
			{
				name: "story-lead-provider-smoke-codex",
				private: true,
				scripts: {
					"green-verify": gateCommand,
					"verify-all": gateCommand,
				},
			},
			null,
			2,
		)}\n`,
	);

	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			story_lead_provider: {
				secondary_harness: "codex",
				model: "gpt-5.5",
				reasoning_effort: "low",
			},
			story_implementor: {
				secondary_harness: "codex",
				model: "gpt-5.4",
				reasoning_effort: "low",
			},
			story_verifier: {
				secondary_harness: "codex",
				model: "gpt-5.4",
				reasoning_effort: "low",
			},
			self_review: {
				passes: 1,
			},
			caller_harness: {
				harness: "codex",
				story_heartbeat_cadence_minutes: 10,
			},
			verification_gates: {
				story: gateCommand,
				epic: gateCommand,
			},
			timeouts: {
				provider_startup_timeout_ms: 60_000,
				story_lead_planner_ms: 120_000,
				story_orchestrate_ms: 420_000,
				story_implementor_ms: 180_000,
				story_implementor_silence_timeout_ms: 120_000,
				story_verifier_ms: 180_000,
				story_verifier_silence_timeout_ms: 120_000,
			},
		}),
	);

	await writeTextFile(
		storyPath,
		[
			"# Story 0: Foundation",
			"",
			"## Acceptance Criteria",
			`- AC-1: Create \`${fixtureFilePath}\` with exact contents \`${fixtureFileContents.trim()}\`.`,
			"- AC-2: The tiny story happy path must include an independent verifier pass before acceptance.",
			`- AC-3: The story is only acceptance-ready when both configured gate commands pass against \`${fixtureFilePath}\`.`,
			"- AC-4: For this smoke fixture, the bounded implementor result must record a stable baseline summary with `totalAfterStory: 1` and `deltaFromPriorBaseline: 0` so the built-in acceptance baseline check is not left unknown.",
			"",
			"## Test Conditions",
			"- TC-1: `story-orchestrate run` must select and execute `run-implement` using the real Codex provider.",
			"- TC-2: After implementation, story-lead must run an independent verifier pass before acceptance.",
			"",
		].join("\n"),
	);
	await writeTextFile(
		join(specPackRoot, "test-plan.md"),
		[
			"# Test Plan",
			"",
			"- Acceptance is not valid on implementor self-report alone; an explicit verifier artifact with pass outcome is required.",
			`- The canonical proof file is \`${fixtureFilePath}\` with exact contents \`${fixtureFileContents.trim()}\`.`,
			`- The configured story gate and epic gate are both \`${gateCommand}\` and should pass only when that file exists with the exact required contents.`,
			"- For this synthetic smoke story, baseline accounting is fixed and deterministic: `totalAfterStory` must be `1` and `deltaFromPriorBaseline` must be `0`.",
			"- TC-1 maps to durable `story-lead-action-selected` with `run-implement` and a completed `story-implement` artifact.",
			"- TC-2 maps to a later `story-lead-action-selected` with `run-verify` and a completed `story-verify` artifact before any acceptance recommendation.",
			"",
		].join("\n"),
	);
	await writeTextFile(
		join(specPackRoot, "custom-story-impl-prompt-insert.md"),
		[
			"## Trusted Integration Fixture Direction",
			"This is a real-provider integration smoke for `story-orchestrate` with one tiny programming task.",
			`Create \`${fixtureFilePath}\` with exact contents \`${fixtureFileContents.trim()}\` and do not make any other file changes.`,
			`Run the configured story and epic gate commands after writing that exact absolute-path file. Return a valid StoryImplementorProviderPayload with changedFiles containing only \`${fixtureFileName}\`, gatesRun showing the configured commands and \`pass\`, outcome \`ready-for-verification\`, and tests reporting \`totalAfterStory: 1\` and \`deltaFromPriorBaseline: 0\`.`,
			"Do not claim the story accepted; the verifier must independently confirm it.",
			"",
		].join("\n"),
	);
	await writeTextFile(
		join(specPackRoot, "custom-story-verifier-prompt-insert.md"),
		[
			"## Trusted Integration Fixture Direction",
			"This is a real-provider integration smoke for `story-orchestrate` with a tiny acceptance path.",
			`Verify that \`${fixtureFilePath}\` exists with exact contents \`${fixtureFileContents.trim()}\`.`,
			"Acceptance is invalid unless this verifier pass runs and returns outcome `pass`.",
			`Run the configured story and epic gate commands yourself and return a valid verifier payload with outcome \`pass\` only if both gates pass and the file contents at \`${fixtureFilePath}\` match exactly.`,
			"If there is no real production-path concern, return `productionPathFindings: []` exactly. Do not place reassuring prose in that array.",
			"",
		].join("\n"),
	);

	return { specPackRoot, storyId };
}

describe("story-lead provider smoke coverage", () => {
	test("TC-2.9a/TC-5.4b/TC-5.4c: Codex story-orchestrate completes a tiny real story happy path with implement, verify, and acceptance-ready terminal result", async () => {
		await assertExecutableOnPath("codex");
		const fixture = await createStoryLeadSmokeFixture();
		const envelope = await storyOrchestrateRun({
			specPackRoot: fixture.specPackRoot,
			storyId: fixture.storyId,
		});

		assertProviderAuthAvailable("codex", envelope);

		expect(envelope.command).toBe("story-orchestrate run");
		expect(envelope.result?.case).toBe("completed");

		if (envelope.result?.case !== "completed") {
			throw new Error(
				`Expected completed story-orchestrate smoke result, received ${envelope.result?.case ?? envelope.status}.`,
			);
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
			events.some(
				(event) =>
					event.type === "story-lead-action-selected" &&
					event.data?.actionType === "run-implement",
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.type === "child-operation-completed" &&
					event.data?.command === "story-implement",
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.type === "story-lead-action-selected" &&
					event.data?.actionType === "run-verify",
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.type === "child-operation-completed" &&
					event.data?.command === "story-verify",
			),
		).toBe(true);
		expect(envelope.result.outcome).toBe("accepted");
		expect(
			events.some((event) => event.type === "story-lead-provider-failed"),
		).toBe(false);
		expect(envelope.result.finalPackagePath).toEqual(expect.any(String));
		expect(await Bun.file(envelope.result.finalPackagePath).exists()).toBe(
			true,
		);
	}, 420_000);
});
