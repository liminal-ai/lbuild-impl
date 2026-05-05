import type {
	ContextDocument,
	StoryLeadPlannerContext,
	StoryLeadSelfNote,
} from "./story-orchestrate-contracts.js";

type StructuredValue =
	| null
	| boolean
	| number
	| string
	| StructuredValue[]
	| { [key: string]: StructuredValue };

function renderDocument(document: ContextDocument): string {
	return [
		`### ${document.kind}`,
		...(document.path ? [`Path: ${document.path}`] : []),
		`Bytes: ${document.bytes}`,
		"",
		document.content,
	].join("\n");
}

function parseStructuredDocument(
	document: ContextDocument,
): StructuredValue | undefined {
	if (document.kind === "event-history") {
		const entries = document.content
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (entries.length === 0) {
			return [];
		}
		try {
			return entries.map((line) => JSON.parse(line) as StructuredValue);
		} catch {
			return undefined;
		}
	}

	const looksJson =
		document.kind === "current-snapshot" ||
		document.kind === "runtime-settings" ||
		document.path?.endsWith(".json") === true;
	if (!looksJson) {
		return undefined;
	}

	try {
		return JSON.parse(document.content) as StructuredValue;
	} catch {
		return undefined;
	}
}

function yamlScalar(
	value: null | boolean | number | string,
	indent: number,
): {
	singleLine: boolean;
	text: string;
} {
	if (value === null) {
		return {
			singleLine: true,
			text: "null",
		};
	}
	if (typeof value === "boolean" || typeof value === "number") {
		return {
			singleLine: true,
			text: String(value),
		};
	}
	if (!value.includes("\n")) {
		return {
			singleLine: true,
			text: JSON.stringify(value),
		};
	}

	const padding = " ".repeat(indent + 2);
	return {
		singleLine: false,
		text: ["|-", ...value.split("\n").map((line) => `${padding}${line}`)].join(
			"\n",
		),
	};
}

function renderYaml(value: StructuredValue, indent = 0): string {
	const padding = " ".repeat(indent);

	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string"
	) {
		return yamlScalar(value, indent).text;
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			return "[]";
		}

		return value
			.map((entry) => {
				if (
					entry === null ||
					typeof entry === "boolean" ||
					typeof entry === "number" ||
					typeof entry === "string"
				) {
					const scalar = yamlScalar(entry, indent);
					if (scalar.singleLine) {
						return `${padding}- ${scalar.text}`;
					}
					return `${padding}- ${scalar.text}`;
				}

				const nested = renderYaml(entry, indent + 2);
				return `${padding}-\n${nested}`;
			})
			.join("\n");
	}

	const entries = Object.entries(value);
	if (entries.length === 0) {
		return "{}";
	}

	return entries
		.map(([key, entryValue]) => renderYamlProperty(key, entryValue, indent))
		.join("\n");
}

function renderYamlProperty(
	key: string,
	value: StructuredValue,
	indent = 0,
): string {
	const padding = " ".repeat(indent);
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string"
	) {
		const scalar = yamlScalar(value, indent);
		if (scalar.singleLine) {
			return `${padding}${key}: ${scalar.text}`;
		}
		const [firstLine, ...rest] = scalar.text.split("\n");
		return [`${padding}${key}: ${firstLine}`, ...rest].join("\n");
	}

	return [`${padding}${key}:`, renderYaml(value, indent + 2)].join("\n");
}

