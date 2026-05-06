import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import {
	type CallerHarnessConfigRecord,
	loadRunConfig,
	resolveConfiguredVerificationGates,
	resolveRunTimeouts,
} from "./config-schema";
import { pathExists, readTextFile } from "./fs-utils";
import { resolveVerificationGates } from "./gate-discovery";
import { resolveProviderCwd } from "./git-repo";
import {
	type AttachedProgressEvent,
	type CallerHarness,
	createPrimitiveHeartbeatEmitter,
} from "./heartbeat";
import {
	createProviderAdapter,
	type ProviderLifecycleEvent,
	type ProviderName,
	type ProviderStreamOutputPaths,
} from "./provider-adapters";
import {
	type CliError,
	type EpicFixResult,
	providerIdSchema,
} from "./result-contracts";
import {
	type RuntimeProgressPaths,
	RuntimeProgressTracker,
} from "./runtime-progress";
import { inspectSpecPack } from "./spec-pack";

const gateRunSchema = z
	.object({
		command: z.string().min(1),
		result: z.enum(["pass", "fail", "not-run"]),
	})
	.strict();

export const epicFixProviderPayloadSchema = z
	.object({
		outcome: z.enum(["cleaned", "needs-more-fix", "blocked"]),
		fixBatchPath: z.string().min(1),
		filesChanged: z.array(z.string().min(1)),
		changeSummary: z.string().min(1),
		gatesRun: z.array(gateRunSchema),
		unresolvedConcerns: z.array(z.string()),
		recommendedNextStep: z.string().min(1),
	})
	.strict();

type ProviderPayload = z.infer<typeof epicFixProviderPayloadSchema>;

export interface EpicFixWorkflowResult {
	outcome: "cleaned" | "needs-more-fix" | "blocked";
	result?: EpicFixResult;
	errors: CliError[];
	warnings: string[];
}

interface PreparedFixContext {
	specPackRoot: string;
	fixBatchPath: string;
	fixBatchContent: string;
	provider: ProviderName;
	model: string;
	reasoningEffort: string;
	gateCommands: {
		story: string;
		epic: string;
	};
	providerCwd: string;
	timeoutMs: number;
	startupTimeoutMs: number;
	silenceTimeoutMs: number;
	callerHarnessConfig?: CallerHarnessConfigRecord;
}

function blockedError(
	code: string,
	message: string,
	detail?: string,
): CliError {
	return {
		code,
		message,
		...(detail ? { detail } : {}),
	};
}

function providerForHarness(harness: "codex" | "none"): ProviderName {
	if (harness === "none") {
		return "claude-code";
	}

	return harness;
}

function executionFailureError(input: {
	provider: ProviderName;
	stderr: string;
	errorCode?: string;
}): CliError {
	if (input.errorCode === "CONTINUATION_HANDLE_INVALID") {
		return blockedError(
			"CONTINUATION_HANDLE_INVALID",
			`Continuation handle is invalid for ${input.provider}.`,
			input.stderr,
		);
	}

	if (input.errorCode === "INVALID_OUTPUT_SCHEMA") {
		return blockedError(
			"PROVIDER_OUTPUT_INVALID",
			`Provider output schema was invalid for ${input.provider}.`,
			input.stderr,
		);
	}

	if (input.errorCode === "PROVIDER_TIMEOUT") {
		return blockedError(
			"PROVIDER_TIMEOUT",
			`Provider execution timed out for ${input.provider}.`,
			input.stderr,
		);
	}

	if (input.errorCode === "PROVIDER_STALLED") {
		return blockedError(
			"PROVIDER_STALLED",
			`Provider execution stalled for ${input.provider}.`,
			input.stderr,
		);
	}

	if (
		input.errorCode === "PROVIDER_STARTUP_FAILED" ||
		input.errorCode === "ENOENT"
	) {
		return blockedError(
			"PROVIDER_STARTUP_FAILED",
			`Provider failed startup for ${input.provider}.`,
			input.stderr,
		);
	}

	return blockedError(
		"PROVIDER_UNAVAILABLE",
		`Provider execution failed for ${input.provider}.`,
		input.stderr,
	);
}

