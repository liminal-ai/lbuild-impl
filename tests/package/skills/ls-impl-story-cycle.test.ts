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
