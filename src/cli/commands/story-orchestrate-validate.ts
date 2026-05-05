import { defineCommand } from "citty";

import {
	type CliResultEnvelope,
	type StoryOrchestrateValidateResult,
	storyOrchestrateValidate,
} from "../../sdk/index.js";
import {
	createCommandErrorEnvelope,
	emitCommandEnvelope,
	emitPersistedCommandEnvelope,
	rejectUnknownCommandArgs,
	resolveCommandArtifactPath,
	storyOrchestrateSharedArgs,
} from "./shared.js";

function renderValidateSummary(
	envelope: CliResultEnvelope<StoryOrchestrateValidateResult>,
): string {
	if (!envelope.result) {
		return `${envelope.command}: ${envelope.outcome}`;
	}

	return [
		`${envelope.command}: ${envelope.outcome}`,
		`story-id: ${envelope.result.storyId}`,
		`selection: ${envelope.result.storyRunSelection.case}`,
		...(envelope.result.baselineSeed
			? [
					`baseline-before-current-story: ${envelope.result.baselineSeed.baselineBeforeCurrentStory}`,
				]
			: []),
		...envelope.result.blockers.map((blocker) => `blocker: ${blocker}`),
	].join("\n");
}

export default defineCommand({
	meta: {
		name: "validate",
		description:
			"Validate deterministic story-orchestrate readiness and capture pre-story baseline seed data.",
	},
	args: {
		...storyOrchestrateSharedArgs,
	},
	async run({ args, rawArgs, cmd }) {
		const json = Boolean(args.json);
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveCommandArtifactPath({
			specPackRoot: args["spec-pack-root"],
			command: "story-validate",
			group: args["story-id"],
			fileName: "story-validate",
		});

		try {
			rejectUnknownCommandArgs(rawArgs, cmd.args);
			const envelope = await storyOrchestrateValidate({
				specPackRoot: args["spec-pack-root"],
				storyId: args["story-id"],
				configPath: args.config,
				artifactPath,
			});
			emitCommandEnvelope({
				envelope,
				json,
				renderHumanSummary: renderValidateSummary,
			});
		} catch (error) {
			await emitPersistedCommandEnvelope({
				artifactPath,
				envelope: createCommandErrorEnvelope({
					command: "story-orchestrate validate",
					artifactPath,
					startedAt,
					error,
				}),
				json,
			});
		}
	},
});
