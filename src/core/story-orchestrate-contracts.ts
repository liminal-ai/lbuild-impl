import { z } from "zod";

import { implRunConfigSchema } from "./config-schema.js";
import {
	continuationHandleSchema,
	providerMatrixSchema,
	verificationGatesSchema,
	providerIdSchema,
} from "./result-contracts.js";
import {
	storyOrchestrateLifecycleStateSchema,
	storyRunPublicStatusSchema,
} from "./story-lead-state-machine.js";
import { runtimeIdentitySchema } from "./runtime-identity.js";

export const storyLeadOutcomeSchema = z.enum([
	"accepted",
	"needs-ruling",
	"blocked",
	"failed",
	"interrupted",
]);

export const storyRunStatusSchema = storyRunPublicStatusSchema;

export const artifactProvenanceSchema = z.enum([
	"current-run",
	"prior-run",
	"caller-input",
]);

export const artifactRefSchema = z
	.object({
		kind: z.string().min(1),
		path: z.string().min(1),
		provenance: artifactProvenanceSchema.optional(),
	})
	.strict();

export const storyRunCandidateSchema = z
	.object({
		storyRunId: z.string().min(1),
		status: storyRunStatusSchema,
		updatedAt: z.string().min(1),
		currentSnapshotPath: z.string().min(1),
		finalPackagePath: z.string().min(1).optional(),
	})
	.strict();

export const currentChildOperationSchema = z
	.object({
		command: z.string().min(1),
		artifactPath: z.string().min(1).optional(),
		continuationHandleRef: z.string().min(1).optional(),
	})
	.strict();

export const storyRunNextIntentSchema = z
	.object({
		actionType: z.string().min(1),
		summary: z.string().min(1),
		artifactRef: z.string().min(1).optional(),
		continuationHandleRef: z.string().min(1).optional(),
	})
	.strict();

export const callerInputHistorySchema = z
	.object({
		reviewRequests: z.array(
			z
				.object({
					source: z.string().min(1),
					decision: z.enum([
						"reject",
						"reopen",
						"revise",
						"ask-ruling",
						"stop",
					]),
					summary: z.string().min(1),
					items: z.array(
						z
							.object({
								id: z.string().min(1),
								severity: z.enum(["blocker", "major", "minor", "note"]),
								concern: z.string().min(1),
								requiredResponse: z.string().min(1),
								evidence: z.array(z.string().min(1)).optional(),
							})
							.strict(),
					),
					evidence: z.array(z.string().min(1)).optional(),
				})
				.strict(),
		),
		rulings: z.array(
			z
				.object({
					rulingRequestId: z.string().min(1),
					decision: z.string().min(1),
					rationale: z.string().min(1),
					source: z.string().min(1),
				})
				.strict(),
		),
	})
	.strict();

export const replayBoundarySchema = z
	.object({
		smallestSafeStep: z.string().min(1),
		reasoning: z.string().min(1),
		validArtifactPaths: z.array(z.string().min(1)),
		requiresFreshStoryLeadSession: z.boolean(),
		requiresFreshChildProviderSession: z.boolean(),
	})
	.strict();

export const storyRunCurrentSnapshotSchema = z
	.object({
		storyRunId: z.string().min(1),
		storyId: z.string().min(1),
		attempt: z.number().int().positive(),
		status: storyRunStatusSchema,
		lifecycleState: storyOrchestrateLifecycleStateSchema,
		currentSummary: z.string().min(1),
		currentPhase: z.string().min(1),
		currentChildOperation: currentChildOperationSchema.nullable(),
		latestArtifacts: z.array(artifactRefSchema),
		latestContinuationHandles: z.record(z.string(), continuationHandleSchema),
		latestEventSequence: z.number().int().nonnegative(),
		callerInputHistory: callerInputHistorySchema,
		nextIntent: storyRunNextIntentSchema.nullable(),
		replayBoundary: replayBoundarySchema.nullable(),
		updatedAt: z.string().min(1),
	})
	.strict();

