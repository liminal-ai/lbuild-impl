import { defineCommand } from "citty";

import {
	type CliResultEnvelope,
	type EpicFixPayload,
	epicFix,
} from "../../sdk/index.js";
import {
	createCommandErrorEnvelope,
	emitCommandEnvelope,
	emitPersistedCommandEnvelope,
	providerHeartbeatArgs,
	rejectUnknownCommandArgs,
	resolvePrimitiveHeartbeatCliOptions,
	resolveProviderArtifactOptions,
} from "./shared.js";

function renderHumanSummary(
	envelope: CliResultEnvelope<EpicFixPayload>,
): string {
	return envelope.result
		? [
				`${envelope.command}: ${envelope.outcome}`,
				`fix-batch: ${envelope.result.fixBatchPath}`,
				`files-changed: ${envelope.result.filesChanged.length}`,
			].join("\n")
		: `${envelope.command}: ${envelope.outcome}`;
}

export default defineCommand({
	meta: {
		name: "epic-fix",
		description: "Apply one fix-only pass from a curated epic fix batch.",
	},
	args: {
		"spec-pack-root": {
			type: "string",
			description: "Absolute or relative path to the spec-pack root",
			required: true,
		},
		"fix-batch": {
			type: "string",
			description: "Path to the curated fix batch artifact",
			required: true,
		},
		provider: {
			type: "string",
			description: "Provider from the prior epic-fix continuation handle",
		},
		"session-id": {
			type: "string",
			description: "Session id from the prior epic-fix continuation handle",
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
			command: "epic-fix",
			group: "fix",
			fileName: "fix-result",
		});

		try {
			rejectUnknownCommandArgs(rawArgs, cmd.args);
			const envelope = await epicFix({
				specPackRoot: args["spec-pack-root"],
				fixBatchPath: args["fix-batch"],
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
					command: "epic-fix",
					artifactPath: artifactOptions.artifactPath,
					startedAt,
					error,
				}),
				json,
			});
		}
	},
});
