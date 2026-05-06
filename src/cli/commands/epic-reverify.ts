import { defineCommand } from "citty";

import {
	type CliResultEnvelope,
	type EpicReverifyPayload,
	epicReverify,
} from "../../sdk/index.js";
import {
	createCommandErrorEnvelope,
	createInvalidInvocationEnvelope,
	emitCommandEnvelope,
	emitPersistedCommandEnvelope,
	providerHeartbeatArgs,
	rejectUnknownCommandArgs,
	resolvePrimitiveHeartbeatCliOptions,
	resolveProviderArtifactOptions,
} from "./shared.js";

function collectRepeatedFlag(rawArgs: string[], flag: string): string[] {
	const values: string[] = [];

	for (let index = 0; index < rawArgs.length; index += 1) {
		const value = rawArgs[index];
		if (value === flag) {
			const nextValue = rawArgs[index + 1];
			if (nextValue && !nextValue.startsWith("--")) {
				values.push(nextValue);
			}
			continue;
		}

		if (value.startsWith(`${flag}=`)) {
			values.push(value.slice(flag.length + 1));
		}
	}

	return values;
}

function renderHumanSummary(
	envelope: CliResultEnvelope<EpicReverifyPayload>,
): string {
	return envelope.result
		? [
				`${envelope.command}: ${envelope.outcome}`,
				`confirmed: ${envelope.result.confirmedIssues.length}`,
				`disputed: ${envelope.result.disputedOrUnconfirmedIssues.length}`,
			].join("\n")
		: `${envelope.command}: ${envelope.outcome}`;
}

export default defineCommand({
	meta: {
		name: "epic-reverify",
		description: "Continue retained epic reverify against canonical findings.",
	},
	args: {
		"spec-pack-root": {
			type: "string",
			description: "Absolute or relative path to the spec-pack root",
			required: true,
		},
		"review-report": {
			type: "string",
			description:
				"Path to a canonical epic review artifact. Repeat the flag to pass multiple reports.",
		},
		provider: {
			type: "string",
			description: "Provider from the prior epic-reverify continuation handle",
		},
		"session-id": {
			type: "string",
			description:
				"Session id from the prior epic-reverify continuation handle",
		},
		config: {
			type: "string",
			description: "Explicit run-config file relative to the spec-pack root",
		},
		...providerHeartbeatArgs,
		json: {
			type: "boolean",
			description: "Emit the structured JSON envelope on stdout",
		},
	},
	async run({ args, rawArgs, cmd }) {
		const json = Boolean(args.json);
		const startedAt = new Date().toISOString();
		const artifactOptions = await resolveProviderArtifactOptions({
			specPackRoot: args["spec-pack-root"],
			command: "epic-reverify",
			group: "epic",
			fileName: "epic-reverify",
		});
		try {
			rejectUnknownCommandArgs(rawArgs, cmd.args);
			const reviewReportPaths = collectRepeatedFlag(rawArgs, "--review-report");

			if (reviewReportPaths.length === 0) {
				await emitPersistedCommandEnvelope({
					artifactPath: artifactOptions.artifactPath,
					envelope: createInvalidInvocationEnvelope({
						command: "epic-reverify",
						artifactPath: artifactOptions.artifactPath,
						startedAt,
						message: "Provide at least one --review-report path.",
					}),
					json,
				});
				return;
			}

			const envelope = await epicReverify({
				specPackRoot: args["spec-pack-root"],
				reviewReportPaths,
				provider: args.provider as "claude-code" | "codex" | undefined,
				sessionId: args["session-id"],
				configPath: args.config,
				...resolvePrimitiveHeartbeatCliOptions(args),
				artifactPath: artifactOptions.artifactPath,
				streamOutputPaths: artifactOptions.streamOutputPaths,
				runtimeProgressPaths: artifactOptions.runtimeProgressPaths,
			});
			emitCommandEnvelope({
				envelope,
				json,
				renderHumanSummary,
			});
		} catch (error) {
			await emitPersistedCommandEnvelope({
				artifactPath: artifactOptions.artifactPath,
				envelope: createCommandErrorEnvelope({
					command: "epic-reverify",
					artifactPath: artifactOptions.artifactPath,
					startedAt,
					error,
				}),
				json,
			});
		}
	},
});
