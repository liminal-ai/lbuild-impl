import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { writeAtomic } from "../infra/fs-atomic.js";
import { quickFix } from "../sdk/operations/quick-fix.js";
import { storyContinue } from "../sdk/operations/story-continue.js";
import { storyImplement } from "../sdk/operations/story-implement.js";
import { storySelfReview } from "../sdk/operations/story-self-review.js";
import { storyVerify } from "../sdk/operations/story-verify.js";
import {
	buildRuntimeProgressPaths,
	buildStreamOutputPaths,
	nextArtifactPath,
	nextGroupedArtifactPath,
	nextGroupedArtifactPaths,
} from "./artifact-writer.js";
import {
	type ImplRunConfig,
	loadRunConfig,
	requireStoryLeadProviderConfig,
	type RoleAssignment,
	resolveRunConfigPath,
	resolveRunTimeouts,
} from "./config-schema.js";
import { pathExists, readTextFile } from "./fs-utils.js";
import { resolveProviderCwd } from "./git-repo.js";
import {
	type AttachedProgressEvent,
	type CallerHarness,
	createStoryHeartbeatEmitter,
	resolveCallerHeartbeatOptions,
} from "./heartbeat.js";
import { type RuntimeStatus, runtimeStatusSchema } from "./runtime-progress.js";
import {
	createProviderAdapter,
	type ProviderExecutionResult,
	type ProviderName,
} from "./provider-adapters/index.js";
import type {
	ContinuationHandle,
	ImplementorResult,
	QuickFixResult,
	StorySelfReviewResult,
	StoryVerifierResult,
} from "./result-contracts.js";
import {
	appendReviewRequest,
	appendRulingResponse,
	buildAuthorityBoundaryRulingRequest,
	createCallerInputHistory,
} from "./review-ruling.js";
import { buildStoryLeadFinalPackage } from "./story-final-package.js";
import {
	buildStoryLeadPlannerContext,
	describeStoryLeadContextSources,
} from "./story-lead-context.js";
import { assembleStoryLeadPrompt } from "./story-lead-prompt.js";
import type {
	ArtifactRef,
	CallerInputHistory,
	CallerRulingRequest,
	CallerRulingResponse,
	ReplayBoundary,
	RiskOrDeviationItem,
	StoryLeadAcceptanceSummary,
	StoryLeadAction,
	StoryLeadContextOverflowError,
	StoryLeadFinalPackage,
	StoryLeadPlannerContext,
	StoryLeadRiskAndDeviationReview,
	StoryLeadVerification,
	StoryRunCurrentSnapshot,
	StoryRunEvent,
} from "./story-orchestrate-contracts.js";
import {
	type ImplLeadReviewRequest,
	storyLeadActionSchema,
} from "./story-orchestrate-contracts.js";
import {
	assertStoryLeadActionAllowed,
	type StoryLeadActionType,
} from "./story-lead-state-machine.js";
import { resolveStoryOrder } from "./story-order.js";
import type {
	StoryRunAttemptPaths,
	StoryRunAttemptRecord,
	StoryRunLedger,
} from "./story-run-ledger.js";
import { StoryRunArtifactIntegrityError } from "./story-run-ledger.js";

// Maintainer/debug-only simulation switches for deterministic tests and local
// diagnosis. These are not part of the public story-orchestrate contract.
const STORY_ORCHESTRATE_DELAY_MS_ENV = "LBUILD_IMPL_STORY_ORCHESTRATE_DELAY_MS";
const STORY_ORCHESTRATE_INCOMPLETE_ENV =
	"LBUILD_IMPL_STORY_ORCHESTRATE_INCOMPLETE";
const STORY_ORCHESTRATE_FAILURE_MODE_ENV =
	"LBUILD_IMPL_STORY_ORCHESTRATE_FAILURE_MODE";
const STORY_ORCHESTRATE_CRASH_AFTER_CHILD_RESULT_ENV =
	"LBUILD_IMPL_STORY_ORCHESTRATE_CRASH_AFTER_CHILD_RESULT";
const STORY_LEAD_MAX_TURNS = 12;

export interface StoryLeadRuntimeInput {
	specPackRoot: string;
	storyId: string;
	configPath?: string;
	env?: Record<string, string | undefined>;
	ledger: StoryRunLedger;
	mode: "run" | "resume";
	startedFromPrimitiveArtifacts?: string[];
	existingAttempt?: StoryRunAttemptRecord;
	reviewRequest?: ImplLeadReviewRequest;
	ruling?: CallerRulingResponse;
	callerHarness?: CallerHarness;
	heartbeatCadenceMinutes?: number;
	disableHeartbeats?: boolean;
	progressListener?: (event: AttachedProgressEvent) => void;
}

export interface StoryLeadRuntimeResult {
	case: "completed" | "interrupted";
	storyId: string;
	storyRunId: string;
	currentSnapshotPath: string;
	eventHistoryPath: string;
	finalPackagePath?: string;
	finalPackage?: StoryLeadFinalPackage;
	recoveryGuidance?: string;
	latestEventSequence: number;
	startedFromPrimitiveArtifacts?: string[];
	acceptedReviewRequestArtifact?: ArtifactRef;
	acceptedRulingArtifact?: ArtifactRef;
}

type OperationEnvelope<TResult> = {
	command: string;
	status: string;
	outcome: string;
	result?: TResult;
	errors: Array<{ code: string; message: string; detail?: string }>;
	warnings: string[];
	artifacts: Array<{ kind: string; path: string }>;
};

type StoryLeadFailureReason =
	| "provider-output-invalid"
	| "artifact-integrity-failed"
	| "context-window-limit"
	| "planner-timeout"
	| "interrupted";

type StoryLeadTerminalDecision =
	| {
			kind: "accept";
			acceptance: StoryLeadAcceptanceSummary;
			verification?: StoryLeadVerification;
			riskAndDeviationReview?: StoryLeadRiskAndDeviationReview;
			rationale: string;
	  }
	| {
			kind: "block";
			reason: string;
			detail?: string;
			verification?: StoryLeadVerification;
			riskAndDeviationReview?: StoryLeadRiskAndDeviationReview;
			rationale: string;
	  }
	| {
			kind: "fail";
			reason: string;
			detail?: string;
			verification?: StoryLeadVerification;
			riskAndDeviationReview?: StoryLeadRiskAndDeviationReview;
			rationale: string;
	  }
	| {
			kind: "request-ruling";
			request: CallerRulingRequest;
			verification?: StoryLeadVerification;
			riskAndDeviationReview?: StoryLeadRiskAndDeviationReview;
			rationale: string;
	  };

async function loadRunConfigIfPresent(input: {
	specPackRoot: string;
	configPath?: string;
}): Promise<ImplRunConfig | undefined> {
	const resolvedPath = resolveRunConfigPath(
		input.specPackRoot,
		input.configPath,
	);
	if (!(await pathExists(resolvedPath))) {
		return undefined;
	}

	return await loadRunConfig(input);
}

async function resolveStoryTitle(
	specPackRoot: string,
	storyId: string,
): Promise<string> {
	const storyOrder = await resolveStoryOrder(`${specPackRoot}/stories`);
	return (
		storyOrder.stories.find((candidate) => candidate.id === storyId)?.title ??
		storyId
	);
}

function nowIso(): string {
	return new Date().toISOString();
}

