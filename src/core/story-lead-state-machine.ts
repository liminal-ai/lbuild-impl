import { z } from "zod";

export const storyOrchestrateLifecycleStateSchema = z.enum([
	"initialized",
	"awaiting_story_lead_action",
	"running_child_operation",
	"recording_result",
	"terminal",
]);

export const storyRunPublicStatusSchema = z.enum([
	"running",
	"accepted",
	"needs-ruling",
	"blocked",
	"failed",
	"interrupted",
]);

export const storyLeadActionTypeSchema = z.enum([
	"run-implement",
	"run-continue",
	"run-self-review",
	"run-verify",
	"run-quick-fix",
	"accept-story",
	"request-ruling",
	"block-story",
	"fail-story",
]);

export type StoryOrchestrateLifecycleState = z.infer<
	typeof storyOrchestrateLifecycleStateSchema
>;

export type StoryRunPublicStatus = z.infer<typeof storyRunPublicStatusSchema>;
export type StoryLeadActionType = z.infer<typeof storyLeadActionTypeSchema>;

export interface StoryOrchestrateStateDefinition {
	state: StoryOrchestrateLifecycleState;
	publicStatus: Extract<StoryRunPublicStatus, "running"> | null;
	terminalPublicStatuses?: Array<Exclude<StoryRunPublicStatus, "running">>;
	description: string;
	callerImplication: string;
	isTerminal: boolean;
}

export interface StoryRunTerminalStatusDefinition {
	status: Exclude<StoryRunPublicStatus, "running">;
	description: string;
	callerImplication: string;
}

const strictStringArray = () => z.array(z.string().min(1));

export const runImplementInputsSchema = z
	.object({
		promptAddendum: z.string().min(1).optional(),
	})
	.strict();

export const runContinueInputsSchema = z
	.object({
		continuationRef: z.string().min(1),
		promptAddendum: z.string().min(1),
	})
	.strict();

export const runSelfReviewInputsSchema = z
	.object({
		artifactRefs: strictStringArray(),
		focus: z.string().min(1).optional(),
	})
	.strict();

export const runVerifyInputsSchema = z
	.object({
		artifactRefs: strictStringArray(),
		focus: z.string().min(1).optional(),
	})
	.strict();

export const runQuickFixInputsSchema = z
	.object({
		findingRefs: strictStringArray(),
		remediationGoal: z.string().min(1),
	})
	.strict();

export const acceptStoryInputsSchema = z
	.object({
		summary: z.string().min(1),
		acceptanceCheckRefs: strictStringArray(),
		recommendedImplLeadAction: z.enum([
			"accept",
			"reject",
			"reopen",
			"ask-ruling",
		]),
	})
	.strict();

export const requestRulingInputsSchema = z
	.object({
		decisionType: z.string().min(1),
		question: z.string().min(1),
		defaultRecommendation: z.string().min(1),
		evidence: strictStringArray(),
		allowedResponses: strictStringArray().min(1),
	})
	.strict();

export const blockStoryInputsSchema = z
	.object({
		reason: z.string().min(1),
		evidence: strictStringArray(),
	})
	.strict();

export const failStoryInputsSchema = z
	.object({
		reason: z.string().min(1),
		detail: z.string().min(1).optional(),
		evidence: strictStringArray(),
	})
	.strict();

function actionEnvelopeSchema<
	TAction extends StoryLeadActionType,
	TSchema extends z.ZodTypeAny,
>(action: TAction, inputs: TSchema) {
	return z
		.object({
			action: z.literal(action),
			rationale: z.string().min(1),
			inputs,
			selfNote: z.string().min(1).optional(),
		})
		.strict();
}

export const storyLeadStateMachineActionSchema = z.discriminatedUnion(
	"action",
	[
		actionEnvelopeSchema("run-implement", runImplementInputsSchema),
		actionEnvelopeSchema("run-continue", runContinueInputsSchema),
		actionEnvelopeSchema("run-self-review", runSelfReviewInputsSchema),
		actionEnvelopeSchema("run-verify", runVerifyInputsSchema),
		actionEnvelopeSchema("run-quick-fix", runQuickFixInputsSchema),
		actionEnvelopeSchema("accept-story", acceptStoryInputsSchema),
		actionEnvelopeSchema("request-ruling", requestRulingInputsSchema),
		actionEnvelopeSchema("block-story", blockStoryInputsSchema),
		actionEnvelopeSchema("fail-story", failStoryInputsSchema),
	],
);

