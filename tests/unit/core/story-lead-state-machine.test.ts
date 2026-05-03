import { describe, expect, test } from "vitest";

import {
	assertStoryLeadActionAllowed,
	getAllowedStoryLeadActionsForState,
	getStoryOrchestrateStateDefinition,
	getStoryRunTerminalStatusDefinition,
	getTerminalStatusForAction,
	STORY_ORCHESTRATE_STATE_DEFINITIONS,
	STORY_RUN_TERMINAL_STATUS_DEFINITIONS,
	storyLeadStateMachineActionSchema,
	validateStoryLeadActionForState,
} from "../../../src/core/story-lead-state-machine.js";
import {
	storyLeadActionFixtures,
	storyOrchestrateLifecycleFixture,
} from "../../support/fixtures/story-orchestrate-context.js";

describe("story-lead state machine", () => {
	test("TC-3.1b defines each persisted lifecycle state with a plain description and caller implication", () => {
		expect(STORY_ORCHESTRATE_STATE_DEFINITIONS).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "initialized",
					publicStatus: "running",
					isTerminal: false,
				}),
				expect.objectContaining({
					state: "awaiting_story_lead_action",
					publicStatus: "running",
					isTerminal: false,
				}),
				expect.objectContaining({
					state: "running_child_operation",
					publicStatus: "running",
					isTerminal: false,
				}),
				expect.objectContaining({
					state: "recording_result",
					publicStatus: "running",
					isTerminal: false,
				}),
				expect.objectContaining({
					state: "terminal",
					publicStatus: null,
					isTerminal: true,
				}),
			]),
		);

		for (const definition of STORY_ORCHESTRATE_STATE_DEFINITIONS) {
			expect(definition.description.length).toBeGreaterThan(20);
			expect(definition.callerImplication.length).toBeGreaterThan(20);
			expect(getStoryOrchestrateStateDefinition(definition.state)).toEqual(
				definition,
			);
		}
	});

	test("keeps terminal lifecycleState separate from terminal public outcomes", () => {
		const terminalDefinition = getStoryOrchestrateStateDefinition("terminal");

		expect(terminalDefinition.publicStatus).toBeNull();
		expect(terminalDefinition).not.toEqual(
			expect.objectContaining({
				publicStatus: "accepted",
			}),
		);
		expect(terminalDefinition.terminalPublicStatuses).toEqual([
			"accepted",
			"needs-ruling",
			"blocked",
			"failed",
			"interrupted",
		]);
	});

	test("TC-3.2a accepts the full bounded action vocabulary while awaiting a story-lead action", () => {
		const actions = Object.values(storyLeadActionFixtures);

		expect(
			getAllowedStoryLeadActionsForState(
				storyOrchestrateLifecycleFixture.lifecycleState,
			),
		).toEqual([
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

		for (const action of actions) {
			expect(() =>
				assertStoryLeadActionAllowed({
					lifecycleState: storyOrchestrateLifecycleFixture.lifecycleState,
					action,
				}),
			).not.toThrow();
		}
	});

	test("TC-3.2b and TC-3.8a reject invalid actions with caller-readable lifecycle and action names", () => {
		const result = validateStoryLeadActionForState({
			lifecycleState: "running_child_operation",
			action: storyLeadActionFixtures.runVerify,
		});

		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("Expected invalid state/action validation result.");
		}
		expect(result.error).toEqual(
			expect.objectContaining({
				reason: "STORY_LEAD_ACTION_NOT_ALLOWED",
				lifecycleState: "running_child_operation",
				action: "run-verify",
				allowedActions: [],
			}),
		);
		expect(result.error.message).toContain("run-verify");
		expect(result.error.message).toContain("running_child_operation");
		expect(() =>
			assertStoryLeadActionAllowed({
				lifecycleState: "recording_result",
				action: storyLeadActionFixtures.acceptStory,
			}),
		).toThrow(/recording_result/u);
	});

	test("TC-3.3a through TC-3.3e define terminal outcomes and their caller implications", () => {
		expect(STORY_RUN_TERMINAL_STATUS_DEFINITIONS).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "accepted",
				}),
				expect.objectContaining({
					status: "needs-ruling",
				}),
				expect.objectContaining({
					status: "blocked",
				}),
				expect.objectContaining({
					status: "failed",
				}),
				expect.objectContaining({
					status: "interrupted",
				}),
			]),
		);

		expect(getTerminalStatusForAction("accept-story")).toBe("accepted");
		expect(getTerminalStatusForAction("request-ruling")).toBe("needs-ruling");
		expect(getTerminalStatusForAction("block-story")).toBe("blocked");
		expect(getTerminalStatusForAction("fail-story")).toBe("failed");

		expect(
			getStoryRunTerminalStatusDefinition("accepted").callerImplication,
		).toContain("receipt completion");
		expect(
			getStoryRunTerminalStatusDefinition("needs-ruling").callerImplication,
		).toContain("ruling request");
		expect(
			getStoryRunTerminalStatusDefinition("blocked").callerImplication,
		).toContain("Resolve the blocker");
		expect(
			getStoryRunTerminalStatusDefinition("failed").callerImplication,
		).toContain("failure details");
		expect(
			getStoryRunTerminalStatusDefinition("interrupted").callerImplication,
		).toContain("last safe checkpoint");
	});

	test("rejects extra keys after action discrimination so schema drift stays loud", () => {
		expect(() =>
			storyLeadStateMachineActionSchema.parse({
				...storyLeadActionFixtures.runImplement,
				extraKey: "not allowed",
			}),
		).toThrow(/extraKey/u);
	});
});
