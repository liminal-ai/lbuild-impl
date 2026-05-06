import { join } from "node:path";
import { expect, test } from "vitest";

import { buildRuntimeProgressPaths } from "../../../src/core/artifact-writer";
import {
	createExternalSpecPack,
	createRunConfig,
	createSpecPack,
	createTempDir,
	parseJsonOutput,
	ROOT,
	readJsonLines,
	runSourceCli,
	writeFakeProviderExecutable,
	writeRunConfig,
	writeTextFile,
} from "../../support/test-helpers";

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

interface EpicVerifierPayload {
	outcome: "pass" | "revise" | "block";
	crossStoryFindings: string[];
	architectureFindings: string[];
	epicCoverageAssessment: string[];
	productionPathFindings: string[];
	blockingFindings: VerifierFindingPayload[];
	nonBlockingFindings: VerifierFindingPayload[];
	unresolvedItems: string[];
	gateResult: "pass" | "fail" | "not-run";
}

interface EpicCanonicalReviewPayload extends EpicVerifierPayload {
	reviewerLabels: string[];
	reconciliationSummary: string;
}

async function createEpicSpecPack(scope: string): Promise<string> {
	const specPackRoot = await createSpecPack(scope, {
		companionMode: "four-file",
	});
	await writeTextFile(
		join(specPackRoot, "package.json"),
		`${JSON.stringify(
			{
				name: "fixture-spec-pack",
				private: true,
				scripts: {
					"green-verify": "bun run green-verify",
					"verify-all": "bun run verify-all",
				},
			},
			null,
			2,
		)}\n`,
	);
	await writeTextFile(
		join(specPackRoot, "src", "runtime.ts"),
		"export const runtime = 'production-path';\n",
	);

	return specPackRoot;
}

