import { defineCommand } from "citty";

import {
	type CliResultEnvelope,
	type StorySelfReviewPayload,
	storySelfReview,
} from "../../sdk/index.js";
import {
	createCommandErrorEnvelope,
	emitCommandEnvelope,
	emitPersistedCommandEnvelope,
	providerHeartbeatArgs,
	rejectUnknownCommandArgs,
	resolveCommandArtifactPath,
	resolvePrimitiveHeartbeatCliOptions,
} from "./shared.js";

function parsePasses(value: unknown): number {
	if (typeof value === "undefined") {
		return Number.NaN;
	}

	if (typeof value !== "string" || value.trim().length === 0) {
		return Number.NaN;
	}

	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function renderHumanSummary(
	envelope: CliResultEnvelope<StorySelfReviewPayload>,
): string {
	return envelope.result
		? [
				`${envelope.command}: ${envelope.outcome}`,
				`story: ${envelope.result.story.id}`,
				`session: ${envelope.result.sessionId}`,
				`passes: ${envelope.result.passesCompleted}/${envelope.result.passesRequested}`,
			].join("\n")
		: `${envelope.command}: ${envelope.outcome}`;
}

export default defineCommand({
	meta: {
		name: "story-self-review",
		description:
			"Run same-session self-review passes against an explicit retained implementor session.",
	},
	args: {
		"spec-pack-root": {
			type: "string",
			description: "Absolute or relative path to the spec-pack root",
			required: true,
		},
		"story-id": {
			type: "string",
			description: "The story id whose retained session should self-review",
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
		passes: {
			type: "string",
			description: "Optional self-review pass override",
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

		try {
			rejectUnknownCommandArgs(rawArgs, cmd.args);
			const envelope = await storySelfReview({
				specPackRoot: args["spec-pack-root"],
				storyId: args["story-id"],
				continuationHandle: {
					provider: args.provider as "claude-code" | "codex",
					sessionId: args["session-id"],
					storyId: args["story-id"],
				},
				passes: parsePasses(args.passes),
				passArtifactPaths: [],
				configPath: args.config,
				...resolvePrimitiveHeartbeatCliOptions(args),
			});
			emitCommandEnvelope({
				envelope,
				json,
				renderHumanSummary,
			});
		} catch (error) {
			const artifactPath = await resolveCommandArtifactPath({
				specPackRoot: args["spec-pack-root"],
				command: "story-self-review",
				group: args["story-id"],
				fileName: "self-review-batch",
			});
			await emitPersistedCommandEnvelope({
				artifactPath,
				envelope: createCommandErrorEnvelope({
					command: "story-self-review",
					artifactPath,
					startedAt,
					error,
				}),
				json,
			});
		}
	},
});
