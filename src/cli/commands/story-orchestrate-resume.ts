import { readFile } from "node:fs/promises";

import { defineCommand } from "citty";

import {
	type CliResultEnvelope,
	type CallerRulingResponse,
	type ImplLeadReviewRequest,
	type StoryOrchestrateResumeResult,
	callerRulingResponseSchema,
	implLeadReviewRequestSchema,
	storyOrchestrateResume,
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

function renderResumeSummary(
	envelope: CliResultEnvelope<StoryOrchestrateResumeResult>,
): string {
	const storyRunId =
		envelope.result && "storyRunId" in envelope.result
			? envelope.result.storyRunId
			: undefined;
	return storyRunId
		? `${envelope.command}: ${envelope.outcome}\nstory-run: ${storyRunId}`
		: `${envelope.command}: ${envelope.outcome}`;
}

async function parseJsonFile<T>(input: {
	path: string;
	schema: { parse(value: unknown): T };
}): Promise<T> {
	return input.schema.parse(
		JSON.parse(await readFile(input.path, "utf8")) as unknown,
	);
}

function buildInvalidResumeEnvelope(input: {
	command: string;
	artifactPath: string;
	startedAt: string;
	outcome: "invalid-review-request" | "invalid-ruling";
	storyId: string;
	error: unknown;
}) {
	return {
		command: input.command,
		version: 1 as const,
		status: "error" as const,
		outcome: input.outcome,
		result:
			input.outcome === "invalid-review-request"
				? ({
						case: "invalid-review-request",
						storyId: input.storyId,
					} as const)
				: ({
						case: "invalid-ruling",
						storyId: input.storyId,
					} as const),
		errors: [
			{
				code: input.outcome.toUpperCase().replace(/-/g, "_"),
				message:
					input.error instanceof Error
						? input.error.message
						: String(input.error),
			},
		],
		warnings: [],
		artifacts: [
			{
				kind: "result-envelope",
				path: input.artifactPath,
			},
		],
		startedAt: input.startedAt,
		finishedAt: new Date().toISOString(),
	};
}

export default defineCommand({
	meta: {
		name: "resume",
		description:
			"Resume or reopen one story in the composed story-lead loop from durable state.",
	},
	args: {
		...storyOrchestrateSharedArgs,
		"story-run-id": {
			type: "string",
			description: "Optional durable story-run id to resume explicitly",
		},
		"review-request-file": {
			type: "string",
			description:
				"Resume-only JSON file parsed into an impl-lead review request",
		},
		"ruling-file": {
			type: "string",
			description: "Resume-only JSON file parsed into a caller ruling response",
		},
		...providerHeartbeatArgs,
	},
	async run({ args, rawArgs, cmd }) {
		const json = Boolean(args.json);
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveCommandArtifactPath({
			specPackRoot: args["spec-pack-root"],
			command: "story-orchestrate-resume",
			group: args["story-id"],
			fileName: "story-orchestrate-resume",
		});

		try {
			rejectUnknownCommandArgs(rawArgs, cmd.args);
			let reviewRequest: ImplLeadReviewRequest | undefined;
			let ruling: CallerRulingResponse | undefined;

			if (typeof args["review-request-file"] === "string") {
				try {
					reviewRequest = await parseJsonFile({
						path: args["review-request-file"],
						schema: implLeadReviewRequestSchema,
					});
				} catch (error) {
					await emitPersistedCommandEnvelope({
						artifactPath,
						envelope: buildInvalidResumeEnvelope({
							command: "story-orchestrate resume",
							artifactPath,
							startedAt,
							outcome: "invalid-review-request",
							storyId: args["story-id"],
							error,
						}),
						json,
					});
					return;
				}
			}

			if (typeof args["ruling-file"] === "string") {
				try {
					ruling = await parseJsonFile({
						path: args["ruling-file"],
						schema: callerRulingResponseSchema,
					});
				} catch (error) {
					await emitPersistedCommandEnvelope({
						artifactPath,
						envelope: buildInvalidResumeEnvelope({
							command: "story-orchestrate resume",
							artifactPath,
							startedAt,
							outcome: "invalid-ruling",
							storyId: args["story-id"],
							error,
						}),
						json,
					});
					return;
				}
			}

			const envelope = await storyOrchestrateResume({
				specPackRoot: args["spec-pack-root"],
				storyId: args["story-id"],
				storyRunId: args["story-run-id"],
				configPath: args.config,
				reviewRequest,
				ruling,
				artifactPath,
				...resolvePrimitiveHeartbeatCliOptions(args),
			});
			emitCommandEnvelope({
				envelope,
				json,
				renderHumanSummary: renderResumeSummary,
			});
		} catch (error) {
			await emitPersistedCommandEnvelope({
				artifactPath,
				envelope: createCommandErrorEnvelope({
					command: "story-orchestrate resume",
					artifactPath,
					startedAt,
					error,
				}),
				json,
			});
		}
	},
});
