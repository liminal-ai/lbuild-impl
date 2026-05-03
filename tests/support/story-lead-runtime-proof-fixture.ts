import { join } from "node:path";

import {
	createRunConfig,
	createSpecPack,
	createTempDir,
	writeFakeProviderExecutable,
	writeRunConfig,
	writeTextFile,
} from "./test-helpers.js";

interface ImplementorProviderPayload {
	outcome:
		| "ready-for-verification"
		| "needs-followup-fix"
		| "needs-human-ruling"
		| "blocked";
	planSummary: string;
	changedFiles: Array<{ path: string; reason: string }>;
	tests: {
		added: string[];
		modified: string[];
		removed: string[];
		totalAfterStory?: number;
		deltaFromPriorBaseline?: number;
	};
	gatesRun: Array<{ command: string; result: "pass" | "fail" | "not-run" }>;
	selfReview: {
		findingsFixed: string[];
		findingsSurfaced: string[];
	};
	openQuestions: string[];
	specDeviations: string[];
	recommendedNextStep: string;
}

interface VerifierFindingPayload {
	id: string;
	severity: "critical" | "major" | "minor" | "observation";
	title: string;
	evidence: string;
	affectedFiles: string[];
	requirementIds: string[];
	recommendedFixScope:
		| "same-session-implementor"
		| "quick-fix"
		| "fresh-fix-path"
		| "human-ruling";
	blocking: boolean;
}

interface VerifierProviderPayload {
	artifactsRead: string[];
	reviewScopeSummary: string;
	priorFindingStatuses: Array<{
		id: string;
		status: "resolved" | "still-open" | "needs-human-ruling";
		rationale: string;
	}>;
	newFindings: VerifierFindingPayload[];
	openFindings: VerifierFindingPayload[];
	requirementCoverage: {
		verified: string[];
		unverified: string[];
	};
	gatesRun: Array<{ command: string; result: "pass" | "fail" | "not-run" }>;
	mockOrShimAuditFindings: string[];
	recommendedNextStep: "pass" | "revise" | "block" | "needs-human-ruling";
	recommendedFixScope:
		| "same-session-implementor"
		| "quick-fix"
		| "fresh-fix-path"
		| "human-ruling";
	openQuestions: string[];
	additionalObservations: string[];
}

export interface MiniStoryRuntimeProofFixture {
	specPackRoot: string;
	storyId: string;
	storyTitle: string;
	targetFilePath: string;
	storyPath: string;
	techDesignPath: string;
	testPlanPath: string;
	childArtifactPaths: {
		implementor: string;
		selfReviewPass: string;
		selfReviewBatch: string;
		verifier: string;
	};
}

export interface MiniStoryRuntimeProofProviders {
	env: Record<string, string>;
	storyLeadLogPath: string;
	childProviderLogPath: string;
}