export const contextDocumentSchema = z
	.object({
		kind: z.string().min(1),
		path: z.string().min(1).optional(),
		content: z.string(),
		bytes: z.number().int().nonnegative(),
	})
	.strict();

export const storyLeadSelfNoteSchema = z
	.object({
		sequence: z.number().int().nonnegative(),
		actionSequence: z.number().int().nonnegative(),
		note: z.string().min(1),
		createdAt: z.string().min(1),
	})
	.strict();

export const storyLeadPlannerContextSchema = z
	.object({
		storyId: z.string().min(1),
		storyRunId: z.string().min(1),
		mode: z.enum(["run", "resume"]),
		plannerTurnIndex: z.number().int().positive(),
		storyFile: contextDocumentSchema,
		testPlan: contextDocumentSchema,
		currentSnapshot: contextDocumentSchema,
		eventHistory: contextDocumentSchema,
		resultArtifacts: z.array(contextDocumentSchema),
		callerInputArtifacts: z.array(contextDocumentSchema),
		priorSelfNotes: z.array(storyLeadSelfNoteSchema),
		seededSelfNoteInstruction: z.string().min(1).optional(),
		stateRules: contextDocumentSchema,
		runtimeSettings: z
			.object({
				storyGate: z.string().min(1).optional(),
				epicGate: z.string().min(1).optional(),
				plannerTimeoutMs: z.number().int().positive(),
				wholeRunTimeoutMs: z.number().int().positive(),
				providerStartupTimeoutMs: z.number().int().positive(),
				providerActiveSilenceTimeoutMs: z.number().int().positive().optional(),
			})
			.strict(),
	})
	.strict();

export const storyLeadContextOverflowErrorSchema = z
	.object({
		code: z.literal("STORY_LEAD_CONTEXT_OVERFLOW"),
		storyId: z.string().min(1),
		storyRunId: z.string().min(1),
		provider: z.string().min(1),
		model: z.string().min(1),
		requiredContextBytes: z.number().int().positive(),
		providerLimit: z.number().int().positive().optional(),
		largestSources: z
			.array(
				z
					.object({
						kind: z.string().min(1),
						path: z.string().min(1).optional(),
						bytes: z.number().int().nonnegative(),
					})
					.strict(),
			)
			.min(1),
	})
	.strict();

