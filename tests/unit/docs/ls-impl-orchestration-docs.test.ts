import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ROOT } from "../../support/test-helpers";

async function readDoc(path: string): Promise<string> {
	return await readFile(join(ROOT, path), "utf8");
}

describe("ls-impl orchestration docs", () => {
	test("TC-4.1a and TC-4.1b keep the root skill generic and scope Claude Code references explicitly", async () => {
		const skillRoot = await readDoc("src/skills/ls-impl/SKILL.md");

		expect(skillRoot).toContain(
			"description: Orchestrate implementation as a live caller harness",
		);
		expect(skillRoot).not.toContain("inside Claude Code");
	});

	test("TC-4.2a and TC-4.2b define caller versus provider harness terminology and keep heartbeat examples caller-oriented", async () => {
		const [terminology, operatingModel, providerResolution] = await Promise.all(
			[
				readDoc("src/skills/ls-impl/onboarding/02-terminology.md"),
				readDoc("src/skills/ls-impl/onboarding/03-operating-model.md"),
				readDoc("src/skills/ls-impl/operations/31-provider-resolution.md"),
			],
		);

		expect(terminology).toContain("**Caller harness**");
		expect(terminology).toContain("**Provider harness**");
		expect(terminology).toContain("`story_lead_provider`");
		expect(terminology).toContain("The removed `story_lead` alias is rejected");
		expect(terminology).not.toContain("story_lead still parses");
		expect(terminology).not.toContain("deprecated compatibility alias");
		expect(operatingModel).toContain(
			"Those heartbeat reminders are written for the caller harness watching the command",
		);
		expect(providerResolution).toContain("`story_lead_provider`");
	});

	test("TC-4.3a and TC-4.3b document Codex heartbeat polling and scope Claude Code Monitor guidance", async () => {
		const [operatingModel, storyCycle, cliOperations] = await Promise.all([
			readDoc("src/skills/ls-impl/onboarding/03-operating-model.md"),
			readDoc("src/skills/ls-impl/phases/20-story-cycle.md"),
			readDoc("src/skills/ls-impl/operations/30-cli-operations.md"),
		]);

		expect(operatingModel).toContain("keep the original exec session open");
		expect(operatingModel).toContain("poll it again with empty input");
		expect(storyCycle).toContain("do not assume that Monitor exists in Codex");
		expect(cliOperations).toContain(
			"In Claude Code, use Monitor when available",
		);
	});

	test("TC-4.4a and TC-4.4b describe the story-lead and impl-lead authority boundary", async () => {
		const [operatingModel, storyCycle, playbook] = await Promise.all([
			readDoc("src/skills/ls-impl/onboarding/03-operating-model.md"),
			readDoc("src/skills/ls-impl/phases/20-story-cycle.md"),
			readDoc("src/skills/ls-impl/references/ls-impl-process-playbook.md"),
		]);

		expect(operatingModel).toContain(
			"Story-lead owns the internal loop for that story and returns one final package",
		);
		expect(operatingModel).toContain("Impl-lead stays outside that loop");
		expect(storyCycle).toContain(
			"impl-lead still reviews that package, finishes the receipt, makes the story commit",
		);
		expect(playbook).toContain(
			"Impl-lead still decides whether to accept, reject, reopen, or request a ruling",
		);
	});

	test("TC-4.5a, TC-4.7a, and TC-4.7b document story-id recovery and smallest-step replay guidance", async () => {
		const [recovery, playbook] = await Promise.all([
			readDoc("src/skills/ls-impl/phases/22-recovery-and-resume.md"),
			readDoc("src/skills/ls-impl/references/ls-impl-process-playbook.md"),
		]);

		expect(recovery).toContain("spec-pack-root + story-id");
		expect(recovery).toContain(
			"Trust valid persisted artifacts and replay only the smallest missing bounded step.",
		);
		expect(recovery).toContain(
			"prefer fresh rehydration from disk over repeatedly resuming an overgrown provider session",
		);
		expect(playbook).toContain("resume only the smallest missing bounded step");
	});

	test("TC-4.6a, TC-4.6b, and TC-4.6c preserve log handoff, commit acceptance, and epic-fix closeout obligations", async () => {
		const [storyCycle, cleanup] = await Promise.all([
			readDoc("src/skills/ls-impl/phases/20-story-cycle.md"),
			readDoc("src/skills/ls-impl/phases/23-cleanup-and-closeout.md"),
		]);

		expect(storyCycle).toContain("`logHandoff`");
		expect(storyCycle).toContain("The commit is part of acceptance");
		expect(storyCycle).toContain(
			"keep them explicit in the story receipt so impl-lead can decide later whether they belong in epic closeout discussion, backlog, or a future story",
		);
		expect(cleanup).toContain("Compile the fix batch from the specific current epic-review findings");
	});

	test("documents the validate-before-run checkpoint for each story", async () => {
		const [skillRoot, stageMap, initialization, setup, storyCycle, playbook] =
			await Promise.all([
				readDoc("src/skills/ls-impl/SKILL.md"),
				readDoc("src/skills/ls-impl/onboarding/04-stage-map.md"),
				readDoc("src/skills/ls-impl/onboarding/05-initialization-overview.md"),
				readDoc("src/skills/ls-impl/setup/12-run-setup.md"),
				readDoc("src/skills/ls-impl/phases/20-story-cycle.md"),
				readDoc("src/skills/ls-impl/references/ls-impl-process-playbook.md"),
			]);

		expect(skillRoot).toContain(
			"should start with `story-orchestrate validate`",
		);
		expect(stageMap).toContain("run `story-orchestrate validate`");
		expect(initialization).toContain(
			"should first pass `story-orchestrate validate`",
		);
		expect(setup).toContain(
			"each story now starts with `story-orchestrate validate`",
		);
		expect(storyCycle).toContain("First run `story-orchestrate validate`");
		expect(playbook).toContain(
			"Before starting a story, run `story-orchestrate validate`",
		);
	});
});
