import {
	buildRuntimeProgressPaths,
	buildStreamOutputPaths,
	nextArtifactPath,
	nextGroupedArtifactPath,
	writeJsonArtifact,
} from "../../core/artifact-writer.js";
import { classifyCommandError } from "../../core/command-errors.js";
import {
	type CliError,
	createResultEnvelope,
} from "../../core/result-contracts.js";
import type { CliResultEnvelope } from "../../sdk/contracts/envelope.js";
import type {
	AttachedProgressEvent,
	CallerHarness,
} from "../../sdk/contracts/operations.js";
import { InvalidInputError } from "../../sdk/errors/classes.js";
import { mapStatusToExitCode, renderDefaultHumanSummary } from "../envelope.js";
import { writeAttachedProgress, writeHuman, writeJson } from "../output.js";

export { resolveCallerHeartbeatOptions } from "../../core/heartbeat.js";

export const providerHeartbeatArgs = {
	heartbeat: {
		type: "boolean",
		description:
			"Enable attached heartbeat output; use --no-heartbeat to disable",
	},
	"caller-harness": {
		type: "string",
		description: "Caller host reading attached heartbeat output",
	},
	"heartbeat-cadence-minutes": {
		type: "string",
		description: "Override the primitive heartbeat cadence in minutes",
	},
	"disable-heartbeats": {
		type: "boolean",
		description: "Disable attached heartbeat output for this invocation",
	},
} as const;

export const storyOrchestrateSharedArgs = {
	"spec-pack-root": {
		type: "string",
		description: "Absolute or relative path to the spec-pack root",
		required: true,
	},
	"story-id": {
		type: "string",
		description: "The stable story id to orchestrate",
		required: true,
	},
	config: {
		type: "string",
		description:
			"Explicit run-config file relative to the spec-pack root; story-orchestrate requires story_lead_provider",
	},
	json: {
		type: "boolean",
		description: "Emit the structured JSON envelope on stdout",
	},
} as const;

export interface ProviderArtifactOptions {
	artifactPath: string;
	runtimeProgressPaths: {
		statusPath: string;
		progressPath: string;
	};
	streamOutputPaths: {
		stdoutPath: string;
		stderrPath: string;
	};
}

type CommandArgsDef = Record<
	string,
	{
		type?: string;
		alias?: string | string[];
	}
>;

function toArray(value: string | string[] | undefined): string[] {
	if (Array.isArray(value)) {
		return value;
	}
	return value ? [value] : [];
}

function toCamelCase(value: string): string {
	return value.replace(/-([a-zA-Z0-9])/g, (_, char: string) =>
		char.toUpperCase(),
	);
}

function knownFlags(argsDef: CommandArgsDef): Map<string, string | undefined> {
	const flags = new Map<string, string | undefined>();

	for (const [name, definition] of Object.entries(argsDef)) {
		if (definition.type === "positional") {
			continue;
		}
		const names = new Set([
			name,
			toCamelCase(name),
			...toArray(definition.alias),
		]);
		for (const flagName of names) {
			flags.set(flagName, definition.type);
		}
	}

	return flags;
}

export function rejectUnknownCommandArgs(
	rawArgs: string[],
	argsDef: unknown,
): void {
	if (!argsDef || typeof argsDef !== "object" || Array.isArray(argsDef)) {
		return;
	}

	const flags = knownFlags(argsDef as CommandArgsDef);

	for (let index = 0; index < rawArgs.length; index += 1) {
		const rawArg = rawArgs[index] as string;

		if (rawArg === "--") {
			const positional = rawArgs[index + 1];
			if (positional) {
				throw new InvalidInputError(
					`Unexpected positional argument: ${positional}`,
				);
			}
			return;
		}

		if (rawArg.startsWith("--no-")) {
			const flagName = rawArg.slice("--no-".length);
			if (flags.get(flagName) !== "boolean") {
				throw new InvalidInputError(`Unknown option: --no-${flagName}`);
			}
			continue;
		}

		if (rawArg.startsWith("--")) {
			const [flagName] = rawArg.slice("--".length).split("=", 1);
			const flagType = flagName ? flags.get(flagName) : undefined;
			if (!flagName || !flagType) {
				throw new InvalidInputError(`Unknown option: --${flagName ?? ""}`);
			}
			if (flagType !== "boolean" && !rawArg.includes("=")) {
				index += 1;
			}
			continue;
		}

		if (rawArg.startsWith("-")) {
			const flagName = rawArg.slice("-".length);
			if (flags.get(flagName) !== "boolean") {
				throw new InvalidInputError(`Unknown option: -${flagName}`);
			}
			continue;
		}

		throw new InvalidInputError(`Unexpected positional argument: ${rawArg}`);
	}
}

