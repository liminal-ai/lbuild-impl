import type { z } from "zod";
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
			const args = request.resumeSessionId
				? [
						"-p",
						request.prompt,
						"--resume",
						request.resumeSessionId,
						"--output-format",
						"json",
						"--model",
						request.model,
						"--effort",
						request.reasoningEffort,
						"--permission-mode",
						"acceptEdits",
					]
				: [
						"-p",
						request.prompt,
						"--output-format",
						"json",
						"--model",
						request.model,
						"--effort",
						request.reasoningEffort,
						"--permission-mode",
						"acceptEdits",
					];
			const execution = await runProviderCommand({
				provider: "claude-code",
				executable: "claude",
				args,
				cwd: request.cwd,
				env: options.env,
				timeoutMs: request.timeoutMs,
				startupTimeoutMs: request.startupTimeoutMs,
				silenceTimeoutMs: undefined,
				startupMode: "spawn-is-healthy",
				streamOutputPaths: request.streamOutputPaths,
				lifecycleCallback: request.lifecycleCallback,
			});

			if (execution.exitCode !== 0) {
				return execution;
			}

			const parsed = parseProviderPayload({
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
	return parseProviderPayload(input);
}
