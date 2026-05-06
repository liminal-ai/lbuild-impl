import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { epicReview, storyVerify } from "../../src/sdk/operations";
import {
	createRunConfig,
	createSpecPack,
	createVerifierSpecPack,
	writeRunConfig,
	writeTextFile,
} from "../support/test-helpers";
import {
	assertExecutableOnPath,
	assertProviderAuthAvailable,
	assertPersistedEnvelope,
	envelopeFailureSummary,
} from "./helpers";

async function createClaudeStoryVerifySpecPack(scope: string) {
	const fixture = await createVerifierSpecPack(scope, {
		storyBody: [
			"# Story 4: Story Verification Workflow",
			"",
			"## Synthetic Verification Fixture",
			"This story is intentionally complete for a provider integration smoke.",
			"All requirements are satisfied if the verifier can read this pack and return one valid verifier payload with no findings.",
			"",
		].join("\n"),
	});

	await writeRunConfig(
		fixture.specPackRoot,
		createRunConfig({
			story_verifier: {
				secondary_harness: "none",
				model: "sonnet",
				reasoning_effort: "low",
			},
			verification_gates: {
				story: "true",
				epic: "true",
			},
		}),
	);

	await writeTextFile(
		join(fixture.specPackRoot, "custom-story-verifier-prompt-insert.md"),
		[
			"## Synthetic Verifier Fixture",
			"This is a tiny real-provider integration smoke for the Claude Code verifier lane.",
			"Treat the story, tech design, and test plan as complete and internally consistent.",
			'Return a valid verifier payload with no findings, `recommendedNextStep: "pass"`, and `recommendedFixScope: "same-session-implementor"`.',
			"Use `artifactsRead` from the files you actually read and mark requirement coverage as verified.",
			"",
		].join("\n"),
	);

	return fixture;
}

async function createClaudeEpicReviewSpecPack(scope: string) {
	const specPackRoot = await createSpecPack(scope, {
		companionMode: "four-file",
	});
	await writeTextFile(
		join(specPackRoot, "stories", "00-foundation.md"),
		[
			"# Story 0: Foundation",
			"",
			"This synthetic epic fixture is intentionally complete and consistent.",
			"",
		].join("\n"),
	);
	await writeTextFile(
		join(specPackRoot, "epic.md"),
		[
			"# Epic",
			"",
			"This is a tiny real-provider integration smoke for the Claude Code epic reviewer lane.",
			"All required behavior in this fixture is satisfied by the files present in the spec pack.",
			"There are no intended blockers or open issues in this fixture.",
			"",
		].join("\n"),
	);
	await writeTextFile(
		join(specPackRoot, "tech-design.md"),
		[
			"# Technical Design",
			"",
			"The implementation surface is intentionally minimal and coherent.",
			"No production-path shims, placeholders, or fake adapters exist in this fixture.",
			"",
		].join("\n"),
	);
	await writeTextFile(
		join(specPackRoot, "test-plan.md"),
		[
			"# Test Plan",
			"",
			"Treat this synthetic fixture as complete if the verifier can read the pack and return a valid payload.",
			"",
		].join("\n"),
	);
	await writeTextFile(
		join(specPackRoot, "package.json"),
		`${JSON.stringify(
			{
				name: "fixture-spec-pack",
				private: true,
				scripts: {
					"green-verify": "true",
					"verify-all": "true",
				},
			},
			null,
			2,
		)}\n`,
	);
	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			epic_verifiers: [
				{
					label: "epic-verifier-1",
					secondary_harness: "none",
					model: "sonnet",
					reasoning_effort: "low",
				},
			],
			verification_gates: {
				story: "true",
				epic: "true",
			},
		}),
	);

	return specPackRoot;
}

describe("real-provider Claude Code workflow coverage", () => {
	test("story-verify initial mode completes through Claude Code without provider fallbacks", async () => {
		await assertExecutableOnPath("claude-code");
		const fixture = await createClaudeStoryVerifySpecPack(
			"integration-claude-story-verify",
		);
		const artifactPath = join(
			fixture.specPackRoot,
			"artifacts",
			fixture.storyId,
			"001-verify.json",
		);
		const stdoutPath = join(
			fixture.specPackRoot,
			"artifacts",
			fixture.storyId,
			"streams",
			"001-verify.stdout.log",
		);
		const stderrPath = join(
			fixture.specPackRoot,
			"artifacts",
			fixture.storyId,
			"streams",
			"001-verify.stderr.log",
		);

		const envelope = await storyVerify({
			specPackRoot: fixture.specPackRoot,
			storyId: fixture.storyId,
			artifactPath,
			streamOutputPaths: {
				stdoutPath,
				stderrPath,
			},
		});

		assertProviderAuthAvailable("claude-code", envelope);
		expect(envelope.command).toBe("story-verify");
		expect(envelope.status, envelopeFailureSummary(envelope)).toBe("ok");
		expect(["pass", "revise", "needs-human-ruling"]).toContain(
			envelope.outcome,
		);
		expect(envelope.result?.provider).toBe("claude-code");
		expect(envelope.result?.mode).toBe("initial");
		expect(envelope.result?.sessionId).toEqual(expect.any(String));
		expect(envelope.result?.continuation.provider).toBe("claude-code");
		const persisted = await assertPersistedEnvelope<typeof envelope>(envelope);
		expect(persisted.result?.provider).toBe("claude-code");

		const stdoutLog = await Bun.file(stdoutPath).text();
		expect(stdoutLog).toContain('"type":"stream_event"');
		expect(stdoutLog).toContain('"type":"result"');
	}, 120_000);

	test("epic-review completes a Claude Code verifier lane without provider failure", async () => {
		await assertExecutableOnPath("claude-code");
		const specPackRoot = await createClaudeEpicReviewSpecPack(
			"integration-claude-epic-review",
		);
		const artifactPath = join(
			specPackRoot,
			"artifacts",
			"epic",
			"001-epic-review.json",
		);
		const stdoutPath = join(
			specPackRoot,
			"artifacts",
			"epic",
			"streams",
			"001-epic-review.stdout.log",
		);
		const stderrPath = join(
			specPackRoot,
			"artifacts",
			"epic",
			"streams",
			"001-epic-review.stderr.log",
		);

		const envelope = await epicReview({
			specPackRoot,
			artifactPath,
			streamOutputPaths: {
				stdoutPath,
				stderrPath,
			},
		});

		assertProviderAuthAvailable("claude-code", envelope);
		expect(envelope.command).toBe("epic-review");
		expect(envelope.status, envelopeFailureSummary(envelope)).toBe("ok");
		expect(envelope.result?.verifierResults).toHaveLength(1);
		expect(envelope.result?.verifierResults[0]?.provider).toBe("claude-code");
		expect(["pass", "revise", "block"]).toContain(
			envelope.result?.verifierResults[0]?.outcome,
		);
		const persisted = await assertPersistedEnvelope<typeof envelope>(envelope);
		expect(persisted.result?.verifierResults[0]?.provider).toBe("claude-code");

		const stdoutLog = await Bun.file(stdoutPath).text();
		expect(stdoutLog).toContain('"type":"stream_event"');
		expect(stdoutLog).toContain('"type":"result"');
	}, 180_000);
});
