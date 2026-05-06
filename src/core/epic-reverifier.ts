import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import {
	type CallerHarnessConfigRecord,
	loadRunConfig,
	resolveConfiguredVerificationGates,
	resolveRunTimeouts,
} from "./config-schema";
import { pathExists, pathReadable, readTextFile } from "./fs-utils";
import { resolveVerificationGates } from "./gate-discovery";
import { resolveProviderCwd } from "./git-repo";
import {
	type AttachedProgressEvent,
	type CallerHarness,
	createPrimitiveHeartbeatEmitter,
} from "./heartbeat";
import { assemblePrompt } from "./prompt-assembly";
import {
	createProviderAdapter,
	type ProviderLifecycleEvent,
	type ProviderName,
	type ProviderStreamOutputPaths,
} from "./provider-adapters";
import {
	type CliError,
	cliResultEnvelopeSchema,
	type EpicReverifyResult,
	type EpicVerifierResult,
	epicVerifierBatchResultSchema,
	epicVerifierResultSchema,
	providerIdSchema,
} from "./result-contracts";
import {
	type RuntimeProgressPaths,
	RuntimeProgressTracker,
} from "./runtime-progress";
import { inspectSpecPack } from "./spec-pack";

export const epicReverifyProviderPayloadSchema = z
	.object({
		outcome: z.enum([
			"ready-for-closeout",
			"needs-fixes",
			"needs-more-verification",
			"blocked",
		]),
		confirmedIssues: z.array(z.string()),
		disputedOrUnconfirmedIssues: z.array(z.string()),
		readinessAssessment: z.string().min(1),
		recommendedNextStep: z.string().min(1),
	})
	.strict();

type ProviderPayload = z.infer<typeof epicReverifyProviderPayloadSchema>;

interface PreparedReverifyContext {
	specPackRoot: string;
	provider: ProviderName;
	model: string;
	reasoningEffort: string;
	reviewReportPaths: string[];
	verifierResults: EpicVerifierResult[];
	gateCommands: {
		story: string;
		epic: string;
	};
	paths: {
		epicPath: string;
		techDesignPath: string;
		techDesignCompanionPaths: string[];
		testPlanPath: string;
	};
	providerCwd: string;
	timeoutMs: number;
	startupTimeoutMs: number;
	silenceTimeoutMs: number;
	callerHarnessConfig?: CallerHarnessConfigRecord;
}

export interface EpicReverifyWorkflowResult {
	outcome:
		| "ready-for-closeout"
		| "needs-fixes"
		| "needs-more-verification"
		| "blocked";
	result?: EpicReverifyResult;
	errors: CliError[];
	warnings: string[];
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

function parseReviewReportContent(
	content: string,
): EpicVerifierResult[] | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return undefined;
	}

	const directResult = epicVerifierResultSchema.safeParse(parsed);
	if (directResult.success) {
		return [directResult.data];
	}

	const directBatch = epicVerifierBatchResultSchema.safeParse(parsed);
	if (directBatch.success) {
		return directBatch.data.verifierResults;
	}

	const envelope = cliResultEnvelopeSchema(
		epicVerifierBatchResultSchema,
	).safeParse(parsed);
	if (envelope.success && envelope.data.result) {
		return envelope.data.result.verifierResults;
	}

	return undefined;
}

async function loadReviewReports(
	reviewReportPaths: string[],
): Promise<{ results?: EpicVerifierResult[]; errors?: CliError[] }> {
	const collected: EpicVerifierResult[] = [];

	for (const reportPath of reviewReportPaths) {
		const resolvedPath = resolve(reportPath);
		if (!(await pathExists(resolvedPath))) {
			return {
				errors: [
					blockedError(
						"INVALID_SPEC_PACK",
						`Review report was not found: ${resolvedPath}`,
					),
				],
			};
		}

		if (!(await pathReadable(resolvedPath))) {
			return {
				errors: [
					blockedError(
						"INVALID_SPEC_PACK",
						`Review report is not readable: ${resolvedPath}`,
					),
				],
			};
		}

		let content: string;
		try {
			content = await readTextFile(resolvedPath);
		} catch (error) {
			return {
				errors: [
					blockedError(
						"INVALID_SPEC_PACK",
						`Review report could not be read: ${resolvedPath}`,
						error instanceof Error ? error.message : String(error),
					),
				],
			};
		}

		const parsed = parseReviewReportContent(content);
		if (!parsed) {
			return {
				errors: [
					blockedError(
						"INVALID_SPEC_PACK",
						`Review report was not valid JSON for the epic reviewer contract: ${resolvedPath}`,
					),
				],
			};
		}

		collected.push(...parsed);
	}

	return {
		results: collected,
	};
}

