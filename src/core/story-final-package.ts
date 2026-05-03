import { buildCleanupHandoff } from "./cleanup-handoff.js";
import { buildLogHandoff } from "./log-handoff.js";
import type { ContinuationHandle } from "./result-contracts.js";
import { buildAuthorityBoundaryRulingRequest } from "./review-ruling.js";
import { createRuntimeIdentity } from "./runtime-identity.js";
import type {
	AcceptanceCheckItem,
	ArtifactRef,
	CallerInputHistory,
	CallerRulingRequest,
	CommitReadiness,
	DiffReview,
	GateRunSummary,
	ReplayBoundary,
	RiskOrDeviationItem,
	StoryLeadAcceptanceSummary,
	StoryLeadFinalPackage,
	StoryLeadVerification,
} from "./story-orchestrate-contracts.js";
import {
	type StoryLeadOutcome,
	storyLeadFinalPackageSchema,
} from "./story-orchestrate-contracts.js";

function effectiveArtifactProvenance(
	artifact: ArtifactRef,
): NonNullable<ArtifactRef["provenance"]> {
	if (artifact.provenance) {
		return artifact.provenance;
	}

	switch (artifact.kind) {
		case "prior-final-package":
			return "prior-run";
		case "review-request":
		case "ruling-response":
			return "caller-input";
		default:
			return "fixture/preexisting";
	}
}

function withArtifactProvenance(artifacts: ArtifactRef[]): ArtifactRef[] {
	return artifacts.map((artifact) => ({
		...artifact,
		provenance: effectiveArtifactProvenance(artifact),
	}));
}

function currentRunArtifactPaths(artifacts: ArtifactRef[]): string[] {
	return withArtifactProvenance(artifacts)
		.filter((artifact) => artifact.provenance === "current-run")
		.map((artifact) => artifact.path);
}

function defaultCommitReadiness(input: {
	outcome: StoryLeadOutcome;
}): CommitReadiness {
	return {
		state: "not-ready",
		reason:
			input.outcome === "accepted"
				? "No recorded commit evidence is available for this story-lead attempt."
				: "Impl-lead acceptance remains blocked until story-lead closes the outstanding follow-up.",
	};
}

