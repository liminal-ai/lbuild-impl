import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createClaudeCodeAdapter } from "../../src/core/provider-adapters/claude-code";
import { createTempDir, ROOT } from "../support/test-helpers";
import { assertExecutableOnPath } from "./helpers";

const CLAUDE_STORY_PROMPT =
	"Dont load any skills. Improvise a 1200 word short story";
const CLAUDE_OPERATION_TIMEOUT_MS = 60_000;
const CLAUDE_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_FIRST_OUTPUT_BUDGET_MS = 12_500;

function configuredFirstOutputBudgetMs(): number {
	const raw = process.env.CLAUDE_FIRST_OUTPUT_BUDGET_MS;
	if (!raw) {
		return DEFAULT_FIRST_OUTPUT_BUDGET_MS;
	}

	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_FIRST_OUTPUT_BUDGET_MS;
}

function isAuthFailure(output: { stdout: string; stderr: string }): boolean {
	return /\bnot logged in\b|please run \/login|\bunauthorized\b|authentication (?:failed|required)|api key|access token/i.test(
		`${output.stdout}\n${output.stderr}`,
	);
}

describe("real-provider Claude Code first-output timing", () => {
	test("Claude Code emits its first provider output before the silence-timeout budget", async () => {
		await assertExecutableOnPath("claude-code");

		const budgetMs = configuredFirstOutputBudgetMs();
		const tempDir = await createTempDir("integration-claude-first-output");
		const stdoutPath = join(tempDir, "claude.stdout.log");
		const stderrPath = join(tempDir, "claude.stderr.log");
		const startedAt = Date.now();
		let firstOutputElapsedMs: number | null = null;
		const adapter = createClaudeCodeAdapter();

		const execution = await adapter.execute({
			prompt: CLAUDE_STORY_PROMPT,
			cwd: ROOT,
			model: "haiku",
			reasoningEffort: "low",
			timeoutMs: CLAUDE_OPERATION_TIMEOUT_MS,
			startupTimeoutMs: CLAUDE_STARTUP_TIMEOUT_MS,
			silenceTimeoutMs: budgetMs,
			streamOutputPaths: {
				stdoutPath,
				stderrPath,
			},
			lifecycleCallback: (event) => {
				if (event.type === "output" && firstOutputElapsedMs === null) {
					firstOutputElapsedMs = Date.now() - startedAt;
				}
			},
		});

		if (isAuthFailure(execution)) {
			throw new Error(
				"Claude Code real-provider integration requires authenticated Claude access. The provider returned an authentication failure instead of a timed output result.",
			);
		}

		const stdout = await readFile(stdoutPath, "utf8");
		const stderr = await readFile(stderrPath, "utf8");

		expect(execution.exitCode, stderr || stdout).toBe(0);
		expect(
			firstOutputElapsedMs,
			[
				`expected first provider output within ${budgetMs}ms`,
				`actual first output: ${firstOutputElapsedMs ?? "none"}ms`,
				`total elapsed: ${execution.elapsedMs ?? "unknown"}ms`,
				`stdout log: ${stdoutPath}`,
				`stderr log: ${stderrPath}`,
			].join("; "),
		).not.toBeNull();
		expect(
			firstOutputElapsedMs ?? Number.POSITIVE_INFINITY,
			[
				`expected first provider output within ${budgetMs}ms`,
				`actual first output: ${firstOutputElapsedMs ?? "none"}ms`,
				`total elapsed: ${execution.elapsedMs ?? "unknown"}ms`,
				`stdout log: ${stdoutPath}`,
				`stderr log: ${stderrPath}`,
			].join("; "),
		).toBeLessThanOrEqual(budgetMs);
	}, 90_000);
});
