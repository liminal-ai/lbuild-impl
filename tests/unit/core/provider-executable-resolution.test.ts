import { chmod } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { runProviderCommand } from "../../../src/core/provider-adapters/shared.js";
import { resolveProviderMatrix } from "../../../src/core/provider-checks.js";
import {
	buildWindowsCommandShimInvocation,
	isWindowsCommandShim,
} from "../../../src/core/provider-executable.js";
import {
	createSpecPack,
	createTempDir,
	createRunConfig,
	writeTextFile,
} from "../../support/test-helpers.js";

async function writeWindowsShim(params: {
	dir: string;
	name: string;
	version: string;
	authStatus?: "authenticated" | "missing";
}) {
	const scriptPath = join(params.dir, params.name);
	const script = [
		"#!/bin/sh",
		'if [ "$1" = "--version" ]; then',
		`  printf '%s' ${JSON.stringify(params.version)}`,
		"  exit 0",
		"fi",
		'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
		params.authStatus === "missing"
			? '  printf "%s" "missing" >&2'
			: '  printf "%s" "authenticated"',
		params.authStatus === "missing" ? "  exit 1" : "  exit 0",
		"fi",
		'printf "%s" "unexpected invocation" >&2',
		"exit 1",
		"",
	].join("\n");
	await writeTextFile(scriptPath, script);
	await chmod(scriptPath, 0o755);
}

async function writeComspecEmulator(dir: string): Promise<string> {
	const emulatorPath = join(dir, "cmd-emulator.js");
	await writeTextFile(
		emulatorPath,
		[
			"#!/usr/bin/env node",
			'import { spawnSync } from "node:child_process";',
			"const command = process.argv.at(-1) ?? '';",
			'const tokens = [...command.matchAll(/"((?:\\\\"|[^"])*)"/g)].map((match) => match[1].replaceAll(\'\\\\"\', \'"\'));',
			"if (tokens.length === 0) {",
			"  process.stderr.write('missing command');",
			"  process.exit(1);",
			"}",
			"const result = spawnSync(tokens[0], tokens.slice(1), { encoding: 'utf8' });",
			"if (result.stdout) process.stdout.write(result.stdout);",
			"if (result.stderr) process.stderr.write(result.stderr);",
			"if (result.error) {",
			"  process.stderr.write(result.error.message);",
			"  process.exit(1);",
			"}",
			"process.exit(result.status ?? 0);",
			"",
		].join("\n"),
	);
	await chmod(emulatorPath, 0o755);
	return emulatorPath;
}

describe("provider executable resolution", () => {
	test("TC-6.2a resolves Windows .cmd shims during provider preflight", async () => {
		const specPackRoot = await createSpecPack(
			"provider-executable-resolution-win-preflight",
		);
		const providerBinDir = await createTempDir(
			"provider-executable-resolution-win-bindir",
		);
		await writeWindowsShim({
			dir: providerBinDir,
			name: "claude.cmd",
			version: "claude 1.0.0",
		});
		await writeWindowsShim({
			dir: providerBinDir,
			name: "codex.cmd",
			version: "codex 2.0.0",
		});
		const comspec = await writeComspecEmulator(providerBinDir);

		const providerMatrix = await resolveProviderMatrix({
			specPackRoot,
			config: createRunConfig({
				story_lead_provider: {
					secondary_harness: "codex",
					model: "gpt-5.5",
					reasoning_effort: "high",
				},
				story_implementor: {
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
				quick_fixer: {
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
				story_verifier: {
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "xhigh",
				},
				epic_verifiers: [
					{
						label: "epic-verifier-1",
						secondary_harness: "none",
						model: "claude-sonnet",
						reasoning_effort: "high",
					},
				],
				epic_synthesizer: {
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
			}),
			env: {
				PATH: `${providerBinDir};${process.env.PATH ?? ""}`,
				PATHEXT: ".CMD;.BAT",
				COMSPEC: comspec,
			},
			platform: "win32",
		});

		expect(providerMatrix.primary).toMatchObject({
			harness: "claude-code",
			available: true,
			tier: "authenticated-known",
			version: "claude 1.0.0",
		});
		expect(providerMatrix.secondary).toContainEqual(
			expect.objectContaining({
				harness: "codex",
				available: true,
				tier: "binary-present",
				version: "codex 2.0.0",
			}),
		);
	});

	test("TC-6.2a resolves Windows .bat shims for provider dispatch", async () => {
		const providerBinDir = await createTempDir(
			"provider-executable-resolution-win-dispatch",
		);
		await writeWindowsShim({
			dir: providerBinDir,
			name: "copilot.bat",
			version: "copilot 3.0.0",
		});
		const comspec = await writeComspecEmulator(providerBinDir);

		const execution = await runProviderCommand({
			provider: "copilot",
			executable: "copilot",
			args: ["--version"],
			cwd: providerBinDir,
			env: {
				PATH: `${providerBinDir};${process.env.PATH ?? ""}`,
				PATHEXT: ".BAT;.CMD",
				COMSPEC: comspec,
			},
			timeoutMs: 1_000,
			platform: "win32",
		});

		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toBe("copilot 3.0.0");
		expect(execution.stderr).toBe("");
	});

	test("TC-6.2b preserves POSIX executable lookup behavior", async () => {
		const providerBinDir = await createTempDir(
			"provider-executable-resolution-posix",
		);
		const executablePath = join(providerBinDir, "codex");
		await writeTextFile(
			executablePath,
			["#!/usr/bin/env node", "process.stdout.write('codex 2.1.0');", ""].join(
				"\n",
			),
		);
		await chmod(executablePath, 0o755);

		const execution = await runProviderCommand({
			provider: "codex",
			executable: "codex",
			args: ["--version"],
			cwd: providerBinDir,
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
			},
			timeoutMs: 1_000,
			platform: "linux",
		});

		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toBe("codex 2.1.0");
		expect(execution.stderr).toBe("");
	});

	test("TC-6.2a builds a COMSPEC invocation for real Windows .cmd/.bat launch", () => {
		const invocation = buildWindowsCommandShimInvocation({
			executable: "C:\\Tools\\codex.cmd",
			args: ["--version"],
			env: {
				COMSPEC: "C:\\Windows\\System32\\cmd.exe",
			},
		});

		expect(isWindowsCommandShim("C:\\Tools\\codex.cmd")).toBe(true);
		expect(isWindowsCommandShim("C:\\Tools\\copilot.bat")).toBe(true);
		expect(isWindowsCommandShim("/usr/local/bin/codex")).toBe(false);
		expect(invocation).toEqual({
			file: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", '"C:\\Tools\\codex.cmd" "--version"'],
		});
	});
});
