import { defineCommand } from "citty";

import storyOrchestrateResumeCommand from "./story-orchestrate-resume.js";
import storyOrchestrateRunCommand from "./story-orchestrate-run.js";
import storyOrchestrateStatusCommand from "./story-orchestrate-status.js";

export default defineCommand({
	meta: {
		name: "story-orchestrate",
		description:
			"Run, resume, or inspect one story through the composed story-lead loop.",
	},
	subCommands: {
		run: storyOrchestrateRunCommand,
		resume: storyOrchestrateResumeCommand,
		status: storyOrchestrateStatusCommand,
	},
});