function providerResult(sessionId: string, payload: EpicVerifierPayload) {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

function canonicalProviderResult(
	sessionId: string,
	payload: EpicCanonicalReviewPayload,
) {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

function basePayload(
	overrides: Partial<EpicVerifierPayload> = {},
): EpicVerifierPayload {
	const payload: EpicVerifierPayload = {
		outcome: "pass",
		crossStoryFindings: [
			"Fix, verification, and reverify are routed in one closeout sequence.",
		],
		architectureFindings: [
			"Artifact persistence remains consistent across story and epic workflows.",
		],
		epicCoverageAssessment: [
			"AC-7.1 through AC-8.4 were reviewed against the whole implementation set.",
		],
		productionPathFindings: [
			"No inappropriate mocks, shims, placeholders, or fake adapters remain on production paths.",
		],
		blockingFindings: [],
		nonBlockingFindings: [],
		unresolvedItems: [],
		gateResult: "not-run",
	};

	return {
		...payload,
		...overrides,
		crossStoryFindings:
			overrides.crossStoryFindings ?? payload.crossStoryFindings,
		architectureFindings:
			overrides.architectureFindings ?? payload.architectureFindings,
		epicCoverageAssessment:
			overrides.epicCoverageAssessment ?? payload.epicCoverageAssessment,
		productionPathFindings:
			overrides.productionPathFindings ?? payload.productionPathFindings,
		blockingFindings: overrides.blockingFindings ?? payload.blockingFindings,
		nonBlockingFindings:
			overrides.nonBlockingFindings ?? payload.nonBlockingFindings,
		unresolvedItems: overrides.unresolvedItems ?? payload.unresolvedItems,
	};
}

function canonicalReviewPayload(
	overrides: Partial<EpicCanonicalReviewPayload> = {},
): EpicCanonicalReviewPayload {
	return {
		...basePayload(overrides),
		reviewerLabels: overrides.reviewerLabels ?? [
			"epic-reviewer-1",
			"epic-reviewer-2",
		],
		reconciliationSummary:
			overrides.reconciliationSummary ??
			"Internal reconciliation reviewed both independent epic reviewer results and produced the canonical finding set.",
	};
}

test("TC-8.1c launches fresh epic reviewers and returns explicit mock or shim audit findings for production paths", async () => {
	const specPackRoot = await createEpicSpecPack("epic-review-contract");
	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			epic_verifiers: [
				{
					label: "epic-reviewer-1",
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "xhigh",
				},
				{
					label: "epic-reviewer-2",
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
			],
		}),
	);
	const providerBinDir = await createTempDir("epic-review-contract-provider");
	const codexProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult("codex-epic-review-001", basePayload()),
			},
			{
				stdout: canonicalProviderResult(
					"codex-epic-review-reconcile-001",
					canonicalReviewPayload(),
				),
			},
		],
	});
	const claudeProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "claude",
		responses: [
			{
				stdout: providerResult("claude-epic-review-001", basePayload()),
			},
		],
	});

	const run = await runSourceCli(
		["epic-review", "--spec-pack-root", specPackRoot, "--json"],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...codexProvider.env,
				...claudeProvider.env,
			},
		},
	);

	expect(run.exitCode).toBe(0);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.command).toBe("epic-review");
	expect(envelope.outcome).toBe("pass");
	expect(envelope.result.canonicalReview).toMatchObject({
		outcome: "pass",
		reviewerLabels: ["epic-reviewer-1", "epic-reviewer-2"],
		reconciliationSummary:
			"Internal reconciliation reviewed both independent epic reviewer results and produced the canonical finding set.",
	});
	expect(envelope.result.canonicalReview.productionPathFindings).toEqual(
		expect.arrayContaining([
			"No inappropriate mocks, shims, placeholders, or fake adapters remain on production paths.",
		]),
	);
	expect(envelope.result.verifierResults).toHaveLength(2);
	expect(envelope.result.verifierResults).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				reviewerLabel: "epic-reviewer-1",
				provider: "codex",
			}),
			expect.objectContaining({
				reviewerLabel: "epic-reviewer-2",
				provider: "claude-code",
			}),
		]),
	);
	for (const result of envelope.result.verifierResults as unknown as Array<{
		productionPathFindings: string[];
	}>) {
		expect(result.productionPathFindings).toEqual(
			expect.arrayContaining([
				"No inappropriate mocks, shims, placeholders, or fake adapters remain on production paths.",
			]),
		);
	}

	const artifactPath = envelope.artifacts[0].path as string;
	expect(artifactPath).toContain("/artifacts/epic/001-epic-review.json");
	const persisted = JSON.parse(await Bun.file(artifactPath).text());
	expect(persisted).toEqual(envelope);
	const progressPaths = buildRuntimeProgressPaths(artifactPath);
	const runtimeStatus = JSON.parse(
		await Bun.file(progressPaths.statusPath).text(),
	) as {
		status: string;
		verifiersCompleted?: number;
		verifiersPlanned?: number;
	};
	const progressEvents = await readJsonLines<{ event: string }>(
		progressPaths.progressPath,
	);
	expect(runtimeStatus.status).toBe("completed");
	expect(runtimeStatus.verifiersCompleted).toBe(2);
	expect(runtimeStatus.verifiersPlanned).toBe(2);
	expect(progressEvents.map((event) => event.event)).toEqual(
		expect.arrayContaining([
			"command-started",
			"verifier-started",
			"verifier-completed",
			"completed",
		]),
	);

	const codexInvocations = await readJsonLines<{ args: string[]; cwd: string }>(
		codexProvider.logPath,
	);
	const claudeInvocations = await readJsonLines<{
		args: string[];
		cwd: string;
	}>(claudeProvider.logPath);
	expect(codexInvocations).toHaveLength(2);
	expect(claudeInvocations).toHaveLength(1);
	expect(codexInvocations[0]?.cwd).toBe(ROOT);
	expect(codexInvocations[1]?.cwd).toBe(ROOT);
	expect(claudeInvocations[0]?.cwd).toBe(ROOT);
	expect(codexInvocations[0]?.args).not.toContain("resume");
	expect(codexInvocations[1]?.args).not.toContain("resume");
	expect(claudeInvocations[0]?.args).not.toContain("--resume");
});

