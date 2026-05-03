import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

async function readScripts(): Promise<Record<string, string>> {
	const packageJson = JSON.parse(
		await readFile(join(ROOT, "package.json"), "utf8"),
	) as {
		scripts: Record<string, string>;
	};

	return packageJson.scripts;
}

async function runIntegrationWithoutFlag() {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		FORCE_COLOR: "0",
	};
	delete env.LSPEC_INTEGRATION;
	delete env.LSPEC_INTEGRATION_SKIP_AUTH_FAILURES;

	return await new Promise<{
		code: number | null;
		stdout: string;
		stderr: string;
	}>((resolveRun, reject) => {
		const child = spawn(
			"npm",
			[
				"run",
				"test:integration",
				"--",
				"--run",
				"tests/integration/gating.test.ts",
			],
			{
				cwd: ROOT,
				env,
			},
		);
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
	});
}

describe("package scripts", () => {
	test("TC-5.5a: verify-all includes the integration suite through the package script", async () => {
		const scripts = await readScripts();

		expect(scripts["test:integration"]).toBe(
			"vitest run --project integration",
		);
		expect(scripts["verify-all"]).toBe(
			"npm run verify && npm run test:package && npm run test:integration",
		);
	});

	test("TC-5.4a: invoking the integration suite without LSPEC_INTEGRATION fails with a prerequisite error instead of skipping", async () => {
		const run = await runIntegrationWithoutFlag();
		const output = `${run.stdout}\n${run.stderr}`;

		expect(run.code).not.toBe(0);
		expect(output).toContain("LSPEC_INTEGRATION=1");
		expect(output).toContain("no longer skips internally");
	});
});