function acceptanceChecks(input: {
	gateRun: { command: string; result: "pass" | "fail" | "not-run" };
	verification: StoryLeadVerification;
	scopeChanges: RiskOrDeviationItem[];
	shimMockFallbackDecisions: RiskOrDeviationItem[];
	baselineBeforeStory: number | null;
	baselineAfterStory: number | null;
	commitReadiness: CommitReadiness;
	implementorEvidenceRefs: string[];
	verifierEvidenceRefs: string[];
}): AcceptanceCheckItem[] {
	const unresolvedFindings = input.verification.findings.filter(
		(finding) => finding.status === "unresolved",
	);
	const scopeChangeBlockers = input.scopeChanges.filter(
		(item) =>
			item.approvalStatus === "needs-ruling" ||
			item.approvalStatus === "rejected",
	);
	const shimBlockers = input.shimMockFallbackDecisions.filter(
		(item) =>
			item.approvalStatus === "needs-ruling" ||
			item.approvalStatus === "rejected",
	);
	const baselineKnown =
		input.baselineBeforeStory !== null && input.baselineAfterStory !== null;
	const baselinePass = baselineKnown
		? (input.baselineAfterStory ?? 0) >= (input.baselineBeforeStory ?? 0)
		: null;
	const receiptReady =
		input.implementorEvidenceRefs.length > 0 &&
		input.verifierEvidenceRefs.length > 0 &&
		input.gateRun.result === "pass";

	return [
		{
			name: "story-gate-result",
			status:
				input.gateRun.result === "pass"
					? "pass"
					: input.gateRun.result === "fail"
						? "fail"
						: "unknown",
			evidence: [input.gateRun.command],
			reasoning: `Story gate ${input.gateRun.command} reported ${input.gateRun.result}.`,
		},
		{
			name: "final-verifier-result",
			status:
				input.verification.finalVerifierOutcome === "pass"
					? "pass"
					: input.verification.finalVerifierOutcome === "not-run"
						? "unknown"
						: "fail",
			evidence: input.verifierEvidenceRefs,
			reasoning: `Final verifier outcome is ${input.verification.finalVerifierOutcome}.`,
		},
		{
			name: "unresolved-findings-status",
			status: unresolvedFindings.length === 0 ? "pass" : "fail",
			evidence: unresolvedFindings.flatMap((finding) => finding.evidence),
			reasoning:
				unresolvedFindings.length === 0
					? "No unresolved verifier findings remain."
					: `${unresolvedFindings.length} verifier finding(s) remain unresolved.`,
		},
		{
			name: "scope-change-status",
			status: scopeChangeBlockers.length === 0 ? "pass" : "fail",
			evidence: input.scopeChanges.flatMap((item) => item.evidence),
			reasoning:
				scopeChangeBlockers.length === 0
					? "No scope changes require further ruling."
					: "At least one scope change still requires ruling or was rejected.",
		},
		{
			name: "shim-mock-fallback-status",
			status: shimBlockers.length === 0 ? "pass" : "fail",
			evidence: input.shimMockFallbackDecisions.flatMap(
				(item) => item.evidence,
			),
			reasoning:
				shimBlockers.length === 0
					? "No shim/mock/fallback decisions require further approval."
					: "At least one shim/mock/fallback decision still requires approval.",
		},
		{
			name: "baseline-status",
			status:
				baselinePass === null ? "unknown" : baselinePass ? "pass" : "fail",
			evidence: [
				`baselineBefore=${input.baselineBeforeStory ?? "unknown"}`,
				`baselineAfter=${input.baselineAfterStory ?? "unknown"}`,
			],
			reasoning: baselineKnown
				? baselinePass
					? "The current baseline did not drop below the prior accepted baseline."
					: "The current baseline dropped below the prior accepted baseline."
				: "Baseline evidence is not recorded for this attempt.",
		},
		{
			name: "receipt-readiness",
			status: receiptReady ? "pass" : "fail",
			evidence: [
				...input.implementorEvidenceRefs,
				...input.verifierEvidenceRefs,
			],
			reasoning: receiptReady
				? "Receipt draft includes implementor evidence, verifier evidence, and a passing story gate."
				: "Receipt draft is incomplete because evidence or gate results are missing.",
		},
		{
			name: "commit-readiness",
			status: input.commitReadiness.state === "not-ready" ? "fail" : "pass",
			evidence: [
				input.commitReadiness.commitSha ??
					input.commitReadiness.reason ??
					input.commitReadiness.state,
			],
			reasoning:
				input.commitReadiness.state === "committed"
					? "The required story commit has already landed."
					: input.commitReadiness.state === "ready-for-impl-lead-commit"
						? "The story is ready for impl-lead to create the required commit."
						: (input.commitReadiness.reason ??
							"Commit readiness has not been satisfied yet."),
		},
	];
}

function mergeAcceptanceChecks(input: {
	builtInChecks: AcceptanceCheckItem[];
	providerChecks?: AcceptanceCheckItem[];
}): AcceptanceCheckItem[] {
	return [...input.builtInChecks, ...(input.providerChecks ?? [])];
}

function dedupeEvidence(items: RiskOrDeviationItem[]): string[] {
	return [...new Set(items.flatMap((item) => item.evidence))];
}