export const storyRunEventSchema = z
	.object({
		storyRunId: z.string().min(1),
		sequence: z.number().int().nonnegative(),
		timestamp: z.string().min(1),
		type: z.string().min(1),
		summary: z.string().min(1),
		artifact: z.string().min(1).optional(),
		data: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export const implLeadReviewItemSchema = z
	.object({
		id: z.string().min(1),
		severity: z.enum(["blocker", "major", "minor", "note"]),
		concern: z.string().min(1),
		requiredResponse: z.string().min(1),
		evidence: z.array(z.string().min(1)).optional(),
	})
	.strict();

export const implLeadReviewRequestSchema = z
	.object({
		source: z.string().min(1),
		decision: z.enum(["reject", "reopen", "revise", "ask-ruling", "stop"]),
		summary: z.string().min(1),
		items: z.array(implLeadReviewItemSchema),
		evidence: z.array(z.string().min(1)).optional(),
	})
	.strict();

export const callerRulingRequestSchema = z
	.object({
		id: z.string().min(1),
		decisionType: z.string().min(1),
		question: z.string().min(1),
		defaultRecommendation: z.string().min(1),
		evidence: z.array(z.string().min(1)),
		allowedResponses: z.array(z.string().min(1)).min(1),
	})
	.strict();

export const callerRulingResponseSchema = z
	.object({
		rulingRequestId: z.string().min(1),
		decision: z.string().min(1),
		rationale: z.string().min(1),
		source: z.string().min(1),
	})
	.strict();

export const acceptanceCheckItemSchema = z
	.object({
		name: z.string().min(1),
		status: z.enum(["pass", "fail", "unknown"]),
		evidence: z.array(z.string().min(1)),
		reasoning: z.string().min(1),
	})
	.strict();

export const riskOrDeviationItemSchema = z
	.object({
		description: z.string().min(1),
		reasoning: z.string().min(1),
		evidence: z.array(z.string().min(1)),
		approvalStatus: z.enum([
			"not-required",
			"approved",
			"needs-ruling",
			"rejected",
		]),
		approvalSource: z.string().min(1).nullable(),
	})
	.strict();

const cleanupAcceptedRiskItemSchema = riskOrDeviationItemSchema.refine(
	(item) => item.approvalStatus === "approved",
	{
		message: "cleanup acceptedRiskItems must carry approvalStatus 'approved'",
	},
);

const cleanupDeferredItemSchema = riskOrDeviationItemSchema.refine(
	(item) => item.approvalStatus === "not-required",
	{
		message: "cleanup deferredItems must carry approvalStatus 'not-required'",
	},
);

export const storyLeadSummarySchema = z
	.object({
		storyTitle: z.string().min(1),
		implementedScope: z.string().min(1),
		acceptanceRationale: z.string().min(1),
	})
	.strict();

export const gateRunSummarySchema = z
	.object({
		command: z.string().min(1),
		result: z.enum(["pass", "fail", "not-run"]),
	})
	.strict();

export const verificationFindingDispositionSchema = z
	.object({
		id: z.string().min(1),
		status: z.enum(["fixed", "accepted-risk", "defer", "unresolved"]),
		evidence: z.array(z.string().min(1)),
	})
	.strict();

export const storyLeadVerificationSchema = z
	.object({
		finalVerifierOutcome: z.enum(["pass", "revise", "block", "not-run"]),
		findings: z.array(verificationFindingDispositionSchema),
	})
	.strict();

export const changedFileReviewSchema = z
	.object({
		path: z.string().min(1),
		reason: z.string().min(1),
	})
	.strict();

export const diffReviewSchema = z
	.object({
		changedFiles: z.array(changedFileReviewSchema),
		storyScopedAssessment: z.string().min(1),
	})
	.strict();

export const storyLeadEvidenceSchema = z
	.object({
		implementorArtifacts: z.array(artifactRefSchema),
		selfReviewArtifacts: z.array(artifactRefSchema),
		verifierArtifacts: z.array(artifactRefSchema),
		quickFixArtifacts: z.array(artifactRefSchema),
		callerInputArtifacts: z.array(artifactRefSchema),
		gateRuns: z.array(gateRunSummarySchema),
	})
	.strict();

export const storyLeadAcceptanceSummarySchema = z
	.object({
		acceptanceChecks: z.array(acceptanceCheckItemSchema),
		recommendedImplLeadAction: z.enum([
			"accept",
			"reject",
			"reopen",
			"ask-ruling",
		]),
	})
	.strict();

export const storyLeadRiskAndDeviationReviewSchema = z
	.object({
		specDeviations: z.array(riskOrDeviationItemSchema).optional(),
		assumedRisks: z.array(riskOrDeviationItemSchema).optional(),
		scopeChanges: z.array(riskOrDeviationItemSchema).optional(),
		productionPathDecisionItems: z.array(riskOrDeviationItemSchema).optional(),
	})
	.strict();

const runImplementPlannerInputsSchema = z
	.object({
		promptAddendum: z.string().min(1).optional(),
	})
	.strict();

const runContinuePlannerInputsSchema = z
	.object({
		continuationRef: z.string().min(1),
		promptAddendum: z.string().min(1),
	})
	.strict();

const runSelfReviewPlannerInputsSchema = z
	.object({
		artifactRefs: z.array(z.string().min(1)),
		focus: z.string().min(1).optional(),
		continuationRef: z.string().min(1).optional(),
		passes: z.number().int().positive().optional(),
	})
	.strict();

const runVerifyPlannerInputsSchema = z
	.object({
		artifactRefs: z.array(z.string().min(1)),
		focus: z.string().min(1).optional(),
		provider: providerIdSchema.optional(),
		verifierContinuationRef: z.string().min(1).optional(),
		responseArtifactRef: z.string().min(1).optional(),
		responseText: z.string().min(1).optional(),
		orchestratorContext: z.string().min(1).optional(),
	})
	.strict();

const runQuickFixPlannerInputsSchema = z
	.object({
		findingRefs: z.array(z.string().min(1)).optional(),
		remediationGoal: z.string().min(1),
		workingDirectory: z.string().min(1).optional(),
	})
	.strict();

const acceptStoryPlannerInputsSchema = z
	.object({
		summary: z.string().min(1),
		acceptanceCheckRefs: z.array(z.string().min(1)),
		acceptanceChecks: z.array(acceptanceCheckItemSchema).optional(),
		recommendedImplLeadAction: z.enum([
			"accept",
			"reject",
			"reopen",
			"ask-ruling",
		]),
	})
	.strict();

const requestRulingPlannerInputsSchema = z
	.object({
		id: z.string().min(1).optional(),
		decisionType: z.string().min(1),
		question: z.string().min(1),
		defaultRecommendation: z.string().min(1),
		evidence: z.array(z.string().min(1)),
		allowedResponses: z.array(z.string().min(1)).min(1),
	})
	.strict();

const blockStoryPlannerInputsSchema = z
	.object({
		reason: z.string().min(1),
		detail: z.string().min(1).optional(),
		evidence: z.array(z.string().min(1)),
	})
	.strict();

const failStoryPlannerInputsSchema = z
	.object({
		reason: z.string().min(1),
		detail: z.string().min(1).optional(),
		evidence: z.array(z.string().min(1)),
	})
	.strict();

function storyLeadActionEnvelopeSchema<
	TAction extends string,
	TInputs extends z.ZodTypeAny,
>(action: TAction, inputs: TInputs) {
	return z
		.object({
			action: z.literal(action),
			rationale: z.string().min(1),
			inputs,
			verification: storyLeadVerificationSchema.optional(),
			riskAndDeviationReview: storyLeadRiskAndDeviationReviewSchema.optional(),
			selfNote: z.string().min(1).optional(),
		})
		.strict();
}

export const storyLeadActionSchema = z
	.discriminatedUnion("action", [
		storyLeadActionEnvelopeSchema(
			"run-implement",
			runImplementPlannerInputsSchema,
		),
		storyLeadActionEnvelopeSchema(
			"run-continue",
			runContinuePlannerInputsSchema,
		),
		storyLeadActionEnvelopeSchema(
			"run-self-review",
			runSelfReviewPlannerInputsSchema,
		),
		storyLeadActionEnvelopeSchema("run-verify", runVerifyPlannerInputsSchema),
		storyLeadActionEnvelopeSchema(
			"run-quick-fix",
			runQuickFixPlannerInputsSchema,
		),
		storyLeadActionEnvelopeSchema(
			"accept-story",
			acceptStoryPlannerInputsSchema,
		),
		storyLeadActionEnvelopeSchema(
			"request-ruling",
			requestRulingPlannerInputsSchema,
		),
		storyLeadActionEnvelopeSchema("block-story", blockStoryPlannerInputsSchema),
		storyLeadActionEnvelopeSchema("fail-story", failStoryPlannerInputsSchema),
	])
	.superRefine((value, ctx) => {
		if (
			value.action === "run-verify" &&
			value.inputs.verifierContinuationRef &&
			!value.inputs.responseArtifactRef &&
			!value.inputs.responseText
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Verifier follow-up actions require responseArtifactRef or responseText.",
				path: ["inputs", "responseArtifactRef"],
			});
		}
	});

