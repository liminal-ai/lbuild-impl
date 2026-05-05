import { defineCommand } from "citty";

import storyOrchestrateResumeCommand from "./story-orchestrate-resume.js";
import storyOrchestrateRunCommand from "./story-orchestrate-run.js";
import storyOrchestrateStatusCommand from "./story-orchestrate-status.js";
import storyOrchestrateValidateCommand from "./story-orchestrate-validate.js";

export default defineCommand({
	meta: {
		name: "story-orchestrate",
		description:
			"Run, resume, validate, or inspect one story through the composed story-lead loop.",
	},
	subCommands: {
		run: storyOrchestrateRunCommand,
		resume: storyOrchestrateResumeCommand,
		status: storyOrchestrateStatusCommand,
		validate: storyOrchestrateValidateCommand,
	},
});