function synthesizeRulingRequest(input: {
	storyRunId: string;
	riskAndDeviationReview: StoryLeadFinalPackage["riskAndDeviationReview"];
}): CallerRulingRequest | null {
	const shimMockFallbackItems =
		input.riskAndDeviationReview.shimMockFallbackDecisions.filter(
			(item) => item.approvalStatus === "needs-ruling",
		);
	if (shimMockFallbackItems.length > 0) {
		return buildAuthorityBoundaryRulingRequest({
			id: `${input.storyRunId}-ruling-shim-mock-fallback`,
			decisionType: "shim-mock-fallback",
			question:
				"Should impl-lead approve the outstanding production shim/mock/fallback decision before story acceptance?",
			defaultRecommendation:
				"Pause for caller ruling instead of silently treating the production shim/mock/fallback decision as accepted or deferred cleanup debt.",
			evidence: dedupeEvidence(shimMockFallbackItems),
			allowedResponses: ["approve", "reject"],
		});
	}

	const scopeChangeItems = input.riskAndDeviationReview.scopeChanges.filter(
		(item) => item.approvalStatus === "needs-ruling",
	);
	if (scopeChangeItems.length > 0) {
		return buildAuthorityBoundaryRulingRequest({
			id: `${input.storyRunId}-ruling-scope-change`,
			decisionType: "scope-change",
			question:
				"Should impl-lead approve the outstanding scope-change decision before story acceptance?",
			defaultRecommendation:
				"Pause for caller ruling instead of carrying an unresolved scope change into cleanup as if it were already deferred.",
			evidence: dedupeEvidence(scopeChangeItems),
			allowedResponses: ["approve", "reject"],
		});
	}

	const specDeviationItems = input.riskAndDeviationReview.specDeviations.filter(
		(item) => item.approvalStatus === "needs-ruling",
	);
	if (specDeviationItems.length > 0) {
		return buildAuthorityBoundaryRulingRequest({
			id: `${input.storyRunId}-ruling-spec-deviation`,
			decisionType: "spec-deviation",
			question:
				"Should impl-lead approve the outstanding spec-deviation decision before story acceptance?",
			defaultRecommendation:
				"Pause for caller ruling until the spec-deviation decision is explicitly approved or rejected.",
			evidence: dedupeEvidence(specDeviationItems),
			allowedResponses: ["approve", "reject"],
		});
	}

	const acceptedRiskItems = input.riskAndDeviationReview.assumedRisks.filter(
		(item) => item.approvalStatus === "needs-ruling",
	);
	if (acceptedRiskItems.length > 0) {
		return buildAuthorityBoundaryRulingRequest({
			id: `${input.storyRunId}-ruling-accepted-risk`,
			decisionType: "accepted-risk",
			question:
				"Should impl-lead approve the outstanding accepted-risk decision before story acceptance?",
			defaultRecommendation:
				"Pause for caller ruling until the accepted-risk decision is explicitly approved or rejected.",
			evidence: dedupeEvidence(acceptedRiskItems),
			allowedResponses: ["approve", "reject"],
		});
	}

	return null;
}

function resolvedOutcome(input: {
	requestedOutcome: StoryLeadOutcome;
	acceptanceChecks: AcceptanceCheckItem[];
	rulingRequest: CallerRulingRequest | null;
}): StoryLeadOutcome {
	if (input.requestedOutcome !== "accepted") {
		return input.requestedOutcome;
	}

	if (input.rulingRequest) {
		return "needs-ruling";
	}

	return input.acceptanceChecks.every((check) => check.status === "pass")
		? "accepted"
		: "blocked";
}

function recommendedImplLeadAction(input: {
	outcome: StoryLeadOutcome;
	acceptanceSummary?: StoryLeadAcceptanceSummary;
}): StoryLeadFinalPackage["recommendedImplLeadAction"] {
	const providerAction = input.acceptanceSummary?.recommendedImplLeadAction;
	if (
		providerAction &&
		(input.outcome === "accepted" || providerAction !== "accept")
	) {
		return providerAction;
	}

	switch (input.outcome) {
		case "accepted":
			return "accept";
		case "needs-ruling":
			return "ask-ruling";
		default:
			return "reopen";
	}
}