export type StoryLeadStateMachineAction = z.infer<
	typeof storyLeadStateMachineActionSchema
>;

export const STORY_ORCHESTRATE_STATE_DEFINITIONS = [
	{
		state: "initialized",
		publicStatus: "running",
		description:
			"Runtime scaffolding exists, but no planner turn or child operation has started yet.",
		callerImplication:
			"Treat this as startup bookkeeping only; wait for the first planner transition before routing work.",
		isTerminal: false,
	},
	{
		state: "awaiting_story_lead_action",
		publicStatus: "running",
		description:
			"The durable record is ready and the next fresh story-lead turn may choose one bounded action.",
		callerImplication:
			"Planner output is the next source of truth; the run is waiting for a valid bounded action selection.",
		isTerminal: false,
	},
	{
		state: "running_child_operation",
		publicStatus: "running",
		description:
			"The runtime is executing one bounded child operation selected by the story lead.",
		callerImplication:
			"Poll runtime artifacts instead of rerouting; the current child operation is still in flight.",
		isTerminal: false,
	},
	{
		state: "recording_result",
		publicStatus: "running",
		description:
			"The child result or terminal decision is being written to durable artifacts before the next transition.",
		callerImplication:
			"Do not treat the run as advanced until evidence and ledger updates are durably recorded.",
		isTerminal: false,
	},
	{
		state: "terminal",
		publicStatus: null,
		terminalPublicStatuses: [
			"accepted",
			"needs-ruling",
			"blocked",
			"failed",
			"interrupted",
		],
		description:
			"A terminal public outcome has been recorded separately from lifecycleState and the story-lead loop will not continue automatically.",
		callerImplication:
			"Read the public status and final package to decide impl-lead follow-up such as accept, reopen, or ruling.",
		isTerminal: true,
	},
] satisfies StoryOrchestrateStateDefinition[];

export const STORY_RUN_TERMINAL_STATUS_DEFINITIONS = [
	{
		status: "accepted",
		description:
			"Story-lead evidence is complete enough to recommend acceptance for impl-lead review.",
		callerImplication:
			"Impl-lead still owes receipt completion, verification gates, and the story commit before accepting the story.",
	},
	{
		status: "needs-ruling",
		description:
			"The run reached a boundary that requires an explicit caller or maintainer decision.",
		callerImplication:
			"Surface the ruling request instead of guessing or downgrading the decision into cleanup debt.",
	},
	{
		status: "blocked",
		description:
			"A named blocker prevents safe forward progress with the current inputs or runtime state.",
		callerImplication:
			"Resolve the blocker or change the plan before resuming; do not pretend the story is ready to continue.",
	},
	{
		status: "failed",
		description:
			"An unrecoverable runtime or planner failure ended the current story-lead attempt.",
		callerImplication:
			"Inspect the failure details and durable artifacts before deciding whether to replay or open a new attempt.",
	},
	{
		status: "interrupted",
		description:
			"The run stopped before a planned transition finished, usually because the caller or runtime interrupted it.",
		callerImplication:
			"Use status or resume against the durable artifacts to continue from the last safe checkpoint.",
	},
] satisfies StoryRunTerminalStatusDefinition[];

const ACTIONS_ALLOWED_WHILE_AWAITING = storyLeadActionTypeSchema.options;

const STORY_LEAD_ACTIONS_BY_STATE: Record<
	StoryOrchestrateLifecycleState,
	StoryLeadActionType[]
> = {
	initialized: [],
	awaiting_story_lead_action: [...ACTIONS_ALLOWED_WHILE_AWAITING],
	running_child_operation: [],
	recording_result: [],
	terminal: [],
};