async function prepareFixContext(input: {
	specPackRoot: string;
	fixBatchPath: string;
	configPath?: string;
}): Promise<PreparedFixContext | { errors: CliError[] }> {
	const inspection = await inspectSpecPack(input.specPackRoot);
	if (inspection.status !== "ready") {
		return {
			errors: [
				blockedError(
					"INVALID_SPEC_PACK",
					"Spec-pack inspection must be ready before epic fix can start.",
					inspection.blockers.join("; ") || inspection.notes.join("; "),
				),
			],
		};
	}

	const fixBatchPath = resolve(input.fixBatchPath);
	if (!(await pathExists(fixBatchPath))) {
		return {
			errors: [
				blockedError(
					"INVALID_SPEC_PACK",
					`Fix batch artifact was not found: ${fixBatchPath}`,
				),
			],
		};
	}

	const config = await loadRunConfig({
		specPackRoot: inspection.specPackRoot,
		configPath: input.configPath,
	});
	const gateResolution = await resolveVerificationGates({
		specPackRoot: inspection.specPackRoot,
		persistedVerificationGates: resolveConfiguredVerificationGates(config),
	});
	if (gateResolution.status !== "ready" || !gateResolution.verificationGates) {
		return {
			errors: gateResolution.errors.length
				? gateResolution.errors
				: [
						blockedError(
							"VERIFICATION_GATE_UNRESOLVED",
							"Verification gates must be resolved before epic fix can start.",
						),
					],
		};
	}

	return {
		specPackRoot: inspection.specPackRoot,
		fixBatchPath,
		fixBatchContent: await readTextFile(fixBatchPath),
		provider: providerForHarness(config.quick_fixer.secondary_harness),
		model: config.quick_fixer.model,
		reasoningEffort: config.quick_fixer.reasoning_effort,
		gateCommands: {
			story: gateResolution.verificationGates.storyGate,
			epic: gateResolution.verificationGates.epicGate,
		},
		providerCwd: await resolveProviderCwd(inspection.specPackRoot),
		timeoutMs: resolveRunTimeouts(config).epic_fixer_ms,
		startupTimeoutMs: resolveRunTimeouts(config).provider_startup_timeout_ms,
		silenceTimeoutMs: resolveRunTimeouts(config).epic_fixer_silence_timeout_ms,
		callerHarnessConfig: config.caller_harness,
	};
}

function hasApprovedFixItems(content: string): boolean {
	return /^\s*[-*]\s+APPROVED\b/im.test(content);
}

function buildFixPrompt(context: PreparedFixContext): string {
	return [
		"# Epic Fix",
		"",
		"Apply only the approved fix items from the curated fix batch.",
		"Do not choose a different workflow, widen the scope, or decide whether the epic can close.",
		"Use the fix batch as the source of truth for this pass.",
		"",
		`Fix batch path: ${context.fixBatchPath}`,
		`Story gate command: ${context.gateCommands.story}`,
		`Epic gate command: ${context.gateCommands.epic}`,
		"",
		"## Fix Batch",
		context.fixBatchContent.trim(),
		"",
		"## Output Contract",
		"Return exactly one JSON object with: outcome, fixBatchPath, filesChanged, changeSummary, gatesRun, unresolvedConcerns, recommendedNextStep.",
	].join("\n");
}

function buildFixResult(input: {
	provider: ProviderName;
	model: string;
	sessionId: string;
	mode: "initial" | "followup";
	fixBatchPath: string;
	payload: ProviderPayload;
}): EpicFixResult {
	return {
		resultId: randomUUID(),
		provider: input.provider,
		model: input.model,
		sessionId: input.sessionId,
		continuation: {
			provider: input.provider,
			sessionId: input.sessionId,
			operation: "epic-fix",
		},
		mode: input.mode,
		outcome: input.payload.outcome,
		fixBatchPath: input.fixBatchPath,
		filesChanged: input.payload.filesChanged,
		changeSummary: input.payload.changeSummary,
		gatesRun: input.payload.gatesRun,
		unresolvedConcerns: input.payload.unresolvedConcerns,
		recommendedNextStep: input.payload.recommendedNextStep,
	};
}