function renderStructuredDocument(document: ContextDocument): string {
	const structured = parseStructuredDocument(document);
	if (structured === undefined) {
		return renderDocument(document);
	}

	return [
		`### ${document.kind}`,
		...(document.path ? [`Path: ${document.path}`] : []),
		`Bytes: ${document.bytes}`,
		"",
		"```yaml",
		renderYaml(structured),
		"```",
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

function splitCurrentAndHistory(documents: ContextDocument[]): {
	current: ContextDocument | null;
	history: ContextDocument[];
} {
	if (documents.length === 0) {
		return {
			current: null,
			history: [],
		};
	}

	return {
		current: documents[documents.length - 1] ?? null,
		history: documents.slice(0, -1),
	};
}

function renderCurrentRunIndex(context: StoryLeadPlannerContext): string {
	const snapshot = parseStructuredDocument(context.currentSnapshot) as
		| {
				status?: unknown;
				lifecycleState?: unknown;
				currentPhase?: unknown;
				currentSummary?: unknown;
				currentChildOperation?: { command?: unknown } | null;
		  }
		| undefined;
	const latestSelfNote =
		context.priorSelfNotes[context.priorSelfNotes.length - 1]?.note ?? "none";
	const currentResponse = splitCurrentAndHistory(
		context.resultArtifacts,
	).current;

	return [
		`- planner_turn_index: ${context.plannerTurnIndex}`,
		`- mode: ${context.mode}`,
		`- current_status: ${
			typeof snapshot?.status === "string" ? snapshot.status : "unknown"
		}`,
		`- lifecycle_state: ${
			typeof snapshot?.lifecycleState === "string"
				? snapshot.lifecycleState
				: "unknown"
		}`,
		`- current_phase: ${
			typeof snapshot?.currentPhase === "string"
				? snapshot.currentPhase
				: "unknown"
		}`,
		`- current_child_operation: ${
			typeof snapshot?.currentChildOperation?.command === "string"
				? snapshot.currentChildOperation.command
				: "none"
		}`,
		`- current_summary: ${
			typeof snapshot?.currentSummary === "string"
				? snapshot.currentSummary
				: "unknown"
		}`,
		`- latest_response_kind: ${currentResponse?.kind ?? "none"}`,
		`- latest_response_path: ${currentResponse?.path ?? "none"}`,
		`- older_response_count: ${splitCurrentAndHistory(context.resultArtifacts).history.length}`,
		`- caller_input_artifact_count: ${context.callerInputArtifacts.length}`,
		`- prior_self_note_count: ${context.priorSelfNotes.length}`,
		`- latest_self_note: ${JSON.stringify(latestSelfNote)}`,
	].join("\n");
}

function renderResponseEntry(document: ContextDocument): string {
	const structuredPayload = parseStructuredDocument(document);
	return [
		`kind: ${document.kind}`,
		...(document.path ? [`path: ${document.path}`] : []),
		`bytes: ${document.bytes}`,
		renderYamlProperty("payload", structuredPayload ?? document.content, 0),
	].join("\n");
}

function renderCurrentResponseSection(documents: ContextDocument[]): string {
	const { current } = splitCurrentAndHistory(documents);
	if (!current) {
		return [
			"<current_response>",
			"No prior bounded child response is recorded yet.",
			"</current_response>",
		].join("\n");
	}

	return [
		"<current_response>",
		"```yaml",
		renderResponseEntry(current),
		"```",
		"</current_response>",
	].join("\n");
}

function renderHistoryResponsesSection(documents: ContextDocument[]): string {
	const { history } = splitCurrentAndHistory(documents);
	if (history.length === 0) {
		return [
			"<history_responses>",
			"No older response entries are recorded yet.",
			"</history_responses>",
		].join("\n");
	}

	return [
		"<history_responses>",
		...history.map((document) =>
			[
				"<history_entry>",
				"```yaml",
				renderResponseEntry(document),
				"```",
				"</history_entry>",
			].join("\n"),
		),
		"</history_responses>",
	].join("\n\n");
}

function renderCallerInputArtifacts(documents: ContextDocument[]): string {
	if (documents.length === 0) {
		return "## Caller Input Artifacts\nNone.";
	}

	return [
		"## Caller Input Artifacts",
		...documents.map(renderStructuredDocument),
	].join("\n\n");
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
		'{"action":"accept-story","rationale":"...","inputs":{"summary":"...","acceptanceCheckRefs":["..."],"acceptanceChecks":[{"name":"...","status":"pass","evidence":["..."],"reasoning":"..."}],"recommendedImplLeadAction":"accept"},"verification":{"finalVerifierOutcome":"pass","findings":[{"id":"...","status":"fixed","evidence":["..."]}]}}',
		'{"action":"block-story","rationale":"...","inputs":{"reason":"...","detail":"optional","evidence":["..."]},"verification":{"finalVerifierOutcome":"block","findings":[{"id":"...","status":"unresolved","evidence":["..."]}]}}',
		'{"action":"fail-story","rationale":"...","inputs":{"reason":"...","detail":"optional","evidence":["..."]}}',
		"",
		"Rules:",
		"- Choose exactly one bounded next action.",
		"- Use only the durable story-run record in this prompt. Do not assume hidden retained planner memory exists.",
		"- Treat `<current_response>` as the latest bounded child response and `<history_responses>` as older response history.",
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
		`This is planner turn ${context.plannerTurnIndex}.`,
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
		"### Story Requirements",
		renderDocument(context.storyFile),
		"",
		"### Test Plan",
		renderDocument(context.testPlan),
		"",
		"## Current Run Index",
		renderCurrentRunIndex(context),
		"",
		"## Response Trail",
		renderCurrentResponseSection(context.resultArtifacts),
		"",
		renderHistoryResponsesSection(context.resultArtifacts),
		"",
		"## Current Snapshot",
		renderStructuredDocument(context.currentSnapshot),
		"",
		renderCallerInputArtifacts(context.callerInputArtifacts),
		"",
		"## Prior Self Notes",
		renderNotes(context.priorSelfNotes),
		...(context.seededSelfNoteInstruction
			? ["", "## Seeded Self-Note Example", context.seededSelfNoteInstruction]
			: []),
		"",
		"## Event History",
		renderStructuredDocument(context.eventHistory),
		"",
		"## State Rules",
		renderDocument(context.stateRules),
		"",
		"## Runtime Settings",
		renderStructuredDocument({
			kind: "runtime-settings",
			content: JSON.stringify(context.runtimeSettings, null, 2),
			bytes: Buffer.byteLength(
				JSON.stringify(context.runtimeSettings, null, 2),
				"utf8",
			),
		}),
		"",
		"## Action Protocol",
		outputContract(),
		"",
		"## Acceptance Rubric",
		"Choose the smallest safe bounded action that advances the story using the durable evidence already present.",
		"Prefer continuing from valid child-operation evidence over repeating work, and keep unresolved authority-boundary questions explicit.",
		"",
		"## Acceptance Decision Standard",
		"Choose `accept-story` only when the latest verifier result is `pass`, no open findings remain, required proof is present, and the configured story gate passed.",
		"If readiness is promising but gate truth is failed, unavailable, or uncertain, do not accept. Choose the smallest safe next action: verify, quick-fix, block, or request a ruling.",
		"",
		"## Ruling Boundaries",
		"Request a ruling when story-local requirements are insufficient, when a blocker needs a caller decision, or when the evidence conflicts in a way that the durable record cannot resolve safely.",
	].join("\n");
}
