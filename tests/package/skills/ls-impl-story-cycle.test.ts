import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const CLI_PATH = resolve(ROOT, "dist/bin/lbuild-impl.js");

async function runBuild(): Promise<void> {
	await new Promise<void>((resolveBuild, reject) => {
		const build = spawn("npm", ["run", "build"], {
			cwd: ROOT,
			env: {
				...process.env,
				FORCE_COLOR: "0",
			},
		});
		build.on("error", reject);
		build.on("close", (code) => {
			if (code === 0) {
				resolveBuild();
				return;
			}
			reject(new Error(`npm run build exited with code ${code}`));
		});
	});
}

function runCli(args: string[]) {
	return new Promise<{ code: number | null; stdout: string; stderr: string }>(
		(resolveRun, reject) => {
			const child = spawn(process.execPath, [CLI_PATH, ...args], {
				cwd: ROOT,
				env: {
					...process.env,
					FORCE_COLOR: "0",
				},
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk) => {
				stdout += String(chunk);
			});
			child.stderr.on("data", (chunk) => {
				stderr += String(chunk);
			});
			child.on("error", reject);
			child.on("close", (code) => {
				resolveRun({ code, stdout, stderr });
			});
		},
	);
}

describe("ls-impl story cycle skill docs", () => {
	test("TC-1.1a/TC-1.1b/TC-1.2b/TC-1.3a/TC-1.3b/TC-1.5a/TC-1.5b/TC-5.6a/TC-5.6b ship story-orchestrate as the default path and primitives as lower-level tools", {
		timeout: 120_000,
	}, async () => {
		await runBuild();

		const chunk = await runCli([
			"skill",
			"ls-impl",
			"phases/20-story-cycle.md",
			"1",
		]);

		expect(chunk.code).toBe(0);
		expect(chunk.stderr).toBe("");
		expect(chunk.stdout).toContain(
			"The normal happy path is `story-orchestrate`",
		);
		expect(chunk.stdout).toContain(
			"the next fresh planner turn should return exactly one bounded action.",
		);
		expect(chunk.stdout).toContain("## Local CLI on this branch");
		expect(chunk.stdout).toContain("npm exec -- lbuild-impl ...");
		expect(chunk.stdout).toContain("node dist/bin/lbuild-impl.js ...");
		expect(chunk.stdout).toContain(
			"switch to the local CLI instead of treating the missing global command as a product defect.",
		);
		expect(chunk.stdout).toContain("Route on the terminal `status`:");
		expect(chunk.stdout).toContain(
			"Story completion is stricter than a clean terminal status.",
		);
		expect(chunk.stdout).toContain(
			"`npm run verify-all` passes as the completion gate that includes integration",
		);
		expect(chunk.stdout).toContain(
			"review the final package, run the final story gate yourself, complete the receipt, make the story commit, and only then accept the story.",
		);
		expect(chunk.stdout).toContain(
			"run `npm run verify-all` before story completion",
		);
		expect(chunk.stdout).toContain(
			"pause and supply the caller decision the story-lead asked for.",
		);
		expect(chunk.stdout).toContain(
			"Primitive story operations stay available, but they are lower-level tools rather than the default story workflow:",
		);
		expect(chunk.stdout).toContain(
			"`story-implement` — initial retained implementor pass",
		);
		expect(chunk.stdout).toContain(
			"`story-continue` — same-session implementor follow-up",
		);
		expect(chunk.stdout).toContain(
			"`story-self-review` — explicit same-session implementor review before verification",
		);
		expect(chunk.stdout).toContain(
			"`story-verify` — retained verifier passes for one story",
		);
		expect(chunk.stdout).toContain(
			"`quick-fix` — narrow, story-agnostic correction",
		);
		expect(chunk.stdout).toContain("bun run test -- --run <files>");
		expect(chunk.stdout).toContain("npm run test:package -- --run <files>");
		expect(chunk.stdout).toContain(
			"Do not use raw `bun test`; it bypasses the repo Vitest configuration and is not an accepted verification path.",
		);
		expect(chunk.stdout).not.toContain("## 1. Launch implementation");
	});

	test("TC-4.3a/TC-4.3b document the recommended Codex gpt-5.5 one-turn story-lead setup", {
		timeout: 120_000,
	}, async () => {
		await runBuild();

		const chunk = await runCli([
			"skill",
			"ls-impl",
			"operations/31-provider-resolution.md",
			"1",
		]);

		expect(chunk.code).toBe(0);
		expect(chunk.stderr).toBe("");
		expect(chunk.stdout).toContain(
			"The recommended current story-lead setup is Codex `gpt-5.5`",
		);
		expect(chunk.stdout).toContain(
			"| `story_lead_provider` | `codex` | `gpt-5.5` | `high` |",
		);
		expect(chunk.stdout).toContain(
			"each fresh planner turn should produce exactly one bounded action",
		);
		expect(chunk.stdout).toContain("story_lead_planner_ms");
		expect(chunk.stdout).toContain("story_orchestrate_ms");
	});

	test("TC-3.1a ships the story-orchestrate state diagram and lifecycle vocabulary in the built skill docs", {
		timeout: 120_000,
	}, async () => {
		await runBuild();

		const chunk = await runCli([
			"skill",
			"ls-impl",
			"phases/20-story-cycle.md",
			"1",
		]);

		expect(chunk.code).toBe(0);
		expect(chunk.stderr).toBe("");
		expect(chunk.stdout).toContain("stateDiagram-v2");
		expect(chunk.stdout).toContain("awaiting_story_lead_action");
		expect(chunk.stdout).toContain("running_child_operation");
		expect(chunk.stdout).toContain("recording_result");
		expect(chunk.stdout).toContain("Terminal `status` meanings");
		expect(chunk.stdout).toContain(
			"`accepted` still requires impl-lead review, receipt completion, gates, and the story commit.",
		);
	});
});
