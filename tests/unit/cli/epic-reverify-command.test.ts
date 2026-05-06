import { chmod } from "node:fs/promises";
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

interface EpicVerifierFindingReport {
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

interface EpicVerifierReport {
	resultId: string;
	outcome: "pass" | "revise" | "block";
	provider: "claude-code" | "codex";
	model: string;
	reviewerLabel: string;
	crossStoryFindings: string[];
	architectureFindings: string[];
	epicCoverageAssessment: string[];
	productionPathFindings: string[];
	blockingFindings: EpicVerifierFindingReport[];
	nonBlockingFindings: EpicVerifierFindingReport[];
	unresolvedItems: string[];
	gateResult: "pass" | "fail" | "not-run";
}

interface EpicReverifyPayload {
	outcome:
		| "ready-for-closeout"
		| "needs-fixes"
		| "needs-more-verification"
		| "blocked";
	confirmedIssues: string[];
	disputedOrUnconfirmedIssues: string[];
	readinessAssessment: string;
	recommendedNextStep: string;
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

	return specPackRoot;
}

function baseVerifierReport(
	reviewerLabel: string,
	overrides: Partial<EpicVerifierReport> = {},
): EpicVerifierReport {
	const report: EpicVerifierReport = {
		resultId: `${reviewerLabel}-result-001`,
		outcome: "pass",
		provider: reviewerLabel === "epic-verifier-1" ? "codex" : "claude-code",
		model: reviewerLabel === "epic-verifier-1" ? "gpt-5.4" : "claude-sonnet",
		reviewerLabel,
		crossStoryFindings: [
			"Fix, verification, and reverify are treated as a single closeout workflow.",
		],
		architectureFindings: [
			"Artifacts persist under the expected fix and epic directories.",
		],
		epicCoverageAssessment: ["Epic AC-7.1 through AC-8.4 were reviewed."],
		productionPathFindings: [
			"No inappropriate mocks remain on production paths.",
		],
		blockingFindings: [],
		nonBlockingFindings: [],
		unresolvedItems: [],
		gateResult: "not-run",
	};

	return {
		...report,
		...overrides,
		crossStoryFindings:
			overrides.crossStoryFindings ?? report.crossStoryFindings,
		architectureFindings:
			overrides.architectureFindings ?? report.architectureFindings,
		epicCoverageAssessment:
			overrides.epicCoverageAssessment ?? report.epicCoverageAssessment,
		productionPathFindings:
			overrides.productionPathFindings ?? report.productionPathFindings,
		blockingFindings: overrides.blockingFindings ?? report.blockingFindings,
		nonBlockingFindings:
			overrides.nonBlockingFindings ?? report.nonBlockingFindings,
		unresolvedItems: overrides.unresolvedItems ?? report.unresolvedItems,
	};
}

async function writeVerifierReport(
	specPackRoot: string,
	fileName: string,
	report: EpicVerifierReport,
): Promise<string> {
	const reportPath = join(specPackRoot, "artifacts", "epic", fileName);
	await writeTextFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	return reportPath;
}

function providerResult(sessionId: string, payload: EpicReverifyPayload) {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

function baseSynthesisPayload(
	overrides: Partial<EpicReverifyPayload> = {},
): EpicReverifyPayload {
	return {
		outcome: "ready-for-closeout",
		confirmedIssues: ["Epic verification ran before closeout."],
		disputedOrUnconfirmedIssues: [],
		readinessAssessment:
			"The epic is ready for the orchestrator-owned final gate.",
		recommendedNextStep:
			"Run the final epic gate and review the reverify evidence before closeout.",
		...overrides,
	};
}

test("returns INVALID_INPUT with exit code 1 when no review reports are provided", async () => {
	const specPackRoot = await createEpicSpecPack(
		"epic-reverify-missing-reports",
	);

	const run = await runSourceCli([
		"epic-reverify",
		"--spec-pack-root",
		specPackRoot,
		"--json",
	]);

	expect(run.exitCode).toBe(1);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.status).toBe("error");
	expect(envelope.outcome).toBe("error");
	expect(envelope.errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "INVALID_INPUT",
				message: "Provide at least one --review-report path.",
			}),
		]),
	);
});

