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

interface EpicFixPayload {
	outcome: "cleaned" | "needs-more-fix" | "blocked";
	fixBatchPath: string;
	filesChanged: string[];
	changeSummary: string;
	gatesRun: Array<{ command: string; result: "pass" | "fail" | "not-run" }>;
	unresolvedConcerns: string[];
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

function providerResult(sessionId: string, payload: EpicFixPayload) {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

async function writeFixBatch(
	specPackRoot: string,
	fileName: string,
	body: string,
): Promise<string> {
	const fixBatchPath = join(specPackRoot, "artifacts", "fix", fileName);
	await writeTextFile(fixBatchPath, body);
	return fixBatchPath;
}

function baseFixPayload(
	fixBatchPath: string,
	overrides: Partial<EpicFixPayload> = {},
): EpicFixPayload {
	const payload: EpicFixPayload = {
		outcome: "cleaned",
		fixBatchPath,
		filesChanged: [
			"src/references/claude-impl-process-playbook.md",
			"src/references/claude-impl-cli-operations.md",
		],
		changeSummary:
			"Applied the approved fix-only closeout corrections before epic verification.",
		gatesRun: [
			{
				command: "bun run green-verify",
				result: "not-run",
			},
		],
		unresolvedConcerns: [],
		recommendedNextStep:
			"Review the fix result, then launch epic verification.",
	};

	return {
		...payload,
		...overrides,
		gatesRun: overrides.gatesRun ?? payload.gatesRun,
		unresolvedConcerns:
			overrides.unresolvedConcerns ?? payload.unresolvedConcerns,
	};
}

test("TC-7.1a consumes a durable fix artifact and returns the structured fix result before epic verification", async () => {
	const specPackRoot = await createEpicSpecPack("epic-fix-contract");
	await writeRunConfig(specPackRoot, createRunConfig());
	const fixBatchPath = await writeFixBatch(
		specPackRoot,
		"fix-batch.md",
		[
			"# Fix Batch",
			"",
			"- APPROVED: tighten the closeout docs so fix precedes epic verification.",
			"- APPROVED: wire the reverify command into the final closeout sequence.",
		].join("\n"),
	);
	const providerBinDir = await createTempDir("epic-fix-contract-provider");
	const { env, logPath } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-fix-001",
					baseFixPayload(fixBatchPath),
				),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-fix",
			"--spec-pack-root",
			specPackRoot,
			"--fix-batch",
			fixBatchPath,
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
	expect(envelope.command).toBe("epic-fix");
	expect(envelope.outcome).toBe("cleaned");
	expect(envelope.result).toMatchObject({
		provider: "codex",
		sessionId: "codex-epic-fix-001",
		mode: "initial",
		continuation: {
			provider: "codex",
			sessionId: "codex-epic-fix-001",
			operation: "epic-fix",
		},
	});
	expect(envelope.result.fixBatchPath).toBe(fixBatchPath);
	expect(envelope.result.filesChanged).toEqual(
		expect.arrayContaining(["src/references/claude-impl-process-playbook.md"]),
	);

	const artifactPath = envelope.artifacts[0].path as string;
	expect(artifactPath).toContain("/artifacts/fix/001-fix-result.json");
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

test("continues epic-fix with the retained provider session", async () => {
	const specPackRoot = await createEpicSpecPack("epic-fix-retained");
	await writeRunConfig(specPackRoot, createRunConfig());
	const fixBatchPath = await writeFixBatch(
		specPackRoot,
		"fix-batch.md",
		["# Fix Batch", "", "- APPROVED: apply the retained follow-up fix."].join(
			"\n",
		),
	);
	const providerBinDir = await createTempDir("epic-fix-retained-provider");
	const { env, logPath } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-fix-retained-001",
					baseFixPayload(fixBatchPath),
				),
			},
			{
				stdout: providerResult(
					"codex-epic-fix-retained-001",
					baseFixPayload(fixBatchPath),
				),
			},
		],
	});

	const first = await runSourceCli(
		[
			"epic-fix",
			"--spec-pack-root",
			specPackRoot,
			"--fix-batch",
			fixBatchPath,
			"--json",
		],
		{ env: { PATH: `${providerBinDir}:${process.env.PATH ?? ""}`, ...env } },
	);
	const firstEnvelope = parseJsonOutput(first.stdout);
	const second = await runSourceCli(
		[
			"epic-fix",
			"--spec-pack-root",
			specPackRoot,
			"--fix-batch",
			fixBatchPath,
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
	expect(invocations[1]?.args).toContain("codex-epic-fix-retained-001");
});