export const storyReceiptDraftSchema = z
	.object({
		storyId: z.string().min(1),
		storyTitle: z.string().min(1),
		implementorEvidenceRefs: z.array(z.string().min(1)),
		verifierEvidenceRefs: z.array(z.string().min(1)),
		gateCommand: z.string().min(1),
		gateResult: z.enum(["pass", "fail"]),
		dispositions: z.array(verificationFindingDispositionSchema),
		baselineBeforeStory: z.number().int().nullable(),
		baselineAfterStory: z.number().int().nullable(),
		openRisks: z.array(z.string().min(1)),
	})
	.strict();

export const cumulativeBaselineSchema = z
	.object({
		baselineBeforeCurrentStory: z.number().int().nullable(),
		expectedAfterCurrentStory: z.number().int().nullable(),
		latestActualTotal: z.number().int().nullable(),
	})
	.strict();

export const commitReadinessSchema = z
	.object({
		state: z.enum(["committed", "ready-for-impl-lead-commit", "not-ready"]),
		commitSha: z.string().min(1).optional(),
		reason: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.state === "committed" && !value.commitSha) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Committed log handoff entries require a commitSha.",
				path: ["commitSha"],
			});
		}

		if (value.state === "not-ready" && !value.reason) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Not-ready commit states require a reason.",
				path: ["reason"],
			});
		}
	});