test("blocks epic-review with INVALID_SPEC_PACK when the spec-pack root is outside any git repo", async () => {
	const specPackRoot = await createExternalSpecPack("epic-review-no-git-repo");

	const run = await runSourceCli([
		"epic-review",
		"--spec-pack-root",
		specPackRoot,
		"--json",
	]);

	expect(run.exitCode).toBe(3);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.status).toBe("blocked");
	expect(envelope.outcome).toBe("block");
	expect(envelope.errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "INVALID_SPEC_PACK",
			}),
		]),
	);
});

test("blocks epic-review when a verifier finding inside blockingFindings includes an unknown key", async () => {
	const specPackRoot = await createEpicSpecPack("epic-review-strict-finding");
	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			epic_verifiers: [
				{
					label: "epic-reviewer-1",
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "xhigh",
				},
				{
					label: "epic-reviewer-2",
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
			],
		}),
	);
	const providerBinDir = await createTempDir(
		"epic-review-strict-finding-provider",
	);
	const invalidFinding = {
		id: "epic-strict-finding-001",
		severity: "major",
		title: "Unexpected finding drift",
		evidence: "The verifier emitted an extra key in a blocking finding.",
		affectedFiles: ["processes/impl-cli/core/result-contracts.ts"],
		requirementIds: ["TC-8.1c"],
		recommendedFixScope: "fresh-fix-path",
		blocking: true,
		extraField: "drift",
	} as VerifierFindingPayload & { extraField: string };
	const codexProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: JSON.stringify({
					sessionId: "codex-epic-review-strict-001",
					result: {
						...basePayload({
							blockingFindings: [invalidFinding],
						}),
					},
				}),
			},
		],
	});
	const claudeProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "claude",
		responses: [
			{
				stdout: providerResult("claude-epic-review-strict-001", basePayload()),
			},
		],
	});

	const run = await runSourceCli(
		["epic-review", "--spec-pack-root", specPackRoot, "--json"],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...codexProvider.env,
				...claudeProvider.env,
			},
		},
	);

	expect(run.exitCode).toBe(3);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.status).toBe("blocked");
	expect(envelope.outcome).toBe("block");
	expect(envelope.result).toEqual(
		expect.objectContaining({
			outcome: "block",
			verifierResults: [
				expect.objectContaining({
					reviewerLabel: "epic-reviewer-2",
					provider: "claude-code",
				}),
			],
		}),
	);
	expect(envelope.errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "PROVIDER_OUTPUT_INVALID",
			}),
		]),
	);
});

test("preserves successful epic reviewer results when a sibling epic reviewer execution fails", async () => {
	const specPackRoot = await createEpicSpecPack("epic-review-partial-failure");
	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			epic_verifiers: [
				{
					label: "epic-reviewer-1",
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "xhigh",
				},
				{
					label: "epic-reviewer-2",
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
			],
		}),
	);
	const providerBinDir = await createTempDir(
		"epic-review-partial-failure-provider",
	);
	const codexProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stderr: "codex epic reviewer crashed before returning JSON",
				exitCode: 1,
			},
		],
	});
	const claudeProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "claude",
		responses: [
			{
				stdout: providerResult(
					"claude-epic-review-partial-001",
					basePayload({
						outcome: "revise",
						nonBlockingFindings: [
							{
								id: "epic-finding-partial-001",
								severity: "major",
								title:
									"The surviving epic reviewer evidence is still available",
								evidence:
									"One epic reviewer failed, but the successful verifier still found a real closeout gap.",
								affectedFiles: ["processes/impl-cli/commands/epic-reverify.ts"],
								requirementIds: ["TC-8.2a"],
								recommendedFixScope: "fresh-fix-path",
								blocking: false,
							},
						],
					}),
				),
			},
		],
	});

	const run = await runSourceCli(
		["epic-review", "--spec-pack-root", specPackRoot, "--json"],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...codexProvider.env,
				...claudeProvider.env,
			},
		},
	);

	expect(run.exitCode).toBe(3);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.status).toBe("blocked");
	expect(envelope.outcome).toBe("block");
	expect(envelope.errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "PROVIDER_UNAVAILABLE",
				message: "Provider execution failed for codex.",
			}),
		]),
	);
	expect(envelope.result.verifierResults).toHaveLength(1);
	expect(envelope.result.verifierResults[0]).toMatchObject({
		reviewerLabel: "epic-reviewer-2",
		provider: "claude-code",
		outcome: "revise",
		nonBlockingFindings: [
			expect.objectContaining({
				id: "epic-finding-partial-001",
				severity: "major",
			}),
		],
	});
});