function providerWrapper(sessionId: string, payload: unknown): string {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

function buildStoryLeadAcceptAction() {
	return {
		action: "accept-story",
		rationale:
			"Implementor, self-review, and verifier evidence are present for the mini runtime proof fixture.",
		inputs: {
			summary:
				"Implementor, self-review, and verifier evidence are present for the mini runtime proof fixture.",
			acceptanceCheckRefs: ["child-artifacts-created"],
			acceptanceChecks: [
				{
					name: "child-artifacts-created",
					status: "pass" as const,
					evidence: [
						"implementor-result",
						"self-review-result",
						"verifier-result",
					],
					reasoning:
						"The runtime created bounded child-operation artifacts during this story-orchestrate run.",
				},
			],
			recommendedImplLeadAction: "accept" as const,
		},
	};
}

function buildImplementorPayload(
	fixture: MiniStoryRuntimeProofFixture,
): ImplementorProviderPayload {
	return {
		outcome: "ready-for-verification",
		planSummary:
			"Update integration-fixture.txt for the mini runtime proof and keep the change story-scoped.",
		changedFiles: [
			{
				path: "integration-fixture.txt",
				reason:
					"Provide one deterministic file edit that the proof can track through child operation artifacts.",
			},
		],
		tests: {
			added: ["tests/unit/core/story-lead-loop.test.ts"],
			modified: [],
			removed: [],
			totalAfterStory: 1,
			deltaFromPriorBaseline: 0,
		},
		gatesRun: [
			{
				command: "npm run green-verify",
				result: "not-run",
			},
		],
		selfReview: {
			findingsFixed: [],
			findingsSurfaced: [],
		},
		openQuestions: [],
		specDeviations: [],
		recommendedNextStep: `Run retained self-review for ${fixture.storyId}.`,
	};
}

function buildSelfReviewPayload(
	fixture: MiniStoryRuntimeProofFixture,
): ImplementorProviderPayload {
	return {
		...buildImplementorPayload(fixture),
		selfReview: {
			findingsFixed: [
				"Confirmed the integration fixture update stays inside the mini proof scope.",
			],
			findingsSurfaced: [],
		},
		recommendedNextStep: `Run story verification for ${fixture.storyId}.`,
	};
}

function buildVerifierPayload(
	fixture: MiniStoryRuntimeProofFixture,
): VerifierProviderPayload {
	return {
		artifactsRead: [
			fixture.storyPath,
			fixture.techDesignPath,
			fixture.testPlanPath,
			fixture.childArtifactPaths.implementor,
			fixture.childArtifactPaths.selfReviewBatch,
		],
		reviewScopeSummary:
			"Reviewed the implementor and self-review evidence for the mini runtime proof fixture.",
		priorFindingStatuses: [],
		newFindings: [],
		openFindings: [],
		requirementCoverage: {
			verified: ["AC-mini-1", "AC-mini-2", "AC-mini-3"],
			unverified: [],
		},
		gatesRun: [
			{
				command: "npm run green-verify",
				result: "not-run",
			},
		],
		mockOrShimAuditFindings: [],
		recommendedNextStep: "pass",
		recommendedFixScope: "same-session-implementor",
		openQuestions: [],
		additionalObservations: [
			"Mini proof fixture child artifacts are sufficient to close the story-level loop.",
		],
	};
}

export async function createMiniStoryRuntimeProofFixture(
	scope: string,
): Promise<MiniStoryRuntimeProofFixture> {
	const specPackRoot = await createSpecPack(scope, {
		companionMode: "four-file",
		includeStoriesDir: false,
	});
	const storyId = "03-mini-story-runtime-proof";
	const storyTitle = "Story 3: Mini Story Runtime Proof";
	const storyPath = join(specPackRoot, "stories", `${storyId}.md`);
	const techDesignPath = join(specPackRoot, "tech-design.md");
	const testPlanPath = join(specPackRoot, "test-plan.md");
	const targetFilePath = join(specPackRoot, "integration-fixture.txt");

	await writeTextFile(
		join(specPackRoot, "epic.md"),
		[
			"# Epic",
			"",
			"## Goal",
			"Exercise a minimal story-runtime loop that creates child operation artifacts during story-orchestrate.",
		].join("\n"),
	);
	await writeTextFile(
		techDesignPath,
		[
			"# Technical Design",
			"",
			"## StoryLeadAction loop",
			"- run-implement",
			"- run-self-review",
			"- run-verify",
			"- accept-story",
		].join("\n"),
	);
	await writeTextFile(
		join(specPackRoot, "tech-design-cli-runtime.md"),
		"# CLI Runtime Companion\n\nUse the public story-orchestrate surface.\n",
	);
	await writeTextFile(
		join(specPackRoot, "tech-design-skill-process.md"),
		"# Skill Process Companion\n\nKeep coordinator internals real and mock only external provider boundaries.\n",
	);
	await writeTextFile(
		testPlanPath,
		[
			"# Test Plan",
			"",
			"## Mock boundaries",
			"- Mock provider subprocesses only.",
			"- Do not mock story-lead coordinator internals.",
			"- Do not mock child SDK operation surfaces in story-runtime tests.",
		].join("\n"),
	);
	await writeTextFile(
		storyPath,
		[
			`# ${storyTitle}`,
			"",
			"## Objective",
			"Update `integration-fixture.txt` from `before` to `after`.",
			"",
			"## Acceptance Criteria",
			"- AC-mini-1: the bounded implementor path updates the integration fixture.",
			"- AC-mini-2: the retained self-review path records a same-session review artifact.",
			"- AC-mini-3: the verifier path confirms the updated fixture evidence.",
		].join("\n"),
	);
	await writeTextFile(targetFilePath, "before\n");
	await writeTextFile(
		join(specPackRoot, "package.json"),
		`${JSON.stringify(
			{
				name: "mini-story-runtime-proof",
				private: true,
				scripts: {
					"green-verify": 'node -e "process.exit(0)"',
					"verify-all": 'node -e "process.exit(0)"',
				},
			},
			null,
			2,
		)}\n`,
	);

	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			story_implementor: {
				secondary_harness: "copilot",
				model: "gpt-5.4",
				reasoning_effort: "high",
			},
			quick_fixer: {
				secondary_harness: "copilot",
				model: "gpt-5.4",
				reasoning_effort: "high",
			},
			story_verifier: {
				secondary_harness: "copilot",
				model: "gpt-5.4",
				reasoning_effort: "xhigh",
			},
			story_lead_provider: {
				secondary_harness: "codex",
				model: "gpt-5.4",
				reasoning_effort: "high",
			},
			self_review: {
				passes: 1,
			},
			caller_harness: {
				harness: "codex",
				story_heartbeat_cadence_minutes: 10,
			},
			verification_gates: {
				story: "npm run green-verify",
				epic: "npm run verify-all",
			},
		}),
	);

	return {
		specPackRoot,
		storyId,
		storyTitle,
		targetFilePath,
		storyPath,
		techDesignPath,
		testPlanPath,
		childArtifactPaths: {
			implementor: join(
				specPackRoot,
				"artifacts",
				storyId,
				"002-implementor.json",
			),
			selfReviewPass: join(
				specPackRoot,
				"artifacts",
				storyId,
				"003-self-review-pass-1.json",
			),
			selfReviewBatch: join(
				specPackRoot,
				"artifacts",
				storyId,
				"004-self-review-batch.json",
			),
			verifier: join(specPackRoot, "artifacts", storyId, "005-verify.json"),
		},
	};
}

