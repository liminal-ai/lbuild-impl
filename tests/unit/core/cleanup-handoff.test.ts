import { describe, expect, test } from "vitest";

import { buildCleanupHandoff } from "../../../src/core/cleanup-handoff";

describe("cleanup handoff", () => {
	test("TC-3.10a, TC-3.10b, and TC-3.10c export accepted-risk and deferred items explicitly", () => {
		const handoff = buildCleanupHandoff({
			acceptedRiskItems: [
				{
					description: "Accepted risk from scope review.",
					reasoning: "Caller approved the remaining risk.",
					evidence: ["risk.md"],
					approvalStatus: "approved",
					approvalSource: "impl-lead",
				},
			],
			deferredItems: [
				{
					description: "Deferred cleanup item.",
					reasoning: "Safe to defer until cleanup.",
					evidence: ["cleanup.md"],
					approvalStatus: "not-required",
					approvalSource: null,
				},
			],
			productionPathItems: [
				{
					description: "Approved production-path exception remains.",
					reasoning: "This is accepted risk and belongs in cleanup.",
					evidence: ["production-path.md"],
					approvalStatus: "approved",
					approvalSource: "impl-lead",
				},
				{
					description: "Fallback still needs caller ruling.",
					reasoning: "This must not be misclassified as cleanup debt.",
					evidence: ["fallback.md"],
					approvalStatus: "needs-ruling",
					approvalSource: null,
				},
			],
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
		});

		expect(handoff.acceptedRiskItems).toHaveLength(2);
		expect(handoff.deferredItems).toHaveLength(1);
		expect(handoff.deferredItems).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					description: "Fallback still needs caller ruling.",
				}),
			]),
		);
		expect(handoff.cleanupRequired).toBe(true);
	});
});
