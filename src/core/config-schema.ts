import { resolve } from "node:path";
import { z } from "zod";
import { InvalidRunConfigError } from "../sdk/errors/classes.js";
import { callerHarnessSchema } from "./caller-guidance.js";
import { readTextFile, writeTextFile } from "./fs-utils";

export const RUN_CONFIG_FILE_NAME = "impl-run.config.json";

export class ConfigLoadError extends InvalidRunConfigError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, undefined, options);
		this.name = "ConfigLoadError";
	}
}

export const reasoningEffortSchema = z.enum([
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);
export const MIN_SELF_REVIEW_PASSES = 1;
export const MAX_SELF_REVIEW_PASSES = 5;
export const primaryHarnessSchema = z.literal("claude-code");
export const secondaryHarnessSchema = z.enum(["codex", "none"]);

export const roleAssignmentSchema = z
	.object({
		secondary_harness: secondaryHarnessSchema,
		model: z.string().min(1),
		reasoning_effort: reasoningEffortSchema,
	})
	.strict();

export const epicVerifierAssignmentSchema = roleAssignmentSchema
	.extend({
		label: z.string().min(1),
	})
	.strict();

export const callerHarnessConfigRecordSchema = z
	.object({
		harness: callerHarnessSchema,
		primitive_heartbeat_cadence_minutes: z.number().int().positive().optional(),
		story_heartbeat_cadence_minutes: z.number().int().positive().optional(),
	})
	.strict();

export const verificationGatesConfigSchema = z
	.object({
		story: z.string().min(1),
		epic: z.string().min(1),
	})
	.strict();

export const runTimeoutsSchema = z
	.object({
		provider_startup_timeout_ms: z.number().int().positive(),
		story_lead_planner_ms: z.number().int().positive(),
		story_orchestrate_ms: z.number().int().positive(),
		story_implementor_ms: z.number().int().positive(),
		story_implementor_silence_timeout_ms: z.number().int().positive(),
		story_verifier_ms: z.number().int().positive(),
		story_verifier_silence_timeout_ms: z.number().int().positive(),
		epic_fixer_ms: z.number().int().positive(),
		epic_fixer_silence_timeout_ms: z.number().int().positive(),
		epic_reviewer_ms: z.number().int().positive(),
		epic_reviewer_silence_timeout_ms: z.number().int().positive(),
		epic_reverifier_ms: z.number().int().positive(),
		epic_reverifier_silence_timeout_ms: z.number().int().positive(),
		quick_fixer_ms: z.number().int().positive(),
		quick_fixer_silence_timeout_ms: z.number().int().positive(),
		story_self_review_silence_timeout_ms: z.number().int().positive(),
	})
	.partial()
	.strict();

export const DEFAULT_RUN_TIMEOUTS = {
	provider_startup_timeout_ms: 300_000,
	story_lead_planner_ms: 600_000,
	story_orchestrate_ms: 7_200_000,
	story_implementor_ms: 7_200_000,
	story_implementor_silence_timeout_ms: 600_000,
	story_verifier_ms: 3_600_000,
	story_verifier_silence_timeout_ms: 360_000,
	epic_fixer_ms: 3_600_000,
	epic_fixer_silence_timeout_ms: 480_000,
	epic_reviewer_ms: 3_600_000,
	epic_reviewer_silence_timeout_ms: 600_000,
	epic_reverifier_ms: 3_600_000,
	epic_reverifier_silence_timeout_ms: 600_000,
	quick_fixer_ms: 1_800_000,
	quick_fixer_silence_timeout_ms: 300_000,
	story_self_review_silence_timeout_ms: 480_000,
} as const;

const EXPLICIT_CLAUDE_MAX_MODEL_PATTERN =
	/^claude-(?:opus|sonnet)-4-(?:6|7)(?:[a-z0-9.-]*)?(?:\[[^\]]+\])?$/i;

