import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import { GORILLA_PROMPT_PATH } from "./helpers";

const CLI_OPERATIONS = [
	"inspect",
	"preflight",
	"epic-reverify",
	"epic-review",
	"epic-fix",
	"quick-fix",
	"story-implement",
	"story-continue",
	"story-self-review",
	"story-verify",
] as const;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCliInvocations(prompt: string): string[] {
	return [...prompt.matchAll(/`([^`]*\$CLI\s+[^`]+)`/g)].map(
		(match) => match[1] ?? "",
	);
}

test("TC-5.6a: prompt covers every operation", async () => {
	const prompt = await readFile(GORILLA_PROMPT_PATH, "utf8");
	const invocations = extractCliInvocations(prompt);

	for (const operation of CLI_OPERATIONS) {
		const commandPattern = new RegExp(
			String.raw`(?:^|\s)\$CLI\s+${escapeRegExp(operation)}(?:\s|$)`,
		);
		expect(
			invocations.some((invocation) => commandPattern.test(invocation)),
			`${operation} must appear as an explicit $CLI invocation`,
		).toBe(true);
	}
});

test("TC-5.6b: prompt covers each provider for provider-consuming operations", async () => {
	const prompt = await readFile(GORILLA_PROMPT_PATH, "utf8");
	const invocations = extractCliInvocations(prompt);

	for (const configPath of [
		"impl-run.claude-smoke.json",
		"impl-run.codex-smoke.json",
		"impl-run.claude.json",
		"impl-run.codex.json",
	]) {
		expect(
			invocations.some((invocation) => invocation.includes(configPath)),
			`${configPath} must be used by an explicit $CLI invocation`,
		).toBe(true);
	}

	for (const provider of ["claude-code", "codex"]) {
		expect(prompt).toContain(`gorilla/evidence/<YYYY-MM-DD>/${provider}-`);
	}
});
