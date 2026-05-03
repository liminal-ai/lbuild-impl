import type {
	ContextDocument,
	StoryLeadPlannerContext,
	StoryLeadSelfNote,
} from "./story-orchestrate-contracts.js";

function renderDocument(document: ContextDocument): string {
	return [
		`### ${document.kind}`,
		...(document.path ? [`Path: ${document.path}`] : []),
		`Bytes: ${document.bytes}`,
		"",
		document.content,
	].join("\n");
}

function renderNotes(notes: StoryLeadSelfNote[]): string {
	if (notes.length === 0) {
		return "No prior runtime self-notes are recorded yet.";
	}

	const latest = notes[notes.length - 1];
	return [
		`Latest note highlight: ${latest?.note ?? ""}`,
		"",
		"All prior runtime self-notes:",
		...notes.map(
			(note) =>
				`- sequence=${note.sequence}; actionSequence=${note.actionSequence}; createdAt=${note.createdAt}; note=${JSON.stringify(note.note)}`,
		),
	].join("\n");
}

function renderArtifacts(title: string, documents: ContextDocument[]): string {
	if (documents.length === 0) {
		return [`## ${title}`, "None."].join("\n");
	}

	return [`## ${title}`, ...documents.map(renderDocument)].join("\n\n");
}

function outputContract(): string {
	return [
		"Return exactly one JSON object matching `StoryLeadAction`.",
		"",
		"Examples:",
		'{"action":"run-implement","rationale":"...","inputs":{"promptAddendum":"optional"},"selfNote":"optional durable reminder"}',
		'{"action":"run-continue","rationale":"...","inputs":{"continuationRef":"storyImplementor","promptAddendum":"..."}}',
		'{"action":"run-self-review","rationale":"...","inputs":{"artifactRefs":["/abs/path.json"],"focus":"optional","continuationRef":"storyImplementor","passes":1}}',
		'{"action":"run-verify","rationale":"...","inputs":{"artifactRefs":["/abs/path.json"],"focus":"optional","provider":"codex"}}',
		'{"action":"run-verify","rationale":"...","inputs":{"artifactRefs":["/abs/path.json"],"verifierContinuationRef":"storyVerifier","responseArtifactRef":"/abs/path.json"}}',
		'{"action":"run-quick-fix","rationale":"...","inputs":{"findingRefs":["finding-001"],"remediationGoal":"...","workingDirectory":"optional"}}',
		'{"action":"request-ruling","rationale":"...","inputs":{"decisionType":"...","question":"...","defaultRecommendation":"...","evidence":["..."],"allowedResponses":["..."]}}',
		'{"action":"accept-story","rationale":"...","inputs":{"summary":"...","acceptanceCheckRefs":["check-001"],"acceptanceChecks":[{"name":"...","status":"pass","evidence":["..."],"reasoning":"..."}],"recommendedImplLeadAction":"accept"},"verification":{"finalVerifierOutcome":"pass","findings":[{"id":"...","status":"fixed","evidence":["..."]}]}}',
		'{"action":"block-story","rationale":"...","inputs":{"reason":"...","detail":"optional","evidence":["..."]},"verification":{"finalVerifierOutcome":"block","findings":[{"id":"...","status":"unresolved","evidence":["..."]}]}}',
		'{"action":"fail-story","rationale":"...","inputs":{"reason":"...","detail":"optional","evidence":["..."]}}',
		"",
		"Rules:",
		"- Choose exactly one bounded next action.",
		"- Use only the durable story-run record in this prompt. Do not assume hidden retained planner memory exists.",
		"- If the story file and test plan are insufficient for a safe next step, request a ruling instead of asking for epic, tech design, git status, or git diff by default.",
		"- Include `selfNote` only when you want to leave a durable reminder for a later planner turn.",
	].join("\n");
}

export function assembleStoryLeadPrompt(
	context: StoryLeadPlannerContext,
): string {
	return [
		"# Story Lead Base Prompt",
		"",
		"## Role Charter",
		`You are the story lead for \`${context.storyId}\` on durable story run \`${context.storyRunId}\`.`,
		`Select exactly one bounded next action for this \`${context.mode}\` turn.`,
		"Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.",
		"",
		"## Authority Boundary",
		"Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.",
		"You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.",
		"",
		"## Requirements Source",
		"Treat the story file and test plan below as the story-local requirements source for this turn.",
		"Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.",
		"",
		"## Durable Story-Run Record",
		renderDocument(context.storyFile),
		"",
		renderDocument(context.testPlan),
		"",
		renderDocument(context.currentSnapshot),
		"",
		renderDocument(context.eventHistory),
		"",
		renderArtifacts(
			"Prior Child Operation Result Artifacts",
			context.resultArtifacts,
		),
		"",
		renderArtifacts("Caller Input Artifacts", context.callerInputArtifacts),
		"",
		"## Prior Self Notes",
		renderNotes(context.priorSelfNotes),
		...(context.seededSelfNoteInstruction
			? ["", "## Seeded Self-Note Example", context.seededSelfNoteInstruction]
			: []),
		"",
		"## State Rules",
		renderDocument(context.stateRules),
		"",
		"## Runtime Settings",
		JSON.stringify(context.runtimeSettings, null, 2),
		"",
		"## Action Protocol",
		outputContract(),
		"",
		"## Acceptance Rubric",
		"Choose the smallest safe bounded action that advances the story using the durable evidence already present.",
		"Prefer continuing from valid child-operation evidence over repeating work, and keep unresolved authority-boundary questions explicit.",
		"",
		"## Ruling Boundaries",
		"Request a ruling when story-local requirements are insufficient, when a blocker needs a caller decision, or when the evidence conflicts in a way that the durable record cannot resolve safely.",
	].join("\n");
}