function readDelayMs(): number {
	const parsed = Number.parseInt(
		process.env[STORY_ORCHESTRATE_DELAY_MS_ENV] ?? "0",
		10,
	);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function shouldLeaveAttemptIncomplete(): boolean {
	return process.env[STORY_ORCHESTRATE_INCOMPLETE_ENV] === "1";
}

function readFailureMode():
	| "provider-output-invalid"
	| "context-window-limit"
	| null {
	const value = process.env[STORY_ORCHESTRATE_FAILURE_MODE_ENV];
	if (value === "provider-output-invalid" || value === "context-window-limit") {
		return value;
	}

	return null;
}

function shouldCrashAfterChildResult(): boolean {
	return process.env[STORY_ORCHESTRATE_CRASH_AFTER_CHILD_RESULT_ENV] === "1";
}

function providerForHarness(
	harness: RoleAssignment["secondary_harness"],
): ProviderName {
	if (harness === "none") {
		return "claude-code";
	}

	return harness;
}

function resolveStoryLeadAssignment(
	config?: ImplRunConfig,
): RoleAssignment | undefined {
	return config?.story_lead_provider;
}

function artifactKindForCommand(
	command: string | undefined,
): ArtifactRef["kind"] {
	switch (command) {
		case "story-verify":
			return "verifier-result";
		case "story-self-review":
			return "self-review-result";
		case "quick-fix":
			return "quick-fix-result";
		default:
			return "implementor-result";
	}
}

async function buildArtifactRefs(paths: string[]): Promise<ArtifactRef[]> {
	const refs: ArtifactRef[] = [];

	for (const path of paths) {
		let command: string | undefined;
		try {
			const parsed = JSON.parse(await readTextFile(path)) as {
				command?: unknown;
			};
			command = typeof parsed.command === "string" ? parsed.command : undefined;
		} catch {
			command = undefined;
		}

		refs.push({
			kind: artifactKindForCommand(command),
			path,
			provenance: "fixture/preexisting",
		});
	}

	return refs;
}

function reclassifyArtifacts(
	artifacts: ArtifactRef[],
	provenance: NonNullable<ArtifactRef["provenance"]>,
): ArtifactRef[] {
	return artifacts.map((artifact) => ({
		...artifact,
		provenance,
	}));
}

function recoverLegacyArtifactProvenance(
	artifact: ArtifactRef,
): NonNullable<ArtifactRef["provenance"]> {
	if (artifact.provenance) {
		return artifact.provenance;
	}

	switch (artifact.kind) {
		case "prior-final-package":
		case "final-package":
			return "prior-run";
		case "review-request":
		case "ruling-response":
			return "caller-input";
		default:
			return "fixture/preexisting";
	}
}

function normalizeRecoveredArtifacts(artifacts: ArtifactRef[]): ArtifactRef[] {
	return artifacts.map((artifact) => ({
		...artifact,
		provenance: recoverLegacyArtifactProvenance(artifact),
	}));
}

function mergeArtifacts(
	current: ArtifactRef[],
	additions: ArtifactRef[],
): ArtifactRef[] {
	const merged = [...current];
	const seen = new Set(
		current.map((artifact) => `${artifact.kind}:${artifact.path}`),
	);

	for (const artifact of additions) {
		const key = `${artifact.kind}:${artifact.path}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(artifact);
	}

	return merged;
}

function filterArtifactsByKind(
	artifacts: ArtifactRef[],
	kinds: string[],
): ArtifactRef[] {
	return artifacts.filter((artifact) => kinds.includes(artifact.kind));
}

interface ChildOperationArtifacts {
	artifactPath: string;
	runtimeProgressPaths: ReturnType<typeof buildRuntimeProgressPaths>;
	streamOutputPaths: ReturnType<typeof buildStreamOutputPaths>;
	passArtifactPaths?: string[];
}

interface ChildProcessCleanupRecord {
	type: "child-process-stopped" | "child-process-abandoned";
	summary: string;
	data: Record<string, unknown>;
}

async function allocateChildOperationArtifacts(input: {
	specPackRoot: string;
	storyId: string;
	command:
		| "story-implement"
		| "story-continue"
		| "story-self-review"
		| "story-verify"
		| "quick-fix";
	selfReviewPasses?: number;
}): Promise<ChildOperationArtifacts> {
	if (input.command === "story-self-review") {
		const passCount = Math.max(1, input.selfReviewPasses ?? 1);
		const allocatedPaths = await nextGroupedArtifactPaths(
			input.specPackRoot,
			input.storyId,
			[
				...Array.from(
					{
						length: passCount,
					},
					(_, index) => `self-review-pass-${index + 1}`,
				),
				"self-review-batch",
			],
		);
		const artifactPath = allocatedPaths[allocatedPaths.length - 1];
		if (typeof artifactPath !== "string") {
			throw new Error("Unable to allocate story-self-review batch artifact.");
		}

		return {
			artifactPath,
			runtimeProgressPaths: buildRuntimeProgressPaths(artifactPath),
			streamOutputPaths: buildStreamOutputPaths(artifactPath),
			passArtifactPaths: allocatedPaths.slice(0, -1),
		};
	}

	const artifactPath =
		input.command === "quick-fix"
			? await nextArtifactPath(input.specPackRoot, "quick-fix")
			: await nextGroupedArtifactPath(
					input.specPackRoot,
					input.storyId,
					(
						{
							"story-implement": "implementor",
							"story-continue": "continue",
							"story-verify": "verify",
						} as const
					)[input.command],
				);

	return {
		artifactPath,
		runtimeProgressPaths: buildRuntimeProgressPaths(artifactPath),
		streamOutputPaths: buildStreamOutputPaths(artifactPath),
	};
}

async function readChildRuntimeStatus(
	artifactPath: string,
): Promise<RuntimeStatus | null> {
	const statusPath = buildRuntimeProgressPaths(artifactPath).statusPath;
	if (!(await pathExists(statusPath))) {
		return null;
	}

	try {
		return runtimeStatusSchema.parse(
			JSON.parse(await readTextFile(statusPath)) as unknown,
		);
	} catch {
		return null;
	}
}

function isProcessMissing(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code === "ESRCH"
	);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !isProcessMissing(error);
	}
}

async function stopTrackedChildProcess(pid: number): Promise<boolean> {
	try {
		process.kill(pid, "SIGTERM");
	} catch (error) {
		if (isProcessMissing(error)) {
			return true;
		}
		return false;
	}

	for (let attempt = 0; attempt < 4; attempt += 1) {
		await sleep(50);
		if (!isProcessAlive(pid)) {
			return true;
		}
	}

	try {
		process.kill(pid, "SIGKILL");
	} catch (error) {
		if (isProcessMissing(error)) {
			return true;
		}
		return false;
	}

	for (let attempt = 0; attempt < 4; attempt += 1) {
		await sleep(50);
		if (!isProcessAlive(pid)) {
			return true;
		}
	}

	return !isProcessAlive(pid);
}

async function cleanupTrackedChildOperation(input: {
	storyId: string;
	storyRunId: string;
	childOperation: StoryRunCurrentSnapshot["currentChildOperation"];
}): Promise<ChildProcessCleanupRecord | null> {
	const artifactPath = input.childOperation?.artifactPath;
	if (!artifactPath) {
		return null;
	}

	const runtimeStatus = await readChildRuntimeStatus(artifactPath);
	const statusArtifactPath = buildRuntimeProgressPaths(artifactPath).statusPath;
	const cleanupTimestamp = nowIso();
	const cleanupData: Record<string, unknown> = {
		storyId: input.storyId,
		storyRunId: input.storyRunId,
		command: input.childOperation?.command,
		artifactPath,
		statusArtifactPath,
		cleanedUpAt: cleanupTimestamp,
		...(runtimeStatus
			? {
					provider: runtimeStatus.provider,
					pid: runtimeStatus.pid,
					streamPaths: runtimeStatus.streamPaths,
				}
			: {}),
	};

	if (typeof runtimeStatus?.pid === "number") {
		const stopped = await stopTrackedChildProcess(runtimeStatus.pid);
		if (stopped) {
			return {
				type: "child-process-stopped",
				summary: `Stopped stale ${input.childOperation?.command} provider process ${runtimeStatus.pid} after interruption handling.`,
				data: cleanupData,
			};
		}
	}

	return {
		type: "child-process-abandoned",
		summary: `Recorded abandoned ${input.childOperation?.command} provider process identity after interruption handling.`,
		data: cleanupData,
	};
}

type DerivedVerifierOutcome = "pass" | "revise" | "block" | "not-run";

function normalizeVerifierOutcome(
	outcome: unknown,
): Exclude<DerivedVerifierOutcome, "not-run"> | null {
	switch (outcome) {
		case "pass":
		case "revise":
		case "block":
			return outcome;
		case "needs-human-ruling":
			return "block";
		default:
			return null;
	}
}

function verifierMockOrShimFindingAsRiskItem(input: {
	finding: string;
	verifierArtifacts: ArtifactRef[];
}): RiskOrDeviationItem {
	return {
		description: input.finding,
		reasoning:
			"Story verifier surfaced a mock/shim/fallback audit finding that must be explicitly resolved before story acceptance.",
		evidence: [
			...input.verifierArtifacts.map((artifact) => artifact.path),
			input.finding,
		],
		approvalStatus: "needs-ruling",
		approvalSource: null,
	};
}

function mergeRiskReview(input: {
	base?: StoryLeadRiskAndDeviationReview;
	shimMockFallbackDecisions: RiskOrDeviationItem[];
}): StoryLeadRiskAndDeviationReview {
	return {
		specDeviations: input.base?.specDeviations,
		assumedRisks: input.base?.assumedRisks,
		scopeChanges: input.base?.scopeChanges,
		shimMockFallbackDecisions: [
			...(input.base?.shimMockFallbackDecisions ?? []),
			...input.shimMockFallbackDecisions,
		],
	};
}

async function deriveVerifierOutcomeFromArtifacts(
	artifacts: ArtifactRef[],
): Promise<DerivedVerifierOutcome> {
	const uniqueOutcomes = new Set<Exclude<DerivedVerifierOutcome, "not-run">>();

	for (const artifact of artifacts) {
		try {
			const parsed = JSON.parse(await readTextFile(artifact.path)) as {
				command?: unknown;
				outcome?: unknown;
				result?: { recommendedNextStep?: unknown };
			};
			const command =
				typeof parsed.command === "string" ? parsed.command : undefined;
			if (command !== "story-verify" && artifact.kind !== "verifier-result") {
				continue;
			}

			const normalized =
				normalizeVerifierOutcome(parsed.outcome) ??
				normalizeVerifierOutcome(parsed.result?.recommendedNextStep);
			if (normalized) {
				uniqueOutcomes.add(normalized);
			}
		} catch {}
	}

	if (uniqueOutcomes.size !== 1) {
		return "not-run";
	}

	return [...uniqueOutcomes][0] ?? "not-run";
}

function buildSnapshot(input: {
	storyId: string;
	attemptPaths: StoryRunAttemptPaths;
	status: StoryRunCurrentSnapshot["status"];
	lifecycleState: StoryRunCurrentSnapshot["lifecycleState"];
	currentSummary: string;
	currentPhase: string;
	latestArtifacts: ArtifactRef[];
	latestContinuationHandles?: StoryRunCurrentSnapshot["latestContinuationHandles"];
	latestEventSequence: number;
	callerInputHistory?: CallerInputHistory;
	nextIntent: StoryRunCurrentSnapshot["nextIntent"];
	replayBoundary?: ReplayBoundary | null;
	currentChildOperation?: StoryRunCurrentSnapshot["currentChildOperation"];
}): StoryRunCurrentSnapshot {
	return {
		storyRunId: input.attemptPaths.storyRunId,
		storyId: input.storyId,
		attempt: input.attemptPaths.attempt,
		status: input.status,
		lifecycleState: input.lifecycleState,
		currentSummary: input.currentSummary,
		currentPhase: input.currentPhase,
		currentChildOperation: input.currentChildOperation ?? null,
		latestArtifacts: input.latestArtifacts,
		latestContinuationHandles: input.latestContinuationHandles ?? {},
		latestEventSequence: input.latestEventSequence,
		callerInputHistory: input.callerInputHistory ?? createCallerInputHistory(),
		nextIntent: input.nextIntent,
		replayBoundary: input.replayBoundary ?? null,
		updatedAt: nowIso(),
	};
}

function buildEvent(input: {
	storyRunId: string;
	sequence: number;
	type: string;
	summary: string;
	artifact?: string;
	data?: Record<string, unknown>;
}): StoryRunEvent {
	return {
		storyRunId: input.storyRunId,
		sequence: input.sequence,
		timestamp: nowIso(),
		type: input.type,
		summary: input.summary,
		...(input.artifact ? { artifact: input.artifact } : {}),
		...(input.data ? { data: input.data } : {}),
	};
}

function callerInputArtifactPath(input: {
	attemptPaths: StoryRunAttemptPaths;
	kind: "review-request" | "ruling-response";
	index: number;
}): string {
	return join(
		input.attemptPaths.artifactDir,
		`${input.attemptPaths.attemptKey}-${input.kind}-${String(input.index).padStart(3, "0")}.json`,
	);
}

async function persistCallerInputArtifact(input: {
	attemptPaths: StoryRunAttemptPaths;
	kind: "review-request" | "ruling-response";
	index: number;
	payload: unknown;
}): Promise<string> {
	const path = callerInputArtifactPath(input);
	await writeAtomic(path, `${JSON.stringify(input.payload, null, 2)}\n`);
	return path;
}

function replayBoundaryForFailure(input: {
	reason: StoryLeadFailureReason;
	validArtifactPaths: string[];
}): ReplayBoundary {
	switch (input.reason) {
		case "provider-output-invalid":
			return {
				smallestSafeStep: "resume-from-last-valid-artifact",
				reasoning:
					"Provider output became invalid after durable artifacts were written, so replay should resume from the last valid artifact boundary.",
				validArtifactPaths: input.validArtifactPaths,
				requiresFreshStoryLeadSession: false,
				requiresFreshChildProviderSession: true,
			};
		case "artifact-integrity-failed":
			return {
				smallestSafeStep: "resume-from-last-valid-artifact",
				reasoning:
					"A bounded child operation returned, but its required artifact was missing or empty, so replay must stop at the last durable artifact boundary instead of advancing as though new evidence exists.",
				validArtifactPaths: input.validArtifactPaths,
				requiresFreshStoryLeadSession: false,
				requiresFreshChildProviderSession: true,
			};
		case "context-window-limit":
			return {
				smallestSafeStep: "rehydrate-from-durable-ledger",
				reasoning:
					"The retained session exhausted its context window, so the next safe step is to rehydrate from the durable ledger before continuing.",
				validArtifactPaths: input.validArtifactPaths,
				requiresFreshStoryLeadSession: true,
				requiresFreshChildProviderSession: false,
			};
		case "planner-timeout":
			return {
				smallestSafeStep: "rehydrate-from-durable-ledger",
				reasoning:
					"The story-lead planner turn exceeded its configured timeout, so the next safe step is to rehydrate from the durable ledger and retry the planner turn with a fresh story-lead provider session.",
				validArtifactPaths: input.validArtifactPaths,
				requiresFreshStoryLeadSession: true,
				requiresFreshChildProviderSession: false,
			};
		case "interrupted":
			return {
				smallestSafeStep: "resume-current-attempt",
				reasoning:
					"The attempt was interrupted and recorded a terminal recovery package, so the safest replay point is the current durable story-run snapshot.",
				validArtifactPaths: input.validArtifactPaths,
				requiresFreshStoryLeadSession: false,
				requiresFreshChildProviderSession: false,
			};
	}
}

function buildAttachedEvent(input: {
	type: AttachedProgressEvent["type"];
	command: string;
	phase: string;
	summary: string;
	callerHarness: CallerHarness;
	storyId: string;
	storyRunId: string;
	statusArtifact: string;
	elapsedTime?: string;
	finalPackagePath?: string;
}): AttachedProgressEvent {
	return {
		type: input.type,
		command: input.command,
		phase: input.phase,
		summary: input.summary,
		callerHarness: input.callerHarness,
		storyId: input.storyId,
		storyRunId: input.storyRunId,
		statusArtifact: input.statusArtifact,
		...(input.elapsedTime ? { elapsedTime: input.elapsedTime } : {}),
		...(input.finalPackagePath
			? { finalPackagePath: input.finalPackagePath }
			: {}),
	};
}

function formatElapsed(startedAt: number): string {
	const elapsedMs = Math.max(0, Date.now() - startedAt);
	const totalSeconds = Math.floor(elapsedMs / 1_000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function buildStoryLeadActionPrompt(input: {
	specPackRoot: string;
	storyRunId: string;
	mode: "run" | "resume";
	currentSnapshot: StoryRunCurrentSnapshot;
	currentSnapshotPath: string;
	eventHistoryPath: string;
	provider: ProviderName;
	model: string;
	runtimeSettings: {
		storyGate?: string;
		epicGate?: string;
		plannerTimeoutMs: number;
		wholeRunTimeoutMs: number;
		providerStartupTimeoutMs: number;
		providerActiveSilenceTimeoutMs?: number;
	};
	providerLimitBytes?: number;
}): Promise<{
	prompt: string;
	context: StoryLeadPlannerContext;
}> {
	const plannerContext = await buildStoryLeadPlannerContext({
		specPackRoot: input.specPackRoot,
		storyId: input.currentSnapshot.storyId,
		storyRunId: input.storyRunId,
		mode: input.mode,
		currentSnapshot: input.currentSnapshot,
		currentSnapshotPath: input.currentSnapshotPath,
		eventHistoryPath: input.eventHistoryPath,
		provider: input.provider,
		model: input.model,
		runtimeSettings: input.runtimeSettings,
		providerLimitBytes: input.providerLimitBytes,
	});
	return {
		prompt: assembleStoryLeadPrompt(plannerContext),
		context: plannerContext,
	};
}

function semanticArtifactRefsFromEnvelope<TResult>(
	command: string,
	envelope: OperationEnvelope<TResult>,
): ArtifactRef[] {
	return envelope.artifacts.map((artifact) => ({
		kind:
			artifact.kind === "result-envelope"
				? artifactKindForCommand(command)
				: artifact.kind,
		path: artifact.path,
		provenance: "current-run",
	}));
}

function lastSemanticArtifactPath(
	artifacts: ArtifactRef[],
): string | undefined {
	return artifacts.at(-1)?.path;
}

function maybeCrashAfterChildResult(command: string): void {
	if (!shouldCrashAfterChildResult()) {
		return;
	}

	throw new Error(
		`Simulated runtime crash after ${command} child result was durably recorded.`,
	);
}

function operationSummaryFromEnvelope<TResult>(
	command: string,
	envelope: OperationEnvelope<TResult>,
): string {
	const errorSummary =
		envelope.errors.length > 0
			? ` Errors: ${envelope.errors
					.map((error) => `${error.code}: ${error.message}`)
					.join("; ")}`
			: "";
	return `${command} completed with outcome ${envelope.outcome} and status ${envelope.status}.${errorSummary}`;
}

function extractContinuationHandle<TResult extends { continuation?: unknown }>(
	envelope: OperationEnvelope<TResult>,
): ContinuationHandle | undefined {
	const continuation = envelope.result?.continuation;
	if (!continuation || typeof continuation !== "object") {
		return undefined;
	}

	const candidate = continuation as Record<string, unknown>;
	if (
		(candidate.provider === "claude-code" ||
			candidate.provider === "codex" ||
			candidate.provider === "copilot") &&
		typeof candidate.sessionId === "string" &&
		typeof candidate.storyId === "string"
	) {
		return {
			provider: candidate.provider,
			sessionId: candidate.sessionId,
			storyId: candidate.storyId,
		};
	}

	return undefined;
}

async function readArtifactEnvelope<TResult>(
	path: string,
): Promise<OperationEnvelope<TResult> | null> {
	try {
		const parsed = JSON.parse(
			await readTextFile(path),
		) as OperationEnvelope<TResult>;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function deriveBaselineFromImplementorResult(
	result:
		| Pick<ImplementorResult, "tests">
		| Pick<StorySelfReviewResult, "tests">
		| undefined,
):
	| {
			baselineBeforeStory: number | null;
			baselineAfterStory: number | null;
			latestActualTotal: number | null;
	  }
	| undefined {
	if (!result) {
		return undefined;
	}

	const totalAfterStory = result.tests.totalAfterStory;
	const deltaFromPriorBaseline = result.tests.deltaFromPriorBaseline;
	if (
		typeof totalAfterStory !== "number" ||
		typeof deltaFromPriorBaseline !== "number"
	) {
		return undefined;
	}

	return {
		baselineBeforeStory: totalAfterStory - deltaFromPriorBaseline,
		baselineAfterStory: totalAfterStory,
		latestActualTotal: totalAfterStory,
	};
}

function buildInitialArtifacts(input: {
	reopeningAcceptedAttempt: boolean;
	priorAcceptedFinalPackage?: StoryLeadFinalPackage;
	priorSnapshot?: StoryRunCurrentSnapshot;
	primitiveArtifacts: ArtifactRef[];
	callerInputArtifacts: ArtifactRef[];
	existingAttempt?: StoryRunAttemptRecord;
}): ArtifactRef[] {
	if (input.reopeningAcceptedAttempt) {
		return mergeArtifacts(
			reclassifyArtifacts(
				input.priorAcceptedFinalPackage?.evidence.implementorArtifacts ?? [],
				"prior-run",
			),
			mergeArtifacts(
				reclassifyArtifacts(
					input.priorAcceptedFinalPackage?.evidence.selfReviewArtifacts ?? [],
					"prior-run",
				),
				mergeArtifacts(
					reclassifyArtifacts(
						input.priorAcceptedFinalPackage?.evidence.verifierArtifacts ?? [],
						"prior-run",
					),
					mergeArtifacts(
						reclassifyArtifacts(
							input.priorAcceptedFinalPackage?.evidence.quickFixArtifacts ?? [],
							"prior-run",
						),
						input.callerInputArtifacts,
					),
				),
			),
		);
	}

	if (input.existingAttempt) {
		return normalizeRecoveredArtifacts(
			input.priorSnapshot?.latestArtifacts ?? [],
		);
	}

	return input.primitiveArtifacts;
}

function legacyTerminalDecision(input: {
	reviewRequest?: ImplLeadReviewRequest;
	ruling?: CallerRulingResponse;
	priorAttempt?: StoryRunAttemptRecord;
	attemptPaths: StoryRunAttemptPaths;
	callerInputArtifacts: ArtifactRef[];
	implementorArtifacts: ArtifactRef[];
	verifierArtifacts: ArtifactRef[];
	priorAcceptedFinalPackage?: StoryLeadFinalPackage;
}): StoryLeadTerminalDecision {
	const inheritedGateRun = input.reviewRequest
		? undefined
		: input.priorAcceptedFinalPackage?.evidence.gateRuns.at(-1);
	const inheritedBaseline = input.reviewRequest
		? undefined
		: input.priorAcceptedFinalPackage?.logHandoff.cumulativeBaseline;
	const inheritedCommitReadiness = input.reviewRequest
		? undefined
		: input.priorAcceptedFinalPackage?.logHandoff.commitReadiness;
	const hasImplementorEvidence = input.implementorArtifacts.length > 0;
	const hasVerifierEvidence = input.verifierArtifacts.length > 0;
	const hasRecordedGatePass = inheritedGateRun?.result === "pass";
	const hasRecordedBaseline =
		typeof inheritedBaseline?.baselineBeforeCurrentStory === "number" &&
		typeof inheritedBaseline.latestActualTotal === "number";
	const hasRecordedCommitReadiness =
		inheritedCommitReadiness?.state === "committed" ||
		inheritedCommitReadiness?.state === "ready-for-impl-lead-commit";

	if (input.reviewRequest?.decision === "ask-ruling") {
		return {
			kind: "request-ruling",
			rationale:
				"Impl-lead explicitly requested a ruling-boundary reopen instead of silent acceptance.",
			request: buildAuthorityBoundaryRulingRequest({
				id: `${input.attemptPaths.storyRunId}-ruling-001`,
				decisionType: "scope-change",
				question: `Should story-lead reopen ${input.priorAttempt?.storyRunId ?? input.attemptPaths.storyRunId} according to the impl-lead review request?`,
				defaultRecommendation:
					"Reopen the story and address the review request before impl-lead acceptance.",
				evidence: input.callerInputArtifacts.map((artifact) => artifact.path),
				allowedResponses: ["reopen", "reject"],
			}),
		};
	}

	if (input.reviewRequest) {
		return {
			kind: "block",
			reason: input.reviewRequest.summary,
			rationale:
				"Open review-request findings still require remediation before story-lead can recommend acceptance.",
		};
	}

	if (!hasImplementorEvidence && !hasVerifierEvidence && !input.ruling) {
		return {
			kind: "request-ruling",
			rationale:
				"Story-lead should not silently accept without durable implementor and verifier evidence.",
			request: buildAuthorityBoundaryRulingRequest({
				id: `${input.attemptPaths.storyRunId}-ruling-001`,
				decisionType: "provider-failure",
				question:
					"Should story-lead proceed without fresh implementor and verifier evidence for this story?",
				defaultRecommendation:
					"Pause for caller ruling instead of accepting without evidence.",
				evidence: input.callerInputArtifacts
					.concat(input.implementorArtifacts)
					.map((artifact) => artifact.path),
				allowedResponses: ["pause", "proceed"],
			}),
		};
	}

	if (
		hasImplementorEvidence &&
		hasVerifierEvidence &&
		hasRecordedGatePass &&
		hasRecordedBaseline &&
		hasRecordedCommitReadiness
	) {
		return {
			kind: "accept",
			rationale:
				"The inherited accepted package still carries enough durable evidence for a scoped story-lead acceptance recommendation.",
			acceptance: {
				acceptanceChecks: [],
				recommendedImplLeadAction: "accept",
			},
		};
	}

	return {
		kind: "block",
		reason: "Story-lead did not reach a commit-ready acceptance state.",
		rationale:
			"The legacy non-provider path preserves prior blocking behavior when fresh story-lead action turns are unavailable.",
	};
}

function providerFailureReason<TResult>(
	execution: ProviderExecutionResult<TResult>,
): StoryLeadFailureReason {
	if (execution.parseError) {
		return "provider-output-invalid";
	}

	if (
		execution.errorCode === "CONTINUATION_HANDLE_INVALID" ||
		execution.errorCode === "PROVIDER_TIMEOUT" ||
		execution.errorCode === "PROVIDER_STALLED" ||
		execution.timedOut
	) {
		return "context-window-limit";
	}

	return "interrupted";
}

function providerFailureSummary<TResult>(
	execution: ProviderExecutionResult<TResult>,
): string {
	const parts = [
		execution.errorCode,
		execution.parseError,
		execution.stderr,
	].filter(
		(value): value is string =>
			typeof value === "string" && value.trim().length > 0,
	);
	return parts.length > 0
		? parts.join("; ")
		: "Story-lead provider failed before it returned a valid bounded action.";
}

function providerFailureLooksLikeContextOverflow<TResult>(
	execution: ProviderExecutionResult<TResult>,
): boolean {
	const diagnostic = [
		execution.errorCode,
		execution.parseError,
		execution.stderr,
		execution.stdout,
	]
		.filter(
			(value): value is string =>
				typeof value === "string" && value.trim().length > 0,
		)
		.join("\n")
		.toLowerCase();

	return (
		/(context|input|prompt|token)/u.test(diagnostic) &&
		/(overflow|limit|too large|too long|maximum|max tokens|context_length)/u.test(
			diagnostic,
		)
	);
}

function providerContextOverflowError(input: {
	storyId: string;
	storyRunId: string;
	provider: ProviderName;
	model: string;
	context: StoryLeadPlannerContext;
}): StoryLeadContextOverflowError {
	const { requiredContextBytes, largestSources } =
		describeStoryLeadContextSources(input.context);
	return {
		code: "STORY_LEAD_CONTEXT_OVERFLOW",
		storyId: input.storyId,
		storyRunId: input.storyRunId,
		provider: input.provider,
		model: input.model,
		requiredContextBytes,
		largestSources,
	};
}

function actionTypeForStateValidation(
	action: StoryLeadAction,
): StoryLeadActionType {
	switch (action.action) {
		case "run-implement":
			return "run-implement";
		case "run-continue":
			return "run-continue";
		case "run-self-review":
			return "run-self-review";
		case "run-verify":
			return "run-verify";
		case "run-quick-fix":
			return "run-quick-fix";
		case "accept-story":
			return "accept-story";
		case "request-ruling":
			return "request-ruling";
		case "block-story":
			return "block-story";
		case "fail-story":
			return "fail-story";
	}
}

function isContextOverflowError(
	error: unknown,
): error is StoryLeadContextOverflowError {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "STORY_LEAD_CONTEXT_OVERFLOW"
	);
}

export async function runStoryLead(
	input: StoryLeadRuntimeInput,
): Promise<StoryLeadRuntimeResult> {
	const reopeningAcceptedAttempt = Boolean(
		input.mode === "resume" &&
			input.existingAttempt?.currentSnapshot.status === "accepted" &&
			input.reviewRequest,
	);
	const storyId = input.storyId;
	const storyTitle = await resolveStoryTitle(input.specPackRoot, storyId);
	const startedAtMs = Date.now();
	const loadedConfig = requireStoryLeadProviderConfig({
		specPackRoot: input.specPackRoot,
		configPath: input.configPath,
		config: await loadRunConfigIfPresent({
			specPackRoot: input.specPackRoot,
			configPath: input.configPath,
		}),
	});
	const attemptPaths = reopeningAcceptedAttempt
		? await input.ledger.createAttempt()
		: (input.existingAttempt ?? (await input.ledger.createAttempt()));
	const callerHarnessConfig = loadedConfig?.caller_harness;
	const storyLeadAssignment = resolveStoryLeadAssignment(loadedConfig);
	const gateCommands = loadedConfig?.verification_gates;
	const timeouts = resolveRunTimeouts(loadedConfig);
	const resolvedHeartbeat = resolveCallerHeartbeatOptions({
		callerHarness: input.callerHarness,
		heartbeatCadenceMinutes: input.heartbeatCadenceMinutes,
		disableHeartbeats: input.disableHeartbeats,
		config: callerHarnessConfig,
		operationKind: "story",
	});
	const activeCallerHarness =
		input.callerHarness ??
		resolvedHeartbeat?.callerHarness ??
		callerHarnessConfig?.harness ??
		"generic";
	const providerCwd = await resolveProviderCwd(input.specPackRoot);
	const priorAttempt = input.existingAttempt;
	const priorSnapshot = reopeningAcceptedAttempt
		? undefined
		: input.existingAttempt?.currentSnapshot;
	const priorAcceptedFinalPackage = input.existingAttempt?.finalPackage;
	let callerInputHistory = reopeningAcceptedAttempt
		? createCallerInputHistory()
		: (priorSnapshot?.callerInputHistory ?? createCallerInputHistory());
	let callerInputArtifacts: ArtifactRef[] = reopeningAcceptedAttempt
		? priorAcceptedFinalPackage
			? [
					{
						kind: "prior-final-package",
						path: input.existingAttempt?.finalPackagePath ?? "",
						provenance: "prior-run",
					},
				]
			: []
		: [];
	const primitiveArtifacts = await buildArtifactRefs(
		input.startedFromPrimitiveArtifacts ?? [],
	);
	const initialArtifacts = buildInitialArtifacts({
		reopeningAcceptedAttempt,
		priorAcceptedFinalPackage,
		priorSnapshot,
		primitiveArtifacts,
		callerInputArtifacts,
		existingAttempt: input.existingAttempt,
	});
	const initialLatestEventSequence =
		input.mode === "resume" && priorSnapshot
			? priorSnapshot.latestEventSequence
			: 0;
	let currentSnapshot = buildSnapshot({
		storyId,
		attemptPaths,
		status: "running",
		lifecycleState: "initialized",
		currentSummary:
			input.mode === "run"
				? "Story orchestration started and durable state has been initialized."
				: "Story orchestration resume requested and durable state has been reopened.",
		currentPhase:
			input.mode === "run"
				? "story-orchestrate-run"
				: "story-orchestrate-resume",
		latestArtifacts: initialArtifacts,
		latestContinuationHandles:
			input.mode === "resume" ? priorSnapshot?.latestContinuationHandles : {},
		latestEventSequence: initialLatestEventSequence,
		callerInputHistory,
		nextIntent: {
			actionType:
				input.mode === "run"
					? "orient-from-disk"
					: reopeningAcceptedAttempt
						? "reopen-accepted-attempt"
						: "resume-attempt",
			summary:
				input.startedFromPrimitiveArtifacts &&
				input.startedFromPrimitiveArtifacts.length > 0
					? `Orient from ${input.startedFromPrimitiveArtifacts.length} existing story artifact(s).`
					: reopeningAcceptedAttempt
						? `Open a fresh story-lead attempt linked to accepted attempt ${priorAttempt?.storyRunId}.`
						: input.mode === "resume"
							? "Continue the existing durable story-lead attempt from its latest checkpoint."
							: "Await the first bounded story-lead action.",
		},
		currentChildOperation:
			input.mode === "resume" ? priorSnapshot?.currentChildOperation : null,
	});

	const writeCurrentSnapshot = async () => {
		await input.ledger.writeCurrentSnapshot({
			storyId,
			storyRunId: attemptPaths.storyRunId,
			snapshot: currentSnapshot,
		});
	};

	const appendRunEvent = async (event: StoryRunEvent) => {
		await input.ledger.appendEvent({
			storyId,
			storyRunId: attemptPaths.storyRunId,
			event,
		});
		currentSnapshot = {
			...currentSnapshot,
			latestEventSequence: event.sequence,
			updatedAt: event.timestamp,
		};
	};

	const overwriteSnapshot = async (inputSnapshot: {
		status: StoryRunCurrentSnapshot["status"];
		lifecycleState: StoryRunCurrentSnapshot["lifecycleState"];
		currentSummary: string;
		currentPhase: string;
		latestArtifacts?: ArtifactRef[];
		latestContinuationHandles?: StoryRunCurrentSnapshot["latestContinuationHandles"];
		callerInputHistory?: CallerInputHistory;
		nextIntent: StoryRunCurrentSnapshot["nextIntent"];
		replayBoundary?: ReplayBoundary | null;
		currentChildOperation?: StoryRunCurrentSnapshot["currentChildOperation"];
	}) => {
		currentSnapshot = buildSnapshot({
			storyId,
			attemptPaths,
			status: inputSnapshot.status,
			lifecycleState: inputSnapshot.lifecycleState,
			currentSummary: inputSnapshot.currentSummary,
			currentPhase: inputSnapshot.currentPhase,
			latestArtifacts:
				inputSnapshot.latestArtifacts ?? currentSnapshot.latestArtifacts,
			latestContinuationHandles:
				inputSnapshot.latestContinuationHandles ??
				currentSnapshot.latestContinuationHandles,
			latestEventSequence: currentSnapshot.latestEventSequence,
			callerInputHistory:
				inputSnapshot.callerInputHistory ?? currentSnapshot.callerInputHistory,
			nextIntent: inputSnapshot.nextIntent,
			replayBoundary: inputSnapshot.replayBoundary ?? null,
			currentChildOperation:
				inputSnapshot.currentChildOperation ??
				currentSnapshot.currentChildOperation,
		});
		await writeCurrentSnapshot();
	};

	const buildWholeRunTimeoutInterruptedResult = async (params?: {
		currentSummary?: string;
		nextIntentSummary?: string;
	}): Promise<StoryLeadRuntimeResult> =>
		buildInterruptedResult({
			reason: "interrupted",
			eventType: "story-orchestrate-timeout",
			eventSummary: `Story-orchestrate exceeded the whole-run timeout of ${timeouts.story_orchestrate_ms}ms.`,
			currentSummary:
				params?.currentSummary ??
				"Story-orchestrate exceeded the whole-run timeout before terminal completion.",
			nextIntentSummary:
				params?.nextIntentSummary ??
				"Use story-orchestrate resume to continue this interrupted attempt from the latest durable checkpoint.",
			eventData: {
				configuredWholeRunTimeoutMs: timeouts.story_orchestrate_ms,
				elapsedMs: Math.max(0, Date.now() - startedAtMs),
			},
		});

	const hasWholeRunTimedOut = (): boolean =>
		Date.now() - startedAtMs >= timeouts.story_orchestrate_ms;

	const plannerExecutionBudget = (): {
		effectiveTimeoutMs: number;
		cappedByWholeRun: boolean;
		remainingWholeRunMs: number;
	} => {
		const remainingWholeRunMs = Math.max(
			0,
			timeouts.story_orchestrate_ms - (Date.now() - startedAtMs),
		);
		return {
			effectiveTimeoutMs: Math.max(
				1,
				Math.min(timeouts.story_lead_planner_ms, remainingWholeRunMs),
			),
			cappedByWholeRun:
				remainingWholeRunMs > 0 &&
				remainingWholeRunMs < timeouts.story_lead_planner_ms,
			remainingWholeRunMs,
		};
	};

	const remainingWholeRunMs = (): number =>
		Math.max(0, timeouts.story_orchestrate_ms - (Date.now() - startedAtMs));

	const buildInterruptedResult = async (params: {
		reason: StoryLeadFailureReason;
		eventType: string;
		eventSummary: string;
		currentSummary: string;
		nextIntentSummary: string;
		eventData?: Record<string, unknown>;
	}) => {
		const cleanupRecord =
			currentSnapshot.lifecycleState === "running_child_operation" &&
			currentSnapshot.currentChildOperation
				? await cleanupTrackedChildOperation({
						storyId,
						storyRunId: attemptPaths.storyRunId,
						childOperation: currentSnapshot.currentChildOperation,
					})
				: null;
		if (cleanupRecord) {
			await appendRunEvent(
				buildEvent({
					storyRunId: attemptPaths.storyRunId,
					sequence: currentSnapshot.latestEventSequence + 1,
					type: cleanupRecord.type,
					summary: cleanupRecord.summary,
					data: cleanupRecord.data,
				}),
			);
		}
		const replayBoundary = replayBoundaryForFailure({
			reason: params.reason,
			validArtifactPaths: currentSnapshot.latestArtifacts.map(
				(artifact) => artifact.path,
			),
		});
		const finalPackage = buildStoryLeadFinalPackage({
			outcome: "interrupted",
			storyId,
			storyRunId: attemptPaths.storyRunId,
			attempt: attemptPaths.attempt,
			storyTitle,
			implementedScope: params.currentSummary,
			evidence: {
				implementorArtifacts: filterArtifactsByKind(
					currentSnapshot.latestArtifacts,
					["implementor-result"],
				),
				selfReviewArtifacts: filterArtifactsByKind(
					currentSnapshot.latestArtifacts,
					["self-review-result"],
				),
				verifierArtifacts: filterArtifactsByKind(
					currentSnapshot.latestArtifacts,
					["verifier-result"],
				),
				quickFixArtifacts: filterArtifactsByKind(
					currentSnapshot.latestArtifacts,
					["quick-fix-result"],
				),
				callerInputArtifacts,
			},
			callerInputHistory,
			replayBoundary,
			continuationHandles: currentSnapshot.latestContinuationHandles,
		});
		await input.ledger.writeFinalPackage({
			storyId,
			storyRunId: attemptPaths.storyRunId,
			finalPackage,
		});
		const interruptedEvent = buildEvent({
			storyRunId: attemptPaths.storyRunId,
			sequence: currentSnapshot.latestEventSequence + 1,
			type: params.eventType,
			summary: params.eventSummary,
			artifact: attemptPaths.finalPackagePath,
			data: {
				terminalDecision: "interrupted",
				recoveryBoundary: replayBoundary,
				...(params.eventData ?? {}),
			},
		});
		await appendRunEvent(interruptedEvent);
		await overwriteSnapshot({
			status: "interrupted",
			lifecycleState: "terminal",
			currentSummary: params.currentSummary,
			currentPhase: "terminal",
			latestArtifacts: mergeArtifacts(currentSnapshot.latestArtifacts, [
				{
					kind: "final-package",
					path: attemptPaths.finalPackagePath,
					provenance: "current-run",
				},
			]),
			nextIntent: {
				actionType: "replay-smallest-safe-step",
				summary: params.nextIntentSummary,
				artifactRef: attemptPaths.finalPackagePath,
			},
			replayBoundary,
			currentChildOperation: null,
		});
		input.progressListener?.(
			buildAttachedEvent({
				type: "terminal",
				command:
					input.mode === "run"
						? "story-orchestrate run"
						: "story-orchestrate resume",
				phase: "terminal",
				summary: `Story ${storyId} finished with outcome interrupted. storyRunId=${attemptPaths.storyRunId}. Final package: ${attemptPaths.finalPackagePath}`,
				callerHarness: activeCallerHarness,
				storyId,
				storyRunId: attemptPaths.storyRunId,
				statusArtifact: attemptPaths.currentSnapshotPath,
				elapsedTime: formatElapsed(startedAtMs),
				finalPackagePath: attemptPaths.finalPackagePath,
			}),
		);

		return {
			case: "interrupted" as const,
			storyId,
			storyRunId: attemptPaths.storyRunId,
			currentSnapshotPath: attemptPaths.currentSnapshotPath,
			eventHistoryPath: attemptPaths.eventHistoryPath,
			finalPackagePath: attemptPaths.finalPackagePath,
			finalPackage,
			recoveryGuidance: params.nextIntentSummary,
			latestEventSequence: currentSnapshot.latestEventSequence,
			startedFromPrimitiveArtifacts: input.startedFromPrimitiveArtifacts,
			...(acceptedReviewRequestArtifact
				? { acceptedReviewRequestArtifact }
				: {}),
			...(acceptedRulingArtifact ? { acceptedRulingArtifact } : {}),
		};
	};

	const interruptForArtifactIntegrityFailure = async (input: {
		command: string;
		error: StoryRunArtifactIntegrityError;
	}): Promise<StoryLeadRuntimeResult> =>
		buildInterruptedResult({
			reason: "artifact-integrity-failed",
			eventType: "artifact-integrity-failed",
			eventSummary: `${input.command} returned before its required result artifact became durable.`,
			currentSummary:
				"A bounded child operation completed, but its required artifact was missing or empty so story-run state could not advance.",
			nextIntentSummary:
				"Resume from the last valid artifact boundary after fixing the child operation artifact write path.",
			eventData: {
				command: input.command,
				errorCode: input.error.issue,
				artifactPath: input.error.artifactPath,
			},
		});

	const recordCompletedChildOperation = async (params: {
		completionEvent: StoryRunEvent;
		requiredArtifacts: ArtifactRef[];
		currentSummary: string;
		latestArtifacts: ArtifactRef[];
		latestContinuationHandles?: StoryRunCurrentSnapshot["latestContinuationHandles"];
		nextIntent: StoryRunCurrentSnapshot["nextIntent"];
	}): Promise<void> => {
		const nextSnapshot = buildSnapshot({
			storyId,
			attemptPaths,
			status: "running",
			lifecycleState: "awaiting_story_lead_action",
			currentSummary: params.currentSummary,
			currentPhase: "story-lead-awaiting-action",
			latestArtifacts: params.latestArtifacts,
			latestContinuationHandles:
				params.latestContinuationHandles ??
				currentSnapshot.latestContinuationHandles,
			latestEventSequence: params.completionEvent.sequence,
			callerInputHistory,
			nextIntent: params.nextIntent,
			replayBoundary: null,
			currentChildOperation: null,
		});

		await input.ledger.recordChildOperationCompletion({
			storyRunId: attemptPaths.storyRunId,
			event: params.completionEvent,
			snapshot: nextSnapshot,
			requiredArtifacts: params.requiredArtifacts,
		});
		currentSnapshot = nextSnapshot;
	};

	const runChildWithinWholeRunBudget = async <TResult>(params: {
		command: string;
		execute: () => Promise<OperationEnvelope<TResult>>;
	}): Promise<
		| { case: "completed"; envelope: OperationEnvelope<TResult> }
		| { case: "timed-out"; result: StoryLeadRuntimeResult }
	> => {
		const budgetMs = remainingWholeRunMs();
		if (budgetMs <= 0) {
			return {
				case: "timed-out",
				result: await buildWholeRunTimeoutInterruptedResult({
					currentSummary: `Story-orchestrate exhausted the whole-run timeout before ${params.command} could start.`,
				}),
			};
		}

		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const operationPromise = params.execute();
		operationPromise.catch(() => undefined);
		const timeoutPromise = new Promise<"whole-run-timeout">((resolve) => {
			timeoutId = setTimeout(() => resolve("whole-run-timeout"), budgetMs);
		});
		const winner = await Promise.race([
			operationPromise.then((envelope) => ({
				case: "completed" as const,
				envelope,
			})),
			timeoutPromise,
		]);

		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		if (winner === "whole-run-timeout") {
			return {
				case: "timed-out",
				result: await buildWholeRunTimeoutInterruptedResult({
					currentSummary: `Story-orchestrate exceeded the whole-run timeout while ${params.command} was still running.`,
					nextIntentSummary: `Use story-orchestrate resume to continue from the latest durable checkpoint; ${params.command} did not complete inside the story-orchestrate wall-clock budget.`,
				}),
			};
		}

		return winner;
	};

	await writeCurrentSnapshot();
	const openedEvent = buildEvent({
		storyRunId: attemptPaths.storyRunId,
		sequence: currentSnapshot.latestEventSequence + 1,
		type:
			input.mode === "run"
				? "story-run-started"
				: reopeningAcceptedAttempt
					? "story-run-reopened"
					: "story-run-resumed",
		summary: reopeningAcceptedAttempt
			? `Story orchestration reopened accepted attempt ${priorAttempt?.storyRunId} as ${attemptPaths.storyRunId}.`
			: input.startedFromPrimitiveArtifacts &&
					input.startedFromPrimitiveArtifacts.length > 0
				? `Story orchestration ${input.mode} started after orienting from ${input.startedFromPrimitiveArtifacts.length} existing artifact(s).`
				: `Story orchestration ${input.mode} started.`,
		...(reopeningAcceptedAttempt && priorAttempt
			? {
					data: {
						reopenedFromStoryRunId: priorAttempt.storyRunId,
						priorFinalPackagePath: priorAttempt.finalPackagePath,
					},
				}
			: {}),
	});
	await appendRunEvent(openedEvent);
	await overwriteSnapshot({
		status: "running",
		lifecycleState: "awaiting_story_lead_action",
		currentSummary: currentSnapshot.currentSummary,
		currentPhase: currentSnapshot.currentPhase,
		nextIntent: currentSnapshot.nextIntent,
		replayBoundary: null,
	});

	if (input.reviewRequest) {
		const reviewArtifactPath = await persistCallerInputArtifact({
			attemptPaths,
			kind: "review-request",
			index: callerInputHistory.reviewRequests.length + 1,
			payload: input.reviewRequest,
		});
		callerInputHistory = appendReviewRequest(
			callerInputHistory,
			input.reviewRequest,
		);
		callerInputArtifacts = [
			...callerInputArtifacts,
			{
				kind: "review-request",
				path: reviewArtifactPath,
				provenance: "caller-input",
			},
		];
		const reviewEvent = buildEvent({
			storyRunId: attemptPaths.storyRunId,
			sequence: currentSnapshot.latestEventSequence + 1,
			type: "review-request-received",
			summary: `Impl-lead review request received: ${input.reviewRequest.summary}`,
			artifact: reviewArtifactPath,
			data: {
				source: input.reviewRequest.source,
				decision: input.reviewRequest.decision,
				itemIds: input.reviewRequest.items.map((item) => item.id),
			},
		});
		await appendRunEvent(reviewEvent);
		await overwriteSnapshot({
			status: "running",
			lifecycleState: "awaiting_story_lead_action",
			currentSummary:
				"Review request recorded and story-lead reopen handling is underway.",
			currentPhase: "review-requested",
			latestArtifacts: mergeArtifacts(currentSnapshot.latestArtifacts, [
				{
					kind: "review-request",
					path: reviewArtifactPath,
					provenance: "caller-input",
				},
			]),
			callerInputHistory,
			nextIntent: {
				actionType: "address-review-request",
				summary: input.reviewRequest.summary,
				artifactRef: reviewArtifactPath,
			},
			replayBoundary: null,
		});
	}

	if (input.ruling) {
		const rulingArtifactPath = await persistCallerInputArtifact({
			attemptPaths,
			kind: "ruling-response",
			index: callerInputHistory.rulings.length + 1,
			payload: input.ruling,
		});
		callerInputHistory = appendRulingResponse(callerInputHistory, input.ruling);
		callerInputArtifacts = [
			...callerInputArtifacts,
			{
				kind: "ruling-response",
				path: rulingArtifactPath,
				provenance: "caller-input",
			},
		];
		const rulingEvent = buildEvent({
			storyRunId: attemptPaths.storyRunId,
			sequence: currentSnapshot.latestEventSequence + 1,
			type: "ruling-received",
			summary: `Caller ruling received for ${input.ruling.rulingRequestId}.`,
			artifact: rulingArtifactPath,
			data: {
				rulingRequestId: input.ruling.rulingRequestId,
				decision: input.ruling.decision,
				source: input.ruling.source,
			},
		});
		await appendRunEvent(rulingEvent);
		await overwriteSnapshot({
			status: "running",
			lifecycleState: "awaiting_story_lead_action",
			currentSummary:
				"Caller ruling recorded and story-lead finalization is resuming.",
			currentPhase: "ruling-received",
			latestArtifacts: mergeArtifacts(currentSnapshot.latestArtifacts, [
				{
					kind: "ruling-response",
					path: rulingArtifactPath,
					provenance: "caller-input",
				},
			]),
			callerInputHistory,
			nextIntent: {
				actionType: "apply-ruling",
				summary: `${input.ruling.rulingRequestId}: ${input.ruling.decision}`,
				artifactRef: rulingArtifactPath,
			},
			replayBoundary: null,
		});
	}

	const acceptedReviewRequestArtifact = callerInputArtifacts
		.filter((artifact) => artifact.kind === "review-request")
		.at(-1);
	const acceptedRulingArtifact = callerInputArtifacts
		.filter((artifact) => artifact.kind === "ruling-response")
		.at(-1);

	const heartbeat =
		input.progressListener && resolvedHeartbeat
			? createStoryHeartbeatEmitter({
					command:
						input.mode === "run"
							? "story-orchestrate run"
							: "story-orchestrate resume",
					callerHarness: activeCallerHarness,
					cadenceMinutes: resolvedHeartbeat.heartbeatCadenceMinutes,
					currentSnapshotPath: attemptPaths.currentSnapshotPath,
					startedAt: startedAtMs,
					readSnapshot: () => currentSnapshot,
					writeAttachedOutput: input.progressListener,
				})
			: null;

	input.progressListener?.(
		buildAttachedEvent({
			type: "progress",
			command:
				input.mode === "run"
					? "story-orchestrate run"
					: "story-orchestrate resume",
			phase: currentSnapshot.currentPhase,
			summary:
				input.startedFromPrimitiveArtifacts &&
				input.startedFromPrimitiveArtifacts.length > 0
					? `Oriented from existing artifacts: ${input.startedFromPrimitiveArtifacts.join(", ")}`
					: "Started a durable story-lead attempt.",
			callerHarness: activeCallerHarness,
			storyId,
			storyRunId: attemptPaths.storyRunId,
			statusArtifact: attemptPaths.currentSnapshotPath,
		}),
	);
	heartbeat?.start();

	const delayMs = readDelayMs();
	if (delayMs > 0) {
		await sleep(delayMs);
	}
	if (hasWholeRunTimedOut()) {
		return await buildWholeRunTimeoutInterruptedResult();
	}

	try {
		const failureMode = readFailureMode();
		if (failureMode) {
			const failureSummary =
				failureMode === "provider-output-invalid"
					? "Story-lead could not parse the provider output into a valid bounded action."
					: "Story-lead hit a retained-session context-window limit.";
			return await buildInterruptedResult({
				reason: failureMode,
				eventType: failureMode,
				eventSummary: failureSummary,
				currentSummary:
					failureMode === "provider-output-invalid"
						? "Provider output invalidated the retained loop before terminal finalization."
						: "Context-window exhaustion requires a fresh replay from the durable ledger.",
				nextIntentSummary: replayBoundaryForFailure({
					reason: failureMode,
					validArtifactPaths: currentSnapshot.latestArtifacts.map(
						(artifact) => artifact.path,
					),
				}).smallestSafeStep,
			});
		}

		if (shouldLeaveAttemptIncomplete()) {
			return await buildInterruptedResult({
				reason: "interrupted",
				eventType: "interrupted",
				eventSummary:
					"Story orchestration was interrupted and recorded a terminal recovery package.",
				currentSummary:
					"Interrupted story-run is ready for explicit resume guidance.",
				nextIntentSummary:
					"Use story-orchestrate resume to continue this interrupted attempt.",
			});
		}

		let terminalDecision: StoryLeadTerminalDecision | null = null;
		if (storyLeadAssignment) {
			const provider = providerForHarness(
				storyLeadAssignment.secondary_harness,
			);
			const adapter = createProviderAdapter(provider, {
				env: input.env,
			});
			const recordPlannerTurnEvent = async (
				executionSessionId?: string,
			): Promise<void> => {
				const providerEvent = buildEvent({
					storyRunId: attemptPaths.storyRunId,
					sequence: currentSnapshot.latestEventSequence + 1,
					type: "story-lead-provider-started",
					summary:
						"Fresh story-lead provider turn executed without planner session resume.",
					data: {
						provider,
						model: storyLeadAssignment.model,
						reasoningEffort: storyLeadAssignment.reasoning_effort,
						...(executionSessionId ? { sessionId: executionSessionId } : {}),
					},
				});
				await appendRunEvent(providerEvent);
				await overwriteSnapshot({
					status: "running",
					lifecycleState: "awaiting_story_lead_action",
					currentSummary: providerEvent.summary,
					currentPhase: "story-lead-awaiting-action",
					callerInputHistory,
					nextIntent: {
						actionType: "await-story-lead-action",
						summary:
							"Await the next structured StoryLeadAction from the fresh provider turn.",
					},
					replayBoundary: null,
				});
			};

			const runChildOperation = async (
				action: StoryLeadAction,
			): Promise<string | StoryLeadRuntimeResult> => {
				switch (action.action) {
					case "run-implement": {
						const childArtifacts = await allocateChildOperationArtifacts({
							specPackRoot: input.specPackRoot,
							storyId,
							command: "story-implement",
						});
						await overwriteSnapshot({
							status: "running",
							lifecycleState: "running_child_operation",
							currentSummary: `Running story-implement: ${action.rationale}`,
							currentPhase: "run-implement",
							nextIntent: {
								actionType: "await-story-implement",
								summary: action.rationale,
							},
							currentChildOperation: {
								command: "story-implement",
								artifactPath: childArtifacts.artifactPath,
							},
							replayBoundary: null,
						});
						const childResult =
							await runChildWithinWholeRunBudget<ImplementorResult>({
								command: "story-implement",
								execute: () =>
									storyImplement({
										specPackRoot: input.specPackRoot,
										storyId,
										configPath: input.configPath,
										env: input.env,
										artifactPath: childArtifacts.artifactPath,
										streamOutputPaths: childArtifacts.streamOutputPaths,
										runtimeProgressPaths: childArtifacts.runtimeProgressPaths,
										disableHeartbeats: true,
									}) as Promise<OperationEnvelope<ImplementorResult>>,
							});
						if (childResult.case === "timed-out") {
							return childResult.result;
						}
						const envelope = childResult.envelope;
						const artifactRefs = semanticArtifactRefsFromEnvelope(
							"story-implement",
							envelope,
						);
						const continuation = extractContinuationHandle(envelope);
						const completionEvent = buildEvent({
							storyRunId: attemptPaths.storyRunId,
							sequence: currentSnapshot.latestEventSequence + 1,
							type: "child-operation-completed",
							summary: operationSummaryFromEnvelope(
								"story-implement",
								envelope,
							),
							artifact: lastSemanticArtifactPath(artifactRefs),
							data: {
								actionType: action.action,
								command: "story-implement",
								outcome: envelope.outcome,
								status: envelope.status,
							},
						});
						try {
							await recordCompletedChildOperation({
								completionEvent,
								requiredArtifacts: artifactRefs,
								currentSummary: completionEvent.summary,
								latestArtifacts: mergeArtifacts(
									currentSnapshot.latestArtifacts,
									artifactRefs,
								),
								latestContinuationHandles: continuation
									? {
											...currentSnapshot.latestContinuationHandles,
											storyImplementor: continuation,
										}
									: currentSnapshot.latestContinuationHandles,
								nextIntent: {
									actionType: "await-story-lead-action",
									summary: action.rationale,
									...(artifactRefs.at(-1)
										? { artifactRef: artifactRefs.at(-1)?.path }
										: {}),
								},
							});
						} catch (error) {
							if (error instanceof StoryRunArtifactIntegrityError) {
								return await interruptForArtifactIntegrityFailure({
									command: "story-implement",
									error,
								});
							}
							throw error;
						}
						maybeCrashAfterChildResult("story-implement");
						return completionEvent.summary;
					}
					case "run-continue": {
						const continuation =
							currentSnapshot.latestContinuationHandles[
								action.inputs.continuationRef
							];
						if (!continuation) {
							return await buildInterruptedResult({
								reason: "provider-output-invalid",
								eventType: "provider-output-invalid",
								eventSummary: `Story-lead referenced unknown continuation handle '${action.inputs.continuationRef}'.`,
								currentSummary:
									"Story-lead returned an invalid continuation-handle reference.",
								nextIntentSummary:
									"Resume from the last valid child artifact after correcting the story-lead action response.",
							});
						}
						const childArtifacts = await allocateChildOperationArtifacts({
							specPackRoot: input.specPackRoot,
							storyId,
							command: "story-continue",
						});
						await overwriteSnapshot({
							status: "running",
							lifecycleState: "running_child_operation",
							currentSummary: `Running story-continue: ${action.rationale}`,
							currentPhase: "run-continue",
							nextIntent: {
								actionType: "await-story-continue",
								summary: action.rationale,
								continuationHandleRef: action.inputs.continuationRef,
							},
							currentChildOperation: {
								command: "story-continue",
								artifactPath: childArtifacts.artifactPath,
								continuationHandleRef: action.inputs.continuationRef,
							},
							replayBoundary: null,
						});
						const childResult =
							await runChildWithinWholeRunBudget<ImplementorResult>({
								command: "story-continue",
								execute: () =>
									storyContinue({
										specPackRoot: input.specPackRoot,
										storyId,
										continuationHandle: continuation,
										followupRequest: action.inputs.promptAddendum,
										configPath: input.configPath,
										env: input.env,
										artifactPath: childArtifacts.artifactPath,
										streamOutputPaths: childArtifacts.streamOutputPaths,
										runtimeProgressPaths: childArtifacts.runtimeProgressPaths,
										disableHeartbeats: true,
									}) as Promise<OperationEnvelope<ImplementorResult>>,
							});
						if (childResult.case === "timed-out") {
							return childResult.result;
						}
						const envelope = childResult.envelope;
						const artifactRefs = semanticArtifactRefsFromEnvelope(
							"story-continue",
							envelope,
						);
						const updatedContinuation =
							extractContinuationHandle(envelope) ?? continuation;
						const completionEvent = buildEvent({
							storyRunId: attemptPaths.storyRunId,
							sequence: currentSnapshot.latestEventSequence + 1,
							type: "child-operation-completed",
							summary: operationSummaryFromEnvelope("story-continue", envelope),
							artifact: lastSemanticArtifactPath(artifactRefs),
							data: {
								actionType: action.action,
								command: "story-continue",
								outcome: envelope.outcome,
								status: envelope.status,
							},
						});
						try {
							await recordCompletedChildOperation({
								completionEvent,
								requiredArtifacts: artifactRefs,
								currentSummary: completionEvent.summary,
								latestArtifacts: mergeArtifacts(
									currentSnapshot.latestArtifacts,
									artifactRefs,
								),
								latestContinuationHandles: {
									...currentSnapshot.latestContinuationHandles,
									storyImplementor: updatedContinuation,
								},
								nextIntent: {
									actionType: "await-story-lead-action",
									summary: action.rationale,
									...(artifactRefs.at(-1)
										? { artifactRef: artifactRefs.at(-1)?.path }
										: {}),
								},
							});
						} catch (error) {
							if (error instanceof StoryRunArtifactIntegrityError) {
								return await interruptForArtifactIntegrityFailure({
									command: "story-continue",
									error,
								});
							}
							throw error;
						}
						maybeCrashAfterChildResult("story-continue");
						return completionEvent.summary;
					}
					case "run-self-review": {
						const continuationRef =
							action.inputs.continuationRef ?? "storyImplementor";
						const continuation =
							currentSnapshot.latestContinuationHandles[continuationRef];
						if (!continuation) {
							return await buildInterruptedResult({
								reason: "provider-output-invalid",
								eventType: "provider-output-invalid",
								eventSummary: `Story-lead referenced unknown continuation handle '${continuationRef}'.`,
								currentSummary:
									"Story-lead returned an invalid self-review continuation-handle reference.",
								nextIntentSummary:
									"Resume from the last valid child artifact after correcting the story-lead action response.",
							});
						}
						const childArtifacts = await allocateChildOperationArtifacts({
							specPackRoot: input.specPackRoot,
							storyId,
							command: "story-self-review",
							selfReviewPasses: action.inputs.passes ?? 1,
						});
						await overwriteSnapshot({
							status: "running",
							lifecycleState: "running_child_operation",
							currentSummary: `Running story-self-review: ${action.rationale}`,
							currentPhase: "run-self-review",
							nextIntent: {
								actionType: "await-story-self-review",
								summary: action.rationale,
								continuationHandleRef: continuationRef,
							},
							currentChildOperation: {
								command: "story-self-review",
								artifactPath: childArtifacts.artifactPath,
								continuationHandleRef: continuationRef,
							},
							replayBoundary: null,
						});
						const childResult =
							await runChildWithinWholeRunBudget<StorySelfReviewResult>({
								command: "story-self-review",
								execute: () =>
									storySelfReview({
										specPackRoot: input.specPackRoot,
										storyId,
										continuationHandle: continuation,
										passes: action.inputs.passes ?? 1,
										passArtifactPaths: childArtifacts.passArtifactPaths ?? [],
										configPath: input.configPath,
										env: input.env,
										artifactPath: childArtifacts.artifactPath,
										streamOutputPaths: childArtifacts.streamOutputPaths,
										runtimeProgressPaths: childArtifacts.runtimeProgressPaths,
										disableHeartbeats: true,
									}) as Promise<OperationEnvelope<StorySelfReviewResult>>,
							});
						if (childResult.case === "timed-out") {
							return childResult.result;
						}
						const envelope = childResult.envelope;
						const artifactRefs = semanticArtifactRefsFromEnvelope(
							"story-self-review",
							envelope,
						);
						const updatedContinuation =
							extractContinuationHandle(envelope) ?? continuation;
						const completionEvent = buildEvent({
							storyRunId: attemptPaths.storyRunId,
							sequence: currentSnapshot.latestEventSequence + 1,
							type: "child-operation-completed",
							summary: operationSummaryFromEnvelope(
								"story-self-review",
								envelope,
							),
							artifact: lastSemanticArtifactPath(artifactRefs),
							data: {
								actionType: action.action,
								command: "story-self-review",
								outcome: envelope.outcome,
								status: envelope.status,
							},
						});
						try {
							await recordCompletedChildOperation({
								completionEvent,
								requiredArtifacts: artifactRefs,
								currentSummary: completionEvent.summary,
								latestArtifacts: mergeArtifacts(
									currentSnapshot.latestArtifacts,
									artifactRefs,
								),
								latestContinuationHandles: {
									...currentSnapshot.latestContinuationHandles,
									storyImplementor: updatedContinuation,
								},
								nextIntent: {
									actionType: "await-story-lead-action",
									summary: action.rationale,
									...(artifactRefs.at(-1)
										? { artifactRef: artifactRefs.at(-1)?.path }
										: {}),
								},
							});
						} catch (error) {
							if (error instanceof StoryRunArtifactIntegrityError) {
								return await interruptForArtifactIntegrityFailure({
									command: "story-self-review",
									error,
								});
							}
							throw error;
						}
						maybeCrashAfterChildResult("story-self-review");
						return completionEvent.summary;
					}
					case "run-verify": {
						if (action.inputs.verifierContinuationRef) {
							const continuation =
								currentSnapshot.latestContinuationHandles[
									action.inputs.verifierContinuationRef
								];
							if (!continuation) {
								return await buildInterruptedResult({
									reason: "provider-output-invalid",
									eventType: "provider-output-invalid",
									eventSummary: `Story-lead referenced unknown verifier continuation handle '${action.inputs.verifierContinuationRef}'.`,
									currentSummary:
										"Story-lead returned an invalid verifier continuation-handle reference.",
									nextIntentSummary:
										"Resume from the last valid child artifact after correcting the story-lead action response.",
								});
							}
							let response: string | undefined = action.inputs.responseText;
							if (!response && action.inputs.responseArtifactRef) {
								const artifactPath = currentSnapshot.latestArtifacts.find(
									(artifact) =>
										artifact.path === action.inputs.responseArtifactRef,
								)?.path;
								if (!artifactPath) {
									return await buildInterruptedResult({
										reason: "provider-output-invalid",
										eventType: "provider-output-invalid",
										eventSummary: `Story-lead referenced unknown artifact '${action.inputs.responseArtifactRef}'.`,
										currentSummary:
											"Story-lead returned an invalid verifier response artifact reference.",
										nextIntentSummary:
											"Resume from the last valid child artifact after correcting the story-lead action response.",
									});
								}
								response = await readTextFile(artifactPath);
							}
							const childArtifacts = await allocateChildOperationArtifacts({
								specPackRoot: input.specPackRoot,
								storyId,
								command: "story-verify",
							});
							await overwriteSnapshot({
								status: "running",
								lifecycleState: "running_child_operation",
								currentSummary: `Running story-verify follow-up: ${action.rationale}`,
								currentPhase: "run-verify-followup",
								nextIntent: {
									actionType: "await-story-verify-followup",
									summary: action.rationale,
									continuationHandleRef: action.inputs.verifierContinuationRef,
								},
								currentChildOperation: {
									command: "story-verify",
									artifactPath: childArtifacts.artifactPath,
									continuationHandleRef: action.inputs.verifierContinuationRef,
								},
								replayBoundary: null,
							});
							const childResult =
								await runChildWithinWholeRunBudget<StoryVerifierResult>({
									command: "story-verify",
									execute: () =>
										storyVerify({
											specPackRoot: input.specPackRoot,
											storyId,
											provider: continuation.provider,
											sessionId: continuation.sessionId,
											response,
											orchestratorContext: action.inputs.orchestratorContext,
											configPath: input.configPath,
											env: input.env,
											artifactPath: childArtifacts.artifactPath,
											streamOutputPaths: childArtifacts.streamOutputPaths,
											runtimeProgressPaths: childArtifacts.runtimeProgressPaths,
											disableHeartbeats: true,
										}) as Promise<OperationEnvelope<StoryVerifierResult>>,
								});
							if (childResult.case === "timed-out") {
								return childResult.result;
							}
							const envelope = childResult.envelope;
							const artifactRefs = semanticArtifactRefsFromEnvelope(
								"story-verify",
								envelope,
							);
							const updatedContinuation =
								extractContinuationHandle(envelope) ?? continuation;
							const completionEvent = buildEvent({
								storyRunId: attemptPaths.storyRunId,
								sequence: currentSnapshot.latestEventSequence + 1,
								type: "child-operation-completed",
								summary: operationSummaryFromEnvelope("story-verify", envelope),
								artifact: lastSemanticArtifactPath(artifactRefs),
								data: {
									actionType: action.action,
									command: "story-verify",
									outcome: envelope.outcome,
									status: envelope.status,
								},
							});
							try {
								await recordCompletedChildOperation({
									completionEvent,
									requiredArtifacts: artifactRefs,
									currentSummary: completionEvent.summary,
									latestArtifacts: mergeArtifacts(
										currentSnapshot.latestArtifacts,
										artifactRefs,
									),
									latestContinuationHandles: {
										...currentSnapshot.latestContinuationHandles,
										storyVerifier: updatedContinuation,
									},
									nextIntent: {
										actionType: "await-story-lead-action",
										summary: action.rationale,
										...(artifactRefs.at(-1)
											? { artifactRef: artifactRefs.at(-1)?.path }
											: {}),
									},
								});
							} catch (error) {
								if (error instanceof StoryRunArtifactIntegrityError) {
									return await interruptForArtifactIntegrityFailure({
										command: "story-verify",
										error,
									});
								}
								throw error;
							}
							maybeCrashAfterChildResult("story-verify");
							return completionEvent.summary;
						}
						const childArtifacts = await allocateChildOperationArtifacts({
							specPackRoot: input.specPackRoot,
							storyId,
							command: "story-verify",
						});
						await overwriteSnapshot({
							status: "running",
							lifecycleState: "running_child_operation",
							currentSummary: `Running story-verify initial pass: ${action.rationale}`,
							currentPhase: "run-verify",
							nextIntent: {
								actionType: "await-story-verify-initial",
								summary: action.rationale,
							},
							currentChildOperation: {
								command: "story-verify",
								artifactPath: childArtifacts.artifactPath,
							},
							replayBoundary: null,
						});
						const childResult =
							await runChildWithinWholeRunBudget<StoryVerifierResult>({
								command: "story-verify",
								execute: () =>
									storyVerify({
										specPackRoot: input.specPackRoot,
										storyId,
										provider: action.inputs.provider,
										orchestratorContext:
											action.inputs.orchestratorContext ?? action.inputs.focus,
										configPath: input.configPath,
										env: input.env,
										artifactPath: childArtifacts.artifactPath,
										streamOutputPaths: childArtifacts.streamOutputPaths,
										runtimeProgressPaths: childArtifacts.runtimeProgressPaths,
										disableHeartbeats: true,
									}) as Promise<OperationEnvelope<StoryVerifierResult>>,
							});
						if (childResult.case === "timed-out") {
							return childResult.result;
						}
						const envelope = childResult.envelope;
						const artifactRefs = semanticArtifactRefsFromEnvelope(
							"story-verify",
							envelope,
						);
						const continuation = extractContinuationHandle(envelope);
						const completionEvent = buildEvent({
							storyRunId: attemptPaths.storyRunId,
							sequence: currentSnapshot.latestEventSequence + 1,
							type: "child-operation-completed",
							summary: operationSummaryFromEnvelope("story-verify", envelope),
							artifact: lastSemanticArtifactPath(artifactRefs),
							data: {
								actionType: action.action,
								command: "story-verify",
								outcome: envelope.outcome,
								status: envelope.status,
							},
						});
						try {
							await recordCompletedChildOperation({
								completionEvent,
								requiredArtifacts: artifactRefs,
								currentSummary: completionEvent.summary,
								latestArtifacts: mergeArtifacts(
									currentSnapshot.latestArtifacts,
									artifactRefs,
								),
								latestContinuationHandles: continuation
									? {
											...currentSnapshot.latestContinuationHandles,
											storyVerifier: continuation,
										}
									: currentSnapshot.latestContinuationHandles,
								nextIntent: {
									actionType: "await-story-lead-action",
									summary: action.rationale,
									...(artifactRefs.at(-1)
										? { artifactRef: artifactRefs.at(-1)?.path }
										: {}),
								},
							});
						} catch (error) {
							if (error instanceof StoryRunArtifactIntegrityError) {
								return await interruptForArtifactIntegrityFailure({
									command: "story-verify",
									error,
								});
							}
							throw error;
						}
						maybeCrashAfterChildResult("story-verify");
						return completionEvent.summary;
					}
					case "run-quick-fix": {
						const childArtifacts = await allocateChildOperationArtifacts({
							specPackRoot: input.specPackRoot,
							storyId,
							command: "quick-fix",
						});
						await overwriteSnapshot({
							status: "running",
							lifecycleState: "running_child_operation",
							currentSummary: `Running quick-fix: ${action.rationale}`,
							currentPhase: "run-quick-fix",
							nextIntent: {
								actionType: "await-quick-fix",
								summary: action.rationale,
							},
							currentChildOperation: {
								command: "quick-fix",
								artifactPath: childArtifacts.artifactPath,
							},
							replayBoundary: null,
						});
						const childResult =
							await runChildWithinWholeRunBudget<QuickFixResult>({
								command: "quick-fix",
								execute: () =>
									quickFix({
										specPackRoot: input.specPackRoot,
										request: action.inputs.remediationGoal,
										workingDirectory: action.inputs.workingDirectory,
										configPath: input.configPath,
										env: input.env,
										artifactPath: childArtifacts.artifactPath,
										streamOutputPaths: childArtifacts.streamOutputPaths,
										runtimeProgressPaths: childArtifacts.runtimeProgressPaths,
										disableHeartbeats: true,
									}) as Promise<OperationEnvelope<QuickFixResult>>,
							});
						if (childResult.case === "timed-out") {
							return childResult.result;
						}
						const envelope = childResult.envelope;
						const artifactRefs = semanticArtifactRefsFromEnvelope(
							"quick-fix",
							envelope,
						);
						const completionEvent = buildEvent({
							storyRunId: attemptPaths.storyRunId,
							sequence: currentSnapshot.latestEventSequence + 1,
							type: "child-operation-completed",
							summary: operationSummaryFromEnvelope("quick-fix", envelope),
							artifact: lastSemanticArtifactPath(artifactRefs),
							data: {
								actionType: action.action,
								command: "quick-fix",
								outcome: envelope.outcome,
								status: envelope.status,
							},
						});
						try {
							await recordCompletedChildOperation({
								completionEvent,
								requiredArtifacts: artifactRefs,
								currentSummary: completionEvent.summary,
								latestArtifacts: mergeArtifacts(
									currentSnapshot.latestArtifacts,
									artifactRefs,
								),
								nextIntent: {
									actionType: "await-story-lead-action",
									summary: action.rationale,
									...(artifactRefs.at(-1)
										? { artifactRef: artifactRefs.at(-1)?.path }
										: {}),
								},
							});
						} catch (error) {
							if (error instanceof StoryRunArtifactIntegrityError) {
								return await interruptForArtifactIntegrityFailure({
									command: "quick-fix",
									error,
								});
							}
							throw error;
						}
						maybeCrashAfterChildResult("quick-fix");
						return completionEvent.summary;
					}
					case "request-ruling":
						terminalDecision = {
							kind: "request-ruling",
							request: {
								id:
									action.inputs.id ??
									`${attemptPaths.storyRunId}-ruling-${String(
										currentSnapshot.latestEventSequence + 1,
									).padStart(3, "0")}`,
								decisionType: action.inputs.decisionType,
								question: action.inputs.question,
								defaultRecommendation: action.inputs.defaultRecommendation,
								evidence: action.inputs.evidence,
								allowedResponses: action.inputs.allowedResponses,
							},
							verification: action.verification,
							riskAndDeviationReview: action.riskAndDeviationReview,
							rationale: action.rationale,
						};
						return "Story-lead requested caller ruling.";
					case "accept-story":
						terminalDecision = {
							kind: "accept",
							acceptance: {
								acceptanceChecks:
									action.inputs.acceptanceChecks ??
									action.inputs.acceptanceCheckRefs.map((ref) => ({
										name: ref,
										status: "unknown" as const,
										evidence: [ref],
										reasoning: action.inputs.summary,
									})),
								recommendedImplLeadAction:
									action.inputs.recommendedImplLeadAction,
							},
							verification: action.verification,
							riskAndDeviationReview: action.riskAndDeviationReview,
							rationale: action.rationale,
						};
						return "Story-lead declared the evidence ready for scoped acceptance packaging.";
					case "block-story":
						terminalDecision = {
							kind: "block",
							reason: action.inputs.reason,
							detail: action.inputs.detail,
							verification: action.verification,
							riskAndDeviationReview: action.riskAndDeviationReview,
							rationale: action.rationale,
						};
						return `Story-lead blocked the story: ${action.inputs.reason}`;
					case "fail-story":
						terminalDecision = {
							kind: "fail",
							reason: action.inputs.reason,
							detail: action.inputs.detail,
							verification: action.verification,
							riskAndDeviationReview: action.riskAndDeviationReview,
							rationale: action.rationale,
						};
						return `Story-lead failed the story: ${action.inputs.reason}`;
				}
			};

			for (let turn = 1; turn <= STORY_LEAD_MAX_TURNS; turn += 1) {
				if (hasWholeRunTimedOut()) {
					return await buildWholeRunTimeoutInterruptedResult({
						currentSummary:
							"Story-orchestrate exceeded the whole-run timeout before the next planner turn could start.",
					});
				}

				let prompt: string;
				let plannerContext: StoryLeadPlannerContext;
				try {
					const promptInput = await buildStoryLeadActionPrompt({
						specPackRoot: input.specPackRoot,
						storyRunId: attemptPaths.storyRunId,
						mode: input.mode,
						currentSnapshot,
						currentSnapshotPath: attemptPaths.currentSnapshotPath,
						eventHistoryPath: attemptPaths.eventHistoryPath,
						provider,
						model: storyLeadAssignment.model,
						runtimeSettings: {
							storyGate: gateCommands?.story,
							epicGate: gateCommands?.epic,
							plannerTimeoutMs: timeouts.story_lead_planner_ms,
							wholeRunTimeoutMs: timeouts.story_orchestrate_ms,
							providerStartupTimeoutMs: timeouts.provider_startup_timeout_ms,
							providerActiveSilenceTimeoutMs:
								timeouts.story_implementor_silence_timeout_ms,
						},
					});
					prompt = promptInput.prompt;
					plannerContext = promptInput.context;
				} catch (error) {
					if (isContextOverflowError(error)) {
						const overflowEvent = buildEvent({
							storyRunId: attemptPaths.storyRunId,
							sequence: currentSnapshot.latestEventSequence + 1,
							type: "story-lead-context-overflow",
							summary:
								"Story-lead planner context exceeded the provider limit and the run failed loudly.",
							data: error,
						});
						await appendRunEvent(overflowEvent);
						terminalDecision = {
							kind: "fail",
							reason: "Story-lead planner context exceeded the provider limit.",
							detail: JSON.stringify(error),
							rationale:
								"Required durable planner context cannot be summarized or truncated to continue safely.",
						};
						break;
					}

					throw error;
				}

				const plannerBudget = plannerExecutionBudget();
				if (plannerBudget.remainingWholeRunMs <= 0) {
					return await buildWholeRunTimeoutInterruptedResult({
						currentSummary:
							"Story-orchestrate exhausted the whole-run timeout before the planner call could start.",
					});
				}

				const providerExecution = await adapter.execute({
					prompt,
					cwd: providerCwd,
					model: storyLeadAssignment.model,
					reasoningEffort: storyLeadAssignment.reasoning_effort,
					timeoutMs: plannerBudget.effectiveTimeoutMs,
					startupTimeoutMs: timeouts.provider_startup_timeout_ms,
					silenceTimeoutMs: timeouts.story_implementor_silence_timeout_ms,
					resultSchema: storyLeadActionSchema,
				});
				if (
					(providerExecution.errorCode === "PROVIDER_TIMEOUT" ||
						providerExecution.timedOut) &&
					plannerBudget.cappedByWholeRun
				) {
					return await buildWholeRunTimeoutInterruptedResult({
						currentSummary:
							"Story-orchestrate exceeded the whole-run timeout while waiting for the current planner turn.",
					});
				}

				if (
					providerExecution.exitCode !== 0 ||
					providerExecution.parseError ||
					!providerExecution.parsedResult
				) {
					if (providerFailureLooksLikeContextOverflow(providerExecution)) {
						const overflowError = providerContextOverflowError({
							storyId,
							storyRunId: attemptPaths.storyRunId,
							provider,
							model: storyLeadAssignment.model,
							context: plannerContext,
						});
						const overflowEvent = buildEvent({
							storyRunId: attemptPaths.storyRunId,
							sequence: currentSnapshot.latestEventSequence + 1,
							type: "story-lead-context-overflow",
							summary:
								"Story-lead provider rejected the full planner context as exceeding input limits.",
							data: {
								...overflowError,
								providerDiagnostic: providerFailureSummary(providerExecution),
							},
						});
						await appendRunEvent(overflowEvent);
						terminalDecision = {
							kind: "fail",
							reason:
								"Story-lead provider rejected the full planner context as exceeding input limits.",
							detail: JSON.stringify(overflowError),
							rationale:
								"Required durable planner context cannot be summarized or truncated after provider-side input-limit rejection.",
						};
						break;
					}

					if (
						providerExecution.errorCode === "PROVIDER_TIMEOUT" ||
						providerExecution.timedOut
					) {
						return await buildInterruptedResult({
							reason: "planner-timeout",
							eventType: "story-lead-planner-timeout",
							eventSummary: `Story-lead planner turn exceeded the configured planner timeout of ${timeouts.story_lead_planner_ms}ms.`,
							currentSummary:
								"Story-lead planner turn timed out before it could return the next bounded action.",
							nextIntentSummary:
								"Resume from the durable story-run record and re-run the next planner turn with a fresh story-lead provider session.",
							eventData: {
								errorCode: providerExecution.errorCode,
								configuredPlannerTimeoutMs: timeouts.story_lead_planner_ms,
								elapsedMs: providerExecution.elapsedMs,
							},
						});
					}

					return await buildInterruptedResult({
						reason: providerFailureReason(providerExecution),
						eventType:
							providerFailureReason(providerExecution) ===
							"provider-output-invalid"
								? "provider-output-invalid"
								: "story-lead-provider-failed",
						eventSummary: providerFailureSummary(providerExecution),
						currentSummary:
							providerFailureReason(providerExecution) ===
							"provider-output-invalid"
								? "Provider output invalidated the story-lead action loop."
								: "Story-lead provider failed before it could return the next bounded action.",
						nextIntentSummary: replayBoundaryForFailure({
							reason: providerFailureReason(providerExecution),
							validArtifactPaths: currentSnapshot.latestArtifacts.map(
								(artifact) => artifact.path,
							),
						}).smallestSafeStep,
						eventData: {
							errorCode: providerExecution.errorCode,
						},
					});
				}

				await recordPlannerTurnEvent(providerExecution.sessionId);
				const action = providerExecution.parsedResult;
				try {
					assertStoryLeadActionAllowed({
						lifecycleState: currentSnapshot.lifecycleState,
						action: actionTypeForStateValidation(action),
					});
				} catch (error) {
					const message =
						error instanceof Error
							? error.message
							: "Story-lead returned an invalid action for the current lifecycle state.";
					const invalidActionEvent = buildEvent({
						storyRunId: attemptPaths.storyRunId,
						sequence: currentSnapshot.latestEventSequence + 1,
						type: "story-lead-action-invalid",
						summary:
							"Story-lead returned an action that is not allowed for the current lifecycle state.",
						data: {
							lifecycleState: currentSnapshot.lifecycleState,
							actionType: action.action,
							message,
						},
					});
					await appendRunEvent(invalidActionEvent);
					terminalDecision = {
						kind: "fail",
						reason:
							"Story-lead returned an action that is not allowed for the current lifecycle state.",
						detail: message,
						rationale:
							"Invalid state/action pairs must fail loudly instead of executing an out-of-bounds planner step.",
					};
					break;
				}
				const actionEvent = buildEvent({
					storyRunId: attemptPaths.storyRunId,
					sequence: currentSnapshot.latestEventSequence + 1,
					type: "story-lead-action-selected",
					summary: `Story-lead selected ${action.action}.`,
					data: {
						actionType: action.action,
						turn,
						...(action.selfNote ? { selfNote: action.selfNote } : {}),
					},
				});
				await appendRunEvent(actionEvent);
				if (action.selfNote) {
					await appendRunEvent(
						buildEvent({
							storyRunId: attemptPaths.storyRunId,
							sequence: currentSnapshot.latestEventSequence + 1,
							type: "story-lead-self-note-recorded",
							summary:
								"Story-lead recorded a durable self-note for a future planner turn.",
							data: {
								note: action.selfNote,
								actionSequence: actionEvent.sequence,
								actionType: action.action,
								turn,
							},
						}),
					);
				}
				await overwriteSnapshot({
					status: "running",
					lifecycleState: terminalDecision
						? "recording_result"
						: "awaiting_story_lead_action",
					currentSummary: actionEvent.summary,
					currentPhase: "story-lead-action-selected",
					nextIntent: {
						actionType: action.action,
						summary: action.rationale,
					},
					replayBoundary: null,
				});

				const childSummaryOrInterrupt = await runChildOperation(action);
				if (typeof childSummaryOrInterrupt !== "string") {
					return childSummaryOrInterrupt;
				}
				if (hasWholeRunTimedOut()) {
					return await buildWholeRunTimeoutInterruptedResult({
						currentSummary:
							"Story-orchestrate exceeded the whole-run timeout after completing a bounded child operation.",
					});
				}

				if (terminalDecision) {
					break;
				}
			}

			if (!terminalDecision) {
				return await buildInterruptedResult({
					reason: "interrupted",
					eventType: "story-lead-turn-limit",
					eventSummary: `Story-lead exceeded the ${STORY_LEAD_MAX_TURNS}-turn bounded limit without reaching a terminal decision.`,
					currentSummary:
						"Story-lead exceeded the bounded turn limit and must be resumed from durable state.",
					nextIntentSummary:
						"Use story-orchestrate resume to continue this interrupted attempt from the latest durable ledger state.",
				});
			}
		}
		if (hasWholeRunTimedOut()) {
			return await buildWholeRunTimeoutInterruptedResult();
		}

		const implementorArtifacts = filterArtifactsByKind(
			currentSnapshot.latestArtifacts,
			["implementor-result"],
		);
		const verifierArtifacts = filterArtifactsByKind(
			currentSnapshot.latestArtifacts,
			["verifier-result"],
		);
		const selfReviewArtifacts = filterArtifactsByKind(
			currentSnapshot.latestArtifacts,
			["self-review-result"],
		);
		const quickFixArtifacts = filterArtifactsByKind(
			currentSnapshot.latestArtifacts,
			["quick-fix-result"],
		);

		const latestImplementorEnvelope =
			await readArtifactEnvelope<ImplementorResult>(
				implementorArtifacts.at(-1)?.path ?? "",
			);
		const latestSelfReviewEnvelope =
			await readArtifactEnvelope<StorySelfReviewResult>(
				selfReviewArtifacts.at(-1)?.path ?? "",
			);
		const latestVerifierEnvelope =
			await readArtifactEnvelope<StoryVerifierResult>(
				verifierArtifacts.at(-1)?.path ?? "",
			);
		const latestQuickFixEnvelope = await readArtifactEnvelope<QuickFixResult>(
			quickFixArtifacts.at(-1)?.path ?? "",
		);

		const latestImplementorResult = latestImplementorEnvelope?.result;
		const latestSelfReviewResult = latestSelfReviewEnvelope?.result;
		const latestVerifierResult = latestVerifierEnvelope?.result;
		const latestQuickFixResult = latestQuickFixEnvelope?.result;
		const derivedVerifierOutcome = input.reviewRequest?.items.length
			? "block"
			: latestVerifierResult
				? (normalizeVerifierOutcome(latestVerifierResult.recommendedNextStep) ??
					(await deriveVerifierOutcomeFromArtifacts(verifierArtifacts)))
				: await deriveVerifierOutcomeFromArtifacts(verifierArtifacts);

		const baselineFromCurrentRun =
			deriveBaselineFromImplementorResult(latestSelfReviewResult) ??
			deriveBaselineFromImplementorResult(latestImplementorResult);
		const inheritedBaseline = input.reviewRequest
			? undefined
			: priorAcceptedFinalPackage?.logHandoff.cumulativeBaseline;
		const baselineBeforeStory =
			baselineFromCurrentRun?.baselineBeforeStory ??
			inheritedBaseline?.baselineBeforeCurrentStory ??
			null;
		const baselineAfterStory =
			baselineFromCurrentRun?.baselineAfterStory ??
			inheritedBaseline?.expectedAfterCurrentStory ??
			inheritedBaseline?.latestActualTotal ??
			null;
		const latestActualTotal =
			baselineFromCurrentRun?.latestActualTotal ??
			inheritedBaseline?.latestActualTotal ??
			null;

		const gateRun =
			latestVerifierResult?.gatesRun.at(-1) ??
			latestSelfReviewResult?.gatesRun.at(-1) ??
			latestImplementorResult?.gatesRun.at(-1) ??
			(!input.reviewRequest
				? priorAcceptedFinalPackage?.evidence.gateRuns.at(-1)
				: undefined);

		const reviewFindings =
			input.reviewRequest?.items.map((item) => ({
				id: item.id,
				status: "unresolved" as const,
				evidence: [
					...callerInputArtifacts.map((artifact) => artifact.path),
					...(item.evidence ?? []),
				],
			})) ?? [];
		const verifierFindings =
			latestVerifierResult?.openFindings.map((finding) => ({
				id: finding.id,
				status: "unresolved" as const,
				evidence: [
					...verifierArtifacts.map((artifact) => artifact.path),
					finding.evidence,
				],
			})) ?? [];

		const resolvedTerminalDecision =
			terminalDecision ??
			legacyTerminalDecision({
				reviewRequest: input.reviewRequest,
				ruling: input.ruling,
				priorAttempt,
				attemptPaths,
				callerInputArtifacts,
				implementorArtifacts,
				verifierArtifacts,
				priorAcceptedFinalPackage,
			});
		const defaultVerification = {
			finalVerifierOutcome: derivedVerifierOutcome,
			findings: [...reviewFindings, ...verifierFindings],
		} satisfies StoryLeadVerification;
		const explicitFindingIds = new Set(
			resolvedTerminalDecision.verification?.findings.map(
				(finding) => finding.id,
			) ?? [],
		);
		const effectiveVerification = resolvedTerminalDecision.verification
			? ({
					...resolvedTerminalDecision.verification,
					findings: [
						...resolvedTerminalDecision.verification.findings,
						...defaultVerification.findings.filter(
							(finding) => !explicitFindingIds.has(finding.id),
						),
					],
				} satisfies StoryLeadVerification)
			: defaultVerification;
		const verifierShimMockFallbackDecisions =
			latestVerifierResult?.mockOrShimAuditFindings.map((finding) =>
				verifierMockOrShimFindingAsRiskItem({
					finding,
					verifierArtifacts,
				}),
			) ?? [];
		const terminalRiskReview = mergeRiskReview({
			base: resolvedTerminalDecision.riskAndDeviationReview,
			shimMockFallbackDecisions: verifierShimMockFallbackDecisions,
		});

		const commitReadiness =
			resolvedTerminalDecision.kind === "accept"
				? gateRun?.result === "pass" &&
					effectiveVerification.finalVerifierOutcome === "pass"
					? {
							state: "ready-for-impl-lead-commit" as const,
						}
					: {
							state: "not-ready" as const,
							reason:
								gateRun?.result !== "pass"
									? "Story gate has not passed in the current evidence set."
									: "Verifier evidence is not yet in a passing terminal state.",
						}
				: {
						state: "not-ready" as const,
						reason:
							resolvedTerminalDecision.kind === "request-ruling"
								? "Caller ruling is still required before impl-lead commit."
								: (resolvedTerminalDecision.detail ??
									resolvedTerminalDecision.reason),
					};

		const diffSource = latestSelfReviewResult ?? latestImplementorResult;
		const finalPackage = buildStoryLeadFinalPackage({
			outcome:
				resolvedTerminalDecision.kind === "accept"
					? "accepted"
					: resolvedTerminalDecision.kind === "request-ruling"
						? "needs-ruling"
						: resolvedTerminalDecision.kind === "fail"
							? "failed"
							: "blocked",
			storyId,
			storyRunId: attemptPaths.storyRunId,
			attempt: attemptPaths.attempt,
			storyTitle,
			implementedScope:
				latestSelfReviewResult?.planSummary ??
				latestImplementorResult?.planSummary ??
				priorAcceptedFinalPackage?.summary.implementedScope ??
				(latestQuickFixResult
					? "Story-lead coordinated bounded child operations, including quick-fix work, and assembled a durable final package."
					: "Story-lead coordinated bounded child operations and assembled a durable final package."),
			evidence: {
				implementorArtifacts,
				selfReviewArtifacts,
				verifierArtifacts,
				quickFixArtifacts,
				callerInputArtifacts,
			},
			verification: {
				finalVerifierOutcome: effectiveVerification.finalVerifierOutcome,
				findings: effectiveVerification.findings,
			},
			riskAndDeviationReview: {
				specDeviations: [
					...(terminalRiskReview.specDeviations ?? []),
					...(latestImplementorResult?.specDeviations.map((description) => ({
						description,
						reasoning:
							"Story implementor surfaced this spec deviation during bounded child execution.",
						evidence: implementorArtifacts.map((artifact) => artifact.path),
						approvalStatus: "needs-ruling" as const,
						approvalSource: null,
					})) ?? []),
				],
				assumedRisks:
					resolvedTerminalDecision.kind === "block"
						? [
								...(terminalRiskReview.assumedRisks ?? []),
								{
									description: resolvedTerminalDecision.reason,
									reasoning: resolvedTerminalDecision.rationale,
									evidence: currentSnapshot.latestArtifacts.map(
										(artifact) => artifact.path,
									),
									approvalStatus: "needs-ruling",
									approvalSource: null,
								},
							]
						: (terminalRiskReview.assumedRisks ?? []),
				scopeChanges:
					input.reviewRequest?.decision === "ask-ruling"
						? [
								...(terminalRiskReview.scopeChanges ?? []),
								{
									description: input.reviewRequest.summary,
									reasoning:
										"Impl-lead asked for a ruling-boundary reopen instead of silent acceptance.",
									evidence: callerInputArtifacts.map(
										(artifact) => artifact.path,
									),
									approvalStatus: "needs-ruling",
									approvalSource: null,
								},
							]
						: (terminalRiskReview.scopeChanges ?? []),
				shimMockFallbackDecisions:
					terminalRiskReview.shimMockFallbackDecisions ?? [],
			},
			diffReview: priorAcceptedFinalPackage?.diffReview ?? {
				changedFiles:
					diffSource?.changedFiles.map((file) => ({
						path: file.path,
						reason: file.reason,
					})) ?? [],
				storyScopedAssessment: diffSource?.changedFiles.length
					? "Latest bounded child-operation changes remain scoped to the active story."
					: "Story-lead preserved story scope and surfaced only handoff-specific orchestration evidence.",
			},
			callerInputHistory,
			rulingRequest:
				resolvedTerminalDecision.kind === "request-ruling"
					? resolvedTerminalDecision.request
					: null,
			replayBoundary: null,
			gateRun,
			continuationHandles: currentSnapshot.latestContinuationHandles,
			baselineBeforeStory,
			baselineAfterStory,
			latestActualTotal,
			commitReadiness,
			acceptanceSummary:
				resolvedTerminalDecision.kind === "accept"
					? resolvedTerminalDecision.acceptance
					: undefined,
		});
		await input.ledger.writeFinalPackage({
			storyId,
			storyRunId: attemptPaths.storyRunId,
			finalPackage,
		});
		const terminalEvent = buildEvent({
			storyRunId: attemptPaths.storyRunId,
			sequence: currentSnapshot.latestEventSequence + 1,
			type: finalPackage.outcome,
			summary: `Story-lead finalized ${attemptPaths.storyRunId} with outcome ${finalPackage.outcome}.`,
			artifact: attemptPaths.finalPackagePath,
			data: {
				terminalDecision: resolvedTerminalDecision.kind,
			},
		});
		await appendRunEvent(terminalEvent);
		await overwriteSnapshot({
			status: finalPackage.outcome,
			lifecycleState: "terminal",
			currentSummary:
				resolvedTerminalDecision.kind === "accept"
					? "Terminal story-lead package is ready for impl-lead review."
					: resolvedTerminalDecision.kind === "request-ruling"
						? "Terminal story-lead package is waiting for caller ruling."
						: resolvedTerminalDecision.kind === "fail"
							? "Terminal story-lead package failed after a child-operation runtime failure."
							: "Terminal story-lead package blocked and awaits explicit follow-up.",
			currentPhase: "terminal",
			latestArtifacts: mergeArtifacts(currentSnapshot.latestArtifacts, [
				{
					kind: "final-package",
					path: attemptPaths.finalPackagePath,
					provenance: "current-run",
				},
			]),
			nextIntent: {
				actionType:
					finalPackage.outcome === "accepted"
						? "impl-lead-review"
						: finalPackage.outcome === "needs-ruling"
							? "await-ruling"
							: finalPackage.outcome === "failed"
								? "inspect-failure"
								: "reopen-story-run",
				summary:
					finalPackage.outcome === "accepted"
						? "Impl-lead can review the scoped acceptance package."
						: finalPackage.outcome === "needs-ruling"
							? "Pause for caller ruling before impl-lead acceptance."
							: finalPackage.outcome === "failed"
								? "Inspect the failed child-operation evidence before deciding whether to reopen or repair the story run."
								: "Use story-orchestrate status or resume for explicit follow-up handling.",
				artifactRef: attemptPaths.finalPackagePath,
			},
			replayBoundary: finalPackage.replayBoundary,
			currentChildOperation: null,
		});
		const terminalFinalPackagePath = attemptPaths.finalPackagePath;
		input.progressListener?.(
			buildAttachedEvent({
				type: "terminal",
				command:
					input.mode === "run"
						? "story-orchestrate run"
						: "story-orchestrate resume",
				phase: "terminal",
				summary: `Story ${storyId} finished with outcome ${finalPackage.outcome}. storyRunId=${attemptPaths.storyRunId}. Final package: ${terminalFinalPackagePath}`,
				callerHarness: activeCallerHarness,
				storyId,
				storyRunId: attemptPaths.storyRunId,
				statusArtifact: attemptPaths.currentSnapshotPath,
				elapsedTime: formatElapsed(startedAtMs),
				finalPackagePath: terminalFinalPackagePath,
			}),
		);

		return {
			case: "completed",
			storyId,
			storyRunId: attemptPaths.storyRunId,
			currentSnapshotPath: attemptPaths.currentSnapshotPath,
			eventHistoryPath: attemptPaths.eventHistoryPath,
			finalPackagePath: attemptPaths.finalPackagePath,
			finalPackage,
			latestEventSequence: currentSnapshot.latestEventSequence,
			startedFromPrimitiveArtifacts: input.startedFromPrimitiveArtifacts,
			...(acceptedReviewRequestArtifact
				? { acceptedReviewRequestArtifact }
				: {}),
			...(acceptedRulingArtifact ? { acceptedRulingArtifact } : {}),
		};
	} finally {
		heartbeat?.stop();
	}
}