test("returns exit code 2 when the epic reviewer batch outcome is revise", async () => {
	const specPackRoot = await createEpicSpecPack("epic-review-revise");
	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			epic_verifiers: [
				{
					label: "epic-reviewer-1",
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "xhigh",
				},
				{
					label: "epic-reviewer-2",
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
			],
		}),
	);
	const providerBinDir = await createTempDir("epic-review-revise-provider");
	const codexProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-review-revise-001",
					basePayload({
						outcome: "revise",
						nonBlockingFindings: [
							{
								id: "epic-finding-revise-001",
								severity: "major",
								title: "epic reviewer found a non-blocking closeout gap",
								evidence:
									"The epic reviewer found a remaining fix before closeout is safe.",
								affectedFiles: ["src/references/claude-impl-cli-operations.md"],
								requirementIds: ["TC-8.2a"],
								recommendedFixScope: "fresh-fix-path",
								blocking: false,
							},
						],
					}),
				),
			},
			{
				stdout: canonicalProviderResult(
					"codex-epic-review-reconcile-revise-001",
					canonicalReviewPayload({
						outcome: "revise",
						nonBlockingFindings: [
							{
								id: "epic-finding-revise-001",
								severity: "major",
								title: "epic reviewer found a non-blocking closeout gap",
								evidence:
									"The epic reviewer found a remaining fix before closeout is safe.",
								affectedFiles: ["src/references/claude-impl-cli-operations.md"],
								requirementIds: ["TC-8.2a"],
								recommendedFixScope: "fresh-fix-path",
								blocking: false,
							},
						],
					}),
				),
			},
		],
	});
	const claudeProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "claude",
		responses: [
			{
				stdout: providerResult("claude-epic-review-revise-001", basePayload()),
			},
		],
	});

	const run = await runSourceCli(
		["epic-review", "--spec-pack-root", specPackRoot, "--json"],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...codexProvider.env,
				...claudeProvider.env,
			},
		},
	);

	expect(run.exitCode).toBe(0);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.outcome).toBe("revise");
	expect(
		(
			envelope.result.verifierResults as unknown as Array<{ outcome: string }>
		).map((result) => result.outcome),
	).toEqual(["revise", "pass"]);
});

