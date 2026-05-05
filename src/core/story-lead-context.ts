import { inspectSpecPack } from "./spec-pack.js";
import { readTextFile } from "./fs-utils.js";
import {
	getAllowedStoryLeadActionsForState,
	STORY_ORCHESTRATE_STATE_DEFINITIONS,
	STORY_RUN_TERMINAL_STATUS_DEFINITIONS,
} from "./story-lead-state-machine.js";
import {
	type ContextDocument,
	type StoryLeadContextOverflowError,
	type StoryLeadPlannerContext,
	type StoryLeadSelfNote,
	type StoryRunCurrentSnapshot,
	type StoryRunEvent,
	storyRunEventSchema,
	storyLeadPlannerContextSchema,
	storyLeadContextOverflowErrorSchema,
} from "./story-orchestrate-contracts.js";

const RESULT_ARTIFACT_KINDS = new Set([
	"implementor-result",
	"self-review-result",
	"verifier-result",
	"quick-fix-result",
]);

const CALLER_INPUT_ARTIFACT_KINDS = new Set([
	"review-request",
	"ruling-response",
	"caller-input",
	"prior-final-package",
]);

const DEFAULT_PROVIDER_LIMIT_BYTES: Record<string, number> = {
	"claude-code": 800_000,
	codex: 800_000,
	copilot: 800_000,
};

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

export class StoryLeadEventHistoryMalformedError extends Error {
	readonly code = "STORY_LEAD_EVENT_HISTORY_MALFORMED";

	constructor(
		readonly path: string,
		readonly line: number,
		cause: unknown,
	) {
		super(`Malformed story-run event history at ${path}:${line}.`, {
			cause,
		});
		this.name = "StoryLeadEventHistoryMalformedError";
	}
}

function buildDocument(input: {
	kind: string;
	content: string;
	path?: string;
}): ContextDocument {
	return {
		kind: input.kind,
		...(input.path ? { path: input.path } : {}),
		content: input.content,
		bytes: byteLength(input.content),
	};
}