function acceptanceRationale(input: {
	outcome: StoryLeadOutcome;
	acceptanceChecks: AcceptanceCheckItem[];
	rulingRequest: CallerRulingRequest | null;
}): string {
	switch (input.outcome) {
		case "accepted":
			return "Story-lead scoped acceptance is ready for impl-lead review and outer acceptance.";
		case "needs-ruling":
			return input.rulingRequest
				? `Story-lead is pausing for caller ruling ${input.rulingRequest.id} before impl-lead can accept the story.`
				: "Story-lead needs a caller ruling before impl-lead can accept the story.";
		case "blocked":
			return `Story-lead could not accept the story because ${input.acceptanceChecks.filter((check) => check.status !== "pass").length} acceptance check(s) remain incomplete.`;
		case "failed":
			return "Story-lead failed before it could assemble a safe acceptance package.";
		case "interrupted":
			return "Story-lead was interrupted before it could reach a terminal acceptance decision.";
	}
}

function openRiskSummaries(input: {
	assumedRisks: RiskOrDeviationItem[];
	replayBoundary: ReplayBoundary | null;
	verification: StoryLeadVerification;
}): string[] {
	const riskDescriptions = input.assumedRisks.map((risk) => risk.description);
	const unresolved = input.verification.findings
		.filter((finding) => finding.status === "unresolved")
		.map((finding) => `Verification finding ${finding.id} remains unresolved.`);

	return [
		...riskDescriptions,
		...unresolved,
		...(input.replayBoundary ? [input.replayBoundary.reasoning] : []),
	];
}

export interface BuildStoryLeadFinalPackageInput {
	outcome: StoryLeadOutcome;
	storyId: string;
	storyRunId: string;
	attempt: number;
	storyTitle: string;
	implementedScope: string;
	diffReview?: DiffReview;
	evidence?: {
		implementorArtifacts?: ArtifactRef[];
		selfReviewArtifacts?: ArtifactRef[];
		verifierArtifacts?: ArtifactRef[];
		quickFixArtifacts?: ArtifactRef[];
		callerInputArtifacts?: ArtifactRef[];
	};
	verification?: StoryLeadVerification;
	riskAndDeviationReview?: {
		specDeviations?: RiskOrDeviationItem[];
		assumedRisks?: RiskOrDeviationItem[];
		scopeChanges?: RiskOrDeviationItem[];
		shimMockFallbackDecisions?: RiskOrDeviationItem[];
	};
	acceptanceSummary?: StoryLeadAcceptanceSummary;
	gateRun?: GateRunSummary;
	callerInputHistory?: CallerInputHistory;
	rulingRequest?: CallerRulingRequest | null;
	replayBoundary?: ReplayBoundary | null;
	continuationHandles?: Record<string, ContinuationHandle>;
	baselineBeforeStory?: number | null;
	baselineAfterStory?: number | null;
	latestActualTotal?: number | null;
	commitReadiness?: CommitReadiness;
}