test("TC-8.2a runs epic reverify from review reports and returns the structured reverify result", async () => {
	const specPackRoot = await createEpicSpecPack("epic-reverify-contract");
	await writeRunConfig(specPackRoot, createRunConfig());
	const reportOne = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-1.json",
		baseVerifierReport("epic-verifier-1"),
	);
	const reportTwo = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-2.json",
		baseVerifierReport("epic-verifier-2"),
	);
	const providerBinDir = await createTempDir("epic-reverify-contract-provider");
	const { env, logPath } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-reverify-001",
					baseSynthesisPayload(),
				),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-reverify",
			"--spec-pack-root",
			specPackRoot,
			"--review-report",
			reportOne,
			"--review-report",
			reportTwo,
			"--json",
		],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...env,
			},
		},
	);

	expect(run.exitCode).toBe(0);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.command).toBe("epic-reverify");
	expect(envelope.outcome).toBe("ready-for-closeout");
	expect(envelope.result).toMatchObject({
		provider: "codex",
		sessionId: "codex-epic-reverify-001",
		mode: "initial",
		continuation: {
			provider: "codex",
			sessionId: "codex-epic-reverify-001",
			operation: "epic-reverify",
		},
	});
	expect(envelope.result.confirmedIssues).toEqual([
		"Epic verification ran before closeout.",
	]);

	const artifactPath = envelope.artifacts[0].path as string;
	expect(artifactPath).toContain("/artifacts/epic/001-epic-reverify.json");
	const persisted = JSON.parse(await Bun.file(artifactPath).text());
	expect(persisted).toEqual(envelope);
	const progressPaths = buildRuntimeProgressPaths(artifactPath);
	const runtimeStatus = JSON.parse(
		await Bun.file(progressPaths.statusPath).text(),
	) as {
		status: string;
		phase: string;
	};
	const progressEvents = await readJsonLines<{ event: string }>(
		progressPaths.progressPath,
	);
	expect(runtimeStatus.status).toBe("completed");
	expect(runtimeStatus.phase).toBe("finalizing");
	expect(progressEvents.map((event) => event.event)).toEqual(
		expect.arrayContaining([
			"command-started",
			"provider-spawned",
			"provider-exit",
			"completed",
		]),
	);

	const invocations = await readJsonLines<{ args: string[]; cwd: string }>(
		logPath,
	);
	expect(invocations).toHaveLength(1);
	expect(invocations[0]?.cwd).toBe(ROOT);
	expect(invocations[0]?.args).not.toContain("resume");
});

test("continues epic-reverify with the retained provider session", async () => {
	const specPackRoot = await createEpicSpecPack("epic-reverify-retained");
	await writeRunConfig(specPackRoot, createRunConfig());
	const firstReportPath = await writeVerifierReport(
		specPackRoot,
		"epic-review-1.json",
		baseVerifierReport("epic-verifier-1"),
	);
	const providerBinDir = await createTempDir("epic-reverify-retained-provider");
	const { env, logPath } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-reverify-retained-001",
					baseSynthesisPayload(),
				),
			},
			{
				stdout: providerResult(
					"codex-epic-reverify-retained-001",
					baseSynthesisPayload(),
				),
			},
		],
	});

	const first = await runSourceCli(
		[
			"epic-reverify",
			"--spec-pack-root",
			specPackRoot,
			"--review-report",
			firstReportPath,
			"--json",
		],
		{ env: { PATH: `${providerBinDir}:${process.env.PATH ?? ""}`, ...env } },
	);
	const firstEnvelope = parseJsonOutput(first.stdout);
	const second = await runSourceCli(
		[
			"epic-reverify",
			"--spec-pack-root",
			specPackRoot,
			"--review-report",
			firstReportPath,
			"--provider",
			firstEnvelope.result.continuation.provider,
			"--session-id",
			firstEnvelope.result.continuation.sessionId,
			"--json",
		],
		{ env: { PATH: `${providerBinDir}:${process.env.PATH ?? ""}`, ...env } },
	);

	expect(second.exitCode).toBe(0);
	const secondEnvelope = parseJsonOutput(second.stdout);
	expect(secondEnvelope.result.mode).toBe("followup");
	expect(secondEnvelope.result.continuation).toEqual(
		firstEnvelope.result.continuation,
	);
	const invocations = await readJsonLines<{ args: string[] }>(logPath);
	expect(invocations).toHaveLength(2);
	expect(invocations[0]?.args).not.toContain("resume");
	expect(invocations[1]?.args).toContain("resume");
	expect(invocations[1]?.args).toContain("codex-epic-reverify-retained-001");
});

test("blocks epic-reverify with INVALID_SPEC_PACK when the spec-pack root is outside any git repo", async () => {
	const specPackRoot = await createExternalSpecPack(
		"epic-reverify-no-git-repo",
	);
	const verifierReportPath = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-1.json",
		baseVerifierReport("epic-verifier-1"),
	);

	const run = await runSourceCli([
		"epic-reverify",
		"--spec-pack-root",
		specPackRoot,
		"--review-report",
		verifierReportPath,
		"--json",
	]);

	expect(run.exitCode).toBe(3);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.status).toBe("blocked");
	expect(envelope.outcome).toBe("blocked");
	expect(envelope.errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "INVALID_SPEC_PACK",
			}),
		]),
	);
});