const TERMINAL_STATUS_BY_ACTION: Record<
	Extract<
		StoryLeadActionType,
		"accept-story" | "request-ruling" | "block-story" | "fail-story"
	>,
	Exclude<StoryRunPublicStatus, "running" | "interrupted">
> = {
	"accept-story": "accepted",
	"request-ruling": "needs-ruling",
	"block-story": "blocked",
	"fail-story": "failed",
};

export interface StoryLeadStateMachineValidationError {
	reason: "STORY_LEAD_ACTION_NOT_ALLOWED";
	lifecycleState: StoryOrchestrateLifecycleState;
	action: StoryLeadActionType;
	allowedActions: StoryLeadActionType[];
	message: string;
}

export class StoryLeadStateMachineError extends Error {
	override readonly name = "StoryLeadStateMachineError";

	readonly reason = "STORY_LEAD_ACTION_NOT_ALLOWED";
	readonly lifecycleState: StoryOrchestrateLifecycleState;
	readonly action: StoryLeadActionType;
	readonly allowedActions: StoryLeadActionType[];

	constructor(error: StoryLeadStateMachineValidationError) {
		super(error.message);
		this.lifecycleState = error.lifecycleState;
		this.action = error.action;
		this.allowedActions = error.allowedActions;
	}
}

export function getStoryOrchestrateStateDefinition(
	state: StoryOrchestrateLifecycleState,
): StoryOrchestrateStateDefinition {
	const definition = STORY_ORCHESTRATE_STATE_DEFINITIONS.find(
		(candidate) => candidate.state === state,
	);
	if (!definition) {
		throw new Error(`Unknown story-orchestrate lifecycle state: ${state}`);
	}

	return definition;
}

export function getStoryRunTerminalStatusDefinition(
	status: Exclude<StoryRunPublicStatus, "running">,
): StoryRunTerminalStatusDefinition {
	const definition = STORY_RUN_TERMINAL_STATUS_DEFINITIONS.find(
		(candidate) => candidate.status === status,
	);
	if (!definition) {
		throw new Error(`Unknown story-orchestrate terminal status: ${status}`);
	}

	return definition;
}

export function getAllowedStoryLeadActionsForState(
	state: StoryOrchestrateLifecycleState,
): StoryLeadActionType[] {
	return [...STORY_LEAD_ACTIONS_BY_STATE[state]];
}

export function validateStoryLeadActionForState(input: {
	lifecycleState: StoryOrchestrateLifecycleState;
	action: StoryLeadStateMachineAction | StoryLeadActionType;
}): { ok: true } | { ok: false; error: StoryLeadStateMachineValidationError } {
	const actionType =
		typeof input.action === "string" ? input.action : input.action.action;
	const allowedActions = getAllowedStoryLeadActionsForState(
		input.lifecycleState,
	);
	if (allowedActions.includes(actionType)) {
		return { ok: true };
	}

	return {
		ok: false,
		error: {
			reason: "STORY_LEAD_ACTION_NOT_ALLOWED",
			lifecycleState: input.lifecycleState,
			action: actionType,
			allowedActions,
			message:
				allowedActions.length === 0
					? `Action "${actionType}" is not allowed while lifecycleState is "${input.lifecycleState}". This state does not accept story-lead actions.`
					: `Action "${actionType}" is not allowed while lifecycleState is "${input.lifecycleState}". Allowed actions: ${allowedActions.join(", ")}.`,
		},
	};
}

export function assertStoryLeadActionAllowed(input: {
	lifecycleState: StoryOrchestrateLifecycleState;
	action: StoryLeadStateMachineAction | StoryLeadActionType;
}): void {
	const result = validateStoryLeadActionForState(input);
	if (!result.ok) {
		throw new StoryLeadStateMachineError(result.error);
	}
}

export function getTerminalStatusForAction(
	action: Extract<
		StoryLeadActionType,
		"accept-story" | "request-ruling" | "block-story" | "fail-story"
	>,
): Exclude<StoryRunPublicStatus, "running" | "interrupted"> {
	return TERMINAL_STATUS_BY_ACTION[action];
}
