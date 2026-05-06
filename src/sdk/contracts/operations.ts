import type {
	ChildProcess,
	ExecFileOptionsWithStringEncoding,
	spawn as nodeSpawn,
} from "node:child_process";
import type { createWriteStream as nodeCreateWriteStream } from "node:fs";
import type {
	access as nodeAccess,
	appendFile as nodeAppendFile,
	mkdir as nodeMkdir,
	mkdtemp as nodeMkdtemp,
	readdir as nodeReaddir,
	readFile as nodeReadFile,
	rename as nodeRename,
	rm as nodeRm,
	stat as nodeStat,
	writeFile as nodeWriteFile,
} from "node:fs/promises";
import { z } from "zod";

import {
	attachedProgressEventSchema,
	type AttachedProgressEvent as CoreAttachedProgressEvent,
	type CallerHarness as CoreCallerHarness,
	callerHarnessSchema,
} from "../../core/heartbeat.js";
import {
	type ContinuationHandle as CoreContinuationHandle,
	type EpicFixResult as CoreEpicFixResult,
	type EpicReverifyResult as CoreEpicReverifyResult,
	type EpicVerifierBatchResult as CoreEpicReviewResult,
	type InspectResult as CoreInspectPayload,
	type PreflightResult as CorePreflightPayload,
	type QuickFixResult as CoreQuickFixPayload,
	type ImplementorResult as CoreStoryImplementPayload,
	type StorySelfReviewResult as CoreStorySelfReviewPayload,
	type StoryVerifierResult as CoreStoryVerifyPayload,
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
import type { ContinuationHandle } from "./continuation-handle.js";
import type { CliResultEnvelope } from "./envelope.js";

export {
	attachedProgressEventSchema,
	callerHarnessSchema,
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

export interface FileSystemAdapter {
	access?: typeof nodeAccess;
	appendFile?: typeof nodeAppendFile;
	createWriteStream?: typeof nodeCreateWriteStream;
	mkdir?: typeof nodeMkdir;
	mkdtemp?: typeof nodeMkdtemp;
	readFile?: typeof nodeReadFile;
	readdir?: typeof nodeReaddir;
	rename?: typeof nodeRename;
	rm?: typeof nodeRm;
	stat?: typeof nodeStat;
	writeFile?: typeof nodeWriteFile;
}

export type SpawnImplementation = typeof nodeSpawn;

export type ExecFileImplementation = (
	file: string,
	args: ReadonlyArray<string>,
	options: ExecFileOptionsWithStringEncoding,
	callback: (error: Error | null, stdout: string, stderr: string) => void,
) => ChildProcess;

export interface ProviderStreamOutputPaths {
	stdoutPath?: string;
	stderrPath?: string;
}

export interface RuntimeProgressPaths {
	statusPath: string;
	progressPath: string;
}

export interface OperationInputBase {
	specPackRoot: string;
	configPath?: string;
	env?: Record<string, string | undefined>;
	fs?: FileSystemAdapter;
	spawn?: SpawnImplementation;
	execFile?: ExecFileImplementation;
	artifactPath?: string;
}

export interface ProviderOperationInputBase extends OperationInputBase {
	callerHarness?: CallerHarness;
	heartbeatCadenceMinutes?: number;
	disableHeartbeats?: boolean;
	progressListener?: (event: AttachedProgressEvent) => void;
	streamOutputPaths?: ProviderStreamOutputPaths;
	runtimeProgressPaths?: RuntimeProgressPaths;
}

export interface InspectInput extends OperationInputBase {}

export interface PreflightInput extends OperationInputBase {
	storyGate?: string;
	epicGate?: string;
}

export interface EpicReverifyInput extends ProviderOperationInputBase {
	reviewReportPaths: string[];
	provider?: ContinuationHandle["provider"];
	sessionId?: string;
}

export interface EpicReviewInput extends ProviderOperationInputBase {}

export interface EpicFixInput extends ProviderOperationInputBase {
	fixBatchPath: string;
	provider?: ContinuationHandle["provider"];
	sessionId?: string;
}

export interface QuickFixInput extends ProviderOperationInputBase {
	request: string;
	workingDirectory?: string;
}

export interface StoryImplementInput extends ProviderOperationInputBase {
	storyId: string;
}

export interface StoryContinueInput extends ProviderOperationInputBase {
	storyId: string;
	continuationHandle: ContinuationHandle;
	followupRequest: string;
}

export interface StorySelfReviewInput extends ProviderOperationInputBase {
	storyId: string;
	continuationHandle: ContinuationHandle;
	passes: number;
	passArtifactPaths: string[];
}

export interface StoryVerifyInput extends ProviderOperationInputBase {
	storyId: string;
	provider?: ContinuationHandle["provider"];
	sessionId?: string;
	response?: string;
	orchestratorContext?: string;
}

const continuationHandleInputSchema = z
	.object({
		provider: z.enum(["claude-code", "codex"]),
		sessionId: z.string().min(1),
		storyId: z.string().min(1),
	})
	.strict() satisfies z.ZodType<CoreContinuationHandle>;

const providerStreamOutputPathsSchema = z
	.object({
		stdoutPath: z.string().min(1).optional(),
		stderrPath: z.string().min(1).optional(),
	})
	.strict();

const runtimeProgressPathsSchema = z
	.object({
		statusPath: z.string().min(1),
		progressPath: z.string().min(1),
	})
	.strict();

const progressListenerSchema = z.custom<(event: AttachedProgressEvent) => void>(
	(value) => typeof value === "function",
);

const envOverridesSchema = z.custom<Record<string, string | undefined>>(
	(value) =>
		typeof value === "object" && value !== null && !Array.isArray(value),
);

const operationInputBaseSchema = z
	.object({
		specPackRoot: z.string().min(1),
		configPath: z.string().min(1).optional(),
		env: envOverridesSchema.optional(),
		fs: z.any().optional(),
		spawn: z.any().optional(),
		execFile: z.any().optional(),
		artifactPath: z.string().min(1).optional(),
	})
	.strict();

const providerOperationInputBaseSchema = operationInputBaseSchema.extend({
	callerHarness: callerHarnessSchema.optional(),
	heartbeatCadenceMinutes: z.number().int().positive().optional(),
	disableHeartbeats: z.boolean().optional(),
	progressListener: progressListenerSchema.optional(),
	streamOutputPaths: providerStreamOutputPathsSchema.optional(),
	runtimeProgressPaths: runtimeProgressPathsSchema.optional(),
});

export type CallerHarness = CoreCallerHarness;
export type AttachedProgressEvent = CoreAttachedProgressEvent;

export interface HeartbeatOptions {
	callerHarness?: CallerHarness;
	heartbeatCadenceMinutes?: number;
	disableHeartbeats?: boolean;
	progressListener?: (event: AttachedProgressEvent) => void;
}

export const inspectInputSchema = operationInputBaseSchema;
export const preflightInputSchema = operationInputBaseSchema.extend({
	storyGate: z.string().min(1).optional(),
	epicGate: z.string().min(1).optional(),
});
export const epicReverifyInputSchema = providerOperationInputBaseSchema.extend({
	reviewReportPaths: z.array(z.string().min(1)),
	provider: continuationHandleInputSchema.shape.provider.optional(),
	sessionId: z.string().min(1).optional(),
});
export const epicReviewInputSchema = providerOperationInputBaseSchema;
export const epicFixInputSchema = providerOperationInputBaseSchema.extend({
	fixBatchPath: z.string().min(1),
	provider: continuationHandleInputSchema.shape.provider.optional(),
	sessionId: z.string().min(1).optional(),
});
export const quickFixInputSchema = providerOperationInputBaseSchema.extend({
	request: z.string().min(1),
	workingDirectory: z.string().min(1).optional(),
});
export const storyImplementInputSchema =
	providerOperationInputBaseSchema.extend({
		storyId: z.string().min(1),
	});
export const storyContinueInputSchema = providerOperationInputBaseSchema.extend(
	{
		storyId: z.string().min(1),
		continuationHandle: continuationHandleInputSchema,
		followupRequest: z.string().min(1),
	},
);
export const storySelfReviewInputSchema =
	providerOperationInputBaseSchema.extend({
		storyId: z.string().min(1),
		continuationHandle: continuationHandleInputSchema,
		passes: z.union([z.number(), z.nan()]),
		passArtifactPaths: z.array(z.string().min(1)),
	});
export const storyVerifyInputSchema = providerOperationInputBaseSchema.extend({
	storyId: z.string().min(1),
	provider: continuationHandleInputSchema.shape.provider.optional(),
	sessionId: z.string().min(1).optional(),
	response: z.string().min(1).optional(),
	orchestratorContext: z.string().min(1).optional(),
});

export type QuickFixPayload = CoreQuickFixPayload;

export type InspectPayload = CoreInspectPayload;
export type PreflightPayload = CorePreflightPayload;
export type EpicReverifyPayload = CoreEpicReverifyResult;
export type EpicReviewPayload = CoreEpicReviewResult;
export type EpicFixPayload = CoreEpicFixResult;
export type StoryImplementPayload = CoreStoryImplementPayload;
export type StoryContinuePayload = CoreStoryImplementPayload;
export type StorySelfReviewPayload = CoreStorySelfReviewPayload;
export type StoryVerifyPayload = CoreStoryVerifyPayload;

export type InspectResult = CliResultEnvelope<InspectPayload>;
export type PreflightResult = CliResultEnvelope<PreflightPayload>;
export type EpicReverifyResult = CliResultEnvelope<EpicReverifyPayload>;
export type EpicReviewResult = CliResultEnvelope<EpicReviewPayload>;
export type EpicFixResult = CliResultEnvelope<EpicFixPayload>;
export type QuickFixResult = CliResultEnvelope<QuickFixPayload>;
export type StoryImplementResult = CliResultEnvelope<StoryImplementPayload>;
export type StoryContinueResult = CliResultEnvelope<StoryContinuePayload>;
export type StorySelfReviewResult = CliResultEnvelope<StorySelfReviewPayload>;
export type StoryVerifyResult = CliResultEnvelope<StoryVerifyPayload>;