export const logHandoffSchema = z
	.object({
		recommendedState: z.string().min(1),
		recommendedCurrentStory: z.string().min(1).nullable(),
		recommendedCurrentPhase: z.string().min(1).nullable(),
		continuationHandles: z.record(z.string(), continuationHandleSchema),
		storyReceiptDraft: storyReceiptDraftSchema,
		cumulativeBaseline: cumulativeBaselineSchema,
		commitReadiness: commitReadinessSchema,
		openRisks: z.array(z.string().min(1)),
	})
	.strict();

export const cleanupHandoffSchema = z
	.object({
		acceptedRiskItems: z.array(cleanupAcceptedRiskItemSchema),
		deferredItems: z.array(cleanupDeferredItemSchema),
		cleanupRequired: z.boolean(),
	})
	.strict();

export const storyLeadFinalPackageSchema = z
	.object({
		outcome: storyLeadOutcomeSchema,
		storyRunId: z.string().min(1),
		storyId: z.string().min(1),
		attempt: z.number().int().positive(),
		summary: storyLeadSummarySchema,
		evidence: storyLeadEvidenceSchema,
		verification: storyLeadVerificationSchema,
		riskAndDeviationReview: z
			.object({
				specDeviations: z.array(riskOrDeviationItemSchema),
				assumedRisks: z.array(riskOrDeviationItemSchema),
				scopeChanges: z.array(riskOrDeviationItemSchema),
				productionPathDecisionItems: z.array(riskOrDeviationItemSchema),
			})
			.strict(),
		diffReview: diffReviewSchema,
		acceptanceChecks: z.array(acceptanceCheckItemSchema),
		callerInputHistory: callerInputHistorySchema,
		runtimeIdentity: runtimeIdentitySchema,
		replayBoundary: replayBoundarySchema.nullable(),
		logHandoff: logHandoffSchema,
		cleanupHandoff: cleanupHandoffSchema,
		rulingRequest: callerRulingRequestSchema.nullable(),
		recommendedImplLeadAction: z.enum([
			"accept",
			"reject",
			"reopen",
			"ask-ruling",
		]),
	})
	.strict();

export const storyRunAttemptSummarySchema = storyRunCandidateSchema;

export const writeCurrentSnapshotInputSchema = z
	.object({
		storyId: z.string().min(1),
		storyRunId: z.string().min(1),
		snapshot: storyRunCurrentSnapshotSchema,
	})
	.strict();

export const appendStoryRunEventInputSchema = z
	.object({
		storyId: z.string().min(1),
		storyRunId: z.string().min(1),
		event: storyRunEventSchema,
	})
	.strict();