test("treats a reviewed fix batch with zero approved items as a cleaned no-op result", async () => {
	const specPackRoot = await createEpicSpecPack("epic-fix-noop");
	await writeRunConfig(specPackRoot, createRunConfig());
	const fixBatchPath = await writeFixBatch(
		specPackRoot,
		"fix-noop.md",
		[
			"# Fix Batch",
			"",
			"- REVIEWED: no approved fix corrections remain before epic verification.",
		].join("\n"),
	);
	const providerBinDir = await createTempDir("epic-fix-noop-provider");
	const { env } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-fix-002",
					baseFixPayload(fixBatchPath, {
						filesChanged: [],
						changeSummary:
							"No approved fix corrections remained, so the fix pass was a no-op.",
					}),
				),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-fix",
			"--spec-pack-root",
			specPackRoot,
			"--fix-batch",
			fixBatchPath,
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
	expect(envelope.outcome).toBe("cleaned");
	expect(envelope.result.filesChanged).toEqual([]);
	expect(envelope.result.changeSummary).toContain("no-op");
	const artifactPath = envelope.artifacts[0].path as string;
	const progressPaths = buildRuntimeProgressPaths(artifactPath);
	const progressEvents = await readJsonLines<{ event: string }>(
		progressPaths.progressPath,
	);
	expect(progressEvents.map((event) => event.event)).toEqual([
		"command-started",
		"completed",
	]);
});

test("does not treat negated or superseded APPROVED text as actionable fix work", async () => {
	const specPackRoot = await createEpicSpecPack("epic-fix-negated-approved");
	await writeRunConfig(specPackRoot, createRunConfig());
	const fixBatchPath = await writeFixBatch(
		specPackRoot,
		"fix-negated-approved.md",
		[
			"# Fix Batch",
			"",
			"- NOT APPROVED: do not widen the fix scope.",
			"- pre-APPROVED drafts are not actionable.",
			"- previously APPROVED but superseded by later review.",
		].join("\n"),
	);
	const providerBinDir = await createTempDir(
		"epic-fix-negated-approved-provider",
	);
	const { env, logPath } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [],
	});

	const run = await runSourceCli(
		[
			"epic-fix",
			"--spec-pack-root",
			specPackRoot,
			"--fix-batch",
			fixBatchPath,
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
	expect(envelope.outcome).toBe("cleaned");
	expect(envelope.result.filesChanged).toEqual([]);

	expect(await Bun.file(logPath).exists()).toBe(false);
});

test("still treats the batch as actionable when a real approved item appears alongside plain-text not approved notes", async () => {
	const specPackRoot = await createEpicSpecPack("epic-fix-mixed-approved");
	await writeRunConfig(specPackRoot, createRunConfig());
	const fixBatchPath = await writeFixBatch(
		specPackRoot,
		"fix-mixed-approved.md",
		[
			"# Fix Batch",
			"",
			"- APPROVED: apply the bounded fix correction.",
			"",
			"Reviewer note: this unrelated idea is not approved for the current pass.",
		].join("\n"),
	);
	const providerBinDir = await createTempDir(
		"epic-fix-mixed-approved-provider",
	);
	const { env, logPath } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-fix-mixed-001",
					baseFixPayload(fixBatchPath),
				),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-fix",
			"--spec-pack-root",
			specPackRoot,
			"--fix-batch",
			fixBatchPath,
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
	expect(envelope.outcome).toBe("cleaned");

	const invocations = await readJsonLines<{ args: string[] }>(logPath);
	expect(invocations).toHaveLength(1);
});

