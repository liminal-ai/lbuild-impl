import { z } from "zod";
import {
	appendProviderOutputDiagnostics,
	type ProviderAdapter,
	type ProviderExecutionRequest,
	parseProviderPayload,
	runProviderCommand,
} from "./shared";

interface ClaudeCodeAdapterOptions {
	env?: Record<string, string | undefined>;
}

export function createClaudeCodeAdapter(
	options: ClaudeCodeAdapterOptions = {},
): ProviderAdapter {
	return {
		provider: "claude-code",
		async execute<TResult>(request: ProviderExecutionRequest<TResult>) {
			const args = [
				"-p",
				request.prompt,
				...(request.resumeSessionId
					? ["--resume", request.resumeSessionId]
					: []),
				"--output-format",
				"stream-json",
				"--verbose",
				"--include-partial-messages",
				"--model",
				request.model,
				"--effort",
				request.reasoningEffort,
				"--permission-mode",
				"acceptEdits",
				...(request.resultSchema
					? [
							"--json-schema",
							JSON.stringify(z.toJSONSchema(request.resultSchema)),
						]
					: []),
			];
			const execution = await runProviderCommand({
				provider: "claude-code",
				executable: "claude",
				args,
				cwd: request.cwd,
				env: options.env,
				timeoutMs: request.timeoutMs,
				startupTimeoutMs: request.startupTimeoutMs,
				silenceTimeoutMs: request.silenceTimeoutMs,
				startupMode: "spawn-is-healthy",
				streamOutputPaths: request.streamOutputPaths,
				lifecycleCallback: request.lifecycleCallback,
			});

			if (execution.exitCode !== 0) {
				return execution;
			}

			const parsed = parseClaudeCodePayload({
				stdout: execution.stdout,
				resultSchema: request.resultSchema,
			});

			return {
				...execution,
				sessionId: parsed.sessionId ?? request.resumeSessionId,
				parsedResult: parsed.parsedResult,
				parseError: appendProviderOutputDiagnostics({
					parseError: parsed.parseError,
					stdout: execution.stdout,
					stderr: execution.stderr,
					streamOutputPaths: request.streamOutputPaths,
				}),
			};
		},
	};
}

export function parseClaudeCodePayload<TResult>(input: {
	stdout: string;
	resultSchema?: z.ZodType<TResult>;
}) {
	const streamJsonParsed = parseClaudeCodeStreamJsonPayload(input);
	if (
		streamJsonParsed &&
		(streamJsonParsed.parsedResult || !streamJsonParsed.parseError)
	) {
		return streamJsonParsed;
	}

	return parseProviderPayload(input);
}

function parseClaudeCodeStreamJsonPayload<TResult>(input: {
	stdout: string;
	resultSchema?: z.ZodType<TResult>;
}):
	| {
			parsedResult?: TResult;
			sessionId?: string;
			parseError?: string;
	  }
	| undefined {
	const lines = input.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) {
		return undefined;
	}

	let sessionId: string | undefined;
	let finalStructuredOutputJson: string | undefined;
	let finalResultJson: string | undefined;
	let streamedStructuredToolInputJson: string | undefined;
	let sawClaudeStreamEnvelope = false;

	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as Record<string, unknown>;
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
				continue;
			}

			if (typeof entry.type === "string") {
				sawClaudeStreamEnvelope = true;
			}

			if (typeof entry.session_id === "string" && entry.session_id.length > 0) {
				sessionId = entry.session_id;
			}

			if (
				entry.type === "assistant" &&
				entry.message &&
				typeof entry.message === "object" &&
				!Array.isArray(entry.message)
			) {
				const message = entry.message as Record<string, unknown>;
				const content = message.content;
				if (Array.isArray(content)) {
					for (const block of content) {
						if (
							block &&
							typeof block === "object" &&
							!Array.isArray(block) &&
							(block as Record<string, unknown>).type === "tool_use"
						) {
							const toolBlock = block as Record<string, unknown>;
							if (
								toolBlock.name === "StructuredOutput" &&
								toolBlock.input &&
								typeof toolBlock.input === "object" &&
								!Array.isArray(toolBlock.input)
							) {
								streamedStructuredToolInputJson = JSON.stringify(
									toolBlock.input,
								);
							}
						}
					}
				}
			}

			if (entry.type === "result") {
				if (
					entry.structured_output &&
					typeof entry.structured_output === "object" &&
					!Array.isArray(entry.structured_output)
				) {
					finalStructuredOutputJson = JSON.stringify(entry.structured_output);
				}
				if (
					typeof entry.result === "string" &&
					entry.result.trim().length > 0
				) {
					finalResultJson = entry.result;
				}
			}
		} catch {
			// Ignore non-JSON noise and continue scanning the stream.
		}
	}

	if (!sawClaudeStreamEnvelope) {
		return undefined;
	}

	for (const candidate of [
		finalStructuredOutputJson,
		streamedStructuredToolInputJson,
		finalResultJson,
	]) {
		if (!candidate) {
			continue;
		}

		const parsed = parseProviderPayload({
			stdout:
				candidate === finalResultJson
					? JSON.stringify({
							result: candidate,
							session_id: sessionId,
						})
					: candidate,
			resultSchema: input.resultSchema,
		});
		if (!parsed.parseError || parsed.parsedResult) {
			return {
				...parsed,
				sessionId: sessionId ?? parsed.sessionId,
			};
		}
	}

	return {
		sessionId,
		parseError:
			"Claude Code stream-json output did not contain a parseable structured payload.",
	};
}