function validateRoleEffort(
	value: z.infer<typeof roleAssignmentSchema>,
	path: ReadonlyArray<string | number>,
	ctx: z.RefinementCtx,
) {
	if (value.reasoning_effort !== "max") {
		return;
	}

	if (value.secondary_harness !== "none") {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"reasoning_effort 'max' is valid only for Claude-backed roles using explicit Claude 4.7/4.6 model names",
			path: [...path, "reasoning_effort"],
		});
		return;
	}

	if (!EXPLICIT_CLAUDE_MAX_MODEL_PATTERN.test(value.model)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"reasoning_effort 'max' requires an explicit Claude 4.7/4.6 model name (for example claude-opus-4-7[1m] or claude-sonnet-4-6[1m])",
			path: [...path, "reasoning_effort"],
		});
	}
}

const implRunConfigCanonicalSchema = z
	.object({
		version: z.literal(1),
		primary_harness: primaryHarnessSchema,
		story_implementor: roleAssignmentSchema,
		story_lead_provider: roleAssignmentSchema.optional(),
		quick_fixer: roleAssignmentSchema,
		story_verifier: roleAssignmentSchema,
		self_review: z
			.object({
				passes: z
					.number()
					.int()
					.min(MIN_SELF_REVIEW_PASSES)
					.max(MAX_SELF_REVIEW_PASSES),
			})
			.strict(),
		epic_verifiers: z.array(epicVerifierAssignmentSchema).min(1),
		epic_reverifier: roleAssignmentSchema,
		caller_harness: callerHarnessConfigRecordSchema.optional(),
		verification_gates: verificationGatesConfigSchema.optional(),
		timeouts: runTimeoutsSchema.optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.story_lead_provider) {
			validateRoleEffort(
				value.story_lead_provider,
				["story_lead_provider"],
				ctx,
			);
		}
		validateRoleEffort(value.story_implementor, ["story_implementor"], ctx);
		validateRoleEffort(value.quick_fixer, ["quick_fixer"], ctx);
		validateRoleEffort(value.story_verifier, ["story_verifier"], ctx);
		validateRoleEffort(value.epic_reverifier, ["epic_reverifier"], ctx);

		const seenLabels = new Set<string>();
		for (const [index, verifier] of value.epic_verifiers.entries()) {
			if (seenLabels.has(verifier.label)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Duplicate epic reviewer label",
					path: ["epic_verifiers", index, "label"],
				});
			}
			seenLabels.add(verifier.label);
			validateRoleEffort(verifier, ["epic_verifiers", index], ctx);
		}
	});

export const implRunConfigSchema = z
	.object({
		version: z.literal(1),
		primary_harness: primaryHarnessSchema,
		story_implementor: roleAssignmentSchema,
		story_lead_provider: roleAssignmentSchema.optional(),
		story_lead: roleAssignmentSchema.optional(),
		quick_fixer: roleAssignmentSchema,
		story_verifier: roleAssignmentSchema,
		self_review: z
			.object({
				passes: z
					.number()
					.int()
					.min(MIN_SELF_REVIEW_PASSES)
					.max(MAX_SELF_REVIEW_PASSES),
			})
			.strict(),
		epic_verifiers: z.array(epicVerifierAssignmentSchema).min(1),
		epic_reverifier: roleAssignmentSchema,
		caller_harness: callerHarnessConfigRecordSchema.optional(),
		verification_gates: verificationGatesConfigSchema.optional(),
		timeouts: runTimeoutsSchema.optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.story_lead) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "story_lead is no longer supported; use story_lead_provider",
				path: ["story_lead"],
			});
		}
	})
	.pipe(implRunConfigCanonicalSchema);

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type PrimaryHarness = z.infer<typeof primaryHarnessSchema>;
export type SecondaryHarness = z.infer<typeof secondaryHarnessSchema>;
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;
export type EpicVerifierAssignment = z.infer<
	typeof epicVerifierAssignmentSchema
