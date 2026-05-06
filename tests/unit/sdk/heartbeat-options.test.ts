import { describe, expect, test } from "vitest";

import { implRunConfigSchema } from "../../../src/core/config-schema";
import { resolveCallerHeartbeatOptions } from "../../../src/core/heartbeat";

describe("heartbeat option precedence", () => {
	test("TC-1.5a resolves the default primitive heartbeat cadence when no overrides are provided", () => {
		const resolved = resolveCallerHeartbeatOptions({
			operationKind: "primitive",
		});

		expect(resolved).toEqual({
			callerHarness: "generic",
			heartbeatCadenceMinutes: 5,
			primitiveHeartbeatCadenceMinutes: 5,
			storyHeartbeatCadenceMinutes: 10,
		});
	});

	test("TC-1.5b explicit invocation cadence overrides the run-config cadence", () => {
		const resolved = resolveCallerHeartbeatOptions({
			operationKind: "primitive",
			heartbeatCadenceMinutes: 2,
			config: {
				harness: "claude-code",
				primitive_heartbeat_cadence_minutes: 7,
				story_heartbeat_cadence_minutes: 11,
			},
		});

		expect(resolved?.heartbeatCadenceMinutes).toBe(2);
		expect(resolved?.callerHarness).toBe("claude-code");
	});

	test("TC-1.5c run config caller-harness defaults apply when no explicit override is provided", () => {
		const parsed = implRunConfigSchema.parse({
			version: 1,
			primary_harness: "claude-code",
			story_lead_provider: {
				secondary_harness: "codex",
				model: "gpt-5.4",
				reasoning_effort: "high",
			},
			story_implementor: {
				secondary_harness: "codex",
				model: "gpt-5.4",
				reasoning_effort: "high",
			},
			quick_fixer: {
				secondary_harness: "codex",
				model: "gpt-5.4",
				reasoning_effort: "medium",
			},
			story_verifier: {
				secondary_harness: "codex",
				model: "gpt-5.4",
				reasoning_effort: "xhigh",
			},
			self_review: {
				passes: 2,
			},
			epic_verifiers: [
				{
					label: "epic-verifier-1",
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "high",
				},
			],
			epic_reverifier: {
				secondary_harness: "codex",
				model: "gpt-5.4",
				reasoning_effort: "xhigh",
			},
			caller_harness: {
				harness: "codex",
				primitive_heartbeat_cadence_minutes: 8,
				story_heartbeat_cadence_minutes: 12,
			},
		});

		const resolved = resolveCallerHeartbeatOptions({
			operationKind: "story",
			config: parsed.caller_harness,
		});

		expect(resolved).toEqual({
			callerHarness: "codex",
			heartbeatCadenceMinutes: 12,
			primitiveHeartbeatCadenceMinutes: 8,
			storyHeartbeatCadenceMinutes: 12,
		});
	});

	test("TC-1.5d explicit SDK-style caller harness input overrides the persisted harness without mutating its cadences", () => {
		const resolved = resolveCallerHeartbeatOptions({
			operationKind: "story",
			callerHarness: "claude-code",
			config: {
				harness: "codex",
				primitive_heartbeat_cadence_minutes: 6,
				story_heartbeat_cadence_minutes: 9,
			},
		});

		expect(resolved).toEqual({
			callerHarness: "claude-code",
			heartbeatCadenceMinutes: 9,
			primitiveHeartbeatCadenceMinutes: 6,
			storyHeartbeatCadenceMinutes: 9,
		});
	});

	test("disabling heartbeats returns a null heartbeat configuration", () => {
		const resolved = resolveCallerHeartbeatOptions({
			operationKind: "primitive",
			disableHeartbeats: true,
			config: {
				harness: "codex",
			},
		});

		expect(resolved).toBeNull();
	});
});