export async function runEpicFix(input: {
	specPackRoot: string;
	fixBatchPath: string;
	provider?: string;
	sessionId?: string;
	configPath?: string;
	env?: Record<string, string | undefined>;
	artifactPath?: string;
	streamOutputPaths?: ProviderStreamOutputPaths;
	runtimeProgressPaths?: RuntimeProgressPaths;
	callerHarness?: CallerHarness;
	heartbeatCadenceMinutes?: number;
	disableHeartbeats?: boolean;
	progressListener?: (event: AttachedProgressEvent) => void;
}): Promise<EpicFixWorkflowResult> {
	const mode =
		typeof input.provider === "string" || typeof input.sessionId === "string"
			? "followup"
			: "initial";
	const provider =
		mode === "followup" ? providerIdSchema.safeParse(input.provider) : null;
	if (mode === "followup" && (!provider?.success || !input.sessionId)) {
		return {
			outcome: "blocked",
			errors: [
				blockedError(
					"CONTINUATION_HANDLE_INVALID",
					"Epic fix follow-up requires --provider and --session-id.",
				),
			],
			warnings: [],
		};
	}

	const context = await prepareFixContext(input);
	if ("errors" in context) {
		return {
			outcome: "blocked",
			errors: context.errors,
			warnings: [],
		};
	}

	const executionProvider = provider?.success
		? provider.data
		: context.provider;
	const progressTracker = input.runtimeProgressPaths
		? await RuntimeProgressTracker.start({
				command: "epic-fix",
				phase: "fix",
				provider: executionProvider,
				cwd: context.providerCwd,
				timeoutMs: context.timeoutMs,
				configuredStartupTimeoutMs: context.startupTimeoutMs,
				configuredSilenceTimeoutMs: context.silenceTimeoutMs,
				artifactPath:
					input.artifactPath ?? input.runtimeProgressPaths.statusPath,
				streamPaths: {
					stdoutPath: input.streamOutputPaths?.stdoutPath ?? "",
					stderrPath: input.streamOutputPaths?.stderrPath ?? "",
				},
				progressPaths: input.runtimeProgressPaths,
			})
		: undefined;

	if (!hasApprovedFixItems(context.fixBatchContent)) {
		const noopSessionId = input.sessionId ?? `noop-${randomUUID()}`;
		await progressTracker?.markCompleted(
			"epic-fix completed as a no-op because there were no approved fix items.",
		);
		await progressTracker?.flush();
		return {
			outcome: "cleaned",
			result: {
				resultId: randomUUID(),
				provider: provider?.success ? provider.data : context.provider,
				model: context.model,
				sessionId: noopSessionId,
				continuation: {
					provider: provider?.success ? provider.data : context.provider,
					sessionId: noopSessionId,
					operation: "epic-fix",
				},
				mode,
				outcome: "cleaned",
				fixBatchPath: context.fixBatchPath,
				filesChanged: [],
				changeSummary:
					"No approved fix corrections remained, so the fix pass was a no-op.",
				gatesRun: [],
				unresolvedConcerns: [],
				recommendedNextStep: "Review the fix result, then launch epic review.",
			},
			errors: [],
			warnings: [],
		};
	}

	const heartbeat = progressTracker
		? createPrimitiveHeartbeatEmitter({
				command: "epic-fix",
				config: context.callerHarnessConfig,
				callerHarness: input.callerHarness,
				heartbeatCadenceMinutes: input.heartbeatCadenceMinutes,
				disableHeartbeats: input.disableHeartbeats,
				progressListener: input.progressListener,
				readSnapshot: () => progressTracker.getSnapshot(),
			})
		: null;
	heartbeat?.start();
	try {
		const adapter = createProviderAdapter(executionProvider, {
			env: input.env,
		});
		const execution = await adapter.execute({
			prompt: buildFixPrompt(context),
			cwd: context.providerCwd,
			model: context.model,
			reasoningEffort: context.reasoningEffort,
			resumeSessionId: mode === "followup" ? input.sessionId : undefined,
			timeoutMs: context.timeoutMs,
			startupTimeoutMs: context.startupTimeoutMs,
			silenceTimeoutMs: context.silenceTimeoutMs,
			resultSchema: epicFixProviderPayloadSchema,
			streamOutputPaths: input.streamOutputPaths,
			lifecycleCallback: (event: ProviderLifecycleEvent) =>
				progressTracker?.handleProviderLifecycle(event),
		});

		if (execution.exitCode !== 0) {
			await progressTracker?.markFailed(
				"epic-fix failed during provider execution.",
				{
					errorCode: execution.errorCode,
				},
			);
			await progressTracker?.flush();
			return {
				outcome: "blocked",
				errors: [
					executionFailureError({
						provider: executionProvider,
						stderr: execution.stderr,
						errorCode: execution.errorCode,
					}),
				],
				warnings: [],
			};
		}

		if (execution.parseError || !execution.parsedResult) {
			await progressTracker?.markFailed(
				"epic-fix produced invalid provider output.",
				{
					parseError: execution.parseError,
				},
			);
			await progressTracker?.flush();
			return {
				outcome: "blocked",
				errors: [
					blockedError(
						"PROVIDER_OUTPUT_INVALID",
						`Provider output was invalid for ${executionProvider}.`,
						execution.parseError,
					),
				],
				warnings: [],
			};
		}

		const sessionId = execution.sessionId ?? input.sessionId;
		if (!sessionId) {
			await progressTracker?.markFailed(
				"epic-fix did not return a retained provider session id.",
			);
			await progressTracker?.flush();
			return {
				outcome: "blocked",
				errors: [
					blockedError(
						"CONTINUATION_HANDLE_INVALID",
						`Provider '${executionProvider}' did not return a session id for the retained epic-fix session.`,
					),
				],
				warnings: [],
			};
		}

		const result = buildFixResult({
			provider: executionProvider,
			model: context.model,
			sessionId,
			mode,
			fixBatchPath: context.fixBatchPath,
			payload: execution.parsedResult,
		});

		await progressTracker?.markCompleted(
			`epic-fix completed with outcome ${result.outcome}.`,
			{
				outcome: result.outcome,
			},
		);
		await progressTracker?.flush();

		return {
			outcome: result.outcome,
			result,
			errors: [],
			warnings: [],
		};
	} finally {
		heartbeat?.stop();
	}
}
