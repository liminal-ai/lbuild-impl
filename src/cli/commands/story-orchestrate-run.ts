import { defineCommand } from "citty";

import {
	type CliResultEnvelope,
	type StoryOrchestrateRunResult,
	storyOrchestrateRun,
} from "../../sdk/index.js";
import {
	createCommandErrorEnvelope,
	emitCommandEnvelope,
	emitPersistedCommandEnvelope,
	providerHeartbeatArgs,
	rejectUnknownCommandArgs,
	resolveCommandArtifactPath,
	resolvePrimitiveHeartbeatCliOptions,
	storyOrchestrateSharedArgs,
} from "./shared.js";

function renderRunSummary(
	envelope: CliResultEnvelope<StoryOrchestrateRunResult>,
): string {
	const storyRunId =
		envelope.result && "storyRunId" in envelope.result
			? envelope.result.storyRunId
			: undefined;
	return storyRunId
		? `${envelope.command}: ${envelope.outcome}\nstory-run: ${storyRunId}`
		: `${envelope.command}: ${envelope.outcome}`;
}

export default defineCommand({
	meta: {
		name: "run",
		description:
			"Run one story through the composed story-lead loop after orienting from durable story artifacts.",
	},
	args: {
		...storyOrchestrateSharedArgs,
		...providerHeartbeatArgs,
	},
	async run({ args, rawArgs, cmd }) {
		const json = Boolean(args.json);
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveCommandArtifactPath({
			specPackRoot: args["spec-pack-root"],
			command: "story-orchestrate-run",
			group: args["story-id"],
			fileName: "story-orchestrate-run",
		});

		try {
			rejectUnknownCommandArgs(rawArgs, cmd.args);
			const envelope = await storyOrchestrateRun({
				specPackRoot: args["spec-pack-root"],
				storyId: args["story-id"],
				configPath: args.config,
				artifactPath,
				...resolvePrimitiveHeartbeatCliOptions(args),
			});
			emitCommandEnvelope({
				envelope,
				json,
				renderHumanSummary: renderRunSummary,
			});
		} catch (error) {
			await emitPersistedCommandEnvelope({
				artifactPath,
				envelope: createCommandErrorEnvelope({
					command: "story-orchestrate run",
					artifactPath,
					startedAt,
					error,
				}),
				json,
			});
		}
	},
});
