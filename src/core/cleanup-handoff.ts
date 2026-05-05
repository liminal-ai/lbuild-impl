import type {
	CleanupHandoff,
	ReplayBoundary,
	RiskOrDeviationItem,
	StoryLeadVerification,
} from "./story-orchestrate-contracts.js";
import { cleanupHandoffSchema } from "./story-orchestrate-contracts.js";

function findingAsCleanupItem(input: {
	id: string;
	status: "accepted-risk" | "defer";
	evidence: string[];
	replayBoundary?: ReplayBoundary | null;
}): RiskOrDeviationItem {
	return {
		description:
			input.status === "accepted-risk"
				? `Verification finding ${input.id} accepted as risk.`
				: `Verification finding ${input.id} deferred for follow-up cleanup.`,
		reasoning:
			input.replayBoundary?.reasoning ??
			(input.status === "accepted-risk"
				? "Story-lead preserved the risk for impl-lead cleanup review."
				: "Story-lead deferred the finding for cleanup review."),
		evidence: input.evidence,
		approvalStatus:
			input.status === "accepted-risk" ? "approved" : "not-required",
		approvalSource:
			input.status === "accepted-risk" ? "story-lead-final-package" : null,
	};
}

export function buildCleanupHandoff(input: {
	acceptedRiskItems?: RiskOrDeviationItem[];
	deferredItems?: RiskOrDeviationItem[];
	productionPathItems?: RiskOrDeviationItem[];
	verification: StoryLeadVerification;
	replayBoundary?: ReplayBoundary | null;
}): CleanupHandoff {
	const acceptedRiskItems = [
		...(input.acceptedRiskItems ?? []).filter(
			(item) => item.approvalStatus === "approved",
		),
		...(input.productionPathItems ?? []).filter(
			(item) => item.approvalStatus === "approved",
		),
		...input.verification.findings
			.filter((finding) => finding.status === "accepted-risk")
			.map((finding) =>
				findingAsCleanupItem({
					id: finding.id,
					status: "accepted-risk",
					evidence: finding.evidence,
					replayBoundary: input.replayBoundary,
				}),
			),
	];
	const deferredItems = [
		...(input.deferredItems ?? []).filter(
			(item) => item.approvalStatus === "not-required",
		),
		...(input.productionPathItems ?? []).filter(
			(item) => item.approvalStatus === "not-required",
		),
		...input.verification.findings
			.filter((finding) => finding.status === "defer")
			.map((finding) =>
				findingAsCleanupItem({
					id: finding.id,
					status: "defer",
					evidence: finding.evidence,
					replayBoundary: input.replayBoundary,
				}),
			),
	];

	return cleanupHandoffSchema.parse({
		acceptedRiskItems,
		deferredItems,
		cleanupRequired: acceptedRiskItems.length > 0 || deferredItems.length > 0,
	});
}