test("accepts a canonical pass when reconciliation downgrades a raw blocking reviewer outcome", async () => {
	const specPackRoot = await createEpicSpecPack("epic-review-canonical-pass");
	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			epic_verifiers: [
				{
					label: "epic-reviewer-1",
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "xhigh",
				},
				{
					label: "epic-reviewer-2",
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
			],
		}),
	);
	const providerBinDir = await createTempDir(
		"epic-review-canonical-pass-provider",
	);
	const blockingFinding = {
		id: "epic-finding-block-001",
		severity: "major" as const,
		title: "epic reviewer raised a contested blocker",
		evidence:
			"The blocking reviewer reported a production-path issue that the reconciler disproved against the code.",
		affectedFiles: ["src/core/story-final-package.ts"],
		requirementIds: ["TC-8.2a"],
		recommendedFixScope: "human-ruling" as const,
		blocking: true,
	};
	const codexProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-review-canonical-pass-001",
					basePayload({
						outcome: "block",
						blockingFindings: [blockingFinding],
					}),
				),
			},
			{
				stdout: canonicalProviderResult(
					"codex-epic-review-canonical-pass-reconcile-001",
					canonicalReviewPayload({
						outcome: "pass",
						blockingFindings: [],
						reconciliationSummary:
							"Reconciliation reviewed the contested blocking issue against the code and disproved it, so the canonical epic review passes.",
					}),
				),
			},
		],
	});
	const claudeProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "claude",
		responses: [
			{
				stdout: providerResult(
					"claude-epic-review-canonical-pass-001",
					basePayload(),
				),
			},
		],
	});

	const run = await runSourceCli(
		["epic-review", "--spec-pack-root", specPackRoot, "--json"],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...codexProvider.env,
				...claudeProvider.env,
			},
		},
	);

	expect(run.exitCode).toBe(0);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.outcome).toBe("pass");
	expect(envelope.result.canonicalReview).toMatchObject({
		outcome: "pass",
		reconciliationSummary:
			"Reconciliation reviewed the contested blocking issue against the code and disproved it, so the canonical epic review passes.",
	});
	expect(
		(
			envelope.result.verifierResults as unknown as Array<{ outcome: string }>
		).map((result) => result.outcome),
	).toEqual(["block", "pass"]);
});

test("reruns epic review with fresh sessions and increments the epic reviewer artifact path", async () => {
	const specPackRoot = await createEpicSpecPack("epic-review-rerun");
	await writeRunConfig(
		specPackRoot,
		createRunConfig({
			epic_verifiers: [
				{
					label: "epic-reviewer-1",
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "xhigh",
				},
				{
					label: "epic-reviewer-2",
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
			],
		}),
	);
	const providerBinDir = await createTempDir("epic-review-rerun-provider");
	const codexProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult("codex-epic-review-rerun-001", basePayload()),
			},
			{
				stdout: canonicalProviderResult(
					"codex-epic-review-rerun-reconcile-001",
					canonicalReviewPayload(),
				),
			},
			{
				stdout: providerResult("codex-epic-review-rerun-002", basePayload()),
			},
			{
				stdout: canonicalProviderResult(
					"codex-epic-review-rerun-reconcile-002",
					canonicalReviewPayload(),
				),
			},
		],
	});
	const claudeProvider = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "claude",
		responses: [
			{
				stdout: providerResult("claude-epic-review-rerun-001", basePayload()),
			},
			{
				stdout: providerResult("claude-epic-review-rerun-002", basePayload()),
			},
		],
	});

	const sharedEnv = {
		PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
		...codexProvider.env,
		...claudeProvider.env,
	};

	const firstRun = await runSourceCli(
		["epic-review", "--spec-pack-root", specPackRoot, "--json"],
		{
			env: sharedEnv,
		},
	);
	const secondRun = await runSourceCli(
		["epic-review", "--spec-pack-root", specPackRoot, "--json"],
		{
			env: sharedEnv,
		},
	);

	expect(firstRun.exitCode).toBe(0);
	expect(secondRun.exitCode).toBe(0);

	const secondEnvelope = parseJsonOutput(secondRun.stdout);
	expect(secondEnvelope.artifacts[0].path).toContain(
		"/artifacts/epic/002-epic-review.json",
	);

	const codexInvocations = await readJsonLines<{ args: string[] }>(
		codexProvider.logPath,
	);
	const claudeInvocations = await readJsonLines<{ args: string[] }>(
		claudeProvider.logPath,
	);

	expect(codexInvocations).toHaveLength(4);
	expect(claudeInvocations).toHaveLength(2);
	expect(codexInvocations[0]?.args).not.toContain("resume");
	expect(codexInvocations[1]?.args).not.toContain("resume");
	expect(codexInvocations[2]?.args).not.toContain("resume");
	expect(codexInvocations[3]?.args).not.toContain("resume");
	expect(claudeInvocations[0]?.args).not.toContain("--resume");
	expect(claudeInvocations[1]?.args).not.toContain("--resume");
});