export const writeFinalPackageInputSchema = z
	.object({
		storyId: z.string().min(1),
		storyRunId: z.string().min(1),
		finalPackage: storyLeadFinalPackageSchema,
	})
	.strict();

export const storyRunSelectionSchema = z.discriminatedUnion("case", [
	z.object({ case: z.literal("start-new") }).strict(),
	z
		.object({
			case: z.literal("start-from-primitive-artifacts"),
			sourceArtifactPaths: z.array(z.string().min(1)),
		})
		.strict(),
	z
		.object({
			case: z.literal("existing-accepted-attempt"),
			storyRunId: z.string().min(1),
			finalPackagePath: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("resume-required"),
			storyRunId: z.string().min(1),
			currentSnapshotPath: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("active-attempt-exists"),
			storyRunId: z.string().min(1),
			currentSnapshotPath: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("ambiguous-story-run"),
			candidates: z.array(storyRunCandidateSchema),
		})
		.strict(),
	z
		.object({
			case: z.literal("invalid-story-id"),
			storyId: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("invalid-story-run-id"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
		})
		.strict(),
]);

export const storyOrchestrateBaselineSeedSchema = z
	.object({
		workspaceRoot: z.string().min(1),
		baselineBeforeCurrentStory: z.number().int().nonnegative(),
		testFilePattern: z.string().min(1),
	})
	.strict();

export const storyOrchestrateValidateCheckSchema = z
	.object({
		name: z.string().min(1),
		status: z.enum(["pass", "fail", "unknown"]),
		summary: z.string().min(1),
		evidence: z.array(z.string().min(1)),
	})
	.strict();

export const storyOrchestrateValidateResultSchema = z
	.object({
		status: z.enum(["ready", "needs-user-decision", "blocked"]),
		storyId: z.string().min(1),
		storyRunSelection: storyRunSelectionSchema,
		validatedConfig: implRunConfigSchema.optional(),
		providerMatrix: providerMatrixSchema.optional(),
		verificationGates: verificationGatesSchema.optional(),
		baselineSeed: storyOrchestrateBaselineSeedSchema.optional(),
		checks: z.array(storyOrchestrateValidateCheckSchema),
		blockers: z.array(z.string()),
		notes: z.array(z.string()),
	})
	.strict();

export const storyOrchestrateRunResultSchema = z.discriminatedUnion("case", [
	z
		.object({
			case: z.literal("completed"),
			outcome: storyLeadFinalPackageSchema.shape.outcome,
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
			currentSnapshotPath: z.string().min(1),
			eventHistoryPath: z.string().min(1),
			finalPackagePath: z.string().min(1),
			finalPackage: storyLeadFinalPackageSchema,
			startedFromPrimitiveArtifacts: z.array(z.string().min(1)).optional(),
		})
		.strict(),
	z
		.object({
			case: z.literal("interrupted"),
			outcome: z.literal("interrupted"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
			currentSnapshotPath: z.string().min(1),
			eventHistoryPath: z.string().min(1),
			finalPackagePath: z.string().min(1),
			finalPackage: storyLeadFinalPackageSchema,
			recoveryGuidance: z.string().min(1),
			latestEventSequence: z.number().int().nonnegative(),
		})
		.strict(),
	z
		.object({
			case: z.literal("existing-accepted-attempt"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
			finalPackagePath: z.string().min(1),
			suggestedNext: z.enum(["status", "resume"]),
		})
		.strict(),
	z
		.object({
			case: z.literal("resume-required"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
			currentSnapshotPath: z.string().min(1),
			suggestedCommand: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("active-attempt-exists"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
			currentSnapshotPath: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("ambiguous-story-run"),
			storyId: z.string().min(1),
			candidates: z.array(storyRunCandidateSchema),
		})
		.strict(),
	z
		.object({
			case: z.literal("invalid-story-id"),
			storyId: z.string().min(1),
		})
		.strict(),
]);

export const storyOrchestrateResumeResultSchema = z.discriminatedUnion("case", [
	z
		.object({
			case: z.literal("completed"),
			outcome: storyLeadFinalPackageSchema.shape.outcome,
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
			currentSnapshotPath: z.string().min(1),
			eventHistoryPath: z.string().min(1),
			finalPackagePath: z.string().min(1),
			finalPackage: storyLeadFinalPackageSchema,
			acceptedReviewRequestId: z.string().min(1).optional(),
			acceptedReviewRequestArtifact: artifactRefSchema.optional(),
			acceptedRulingRequestId: z.string().min(1).optional(),
			acceptedRulingArtifact: artifactRefSchema.optional(),
		})
		.strict(),
	z
		.object({
			case: z.literal("interrupted"),
			outcome: z.literal("interrupted"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
			currentSnapshotPath: z.string().min(1),
			eventHistoryPath: z.string().min(1),
			finalPackagePath: z.string().min(1),
			finalPackage: storyLeadFinalPackageSchema,
			recoveryGuidance: z.string().min(1),
			latestEventSequence: z.number().int().nonnegative(),
			acceptedReviewRequestArtifact: artifactRefSchema.optional(),
			acceptedRulingArtifact: artifactRefSchema.optional(),
		})
		.strict(),
	z
		.object({
			case: z.literal("existing-accepted-attempt"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
			finalPackagePath: z.string().min(1),
			suggestedNext: z.enum(["status", "resume-with-review-request"]),
		})
		.strict(),
	z
		.object({
			case: z.literal("invalid-review-request"),
			storyId: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("invalid-ruling"),
			storyId: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("invalid-story-run-id"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("ambiguous-story-run"),
			storyId: z.string().min(1),
			candidates: z.array(storyRunCandidateSchema),
		})
		.strict(),
	z
		.object({
			case: z.literal("invalid-story-id"),
			storyId: z.string().min(1),
		})
		.strict(),
]);

export const storyOrchestrateStatusResultSchema = z.discriminatedUnion("case", [
	z
		.object({
			case: z.literal("single-attempt"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
			currentSnapshotPath: z.string().min(1),
			eventHistoryPath: z.string().min(1),
			statusArtifactPath: z.string().min(1),
			currentSnapshot: storyRunCurrentSnapshotSchema,
			currentStatus: storyRunStatusSchema,
			lifecycleState: storyOrchestrateLifecycleStateSchema,
			latestEventSequence: z.number().int().nonnegative(),
			latestEvent: storyRunEventSchema.nullable(),
			latestChildOperation: currentChildOperationSchema.nullable(),
			runtimeIdentity: runtimeIdentitySchema,
			elapsedTime: z.string().min(1),
			terminalResult: storyLeadOutcomeSchema.optional(),
			finalPackagePath: z.string().min(1).optional(),
			finalPackage: storyLeadFinalPackageSchema.optional(),
		})
		.strict(),
	z
		.object({
			case: z.literal("ambiguous-story-run"),
			storyId: z.string().min(1),
			candidates: z.array(storyRunCandidateSchema),
		})
		.strict(),
	z
		.object({
			case: z.literal("invalid-story-id"),
			storyId: z.string().min(1),
		})
		.strict(),
	z
		.object({
			case: z.literal("invalid-story-run-id"),
			storyId: z.string().min(1),
			storyRunId: z.string().min(1),
		})
		.strict(),
]);

export type StoryLeadOutcome = z.infer<typeof storyLeadOutcomeSchema>;
export type StoryRunStatus = z.infer<typeof storyRunStatusSchema>;
export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export type StoryRunCandidate = z.infer<typeof storyRunCandidateSchema>;
export type CurrentChildOperation = z.infer<typeof currentChildOperationSchema>;
export type StoryRunNextIntent = z.infer<typeof storyRunNextIntentSchema>;
export type CallerInputHistory = z.infer<typeof callerInputHistorySchema>;
export type ReplayBoundary = z.infer<typeof replayBoundarySchema>;
export type StoryRunCurrentSnapshot = z.infer<
	typeof storyRunCurrentSnapshotSchema
>;
export type ContextDocument = z.infer<typeof contextDocumentSchema>;
export type StoryLeadSelfNote = z.infer<typeof storyLeadSelfNoteSchema>;
export type StoryLeadPlannerContext = z.infer<
	typeof storyLeadPlannerContextSchema
>;
export type StoryLeadContextOverflowError = z.infer<
	typeof storyLeadContextOverflowErrorSchema
>;
export type StoryRunEvent = z.infer<typeof storyRunEventSchema>;
export type ImplLeadReviewItem = z.infer<typeof implLeadReviewItemSchema>;
export type ImplLeadReviewRequest = z.infer<typeof implLeadReviewRequestSchema>;
export type CallerRulingRequest = z.infer<typeof callerRulingRequestSchema>;
export type CallerRulingResponse = z.infer<typeof callerRulingResponseSchema>;
export type AcceptanceCheckItem = z.infer<typeof acceptanceCheckItemSchema>;
export type RiskOrDeviationItem = z.infer<typeof riskOrDeviationItemSchema>;
export type StoryLeadSummary = z.infer<typeof storyLeadSummarySchema>;
export type GateRunSummary = z.infer<typeof gateRunSummarySchema>;
export type VerificationFindingDisposition = z.infer<
	typeof verificationFindingDispositionSchema
>;
export type StoryLeadVerification = z.infer<typeof storyLeadVerificationSchema>;
export type ChangedFileReview = z.infer<typeof changedFileReviewSchema>;
export type DiffReview = z.infer<typeof diffReviewSchema>;
export type StoryLeadEvidence = z.infer<typeof storyLeadEvidenceSchema>;
export type StoryLeadAcceptanceSummary = z.infer<
	typeof storyLeadAcceptanceSummarySchema
>;
export type StoryLeadRiskAndDeviationReview = z.infer<
	typeof storyLeadRiskAndDeviationReviewSchema
>;
export type StoryLeadAction = z.infer<typeof storyLeadActionSchema>;
export type StoryReceiptDraft = z.infer<typeof storyReceiptDraftSchema>;
export type CumulativeBaseline = z.infer<typeof cumulativeBaselineSchema>;
export type CommitReadiness = z.infer<typeof commitReadinessSchema>;
export type LogHandoff = z.infer<typeof logHandoffSchema>;
export type CleanupHandoff = z.infer<typeof cleanupHandoffSchema>;
export type StoryLeadFinalPackage = z.infer<typeof storyLeadFinalPackageSchema>;
export type StoryRunAttemptSummary = z.infer<
	typeof storyRunAttemptSummarySchema
>;
export type WriteCurrentSnapshotInput = z.infer<
	typeof writeCurrentSnapshotInputSchema
>;
export type AppendStoryRunEventInput = z.infer<
	typeof appendStoryRunEventInputSchema
>;
export type WriteFinalPackageInput = z.infer<
	typeof writeFinalPackageInputSchema
>;
export type StoryRunSelection = z.infer<typeof storyRunSelectionSchema>;
export type StoryOrchestrateBaselineSeed = z.infer<
	typeof storyOrchestrateBaselineSeedSchema
>;
export type StoryOrchestrateValidateCheck = z.infer<
	typeof storyOrchestrateValidateCheckSchema
>;
export type StoryOrchestrateValidateResult = z.infer<
	typeof storyOrchestrateValidateResultSchema
>;
export type StoryOrchestrateRunResult = z.infer<
	typeof storyOrchestrateRunResultSchema
>;
export type StoryOrchestrateResumeResult = z.infer<
	typeof storyOrchestrateResumeResultSchema
>;
export type StoryOrchestrateStatusResult = z.infer<
	typeof storyOrchestrateStatusResultSchema
>;
