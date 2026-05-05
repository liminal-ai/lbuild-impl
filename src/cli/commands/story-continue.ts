import { readFile } from "node:fs/promises";

import { defineCommand } from "citty";

import {
	type CliResultEnvelope,
	type StoryContinuePayload,
	storyContinue,
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

function renderHumanSummary(
	envelope: CliResultEnvelope<StoryContinuePayload>,
): string {
	return envelope.result
		? [
				`${envelope.command}: ${envelope.outcome}`,
				`story: ${envelope.result.story.id}`,
				`session: ${envelope.result.sessionId}`,
			].join("\n")
		: `${envelope.command}: ${envelope.outcome}`;
}

export default defineCommand({
	meta: {
		name: "story-continue",
		description:
			"Continue an explicit retained story implementor session with follow-up work.",
	},
	args: {
		"spec-pack-root": {
			type: "string",
			description: "Absolute or relative path to the spec-pack root",
			required: true,
		},
		"story-id": {
			type: "string",
			description: "The story id to continue",
			required: true,
		},
		provider: {
			type: "string",
			description: "Provider name from the continuation handle",
			required: true,
		},
		"session-id": {
			type: "string",
			description: "Explicit session id from the continuation handle",
			required: true,
		},
		config: {
			type: "string",
			description: "Explicit run-config file relative to the spec-pack root",
		},
		"followup-file": {
			type: "string",
			description: "Path to a follow-up prompt file",
		},
		"followup-text": {
			type: "string",
			description: "Inline follow-up request text",
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
			command: "story-continue",
			group: args["story-id"],
			fileName: "continue",
		});

		try {
			rejectUnknownCommandArgs(rawArgs, cmd.args);
			if (
				(!args["followup-file"] && !args["followup-text"]) ||
				(args["followup-file"] && args["followup-text"])
			) {
				await emitPersistedCommandEnvelope({
					artifactPath: artifactOptions.artifactPath,
					envelope: createInvalidInvocationEnvelope({
						command: "story-continue",
						artifactPath: artifactOptions.artifactPath,
						startedAt,
						message:
							"Provide exactly one of --followup-file or --followup-text.",
					}),
					json,
				});
				return;
			}
			const followupRequest = args["followup-file"]
				? await readFile(args["followup-file"], "utf8")
				: (args["followup-text"] as string);
			const envelope = await storyContinue({
				specPackRoot: args["spec-pack-root"],
				storyId: args["story-id"],
				continuationHandle: {
					provider: args.provider as "claude-code" | "codex",
					sessionId: args["session-id"],
					storyId: args["story-id"],
				},
				followupRequest,
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
					command: "story-continue",
					artifactPath: artifactOptions.artifactPath,
					startedAt,
					error,
				}),
				json,
			});
		}
	},
});