test("blocks epic-reverify when the structured reverify payload includes an unknown top-level key", async () => {
	const specPackRoot = await createEpicSpecPack("epic-reverify-strict-payload");
	await writeRunConfig(specPackRoot, createRunConfig());
	const reportOne = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-1.json",
		baseVerifierReport("epic-verifier-1"),
	);
	const reportTwo = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-2.json",
		baseVerifierReport("epic-verifier-2"),
	);
	const providerBinDir = await createTempDir("epic-reverify-strict-provider");
	const { env } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: JSON.stringify({
					sessionId: "codex-epic-reverify-strict-001",
					result: {
						...baseSynthesisPayload(),
						extraField: "drift",
					},
				}),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-reverify",
			"--spec-pack-root",
			specPackRoot,
			"--review-report",
			reportOne,
			"--review-report",
			reportTwo,
			"--json",
		],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...env,
			},
		},
	);

	expect(run.exitCode).toBe(3);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.status).toBe("blocked");
	expect(envelope.outcome).toBe("blocked");
	expect(envelope.result).toBeUndefined();
	expect(envelope.errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "PROVIDER_OUTPUT_INVALID",
			}),
		]),
	);
});

test("TC-8.3a verifies findings independently instead of blindly merging review reports", async () => {
	const specPackRoot = await createEpicSpecPack(
		"epic-reverify-independent-verification",
	);
	await writeRunConfig(specPackRoot, createRunConfig());
	const reportOne = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-1.json",
		baseVerifierReport("epic-verifier-1", {
			outcome: "revise",
			nonBlockingFindings: [
				{
					id: "epic-synth-finding-001",
					severity: "major",
					title: "Fix precedes epic verification",
					evidence: "Verifier 1 observed the documented fix ordering.",
					affectedFiles: ["src/references/claude-impl-process-playbook.md"],
					requirementIds: ["TC-7.3a"],
					recommendedFixScope: "fresh-fix-path",
					blocking: false,
				},
			],
		}),
	);
	const reportTwo = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-2.json",
		baseVerifierReport("epic-verifier-2", {
			outcome: "revise",
			nonBlockingFindings: [
				{
					id: "epic-synth-finding-002",
					severity: "major",
					title: "A production-path mock may remain",
					evidence:
						"Verifier 2 suspected a production-path mock but could not confirm it conclusively.",
					affectedFiles: ["processes/impl-cli/core/provider-adapters/codex.ts"],
					requirementIds: ["TC-8.1c"],
					recommendedFixScope: "human-ruling",
					blocking: false,
				},
			],
		}),
	);
	const providerBinDir = await createTempDir(
		"epic-reverify-independent-verification-provider",
	);
	const { env, logPath } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-reverify-002",
					baseSynthesisPayload({
						outcome: "needs-more-verification",
						confirmedIssues: [
							"Fix must be verified before epic verification begins.",
						],
						disputedOrUnconfirmedIssues: [
							"The reported production-path mock could not be confirmed from the current evidence set.",
						],
						readinessAssessment:
							"One material issue remains unconfirmed, so the epic is not ready for closeout.",
						recommendedNextStep:
							"Run another fresh epic verification pass after clarifying the disputed mock report.",
					}),
				),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-reverify",
			"--spec-pack-root",
			specPackRoot,
			"--review-report",
			reportOne,
			"--review-report",
			reportTwo,
			"--json",
		],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...env,
			},
		},
	);

	expect(run.exitCode).toBe(0);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.outcome).toBe("needs-more-verification");
	expect(envelope.result.confirmedIssues).toEqual([
		"Fix must be verified before epic verification begins.",
	]);
	expect(envelope.result.disputedOrUnconfirmedIssues).toEqual([
		"The reported production-path mock could not be confirmed from the current evidence set.",
	]);

	const invocations = await readJsonLines<{ args: string[] }>(logPath);
	expect(invocations).toHaveLength(1);
	const prompt = invocations[0]?.args[invocations[0].args.length - 1] ?? "";
	expect(prompt).toContain("independently verify");
	expect(prompt).toContain(reportOne);
	expect(prompt).toContain(reportTwo);
});

