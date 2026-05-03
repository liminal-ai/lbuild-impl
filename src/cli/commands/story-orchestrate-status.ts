import { defineCommand } from "citty";

import {
	type CliResultEnvelope,
	type StoryOrchestrateStatusResult,
	storyOrchestrateStatus,
} from "../../sdk/index.js";
import {
	createCommandErrorEnvelope,
	emitCommandEnvelope,
	emitPersistedCommandEnvelope,
	rejectUnknownCommandArgs,
	resolveCommandArtifactPath,
	storyOrchestrateSharedArgs,
} from "./shared.js";

function renderStatusSummary(
	envelope: CliResultEnvelope<StoryOrchestrateStatusResult>,
): string {
	if (envelope.result?.case === "single-attempt") {
		return [
			`${envelope.command}: ${envelope.outcome}`,
			`story-run: ${envelope.result.storyRunId}`,
			`lifecycle-state: ${envelope.result.lifecycleState}`,
			`status: ${envelope.result.currentStatus}`,
			...(envelope.result.terminalResult
				? [`terminal-result: ${envelope.result.terminalResult}`]
				: []),
			...(envelope.result.latestEvent
				? [
						`latest-event: ${envelope.result.latestEvent.type} - ${envelope.result.latestEvent.summary}`,
					]
				: []),
			...(envelope.result.latestChildOperation
				? [
						`latest-child-operation: ${envelope.result.latestChildOperation.command}`,
					]
				: []),
			`runtime-version: ${envelope.result.runtimeIdentity.version}`,
			`invocation-source: ${envelope.result.runtimeIdentity.invocationSource}`,
			...(envelope.result.runtimeIdentity.entryPath
				? [`entry-path: ${envelope.result.runtimeIdentity.entryPath}`]
				: []),
			`status-artifact: ${envelope.result.statusArtifactPath}`,
			`elapsed: ${envelope.result.elapsedTime}`,
			...(envelope.result.finalPackagePath
				? [`final-package: ${envelope.result.finalPackagePath}`]
				: []),
		].join("\n");
	}

	return `${envelope.command}: ${envelope.outcome}`;
}

export default defineCommand({
	meta: {
		name: "status",
		description:
			"Read durable status for one story in the composed story-lead loop.",
	},
	args: {
		...storyOrchestrateSharedArgs,
		"story-run-id": {
			type: "string",
			description: "Optional durable story-run id to inspect explicitly",
		},
	},
	async run({ args, rawArgs, cmd }) {
		const json = Boolean(args.json);
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveCommandArtifactPath({
			specPackRoot: args["spec-pack-root"],
			command: "story-orchestrate-status",
			group: args["story-id"],
			fileName: "story-orchestrate-status",
		});

		try {
			rejectUnknownCommandArgs(rawArgs, cmd.args);
			const envelope = await storyOrchestrateStatus({
				specPackRoot: args["spec-pack-root"],
				storyId: args["story-id"],
				storyRunId: args["story-run-id"],
				configPath: args.config,
				artifactPath,
			});
			emitCommandEnvelope({
				envelope,
				json,
				renderHumanSummary: renderStatusSummary,
			});
		} catch (error) {
			await emitPersistedCommandEnvelope({
				artifactPath,
				envelope: createCommandErrorEnvelope({
					command: "story-orchestrate status",
					artifactPath,
					startedAt,
					error,
				}),
				json,
			});
		}
	},
});
