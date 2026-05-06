import { describe, expect, test } from "vitest";

import { buildStoryLeadFinalPackage } from "../../../src/core/story-final-package";

describe("story final package", () => {
	test("TC-3.1a, TC-3.1b, TC-3.3a, TC-3.3b, TC-3.7a, TC-3.7b, and TC-3.8a build a complete accepted package", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "accepted",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-002",
			attempt: 2,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Accepted package flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
						provenance: "current-run",
					},
				],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/002-verifier.json",
						provenance: "current-run",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
			gateRun: {
				command: "npm run green-verify",
				result: "pass",
			},
			baselineBeforeStory: 30,
			baselineAfterStory: 33,
			latestActualTotal: 33,
			commitReadiness: {
				state: "ready-for-impl-lead-commit",
			},
		});

		expect(finalPackage.outcome).toBe("accepted");
		expect(finalPackage.evidence.implementorArtifacts).toEqual([
			expect.objectContaining({
				path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
				provenance: "current-run",
			}),
		]);
		expect(finalPackage.evidence.verifierArtifacts).toEqual([
			expect.objectContaining({
				path: "/tmp/spec-pack/artifacts/00-foundation/002-verifier.json",
				provenance: "current-run",
			}),
		]);
		expect(finalPackage.riskAndDeviationReview.specDeviations).toEqual([]);
		expect(finalPackage.riskAndDeviationReview.assumedRisks).toEqual([]);
		expect(finalPackage.riskAndDeviationReview.scopeChanges).toEqual([]);
		expect(
			finalPackage.riskAndDeviationReview.productionPathDecisionItems,
		).toEqual([]);
		expect(finalPackage.acceptanceChecks.map((check) => check.name)).toEqual([
			"story-gate-result",
			"final-verifier-result",
			"unresolved-findings-status",
			"scope-change-status",
			"production-path-status",
			"baseline-status",
			"receipt-readiness",
			"commit-readiness",
		]);
		expect(finalPackage.summary.acceptanceRationale).toContain(
			"Story-lead scoped acceptance",
		);
		expect(
			finalPackage.logHandoff.storyReceiptDraft.implementorEvidenceRefs,
		).toHaveLength(1);
		expect(finalPackage.logHandoff.commitReadiness.state).toBe(
			"ready-for-impl-lead-commit",
		);
		expect(finalPackage.runtimeIdentity.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(finalPackage.runtimeIdentity.invocationSource).toBe("local-source");
		expect(finalPackage.runtimeIdentity.entryPath).toEqual(expect.any(String));
	});

	test("TC-3.2a, TC-3.2b, TC-3.2c, TC-3.2d, TC-3.3c, and TC-3.7c prevent accepted outcome when acceptance checks fail", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "accepted",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-003",
			attempt: 3,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Blocked acceptance package flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
			riskAndDeviationReview: {
				specDeviations: [
					{
						description: "Intentional deviation remains open.",
						reasoning: "Needs explicit approval before acceptance.",
						evidence: ["deviation.md"],
						approvalStatus: "needs-ruling",
						approvalSource: null,
					},
				],
			},
			commitReadiness: {
				state: "not-ready",
				reason: "Commit has not landed yet.",
			},
		});

		expect(finalPackage.outcome).toBe("needs-ruling");
		expect(finalPackage.rulingRequest).toEqual(
			expect.objectContaining({
				decisionType: "spec-deviation",
			}),
		);
		expect(
			finalPackage.acceptanceChecks.find(
				(check) => check.name === "receipt-readiness",
			)?.status,
		).toBe("fail");
		expect(
			finalPackage.acceptanceChecks.find(
				(check) => check.name === "commit-readiness",
			)?.status,
		).toBe("fail");
		expect(finalPackage.recommendedImplLeadAction).toBe("ask-ruling");
	});

	test("TC-3.3a and TC-3.7c do not self-certify gate, baseline, or commit readiness when evidence is missing", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "accepted",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-004",
			attempt: 4,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Missing acceptance evidence flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
					},
				],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/002-verifier.json",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
		});

		expect(finalPackage.outcome).toBe("blocked");
		expect(
			finalPackage.acceptanceChecks.find(
				(check) => check.name === "story-gate-result",
			)?.status,
		).toBe("unknown");
		expect(
			finalPackage.acceptanceChecks.find(
				(check) => check.name === "baseline-status",
			)?.status,
		).toBe("unknown");
		expect(
			finalPackage.acceptanceChecks.find(
				(check) => check.name === "commit-readiness",
			)?.status,
		).toBe("fail");
	});

	test("keeps final verifier acceptance unknown when no recorded verifier result is supplied", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "accepted",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-005",
			attempt: 5,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Missing verifier outcome flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
					},
				],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/002-verifier.json",
					},
				],
			},
			gateRun: {
				command: "npm run green-verify",
				result: "pass",
			},
			baselineBeforeStory: 30,
			baselineAfterStory: 33,
			latestActualTotal: 33,
			commitReadiness: {
				state: "ready-for-impl-lead-commit",
			},
		});

		expect(finalPackage.outcome).toBe("blocked");
		expect(finalPackage.verification.finalVerifierOutcome).toBe("not-run");
		expect(
			finalPackage.acceptanceChecks.find(
				(check) => check.name === "final-verifier-result",
			)?.status,
		).toBe("unknown");
	});

	test("preserves provider-authored acceptance checks and recommended impl-lead action", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "accepted",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-006",
			attempt: 6,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Provider acceptance metadata flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
					},
				],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/002-verifier.json",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
			gateRun: {
				command: "npm run green-verify",
				result: "pass",
			},
			baselineBeforeStory: 30,
			baselineAfterStory: 33,
			latestActualTotal: 33,
			commitReadiness: {
				state: "ready-for-impl-lead-commit",
			},
			acceptanceSummary: {
				acceptanceChecks: [
					{
						name: "custom-provider-check",
						status: "pass",
						evidence: ["story-lead-action"],
						reasoning:
							"Story-lead supplied acceptance metadata that must survive packaging.",
					},
				],
				recommendedImplLeadAction: "reject",
			},
		});

		expect(finalPackage.acceptanceChecks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "custom-provider-check" }),
			]),
		);
		expect(finalPackage.recommendedImplLeadAction).toBe("reject");
	});

	test("does not let a provider accept recommendation override failed built-in checks", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "accepted",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-007",
			attempt: 7,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Provider safety boundary flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
					},
				],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/002-verifier.json",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
			gateRun: {
				command: "npm run green-verify",
				result: "fail",
			},
			baselineBeforeStory: 30,
			baselineAfterStory: 33,
			latestActualTotal: 33,
			commitReadiness: {
				state: "ready-for-impl-lead-commit",
			},
			acceptanceSummary: {
				acceptanceChecks: [
					{
						name: "story-gate-result",
						status: "pass",
						evidence: ["provider-accept-story-payload"],
						reasoning:
							"Provider-authored duplicate check should be preserved, not override the built-in gate result.",
					},
				],
				recommendedImplLeadAction: "accept",
			},
		});

		const gateChecks = finalPackage.acceptanceChecks.filter(
			(check) => check.name === "story-gate-result",
		);

		expect(finalPackage.outcome).toBe("blocked");
		expect(gateChecks).toHaveLength(2);
		expect(gateChecks.map((check) => check.status)).toEqual(["fail", "pass"]);
		expect(finalPackage.recommendedImplLeadAction).toBe("reopen");
	});

	test("exports only approved accepted-risk items and true deferred items into cleanup handoff", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "accepted",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-008",
			attempt: 8,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Shim/mock cleanup handoff flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
					},
				],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/002-verifier.json",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
			riskAndDeviationReview: {
				scopeChanges: [
					{
						description: "Deferred cleanup item remains.",
						reasoning: "Safe to defer until cleanup.",
						evidence: ["cleanup.md"],
						approvalStatus: "not-required",
						approvalSource: null,
					},
					{
						description: "Scope change still needs a ruling.",
						reasoning: "This must stay on the ruling path.",
						evidence: ["scope.md"],
						approvalStatus: "needs-ruling",
						approvalSource: null,
					},
				],
				productionPathDecisionItems: [
					{
						description: "Approved compatibility shim remains.",
						reasoning: "Impl-lead accepted the compatibility shim.",
						evidence: ["shim.md"],
						approvalStatus: "approved",
						approvalSource: "impl-lead",
					},
				],
			},
			gateRun: {
				command: "npm run green-verify",
				result: "pass",
			},
			baselineBeforeStory: 30,
			baselineAfterStory: 33,
			latestActualTotal: 33,
			commitReadiness: {
				state: "ready-for-impl-lead-commit",
			},
		});

		expect(finalPackage.cleanupHandoff.acceptedRiskItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					description: "Approved compatibility shim remains.",
				}),
			]),
		);
		expect(finalPackage.cleanupHandoff.deferredItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					description: "Deferred cleanup item remains.",
				}),
			]),
		);
		expect(finalPackage.cleanupHandoff.deferredItems).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					description: "Scope change still needs a ruling.",
				}),
			]),
		);
		expect(finalPackage.cleanupHandoff.cleanupRequired).toBe(true);
	});

	test("reverifys a ruling request for production shim/mock decisions that still need approval instead of downgrading them to plain blocked cleanup debt", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "accepted",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-009",
			attempt: 9,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Shim/mock ruling boundary flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/001-implementor.json",
					},
				],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/002-verifier.json",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
			riskAndDeviationReview: {
				productionPathDecisionItems: [
					{
						description: "Production fallback still needs caller approval.",
						reasoning:
							"Story-lead cannot silently approve a production fallback.",
						evidence: ["fallback.md"],
						approvalStatus: "needs-ruling",
						approvalSource: null,
					},
				],
			},
			gateRun: {
				command: "npm run green-verify",
				result: "pass",
			},
			baselineBeforeStory: 30,
			baselineAfterStory: 33,
			latestActualTotal: 33,
			commitReadiness: {
				state: "ready-for-impl-lead-commit",
			},
		});

		expect(finalPackage.outcome).toBe("needs-ruling");
		expect(finalPackage.rulingRequest).toEqual(
			expect.objectContaining({
				decisionType: "production-path",
			}),
		);
		expect(finalPackage.cleanupHandoff.acceptedRiskItems).toEqual([]);
		expect(finalPackage.cleanupHandoff.deferredItems).toEqual([]);
		expect(finalPackage.cleanupHandoff.cleanupRequired).toBe(false);
		expect(finalPackage.recommendedImplLeadAction).toBe("ask-ruling");
	});

	test("TC-5.3a marks evidence provenance in the final package so current-run proof is distinguishable from prior and caller-input files", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "blocked",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-010",
			attempt: 10,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Evidence provenance flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/003-implementor.json",
						provenance: "current-run",
					},
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/seeded-implementor.json",
						provenance: "prior-run",
					},
				],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/004-verifier.json",
						provenance: "prior-run",
					},
				],
				callerInputArtifacts: [
					{
						kind: "review-request",
						path: "/tmp/spec-pack/artifacts/00-foundation/story-lead/010-review-request-001.json",
						provenance: "caller-input",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
		});

		expect(finalPackage.evidence.implementorArtifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provenance: "current-run",
				}),
				expect.objectContaining({
					provenance: "prior-run",
				}),
			]),
		);
		expect(finalPackage.evidence.verifierArtifacts).toEqual([
			expect.objectContaining({
				provenance: "prior-run",
			}),
		]);
		expect(finalPackage.evidence.callerInputArtifacts).toEqual([
			expect.objectContaining({
				provenance: "caller-input",
			}),
		]);
	});

	test("TC-5.3b does not treat prior evidence artifacts as current-run proof in receipt readiness", () => {
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "accepted",
			storyId: "00-foundation",
			storyRunId: "00-foundation-story-run-011",
			attempt: 11,
			storyTitle: "Story 0: Foundation",
			implementedScope: "Preseeded evidence rejection flow.",
			evidence: {
				implementorArtifacts: [
					{
						kind: "implementor-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/seeded-implementor.json",
						provenance: "prior-run",
					},
				],
				verifierArtifacts: [
					{
						kind: "verifier-result",
						path: "/tmp/spec-pack/artifacts/00-foundation/seeded-verifier.json",
						provenance: "prior-run",
					},
				],
			},
			verification: {
				finalVerifierOutcome: "pass",
				findings: [],
			},
			gateRun: {
				command: "npm run green-verify",
				result: "pass",
			},
			baselineBeforeStory: 30,
			baselineAfterStory: 31,
			latestActualTotal: 31,
			commitReadiness: {
				state: "ready-for-impl-lead-commit",
			},
		});

		expect(finalPackage.outcome).toBe("blocked");
		expect(
			finalPackage.acceptanceChecks.find(
				(check) => check.name === "receipt-readiness",
			)?.status,
		).toBe("fail");
		expect(
			finalPackage.logHandoff.storyReceiptDraft.implementorEvidenceRefs,
		).toEqual([]);
		expect(
			finalPackage.logHandoff.storyReceiptDraft.verifierEvidenceRefs,
		).toEqual([]);
	});
});