test("returns needs-more-verification when all epic findings remain disputed or unconfirmed", async () => {
	const specPackRoot = await createEpicSpecPack("epic-reverify-all-disputed");
	await writeRunConfig(specPackRoot, createRunConfig());
	const reportOne = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-1.json",
		baseVerifierReport("epic-verifier-1", {
			outcome: "revise",
		}),
	);
	const reportTwo = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-2.json",
		baseVerifierReport("epic-verifier-2", {
			outcome: "revise",
		}),
	);
	const providerBinDir = await createTempDir(
		"epic-reverify-all-disputed-provider",
	);
	const { env } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-reverify-003",
					baseSynthesisPayload({
						outcome: "needs-more-verification",
						confirmedIssues: [],
						disputedOrUnconfirmedIssues: [
							"No reported issue could be confirmed from the current evidence set.",
						],
						readinessAssessment:
							"The verifier findings remain too disputed for epic closeout.",
						recommendedNextStep:
							"Run another fresh epic verification cycle or escalate for human ruling.",
					}),
				),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-reverify",
			"--spec-pack-root",
			specPackRoot,
			"--review-report",
			reportOne,
			"--review-report",
			reportTwo,
			"--json",
		],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...env,
			},
		},
	);

	expect(run.exitCode).toBe(0);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.outcome).toBe("needs-more-verification");
	expect(envelope.result.confirmedIssues).toEqual([]);
	expect(envelope.result.disputedOrUnconfirmedIssues).toHaveLength(1);
});

test("returns exit code 2 when epic reverify reports needs-fixes", async () => {
	const specPackRoot = await createEpicSpecPack("epic-reverify-needs-fixes");
	await writeRunConfig(specPackRoot, createRunConfig());
	const reportOne = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-1.json",
		baseVerifierReport("epic-verifier-1", {
			outcome: "revise",
		}),
	);
	const reportTwo = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-2.json",
		baseVerifierReport("epic-verifier-2", {
			outcome: "revise",
		}),
	);
	const providerBinDir = await createTempDir(
		"epic-reverify-needs-fixes-provider",
	);
	const { env } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-reverify-004",
					baseSynthesisPayload({
						outcome: "needs-fixes",
						confirmedIssues: [
							"A closeout fix still needs to land before the epic is ready.",
						],
						disputedOrUnconfirmedIssues: [],
						readinessAssessment:
							"The epic is not ready for closeout until the confirmed issue is fixed.",
						recommendedNextStep:
							"Route the confirmed issue to a fix path, then re-run epic verification and reverify.",
					}),
				),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-reverify",
			"--spec-pack-root",
			specPackRoot,
			"--review-report",
			reportOne,
			"--review-report",
			reportTwo,
			"--json",
		],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...env,
			},
		},
	);

	expect(run.exitCode).toBe(0);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.outcome).toBe("needs-fixes");
	expect(envelope.result.confirmedIssues).toEqual([
		"A closeout fix still needs to land before the epic is ready.",
	]);
});

test("returns exit code 3 when epic reverify is blocked by provider execution failure", async () => {
	const specPackRoot = await createEpicSpecPack("epic-reverify-blocked");
	await writeRunConfig(specPackRoot, createRunConfig());
	const reportOne = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-1.json",
		baseVerifierReport("epic-verifier-1"),
	);
	const reportTwo = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-2.json",
		baseVerifierReport("epic-verifier-2"),
	);
	const providerBinDir = await createTempDir("epic-reverify-blocked-provider");
	const { env } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stderr: "epic reverify provider failed before returning JSON",
				exitCode: 1,
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-reverify",
			"--spec-pack-root",
			specPackRoot,
			"--review-report",
			reportOne,
			"--review-report",
			reportTwo,
			"--json",
		],
		{
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...env,
			},
		},
	);

	expect(run.exitCode).toBe(3);

	const envelope = parseJsonOutput(run.stdout);
	expect(envelope.status).toBe("blocked");
	expect(envelope.outcome).toBe("blocked");
	expect(envelope.errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "PROVIDER_UNAVAILABLE",
			}),
		]),
	);
});

test("returns exit code 3 when a review report path is unreadable", async () => {
	const specPackRoot = await createEpicSpecPack(
		"epic-reverify-unreadable-report",
	);
	await writeRunConfig(specPackRoot, createRunConfig());
	const reportOne = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-1.json",
		baseVerifierReport("epic-verifier-1"),
	);
	const reportTwo = await writeVerifierReport(
		specPackRoot,
		"epic-verifier-2.json",
		baseVerifierReport("epic-verifier-2"),
	);
	await chmod(reportTwo, 0o000);

	try {
		const run = await runSourceCli([
			"epic-reverify",
			"--spec-pack-root",
			specPackRoot,
			"--review-report",
			reportOne,
			"--review-report",
			reportTwo,
			"--json",
		]);

		expect(run.exitCode).toBe(3);

		const envelope = parseJsonOutput(run.stdout);
		expect(envelope.status).toBe("blocked");
		expect(envelope.outcome).toBe("blocked");
		expect(envelope.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "INVALID_SPEC_PACK",
				}),
			]),
		);
	} finally {
		await chmod(reportTwo, 0o644);
	}
});
