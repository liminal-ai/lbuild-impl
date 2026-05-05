import type {
	CallerInputHistory,
	CallerRulingRequest,
	CallerRulingResponse,
	ImplLeadReviewRequest,
} from "./story-orchestrate-contracts.js";
import {
	callerInputHistorySchema,
	callerRulingRequestSchema,
} from "./story-orchestrate-contracts.js";

export const authorityBoundaryDecisionTypes = [
	"scope-change",
	"spec-ambiguity",
	"spec-deviation",
	"accepted-risk",
	"production-path",
	"gate-change",
	"provider-failure",
	"repeated-failure",
	"verifier-blocker",
] as const;

export type AuthorityBoundaryDecisionType =
	(typeof authorityBoundaryDecisionTypes)[number];

export function createCallerInputHistory(
	input?: Partial<CallerInputHistory>,
): CallerInputHistory {
	return callerInputHistorySchema.parse({
		reviewRequests: input?.reviewRequests ?? [],
		rulings: input?.rulings ?? [],
	});
}

export function appendReviewRequest(
	history: CallerInputHistory,
	reviewRequest: ImplLeadReviewRequest,
): CallerInputHistory {
	return callerInputHistorySchema.parse({
		reviewRequests: [...history.reviewRequests, reviewRequest],
		rulings: history.rulings,
	});
}

export function appendRulingResponse(
	history: CallerInputHistory,
	ruling: CallerRulingResponse,
): CallerInputHistory {
	return callerInputHistorySchema.parse({
		reviewRequests: history.reviewRequests,
		rulings: [...history.rulings, ruling],
	});
}

export function buildAuthorityBoundaryRulingRequest(input: {
	id: string;
	decisionType: AuthorityBoundaryDecisionType;
	question: string;
	defaultRecommendation: string;
	evidence: string[];
	allowedResponses?: string[];
}): CallerRulingRequest {
	return callerRulingRequestSchema.parse({
		id: input.id,
		decisionType: input.decisionType,
		question: input.question,
		defaultRecommendation: input.defaultRecommendation,
		evidence: input.evidence,
		allowedResponses: input.allowedResponses ?? ["approve", "reject"],
	});
}