test("blocks epic-fix with INVALID_SPEC_PACK when the spec-pack root is outside any git repo", async () => {
	const specPackRoot = await createExternalSpecPack("epic-fix-no-git-repo");
	const fixBatchPath = await writeFixBatch(
		specPackRoot,
		"fix-batch.md",
		"# Fix Batch\n\n- APPROVED: apply the bounded fix correction.\n",
	);

	const run = await runSourceCli([
		"epic-fix",
		"--spec-pack-root",
		specPackRoot,
		"--fix-batch",
		fixBatchPath,
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

test("blocks epic-fix when the structured fix payload includes an unknown top-level key", async () => {
	const specPackRoot = await createEpicSpecPack("epic-fix-strict-payload");
	await writeRunConfig(specPackRoot, createRunConfig());
	const fixBatchPath = await writeFixBatch(
		specPackRoot,
		"fix-strict.md",
		["# Fix Batch", "", "- APPROVED: apply the bounded fix correction."].join(
			"\n",
		),
	);
	const providerBinDir = await createTempDir("epic-fix-strict-provider");
	const { env } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: JSON.stringify({
					sessionId: "codex-epic-fix-strict-001",
					result: {
						...baseFixPayload(fixBatchPath),
						extraField: "drift",
					},
				}),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-fix",
			"--spec-pack-root",
			specPackRoot,
			"--fix-batch",
			fixBatchPath,
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

test("returns exit code 2 when epic-fix reports needs-more-fix", async () => {
	const specPackRoot = await createEpicSpecPack("epic-fix-needs-more");
	await writeRunConfig(specPackRoot, createRunConfig());
	const fixBatchPath = await writeFixBatch(
		specPackRoot,
		"fix-needs-more.md",
		[
			"# Fix Batch",
			"",
			"- APPROVED: apply the closeout corrections in one bounded pass.",
		].join("\n"),
	);
	const providerBinDir = await createTempDir("epic-fix-needs-more-provider");
	const { env } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stdout: providerResult(
					"codex-epic-fix-003",
					baseFixPayload(fixBatchPath, {
						outcome: "needs-more-fix",
						unresolvedConcerns: [
							"One approved fix item still needs a follow-up pass.",
						],
						recommendedNextStep:
							"Review the remaining fix concern, then run another fix pass.",
					}),
				),
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-fix",
			"--spec-pack-root",
			specPackRoot,
			"--fix-batch",
			fixBatchPath,
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
	expect(envelope.outcome).toBe("needs-more-fix");
	expect(envelope.result.unresolvedConcerns).toEqual([
		"One approved fix item still needs a follow-up pass.",
	]);
});

test("returns exit code 3 when epic-fix is blocked by provider execution failure", async () => {
	const specPackRoot = await createEpicSpecPack("epic-fix-blocked");
	await writeRunConfig(specPackRoot, createRunConfig());
	const fixBatchPath = await writeFixBatch(
		specPackRoot,
		"fix-blocked.md",
		[
			"# Fix Batch",
			"",
			"- APPROVED: apply the final fix corrections before epic verification.",
		].join("\n"),
	);
	const providerBinDir = await createTempDir("epic-fix-blocked-provider");
	const { env } = await writeFakeProviderExecutable({
		binDir: providerBinDir,
		provider: "codex",
		responses: [
			{
				stderr: "fix provider failed before producing JSON output",
				exitCode: 1,
			},
		],
	});

	const run = await runSourceCli(
		[
			"epic-fix",
			"--spec-pack-root",
			specPackRoot,
			"--fix-batch",
			fixBatchPath,
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
