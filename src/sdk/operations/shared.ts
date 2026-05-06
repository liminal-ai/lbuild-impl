import { ZodError, type z } from "zod";
import {
	nextArtifactPath,
	nextGroupedArtifactPath,
	writeJsonArtifact,
} from "../../core/artifact-writer.js";
import { classifyCommandError } from "../../core/command-errors.js";
import { ensureTeamImplLog } from "../../core/log-template.js";
import {
	cliResultEnvelopeSchema,
	createResultEnvelope,
	epicFixResultSchema,
	epicReverifyResultSchema,
	epicVerifierBatchResultSchema,
	implementorResultSchema,
	inspectResultSchema,
	preflightResultSchema,
	quickFixResultSchema,
	storySelfReviewResultSchema,
	storyVerifierResultSchema,
} from "../../core/result-contracts.js";
import { withRuntimeDeps } from "../../core/runtime-deps.js";
import type {
	ExecFileImplementation,
	FileSystemAdapter,
	SpawnImplementation,
} from "../contracts/operations.js";
import type { ImplCliError } from "../errors/base.js";
import { InvalidInputError } from "../errors/classes.js";

export {
	epicFixResultSchema,
	epicReverifyResultSchema,
	epicVerifierBatchResultSchema,
	implementorResultSchema,
	inspectResultSchema,
	preflightResultSchema,
	quickFixResultSchema,
	storySelfReviewResultSchema,
	storyVerifierResultSchema,
};

export interface SdkExecutionInput {
	fs?: FileSystemAdapter;
	spawn?: SpawnImplementation;
	execFile?: ExecFileImplementation;
}

export async function withSdkExecutionContext<T>(
	input: SdkExecutionInput,
	callback: () => Promise<T>,
): Promise<T> {
	return await withRuntimeDeps(
		{
			fs: input.fs,
			spawn: input.spawn,
			execFile: input.execFile,
		},
		callback,
	);
}

export function parseSdkInput<TSchema extends z.ZodTypeAny>(
	schema: TSchema,
	input: unknown,
): z.infer<TSchema> {
	try {
		return schema.parse(input);
	} catch (error) {
		if (!(error instanceof ZodError)) {
			throw error;
		}

		const issues = error.issues
			.map((issue) => {
				const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
				return `${path}: ${issue.message}`;
			})
			.join("; ");
		throw new InvalidInputError(
			`SDK input validation failed: ${issues}`,
			undefined,
			{
				cause: error,
			},
		);
	}
}

export function buildUnexpectedEnvelope(input: {
	command: string;
	outcome?: "block" | "blocked";
	error: unknown;
	artifactPath: string;
	startedAt: string;
}) {
	const classification = classifyCommandError(input.error, input.outcome);
	const typedError = isImplCliError(input.error) ? input.error : undefined;
	return createResultEnvelope({
		command: input.command,
		outcome: classification.outcome,
		errors: [
			typedError?.toCliError() ?? {
				code: classification.code,
				message:
					input.error instanceof Error
						? input.error.message
						: String(input.error),
			},
		],
		artifacts: [
			{
				kind: "result-envelope",
				path: input.artifactPath,
			},
		],
		startedAt: input.startedAt,
		finishedAt: new Date().toISOString(),
	});
}

function isImplCliError(error: unknown): error is ImplCliError {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string" &&
		"toCliError" in error &&
		typeof error.toCliError === "function"
	);
}

export async function finalizeEnvelope<TSchema extends z.ZodTypeAny>(input: {
	command: string;
	artifactPath: string;
	startedAt: string;
	outcome: string;
	resultSchema: TSchema;
	result?: z.infer<TSchema>;
	errors?: {
		code: string;
		message: string;
		detail?: string;
	}[];
	warnings?: string[];
	additionalArtifacts?: {
		kind: string;
		path: string;
	}[];
}) {
	const envelope = cliResultEnvelopeSchema(input.resultSchema).parse(
		createResultEnvelope({
			command: input.command,
			outcome: input.outcome,
			result: input.result,
			errors: input.errors,
			warnings: input.warnings,
			artifacts: [
				...(input.additionalArtifacts ?? []),
				{
					kind: "result-envelope",
					path: input.artifactPath,
				},
			],
			startedAt: input.startedAt,
			finishedAt: new Date().toISOString(),
		}),
	);

	await writeJsonArtifact(input.artifactPath, envelope);
	return envelope;
}

export async function finalizeUnknownEnvelope<T>(input: {
	command: string;
	artifactPath: string;
	startedAt: string;
	outcome: string;
	result?: T;
	errors?: {
		code: string;
		message: string;
		detail?: string;
	}[];
	warnings?: string[];
}) {
	const envelope = createResultEnvelope({
		command: input.command,
		outcome: input.outcome,
		result: input.result,
		errors: input.errors,
		warnings: input.warnings,
		artifacts: [
			{
				kind: "result-envelope",
				path: input.artifactPath,
			},
		],
		startedAt: input.startedAt,
		finishedAt: new Date().toISOString(),
	});

	await writeJsonArtifact(input.artifactPath, envelope);
	return envelope;
}

export async function resolveOperationArtifactPath(input: {
	command: string;
	specPackRoot: string;
	artifactPath?: string;
	group?: string;
	fileName?: string;
}): Promise<string> {
	if (input.artifactPath) {
		return input.artifactPath;
	}

	if (input.group && input.fileName) {
		return await nextGroupedArtifactPath(
			input.specPackRoot,
			input.group,
			input.fileName,
		);
	}

	return await nextArtifactPath(input.specPackRoot, input.command);
}

export async function ensureReadyTeamImplLog(input: {
	specPackRoot: string;
	stories: { id: string }[];
	status: string;
}) {
	if (input.status !== "ready") {
		return;
	}

	await ensureTeamImplLog({
		specPackRoot: input.specPackRoot,
		storyIds: input.stories.map((story) => story.id),
	});
}