function parsePositiveInteger(
	value: unknown,
	flagName: string,
): number | undefined {
	if (typeof value === "undefined") {
		return undefined;
	}

	if (typeof value !== "string" || value.trim().length === 0) {
		throw new InvalidInputError(`${flagName} must be a positive integer.`);
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new InvalidInputError(`${flagName} must be a positive integer.`);
	}

	return parsed;
}

export function resolvePrimitiveHeartbeatCliOptions(args: {
	heartbeat?: boolean;
	"caller-harness"?: string;
	"heartbeat-cadence-minutes"?: string;
	"disable-heartbeats"?: boolean;
}): {
	callerHarness?: CallerHarness;
	heartbeatCadenceMinutes?: number;
	disableHeartbeats?: boolean;
	progressListener: (event: AttachedProgressEvent) => void;
} {
	return {
		callerHarness: args["caller-harness"] as CallerHarness | undefined,
		heartbeatCadenceMinutes: parsePositiveInteger(
			args["heartbeat-cadence-minutes"],
			"--heartbeat-cadence-minutes",
		),
		disableHeartbeats:
			args["disable-heartbeats"] === true || args.heartbeat === false,
		progressListener: (event) => {
			writeAttachedProgress(event);
		},
	};
}

export async function resolveCommandArtifactPath(input: {
	specPackRoot: string;
	command: string;
	group?: string;
	fileName?: string;
}): Promise<string> {
	if (input.group && input.fileName) {
		return await nextGroupedArtifactPath(
			input.specPackRoot,
			input.group,
			input.fileName,
		);
	}

	return await nextArtifactPath(input.specPackRoot, input.command);
}

export async function resolveProviderArtifactOptions(input: {
	specPackRoot: string;
	command: string;
	group?: string;
	fileName?: string;
}): Promise<ProviderArtifactOptions> {
	const artifactPath = await resolveCommandArtifactPath(input);
	return {
		artifactPath,
		streamOutputPaths: buildStreamOutputPaths(artifactPath),
		runtimeProgressPaths: buildRuntimeProgressPaths(artifactPath),
	};
}

export function emitCommandEnvelope<TResult>(input: {
	envelope: CliResultEnvelope<TResult>;
	json: boolean;
	renderHumanSummary?: (envelope: CliResultEnvelope<TResult>) => string;
}): void {
	if (input.json) {
		writeJson(input.envelope);
	} else {
		writeHuman(
			input.renderHumanSummary?.(input.envelope) ??
				renderDefaultHumanSummary(input.envelope),
		);
	}

	process.exitCode = mapStatusToExitCode(input.envelope.status);
}

export async function emitPersistedCommandEnvelope<TResult>(input: {
	artifactPath: string;
	envelope: CliResultEnvelope<TResult>;
	json: boolean;
	renderHumanSummary?: (envelope: CliResultEnvelope<TResult>) => string;
}): Promise<void> {
	await writeJsonArtifact(input.artifactPath, input.envelope);
	emitCommandEnvelope(input);
}

export function createInvalidInvocationEnvelope(input: {
	command: string;
	artifactPath: string;
	startedAt: string;
	message: string;
}): CliResultEnvelope<undefined> {
	return createResultEnvelope({
		command: input.command,
		outcome: "error",
		errors: [
			{
				code: "INVALID_INPUT",
				message: input.message,
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

export function createCommandErrorEnvelope(input: {
	command: string;
	artifactPath: string;
	startedAt: string;
	error: unknown;
	blockedOutcome?: "blocked" | "block";
	code?: CliError["code"];
	outcome?: string;
}): CliResultEnvelope<undefined> {
	const classification = classifyCommandError(
		input.error,
		input.blockedOutcome,
	);
	const code = input.code ?? classification.code;
	const outcome = input.outcome ?? classification.outcome;

	return createResultEnvelope({
		command: input.command,
		outcome,
		errors: [
			{
				code,
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