function serializeEvents(events: StoryRunEvent[]): string {
	return events.length === 0
		? ""
		: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function buildStateRulesDocument(
	currentSnapshot: StoryRunCurrentSnapshot,
): ContextDocument {
	const lifecycleRules = STORY_ORCHESTRATE_STATE_DEFINITIONS.map((definition) =>
		[
			`State: ${definition.state}`,
			`Public status: ${definition.publicStatus ?? "terminal-only"}`,
			`Allowed actions: ${
				getAllowedStoryLeadActionsForState(definition.state).join(", ") ||
				"none"
			}`,
			`Meaning: ${definition.description}`,
			`Caller implication: ${definition.callerImplication}`,
		].join("\n"),
	).join("\n\n");
	const terminalRules = STORY_RUN_TERMINAL_STATUS_DEFINITIONS.map(
		(definition) =>
			[
				`Outcome: ${definition.status}`,
				`Meaning: ${definition.description}`,
				`Caller implication: ${definition.callerImplication}`,
			].join("\n"),
	).join("\n\n");

	return buildDocument({
		kind: "state-rules",
		content: [
			"Requirements source for story-local acceptance: the story file and test plan below.",
			`Current lifecycle state: ${currentSnapshot.lifecycleState}`,
			"",
			"Lifecycle rules:",
			lifecycleRules,
			"",
			"Terminal outcome rules:",
			terminalRules,
		].join("\n"),
	});
}

function extractSelfNotes(events: StoryRunEvent[]): StoryLeadSelfNote[] {
	return events.flatMap((event) => {
		if (event.type !== "story-lead-self-note-recorded" || !event.data) {
			return [];
		}

		const note = event.data.note;
		const actionSequence = event.data.actionSequence;
		if (
			typeof note !== "string" ||
			note.trim().length === 0 ||
			typeof actionSequence !== "number" ||
			!Number.isInteger(actionSequence)
		) {
			return [];
		}

		return [
			{
				sequence: event.sequence,
				actionSequence,
				note,
				createdAt: event.timestamp,
			},
		];
	});
}

function plannerTurnIndex(events: StoryRunEvent[]): number {
	const consumedTurnEventTypes = new Set([
		"story-lead-provider-started",
		"story-lead-provider-failed",
		"provider-output-invalid",
		"story-lead-planner-timeout",
		"story-lead-context-overflow",
	]);

	return (
		events.filter((event) => consumedTurnEventTypes.has(event.type)).length + 1
	);
}

function selfNotesDocument(notes: StoryLeadSelfNote[]): ContextDocument | null {
	if (notes.length === 0) {
		return null;
	}

	const latest = notes[notes.length - 1];
	return buildDocument({
		kind: "prior-self-notes",
		content: [
			`Latest self-note (keep older notes in view): ${latest?.note ?? ""}`,
			"",
			"All prior self-notes:",
			...notes.map(
				(note) =>
					`- sequence=${note.sequence}; actionSequence=${note.actionSequence}; createdAt=${note.createdAt}; note=${JSON.stringify(note.note)}`,
			),
		].join("\n"),
	});
}

function contextSources(input: StoryLeadPlannerContext): ContextDocument[] {
	const selfNotesDoc = selfNotesDocument(input.priorSelfNotes);
	return [
		input.storyFile,
		input.testPlan,
		input.currentSnapshot,
		input.eventHistory,
		...input.resultArtifacts,
		...input.callerInputArtifacts,
		...(selfNotesDoc ? [selfNotesDoc] : []),
		...(input.seededSelfNoteInstruction
			? [
					buildDocument({
						kind: "seeded-self-note-instruction",
						content: input.seededSelfNoteInstruction,
					}),
				]
			: []),
		input.stateRules,
		buildDocument({
			kind: "runtime-settings",
			content: JSON.stringify(input.runtimeSettings, null, 2),
		}),
	];
}

export function describeStoryLeadContextSources(
	context: StoryLeadPlannerContext,
): Pick<
	StoryLeadContextOverflowError,
	"requiredContextBytes" | "largestSources"
> {
	const sources = contextSources(context);
	return {
		requiredContextBytes: sources.reduce(
			(total, source) => total + source.bytes,
			0,
		),
		largestSources: sources
			.map((source) => ({
				kind: source.kind,
				path: source.path,
				bytes: source.bytes,
			}))
			.sort((left, right) => right.bytes - left.bytes)
			.slice(0, 5),
	};
}

function maybeThrowOverflow(input: {
	context: StoryLeadPlannerContext;
	provider: string;
	model: string;
	providerLimitBytes?: number;
}) {
	const { requiredContextBytes, largestSources } =
		describeStoryLeadContextSources(input.context);
	const providerLimit =
		input.providerLimitBytes ?? DEFAULT_PROVIDER_LIMIT_BYTES[input.provider];
	if (!providerLimit || requiredContextBytes <= providerLimit) {
		return;
	}

	const error: StoryLeadContextOverflowError = {
		code: "STORY_LEAD_CONTEXT_OVERFLOW",
		storyId: input.context.storyId,
		storyRunId: input.context.storyRunId,
		provider: input.provider,
		model: input.model,
		requiredContextBytes,
		providerLimit,
		largestSources,
	};

	throw storyLeadContextOverflowErrorSchema.parse(error);
}

async function readArtifactDocuments(input: {
	artifacts: StoryRunCurrentSnapshot["latestArtifacts"];
	kinds: Set<string>;
}): Promise<ContextDocument[]> {
	const documents: ContextDocument[] = [];

	for (const artifact of input.artifacts) {
		if (!input.kinds.has(artifact.kind)) {
			continue;
		}

		const content = await readTextFile(artifact.path);
		documents.push(
			buildDocument({
				kind: artifact.kind,
				path: artifact.path,
				content,
			}),
		);
	}

	return documents;
}

export async function readStoryRunEvents(
	eventHistoryPath: string,
): Promise<StoryRunEvent[]> {
	let content: string;
	try {
		content = await readTextFile(eventHistoryPath);
	} catch (error) {
		if (!isMissingFileError(error)) {
			throw error;
		}
		return [];
	}

	return content
		.split("\n")
		.map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
		.filter((entry) => entry.line.length > 0)
		.map((entry) => {
			try {
				return storyRunEventSchema.parse(JSON.parse(entry.line));
			} catch (error) {
				throw new StoryLeadEventHistoryMalformedError(
					eventHistoryPath,
					entry.lineNumber,
					error,
				);
			}
		});
}

export async function buildStoryLeadPlannerContext(input: {
	specPackRoot: string;
	storyId: string;
	storyRunId: string;
	mode: "run" | "resume";
	currentSnapshot: StoryRunCurrentSnapshot;
	currentSnapshotPath: string;
	eventHistoryPath: string;
	provider: string;
	model: string;
	runtimeSettings: StoryLeadPlannerContext["runtimeSettings"];
	providerLimitBytes?: number;
}): Promise<StoryLeadPlannerContext> {
	const inspection = await inspectSpecPack(input.specPackRoot);
	const story = inspection.stories.find(
		(candidate) => candidate.id === input.storyId,
	);
	const storyPath =
		story?.path ?? `${inspection.artifacts.storiesDir}/${input.storyId}.md`;
	const storyFile = buildDocument({
		kind: "story-file",
		path: storyPath,
		content: await readTextFile(storyPath),
	});
	const testPlan = buildDocument({
		kind: "test-plan",
		path: inspection.artifacts.testPlanPath,
		content: await readTextFile(inspection.artifacts.testPlanPath),
	});
	const currentSnapshot = buildDocument({
		kind: "current-snapshot",
		path: input.currentSnapshotPath,
		content: JSON.stringify(input.currentSnapshot, null, 2),
	});
	const events = await readStoryRunEvents(input.eventHistoryPath);
	const eventHistory = buildDocument({
		kind: "event-history",
		path: input.eventHistoryPath,
		content: serializeEvents(events),
	});
	const resultArtifacts = await readArtifactDocuments({
		artifacts: input.currentSnapshot.latestArtifacts,
		kinds: RESULT_ARTIFACT_KINDS,
	});
	const callerInputArtifacts = await readArtifactDocuments({
		artifacts: input.currentSnapshot.latestArtifacts,
		kinds: CALLER_INPUT_ARTIFACT_KINDS,
	});
	const priorSelfNotes = extractSelfNotes(events);
	const context = storyLeadPlannerContextSchema.parse({
		storyId: input.storyId,
		storyRunId: input.storyRunId,
		mode: input.mode,
		plannerTurnIndex: plannerTurnIndex(events),
		storyFile,
		testPlan,
		currentSnapshot,
		eventHistory,
		resultArtifacts,
		callerInputArtifacts,
		priorSelfNotes,
		...(priorSelfNotes.length === 0
			? {
					seededSelfNoteInstruction:
						"Seeded first-turn instruction (not a prior runtime self-note): include `selfNote` when you want to leave a durable reminder for a later planner turn, for example `Track whether the next verifier pass still needs the ruling evidence.`",
				}
			: {}),
		stateRules: buildStateRulesDocument(input.currentSnapshot),
		runtimeSettings: input.runtimeSettings,
	});

	maybeThrowOverflow({
		context,
		provider: input.provider,
		model: input.model,
		providerLimitBytes: input.providerLimitBytes,
	});

	return context;
}
