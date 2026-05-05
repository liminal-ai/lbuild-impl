import { z } from "zod";

import { createClaudeCodeAdapter } from "../../../src/core/provider-adapters/claude-code";
import { createCodexAdapter } from "../../../src/core/provider-adapters/codex";
import type {
	ProviderAdapter,
	ProviderExecutionResult,
} from "../../../src/core/provider-adapters/shared";
import { ROOT } from "../test-helpers";

export type RealProviderName = "claude-code" | "codex";
export type ParserScenarioName =
	| "smoke"
	| "resume"
	| "structured-output"
	| "stall";
type PromptScenarioName = ParserScenarioName | "resume-seed";

interface ScenarioDefinition<TResult> {
	command: string;
	expected: TResult;
	prompt: string;
	schema: z.ZodType<TResult>;
}

export interface ExecutedScenario<TResult> {
	command: string;
	expected: TResult;
	result: ProviderExecutionResult<TResult>;
	scenario: PromptScenarioName;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_SILENCE_TIMEOUT_MS = 15_000;

const providerModels: Record<RealProviderName, string> = {
	"claude-code": "sonnet",
	codex: "gpt-5.4",
};

const providerExecutables: Record<RealProviderName, string> = {
	"claude-code": "claude",
	codex: "codex",
};

function createAdapter(
	provider: RealProviderName,
	env?: Record<string, string | undefined>,
): ProviderAdapter {
	switch (provider) {
		case "claude-code":
			return createClaudeCodeAdapter({ env });
		case "codex":
			return createCodexAdapter({ env });
	}
}

function exactJsonPrompt(payload: unknown): string {
	return `Return exactly this JSON and nothing else: ${JSON.stringify(payload)}`;
}

function buildStructuredExpected(provider: RealProviderName) {
	return {
		provider,
		scenario: "structured-output" as const,
		summary: {
			completed: true,
			itemCount: 2,
		},
		items: [
			{
				id: "alpha",
				status: "ready" as const,
			},
			{
				id: "beta",
				status: "done" as const,
			},
		],
	};
}

function commandTemplate(
	provider: RealProviderName,
	prompt: string,
	resumeSessionId?: string,
): string {
	switch (provider) {
		case "claude-code":
			return resumeSessionId
				? `claude -p ${JSON.stringify(prompt)} --resume ${resumeSessionId} --output-format json --model sonnet --effort low`
				: `claude -p ${JSON.stringify(prompt)} --output-format json --model sonnet --effort low --permission-mode acceptEdits`;
		case "codex":
			return resumeSessionId
				? `codex exec resume --json -o <output-last-message-path> ${resumeSessionId} ${JSON.stringify(prompt)}`
				: `codex exec --json -m gpt-5.4 -c model_reasoning_effort=low --output-schema <output-schema-path> -o <output-last-message-path> ${JSON.stringify(prompt)}`;
	}
}

export function getProviderExecutable(
	provider: RealProviderName,
): (typeof providerExecutables)[RealProviderName] {
	return providerExecutables[provider];
}

export function getScenarioDefinition(
	provider: RealProviderName,
	scenario: PromptScenarioName,
	resumeSessionId?: string,
): ScenarioDefinition<unknown> {
	switch (scenario) {
		case "smoke": {
			const expected = {
				ok: true,
				provider,
				scenario: "smoke" as const,
			};
			return {
				command: commandTemplate(provider, exactJsonPrompt(expected)),
				expected,
				prompt: exactJsonPrompt(expected),
				schema: z.object({
					ok: z.boolean(),
					provider: z.literal(provider),
					scenario: z.literal("smoke"),
				}),
			};
		}
		case "resume-seed": {
			const expected = {
				ok: true,
				provider,
				scenario: "resume-seed" as const,
			};
			return {
				command: commandTemplate(provider, exactJsonPrompt(expected)),
				expected,
				prompt: exactJsonPrompt(expected),
				schema: z.object({
					ok: z.boolean(),
					provider: z.literal(provider),
					scenario: z.literal("resume-seed"),
				}),
			};
		}
		case "resume": {
			const expected = {
				ok: true,
				provider,
				scenario: "resume" as const,
				resumed: true,
			};
			return {
				command: commandTemplate(
					provider,
					exactJsonPrompt(expected),
					resumeSessionId,
				),
				expected,
				prompt: exactJsonPrompt(expected),
				schema: z.object({
					ok: z.boolean(),
					provider: z.literal(provider),
					scenario: z.literal("resume"),
					resumed: z.literal(true),
				}),
			};
		}
		case "structured-output": {
			const expected = buildStructuredExpected(provider);
			return {
				command: commandTemplate(provider, exactJsonPrompt(expected)),
				expected,
				prompt: exactJsonPrompt(expected),
				schema: z.object({
					provider: z.literal(provider),
					scenario: z.literal("structured-output"),
					summary: z.object({
						completed: z.literal(true),
						itemCount: z.literal(2),
					}),
					items: z.array(
						z.object({
							id: z.string(),
							status: z.enum(["ready", "done"]),
						}),
					),
				}),
			};
		}
		case "stall": {
			const expected = {
				ok: true,
				provider,
				scenario: "stall" as const,
				mode: "fixture" as const,
			};
			return {
				command: commandTemplate(provider, exactJsonPrompt(expected)),
				expected,
				prompt: exactJsonPrompt(expected),
				schema: z.object({
					ok: z.boolean(),
					provider: z.literal(provider),
					scenario: z.literal("stall"),
					mode: z.literal("fixture"),
				}),
			};
		}
	}
}

export async function executeScenario(
	provider: RealProviderName,
	scenario: PromptScenarioName,
	options: {
		cwd?: string;
		env?: Record<string, string | undefined>;
		resumeSessionId?: string;
		startupTimeoutMs?: number;
		silenceTimeoutMs?: number;
		timeoutMs?: number;
	} = {},
): Promise<ExecutedScenario<unknown>> {
	const definition = getScenarioDefinition(
		provider,
		scenario,
		options.resumeSessionId,
	);
	const adapter = createAdapter(provider, options.env);
	const result = await adapter.execute({
		prompt: definition.prompt,
		cwd: options.cwd ?? ROOT,
		model: providerModels[provider],
		reasoningEffort: "low",
		resumeSessionId: options.resumeSessionId,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
		silenceTimeoutMs: options.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS,
		resultSchema: definition.schema,
	});

	return {
		command: definition.command,
		expected: definition.expected,
		result,
		scenario,
	};
}

export async function executeResumeScenario(
	provider: RealProviderName,
	options: {
		cwd?: string;
		env?: Record<string, string | undefined>;
		startupTimeoutMs?: number;
		silenceTimeoutMs?: number;
		timeoutMs?: number;
	} = {},
): Promise<{
	resumed: ExecutedScenario<unknown>;
	seed: ExecutedScenario<unknown>;
}> {
	const seed = await executeScenario(provider, "resume-seed", options);
	if (!seed.result.sessionId) {
		throw new Error(`Seed ${provider} run did not return a session id.`);
	}

	const resumed = await executeScenario(provider, "resume", {
		...options,
		resumeSessionId: seed.result.sessionId,
	});

	return {
		resumed,
		seed,
	};
}
