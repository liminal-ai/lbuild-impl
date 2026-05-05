import { z } from "zod";

import {
	attachedProgressEventSchema,
	callerHarnessSchema,
} from "../../core/heartbeat.js";
import {
	type CallerRulingRequest as CoreCallerRulingRequest,
	type CallerRulingResponse as CoreCallerRulingResponse,
	type ImplLeadReviewRequest as CoreImplLeadReviewRequest,
	type StoryLeadFinalPackage as CoreStoryLeadFinalPackage,
	type StoryOrchestrateValidateResult as CoreStoryOrchestrateValidateResult,
	type StoryOrchestrateResumeResult as CoreStoryOrchestrateResumeResult,
	type StoryOrchestrateRunResult as CoreStoryOrchestrateRunResult,
	type StoryOrchestrateStatusResult as CoreStoryOrchestrateStatusResult,
	type StoryRunCurrentSnapshot as CoreStoryRunCurrentSnapshot,
	callerRulingRequestSchema,
	callerRulingResponseSchema,
	implLeadReviewRequestSchema,
	storyLeadFinalPackageSchema,
	storyOrchestrateValidateResultSchema,
	storyOrchestrateResumeResultSchema,
	storyOrchestrateRunResultSchema,
	storyOrchestrateStatusResultSchema,
	storyRunCurrentSnapshotSchema,
} from "../../core/story-orchestrate-contracts.js";
import type { HeartbeatOptions, OperationInputBase } from "./operations.js";

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

const progressListenerSchema = z.custom<(event: unknown) => void>(
	(value) => typeof value === "function",
);

const heartbeatOptionsSchema = z
	.object({
		callerHarness: callerHarnessSchema.optional(),
		heartbeatCadenceMinutes: z.number().int().positive().optional(),
		disableHeartbeats: z.boolean().optional(),
		progressListener: progressListenerSchema.optional(),
	})
	.strict();

export interface StoryOrchestrateRunInput
	extends OperationInputBase,
		HeartbeatOptions {
	storyId: string;
}

export interface StoryOrchestrateResumeInput
	extends OperationInputBase,
		HeartbeatOptions {
	storyId: string;
	storyRunId?: string;
	reviewRequest?: CoreImplLeadReviewRequest;
	ruling?: CoreCallerRulingResponse;
}

export interface StoryOrchestrateStatusInput extends OperationInputBase {
	storyId: string;
	storyRunId?: string;
}

export interface StoryOrchestrateValidateInput extends OperationInputBase {
	storyId: string;
}

export const storyOrchestrateRunInputSchema = operationInputBaseSchema
	.extend({
		storyId: z.string().min(1),
	})
	.merge(heartbeatOptionsSchema);

export const storyOrchestrateResumeInputSchema = operationInputBaseSchema
	.extend({
		storyId: z.string().min(1),
		storyRunId: z.string().min(1).optional(),
		reviewRequest: implLeadReviewRequestSchema.optional(),
		ruling: callerRulingResponseSchema.optional(),
	})
	.merge(heartbeatOptionsSchema);

export const storyOrchestrateStatusInputSchema =
	operationInputBaseSchema.extend({
		storyId: z.string().min(1),
		storyRunId: z.string().min(1).optional(),
	});

export const storyOrchestrateValidateInputSchema =
	operationInputBaseSchema.extend({
		storyId: z.string().min(1),
	});

export {
	attachedProgressEventSchema,
	callerHarnessSchema,
	callerRulingRequestSchema,
	callerRulingResponseSchema,
	implLeadReviewRequestSchema,
	storyLeadFinalPackageSchema,
	storyOrchestrateValidateResultSchema,
	storyOrchestrateResumeResultSchema,
	storyOrchestrateRunResultSchema,
	storyOrchestrateStatusResultSchema,
	storyRunCurrentSnapshotSchema,
};

export type ImplLeadReviewRequest = CoreImplLeadReviewRequest;
export type CallerRulingRequest = CoreCallerRulingRequest;
export type CallerRulingResponse = CoreCallerRulingResponse;
export type StoryLeadFinalPackage = CoreStoryLeadFinalPackage;
export type StoryRunCurrentSnapshot = CoreStoryRunCurrentSnapshot;
export type StoryOrchestrateValidateResult =
	CoreStoryOrchestrateValidateResult;
export type StoryOrchestrateRunResult = CoreStoryOrchestrateRunResult;
export type StoryOrchestrateResumeResult = CoreStoryOrchestrateResumeResult;
export type StoryOrchestrateStatusResult = CoreStoryOrchestrateStatusResult;