export function buildStoryLeadFinalPackage(
	input: BuildStoryLeadFinalPackageInput,
): StoryLeadFinalPackage {
	const gateRun = input.gateRun ?? {
		command: "npm run green-verify",
		result: "not-run" as const,
	};
	const verification = input.verification ?? {
		finalVerifierOutcome: "not-run" as const,
		findings: [],
	};
	const riskAndDeviationReview = {
		specDeviations: input.riskAndDeviationReview?.specDeviations ?? [],
		assumedRisks: input.riskAndDeviationReview?.assumedRisks ?? [],
		scopeChanges: input.riskAndDeviationReview?.scopeChanges ?? [],
		shimMockFallbackDecisions:
			input.riskAndDeviationReview?.shimMockFallbackDecisions ?? [],
	};
	const commitReadiness =
		input.commitReadiness ?? defaultCommitReadiness({ outcome: input.outcome });
	const evidence = {
		implementorArtifacts: withArtifactProvenance(
			input.evidence?.implementorArtifacts ?? [],
		),
		selfReviewArtifacts: withArtifactProvenance(
			input.evidence?.selfReviewArtifacts ?? [],
		),
		verifierArtifacts: withArtifactProvenance(
			input.evidence?.verifierArtifacts ?? [],
		),
		quickFixArtifacts: withArtifactProvenance(
			input.evidence?.quickFixArtifacts ?? [],
		),
		callerInputArtifacts: withArtifactProvenance(
			input.evidence?.callerInputArtifacts ?? [],
		),
		gateRuns: [gateRun],
	};
	const checks = mergeAcceptanceChecks({
		builtInChecks: acceptanceChecks({
			gateRun,
			verification,
			scopeChanges: riskAndDeviationReview.scopeChanges,
			shimMockFallbackDecisions:
				riskAndDeviationReview.shimMockFallbackDecisions,
			baselineBeforeStory: input.baselineBeforeStory ?? null,
			baselineAfterStory: input.baselineAfterStory ?? null,
			commitReadiness,
			implementorEvidenceRefs: currentRunArtifactPaths(
				evidence.implementorArtifacts,
			),
			verifierEvidenceRefs: currentRunArtifactPaths(evidence.verifierArtifacts),
		}),
		providerChecks: input.acceptanceSummary?.acceptanceChecks,
	});
	const effectiveRulingRequest =
		input.rulingRequest ??
		(input.outcome === "accepted"
			? synthesizeRulingRequest({
					storyRunId: input.storyRunId,
					riskAndDeviationReview,
				})
			: null);
	const outcome = resolvedOutcome({
		requestedOutcome: input.outcome,
		acceptanceChecks: checks,
		rulingRequest: effectiveRulingRequest,
	});
	const openRisks = openRiskSummaries({
		assumedRisks: riskAndDeviationReview.assumedRisks,
		replayBoundary: input.replayBoundary ?? null,
		verification,
	});
	const cleanupHandoff = buildCleanupHandoff({
		acceptedRiskItems: riskAndDeviationReview.assumedRisks.filter(
			(item) => item.approvalStatus === "approved",
		),
		deferredItems: riskAndDeviationReview.scopeChanges.filter(
			(item) => item.approvalStatus === "not-required",
		),
		shimMockFallbackItems:
			riskAndDeviationReview.shimMockFallbackDecisions.filter(
				(item) =>
					item.approvalStatus === "approved" ||
					item.approvalStatus === "not-required",
			),
		verification,
		replayBoundary: input.replayBoundary ?? null,
	});
	const terminalRulingRequest =
		outcome === "needs-ruling" ? effectiveRulingRequest : null;

	return storyLeadFinalPackageSchema.parse({
		outcome,
		storyRunId: input.storyRunId,
		storyId: input.storyId,
		attempt: input.attempt,
		summary: {
			storyTitle: input.storyTitle,
			implementedScope: input.implementedScope,
			acceptanceRationale: acceptanceRationale({
				outcome,
				acceptanceChecks: checks,
				rulingRequest: terminalRulingRequest,
			}),
		},
		evidence,
		verification,
		riskAndDeviationReview,
		diffReview:
			input.diffReview ??
			({
				changedFiles: [],
				storyScopedAssessment:
					"Story-lead package is scoped to orchestration evidence and impl-lead handoff data.",
			} satisfies DiffReview),
		acceptanceChecks: checks,
		callerInputHistory: input.callerInputHistory ?? {
			reviewRequests: [],
			rulings: [],
		},
		runtimeIdentity: createRuntimeIdentity(),
		replayBoundary: input.replayBoundary ?? null,
		logHandoff: buildLogHandoff({
			outcome,
			storyId: input.storyId,
			storyTitle: input.storyTitle,
			continuationHandles: input.continuationHandles,
			gateRun,
			verification,
			implementorEvidenceRefs: currentRunArtifactPaths(
				evidence.implementorArtifacts,
			),
			verifierEvidenceRefs: currentRunArtifactPaths(evidence.verifierArtifacts),
			openRisks,
			commitReadiness,
			baselineBeforeStory: input.baselineBeforeStory ?? null,
			baselineAfterStory: input.baselineAfterStory ?? null,
			latestActualTotal: input.latestActualTotal ?? null,
		}),
		cleanupHandoff,
		rulingRequest: terminalRulingRequest,
		recommendedImplLeadAction: recommendedImplLeadAction({
			outcome,
			acceptanceSummary: input.acceptanceSummary,
		}),
	});
}