export async function installMiniStoryRuntimeProofProviders(
	fixture: MiniStoryRuntimeProofFixture,
): Promise<MiniStoryRuntimeProofProviders> {
	const providerBinDir = await createTempDir(
		`story-runtime-proof-providers-${fixture.storyId}`,
	);
	const storyLead = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerWrapper("codex-story-lead-proof-001", {
					action: "run-implement",
					rationale:
						"Start with the bounded implementor operation so the proof can observe real child artifact creation.",
					inputs: {},
				}),
			},
			{
				stdout: providerWrapper("codex-story-lead-proof-001", {
					action: "run-self-review",
					rationale:
						"Use the retained implementor continuation for a single explicit self-review pass.",
					inputs: {
						artifactRefs: [fixture.childArtifactPaths.implementor],
						continuationRef: "storyImplementor",
						passes: 1,
					},
				}),
			},
			{
				stdout: providerWrapper("codex-story-lead-proof-001", {
					action: "run-verify",
					rationale:
						"Run the verifier after implementation and self-review artifacts are present.",
					inputs: {
						artifactRefs: [fixture.childArtifactPaths.selfReviewBatch],
					},
				}),
			},
			{
				stdout: providerWrapper(
					"codex-story-lead-proof-001",
					buildStoryLeadAcceptAction(),
				),
			},
		],
	});
	const childProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "copilot",
		responses: [
			{
				stdout: providerWrapper(
					"copilot-story-implement-proof-001",
					buildImplementorPayload(fixture),
				),
			},
			{
				stdout: providerWrapper(
					"copilot-story-implement-proof-001",
					buildSelfReviewPayload(fixture),
				),
			},
			{
				stdout: providerWrapper(
					"copilot-story-verify-proof-001",
					buildVerifierPayload(fixture),
				),
			},
		],
	});

	return {
		env: {
			PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
			...storyLead.env,
			...childProvider.env,
		},
		storyLeadLogPath: storyLead.logPath,
		childProviderLogPath: childProvider.logPath,
	};
}
