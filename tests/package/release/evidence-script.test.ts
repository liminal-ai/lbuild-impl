import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import { ROOT } from "../../support/test-helpers";

const execFileAsync = promisify(execFile);
const SCRIPT = join(ROOT, "scripts", "check-release-evidence.ts");
const TSX = resolve(ROOT, "node_modules", ".bin", "tsx");
const evidenceRoots: string[] = [];

const CLEAN_REPORT = [
	"# Evidence",
	"",
	"## Divergences",
	"- Unexpected behaviors observed: none",
	"",
].join("\n");

afterEach(async () => {
	await Promise.all(
		evidenceRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function createEvidenceRoot(files: string[]): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "release-evidence-"));
	evidenceRoots.push(root);
	const day = join(root, "2026-04-29");
	await mkdir(day, { recursive: true });

	await Promise.all(
		files.map((fileName) => writeFile(join(day, fileName), CLEAN_REPORT)),
	);

	return root;
}

async function runEvidenceCheck(
	evidenceRoot: string,
	args: string[] = [],
): Promise<{ stdout: string; stderr: string }> {
	const result = await execFileAsync(TSX, [
		SCRIPT,
		"--evidence-root",
		evidenceRoot,
		"--reference-date",
		"2026-04-29",
		...args,
	]);

	return {
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

test("release evidence gate requires the canonical gorilla release matrix", async () => {
	const evidenceRoot = await createEvidenceRoot([
		"claude-code-smoke.md",
		"codex-resume.md",
		"codex-structured-output.md",
		"codex-stall.md",
	]);

	await expect(runEvidenceCheck(evidenceRoot)).resolves.toMatchObject({
		stdout: expect.stringContaining(
			"required matrix claude-code-smoke.md, codex-resume.md, codex-structured-output.md, codex-stall.md",
		),
	});
});

test("release evidence gate fails when a required matrix report is absent", async () => {
	const evidenceRoot = await createEvidenceRoot(["codex-smoke.md"]);

	await expect(runEvidenceCheck(evidenceRoot)).rejects.toMatchObject({
		stderr: expect.stringContaining(
			"missing required release report(s): claude-code-smoke.md, codex-resume.md, codex-structured-output.md, codex-stall.md",
		),
	});
});

test("release evidence gate accepts an explicit documented matrix override", async () => {
	const evidenceRoot = await createEvidenceRoot(["codex-smoke.md"]);

	await expect(
		runEvidenceCheck(evidenceRoot, ["--matrix", "codex-smoke.md"]),
	).resolves.toMatchObject({
		stdout: expect.stringContaining("required matrix codex-smoke.md"),
	});
});