>;
export type CallerHarnessConfigRecord = z.infer<
	typeof callerHarnessConfigRecordSchema
>;
export type VerificationGatesConfig = z.infer<
	typeof verificationGatesConfigSchema
>;
export type RunTimeouts = z.infer<typeof runTimeoutsSchema>;
export type ImplRunConfig = z.infer<typeof implRunConfigSchema>;
export type ResolvedRunTimeouts = {
	[K in keyof typeof DEFAULT_RUN_TIMEOUTS]: number;
};

export function resolveRunConfigPath(
	specPackRoot: string,
	configPath?: string,
): string {
	if (!configPath) {
		return resolve(specPackRoot, RUN_CONFIG_FILE_NAME);
	}

	return resolve(specPackRoot, configPath);
}

export function mergeVerificationGates(
	config: ImplRunConfig,
	verificationGates: {
		storyGate: string;
		epicGate: string;
	},
): ImplRunConfig {
	return {
		...config,
		verification_gates: {
			story: verificationGates.storyGate,
			epic: verificationGates.epicGate,
		},
	};
}

export function resolveConfiguredVerificationGates(config: ImplRunConfig):
	| {
			storyGate: string;
			epicGate: string;
			storyGateSource: string;
			epicGateSource: string;
	  }
	| undefined {
	if (!config.verification_gates) {
		return undefined;
	}

	return {
		storyGate: config.verification_gates.story,
		epicGate: config.verification_gates.epic,
		storyGateSource: "impl-run.config.json verification_gates",
		epicGateSource: "impl-run.config.json verification_gates",
	};
}

export function resolveRunTimeouts(config: ImplRunConfig): ResolvedRunTimeouts {
	return {
		...DEFAULT_RUN_TIMEOUTS,
		...(config.timeouts ?? {}),
	};
}

export function requireStoryLeadProviderConfig(input: {
	specPackRoot: string;
	configPath?: string;
	config: ImplRunConfig | undefined;
}): ImplRunConfig & { story_lead_provider: RoleAssignment } {
	const resolvedPath = resolveRunConfigPath(
		input.specPackRoot,
		input.configPath,
	);

	if (!input.config?.story_lead_provider) {
		throw new ConfigLoadError(
			`Run-config validation failed for ${resolvedPath}: story-orchestrate requires explicit story_lead_provider`,
		);
	}

	return input.config as ImplRunConfig & {
		story_lead_provider: RoleAssignment;
	};
}

function formatConfigLoadError(error: unknown, resolvedPath: string): string {
	if (error instanceof z.ZodError) {
		const issues = error.issues
			.map((issue) => {
				const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
				return `${path}: ${issue.message}`;
			})
			.join("; ");
		return `Run-config validation failed for ${resolvedPath}: ${issues}`;
	}

	if (error instanceof Error) {
		return `Run-config load failed for ${resolvedPath}: ${error.message}`;
	}

	return `Run-config load failed for ${resolvedPath}: ${String(error)}`;
}

export async function loadRunConfig(input: {
	specPackRoot: string;
	configPath?: string;
}): Promise<ImplRunConfig> {
	const resolvedPath = resolveRunConfigPath(
		input.specPackRoot,
		input.configPath,
	);
	try {
		return implRunConfigSchema.parse(
			JSON.parse(await readTextFile(resolvedPath)) as unknown,
		);
	} catch (error) {
		throw new ConfigLoadError(formatConfigLoadError(error, resolvedPath), {
			cause: error,
		});
	}
}

export async function writeRunConfig(input: {
	specPackRoot: string;
	configPath?: string;
	config: ImplRunConfig;
}): Promise<string> {
	const resolvedPath = resolveRunConfigPath(
		input.specPackRoot,
		input.configPath,
	);
	await writeTextFile(
		resolvedPath,
		`${JSON.stringify(input.config, null, 2)}\n`,
	);
	return resolvedPath;
}
