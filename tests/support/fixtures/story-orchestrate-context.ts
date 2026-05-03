import type {
	StoryLeadStateMachineAction,
	StoryOrchestrateLifecycleState,
	StoryRunPublicStatus,
} from "../../../src/core/story-lead-state-machine.js";

export const storyOrchestrateLifecycleFixture = {
	storyId: "00-foundation",
	storyRunId: "00-foundation-story-run-001",
	lifecycleState: "awaiting_story_lead_action",
	status: "running",
} satisfies {
	storyId: string;
	storyRunId: string;
	lifecycleState: StoryOrchestrateLifecycleState;
	status: StoryRunPublicStatus;
};

export const storyLeadActionFixtures = {
	runImplement: {
		action: "run-implement",
		rationale: "Start the first bounded implementation pass.",
		inputs: {
			promptAddendum: "Focus on the state machine foundation only.",
		},
		selfNote: "First turn should establish the shared vocabulary.",
	},
	runContinue: {
		action: "run-continue",
		rationale: "Resume the retained implementor with focused follow-up.",
		inputs: {
			continuationRef: "implementor:001",
			promptAddendum: "Address the remaining verifier concern only.",
		},
	},
	runSelfReview: {
		action: "run-self-review",
		rationale: "Review the current implementation before verification.",
		inputs: {
			artifactRefs: ["artifacts/00-foundation/001-implementor.json"],
			focus: "Check the new state vocabulary and test plan traceability.",
		},
	},
	runVerify: {
		action: "run-verify",
		rationale: "Run the story verification pass against the current artifacts.",
		inputs: {
			artifactRefs: ["artifacts/00-foundation/002-self-review.json"],
			focus: "Confirm the state machine docs and tests line up.",
		},
	},
	runQuickFix: {
		action: "run-quick-fix",
		rationale: "Apply one bounded correction before rerunning verification.",
		inputs: {
			findingRefs: ["finding-001"],
			remediationGoal: "Tighten the state vocabulary wording.",
		},
	},
	acceptStory: {
		action: "accept-story",
		rationale: "All scoped evidence is ready for impl-lead review.",
		inputs: {
			summary: "Foundation contracts and docs are aligned.",
			acceptanceCheckRefs: ["check-001"],
			recommendedImplLeadAction: "accept",
		},
	},
	requestRuling: {
		action: "request-ruling",
		rationale: "The next step depends on an explicit maintainer decision.",
		inputs: {
			decisionType: "scope-approval",
			question: "Should the runtime migrate old snapshots in this story?",
			defaultRecommendation: "No, keep Story 0 foundation-only.",
			evidence: [
				"docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md",
			],
			allowedResponses: ["approve", "reject"],
		},
	},
	blockStory: {
		action: "block-story",
		rationale: "The story cannot continue until the blocker is resolved.",
		inputs: {
			reason: "Required story-local artifact is missing.",
			evidence: ["artifacts/00-foundation/story-lead/001-current.json"],
		},
	},
	failStory: {
		action: "fail-story",
		rationale: "The runtime hit an unrecoverable error for this attempt.",
		inputs: {
			reason: "Planner output violated the strict action schema.",
			detail: "Unexpected keys were present after action discrimination.",
			evidence: ["provider-output.json"],
		},
	},
} satisfies Record<string, StoryLeadStateMachineAction>;