async function prepareReverifyContext(input: {
	specPackRoot: string;
	reviewReportPaths: string[];
	configPath?: string;
}): Promise<PreparedReverifyContext | { errors: CliError[] }> {
	const inspection = await inspectSpecPack(input.specPackRoot);
	if (inspection.status !== "ready") {
		return {
			errors: [
				blockedError(
					"INVALID_SPEC_PACK",
					"Spec-pack inspection must be ready before epic reverify can start.",
					inspection.blockers.join("; ") || inspection.notes.join("; "),
				),
			],
		};
	}

	const reportResolution = await loadReviewReports(input.reviewReportPaths);
	if (reportResolution.errors || !reportResolution.results) {
		return {
			errors: reportResolution.errors ?? [
				blockedError(
					"INVALID_SPEC_PACK",
					"Epic reverify requires at least one review report.",
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
							"Verification gates must be resolved before epic reverify can start.",
						),
					],
		};
	}

	return {
		specPackRoot: inspection.specPackRoot,
		provider: providerForHarness(config.epic_reverifier.secondary_harness),
		model: config.epic_reverifier.model,
		reasoningEffort: config.epic_reverifier.reasoning_effort,
		reviewReportPaths: input.reviewReportPaths.map((path) => resolve(path)),
		verifierResults: reportResolution.results,
		gateCommands: {
			story: gateResolution.verificationGates.storyGate,
			epic: gateResolution.verificationGates.epicGate,
		},
		paths: {
			epicPath: inspection.artifacts.epicPath,
			techDesignPath: inspection.artifacts.techDesignPath,
			techDesignCompanionPaths: inspection.artifacts.techDesignCompanionPaths,
			testPlanPath: inspection.artifacts.testPlanPath,
		},
		providerCwd: await resolveProviderCwd(inspection.specPackRoot),
		timeoutMs: resolveRunTimeouts(config).epic_reverifier_ms,
		startupTimeoutMs: resolveRunTimeouts(config).provider_startup_timeout_ms,
		silenceTimeoutMs:
			resolveRunTimeouts(config).epic_reverifier_silence_timeout_ms,
		callerHarnessConfig: config.caller_harness,
	};
}

function buildReverifyResult(input: {
	provider: ProviderName;
	model: string;
	sessionId: string;
	mode: "initial" | "followup";
	payload: ProviderPayload;
}): EpicReverifyResult {
	return {
		resultId: randomUUID(),
		provider: input.provider,
		model: input.model,
		sessionId: input.sessionId,
		continuation: {
			provider: input.provider,
			sessionId: input.sessionId,
			operation: "epic-reverify",
		},
		mode: input.mode,
		outcome: input.payload.outcome,
		confirmedIssues: input.payload.confirmedIssues,
		disputedOrUnconfirmedIssues: input.payload.disputedOrUnconfirmedIssues,
		readinessAssessment: input.payload.readinessAssessment,
		recommendedNextStep: input.payload.recommendedNextStep,
	};
}

export async function runEpicReverify(input: {
	specPackRoot: string;
	reviewReportPaths: string[];
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
}): Promise<EpicReverifyWorkflowResult> {
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
					"Epic reverify follow-up requires --provider and --session-id.",
				),
			],
			warnings: [],
		};
	}

	const context = await prepareReverifyContext(input);
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
				command: "epic-reverify",
				phase: "epic-reverify",
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

	const heartbeat = progressTracker
		? createPrimitiveHeartbeatEmitter({
				command: "epic-reverify",
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
		const prompt = await assemblePrompt({
			role: "epic_reverifier",
			epicPath: context.paths.epicPath,
			techDesignPath: context.paths.techDesignPath,
			techDesignCompanionPaths: context.paths.techDesignCompanionPaths,
			testPlanPath: context.paths.testPlanPath,
			reviewReportPaths: context.reviewReportPaths,
			gateCommands: context.gateCommands,
		});
		const adapter = createProviderAdapter(executionProvider, {
			env: input.env,
		});
		const execution = await adapter.execute({
			prompt: prompt.prompt,
			cwd: context.providerCwd,
			model: context.model,
			reasoningEffort: context.reasoningEffort,
			resumeSessionId: mode === "followup" ? input.sessionId : undefined,
			timeoutMs: context.timeoutMs,
			startupTimeoutMs: context.startupTimeoutMs,
			silenceTimeoutMs: context.silenceTimeoutMs,
			resultSchema: epicReverifyProviderPayloadSchema,
			streamOutputPaths: input.streamOutputPaths,
			lifecycleCallback: (event: ProviderLifecycleEvent) =>
				progressTracker?.handleProviderLifecycle(event),
		});

		if (execution.exitCode !== 0) {
			await progressTracker?.markFailed(
				"epic-reverify failed during provider execution.",
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
				"epic-reverify produced invalid provider output.",
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
				"epic-reverify did not return a retained provider session id.",
			);
			await progressTracker?.flush();
			return {
				outcome: "blocked",
				errors: [
					blockedError(
						"CONTINUATION_HANDLE_INVALID",
						`Provider '${executionProvider}' did not return a session id for the retained epic-reverify session.`,
					),
				],
				warnings: [],
			};
		}

		const result = buildReverifyResult({
			provider: executionProvider,
			model: context.model,
			sessionId,
			mode,
			payload: execution.parsedResult,
		});
		await progressTracker?.markCompleted(
			`epic-reverify completed with outcome ${result.outcome}.`,
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
