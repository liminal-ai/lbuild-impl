import { readFile } from "node:fs/promises";

import { defineCommand } from "citty";

import {
	type CliResultEnvelope,
	type StoryVerifyPayload,
	storyVerify,
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
	envelope: CliResultEnvelope<StoryVerifyPayload>,
): string {
	return envelope.result
		? [
				`${envelope.command}: ${envelope.outcome}`,
				`story: ${envelope.result.story.id}`,
				`mode: ${envelope.result.mode}`,
				`session: ${envelope.result.sessionId}`,
			].join("\n")
		: `${envelope.command}: ${envelope.outcome}`;
}

export default defineCommand({
	meta: {
		name: "story-verify",
		description:
			"Start or continue the retained story verifier session for one story.",
	},
	args: {
		"spec-pack-root": {
			type: "string",
			description: "Absolute or relative path to the spec-pack root",
			required: true,
		},
		"story-id": {
			type: "string",
			description: "The story id to verify",
			required: true,
		},
		provider: {
			type: "string",
			description:
				"Provider name from the retained verifier continuation handle",
		},
		"session-id": {
			type: "string",
			description:
				"Explicit session id from the retained verifier continuation handle",
		},
		"response-file": {
			type: "string",
			description:
				"Path to a file containing the full implementor response for verifier follow-up",
		},
		"response-text": {
			type: "string",
			description: "Inline implementor response text for verifier follow-up",
		},
		"orchestrator-context-file": {
			type: "string",
			description: "Path to optional orchestrator framing for the verifier",
		},
		"orchestrator-context-text": {
			type: "string",
			description: "Inline optional orchestrator framing for the verifier",
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
			command: "story-verify",
			group: args["story-id"],
			fileName: "verify",
		});
		try {
			rejectUnknownCommandArgs(rawArgs, cmd.args);
			const isFollowupMode =
				typeof args.provider === "string" ||
				typeof args["session-id"] === "string";
			const hasResponseFile = typeof args["response-file"] === "string";
			const hasResponseText = typeof args["response-text"] === "string";
			const hasOrchestratorContextFile =
				typeof args["orchestrator-context-file"] === "string";
			const hasOrchestratorContextText =
				typeof args["orchestrator-context-text"] === "string";

			if (!isFollowupMode && (hasResponseFile || hasResponseText)) {
				await emitPersistedCommandEnvelope({
					artifactPath: artifactOptions.artifactPath,
					envelope: createInvalidInvocationEnvelope({
						command: "story-verify",
						artifactPath: artifactOptions.artifactPath,
						startedAt,
						message:
							"Initial story-verify mode does not accept --response-file or --response-text.",
					}),
					json,
				});
				return;
			}

			if (isFollowupMode) {
				if (
					typeof args.provider !== "string" ||
					typeof args["session-id"] !== "string"
				) {
					await emitPersistedCommandEnvelope({
						artifactPath: artifactOptions.artifactPath,
						envelope: createInvalidInvocationEnvelope({
							command: "story-verify",
							artifactPath: artifactOptions.artifactPath,
							startedAt,
							message:
								"Follow-up story-verify mode requires both --provider and --session-id.",
						}),
						json,
					});
					return;
				}

				if ((hasResponseFile ? 1 : 0) + (hasResponseText ? 1 : 0) !== 1) {
					await emitPersistedCommandEnvelope({
						artifactPath: artifactOptions.artifactPath,
						envelope: createInvalidInvocationEnvelope({
							command: "story-verify",
							artifactPath: artifactOptions.artifactPath,
							startedAt,
							message:
								"Follow-up story-verify mode requires exactly one of --response-file or --response-text.",
						}),
						json,
					});
					return;
				}
			}

			if (
				(hasOrchestratorContextFile ? 1 : 0) +
					(hasOrchestratorContextText ? 1 : 0) >
				1
			) {
				await emitPersistedCommandEnvelope({
					artifactPath: artifactOptions.artifactPath,
					envelope: createInvalidInvocationEnvelope({
						command: "story-verify",
						artifactPath: artifactOptions.artifactPath,
						startedAt,
						message:
							"Provide at most one of --orchestrator-context-file or --orchestrator-context-text.",
					}),
					json,
				});
				return;
			}

			const response = isFollowupMode
				? hasResponseFile
					? await readFile(args["response-file"] as string, "utf8")
					: (args["response-text"] as string)
				: undefined;
			const orchestratorContext = hasOrchestratorContextFile
				? await readFile(args["orchestrator-context-file"] as string, "utf8")
				: typeof args["orchestrator-context-text"] === "string"
					? args["orchestrator-context-text"]
					: undefined;
			const envelope = await storyVerify({
				specPackRoot: args["spec-pack-root"],
				storyId: args["story-id"],
				provider:
					typeof args.provider === "string"
						? (args.provider as "claude-code" | "codex")
						: undefined,
				sessionId: args["session-id"],
				response,
				orchestratorContext,
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
					command: "story-verify",
					artifactPath: artifactOptions.artifactPath,
					startedAt,
					error,
					blockedOutcome: "block",
				}),
				json,
			});
		}
	},
});
