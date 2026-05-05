import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ImplRunConfig } from "../../src/core/config-schema";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type LooseJsonOutput = string & {
	[key: string]: LooseJsonOutput;
	[index: number]: LooseJsonOutput;
};

interface CreateSpecPackOptions {
	companionMode?: "two-file" | "four-file";
	includeStoriesDir?: boolean;
	includeStoriesFile?: boolean;
	includeEpic?: boolean;
	includeTechDesign?: boolean;
	includeTestPlan?: boolean;
	includeImplInsert?: boolean;
	includeVerifierInsert?: boolean;
}

export async function createTempDir(scope: string): Promise<string> {
	const dir = join(ROOT, ".test-tmp", "impl-cli", scope, randomUUID());
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	return dir;
}

export async function createExternalSpecPack(scope: string): Promise<string> {
	const specPackRoot = await mkdtemp(join(tmpdir(), `${scope}-`));
	await writeTextFile(join(specPackRoot, "epic.md"), "# Epic\n");
	await writeTextFile(
		join(specPackRoot, "tech-design.md"),
		"# Technical Design\n",
	);
	await writeTextFile(join(specPackRoot, "test-plan.md"), "# Test Plan\n");
	await writeTextFile(
		join(specPackRoot, "stories", "00-foundation.md"),
		"# Story 0: Foundation\n",
	);
	return specPackRoot;
}

export async function writeTextFile(
	path: string,
	content: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await Bun.write(path, content);
}

export function createRunConfig(
	overrides: Partial<ImplRunConfig> = {},
): ImplRunConfig {
	const base: ImplRunConfig = {
		version: 1,
		primary_harness: "claude-code",
		story_implementor: {
			secondary_harness: "codex",
			model: "gpt-5.4",
			reasoning_effort: "high",
		},
		quick_fixer: {
			secondary_harness: "codex",
			model: "gpt-5.4",
			reasoning_effort: "high",
		},
		story_verifier: {
			secondary_harness: "codex",
			model: "gpt-5.4",
			reasoning_effort: "xhigh",
		},
		self_review: {
			passes: 3,
		},
		epic_verifiers: [
			{
				label: "epic-verifier-1",
				secondary_harness: "codex",
				model: "gpt-5.4",
				reasoning_effort: "xhigh",
			},
		],
		epic_synthesizer: {
			secondary_harness: "codex",
			model: "gpt-5.4",
			reasoning_effort: "xhigh",
		},
	};

	return {
		...base,
		...overrides,
		story_implementor: {
			...base.story_implementor,
			...overrides.story_implementor,
		},
		quick_fixer: {
			...base.quick_fixer,
			...overrides.quick_fixer,
		},
		story_verifier: {
			...base.story_verifier,
			...overrides.story_verifier,
		},
		self_review: {
			...base.self_review,
			...overrides.self_review,
		},
		epic_verifiers: overrides.epic_verifiers ?? base.epic_verifiers,
		epic_synthesizer: {
			...base.epic_synthesizer,
			...overrides.epic_synthesizer,
		},
	};
}

export async function writeRunConfig(
	specPackRoot: string,
	config: ImplRunConfig,
): Promise<string> {
	const configPath = join(specPackRoot, "impl-run.config.json");
	await writeTextFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
	return configPath;
}

export async function createSpecPack(
	scope: string,
	options: CreateSpecPackOptions = {},
): Promise<string> {
	const specPackRoot = await createTempDir(scope);
	const {
		companionMode = "two-file",
		includeStoriesDir = true,
		includeStoriesFile = false,
		includeEpic = true,
		includeTechDesign = true,
		includeTestPlan = true,
		includeImplInsert = false,
		includeVerifierInsert = false,
	} = options;

	if (includeEpic) {
		await writeTextFile(join(specPackRoot, "epic.md"), "# Epic\n");
	}

	if (includeTechDesign) {
		await writeTextFile(
			join(specPackRoot, "tech-design.md"),
			"# Technical Design\n",
		);
	}

	if (includeTestPlan) {
		await writeTextFile(join(specPackRoot, "test-plan.md"), "# Test Plan\n");
	}

	if (companionMode === "four-file") {
		await writeTextFile(
			join(specPackRoot, "tech-design-cli-runtime.md"),
			"# CLI Runtime Companion\n",
		);
		await writeTextFile(
			join(specPackRoot, "tech-design-skill-process.md"),
			"# Skill Process Companion\n",
		);
	}

	if (includeStoriesDir) {
		await writeTextFile(
			join(specPackRoot, "stories", "00-foundation.md"),
			"# Story 0: Foundation\n",
		);
		await writeTextFile(
			join(specPackRoot, "stories", "01-next.md"),
			"# Story 1: Next\n",
		);
	}

	if (includeStoriesFile) {
		await writeTextFile(join(specPackRoot, "stories.md"), "# Stories\n");
	}

	if (includeImplInsert) {
		await writeTextFile(
			join(specPackRoot, "custom-story-impl-prompt-insert.md"),
			"Custom implementor insert\n",
		);
	}

	if (includeVerifierInsert) {
		await writeTextFile(
			join(specPackRoot, "custom-story-verifier-prompt-insert.md"),
			"Custom verifier insert\n",
		);
	}

	return specPackRoot;
}

export async function createImplementorSpecPack(scope: string): Promise<{
	specPackRoot: string;
	storyId: string;
	storyTitle: string;
	storyPath: string;
	epicPath: string;
	techDesignPath: string;
	techDesignCompanionPaths: string[];
	testPlanPath: string;
}> {
	const specPackRoot = await createSpecPack(scope, {
		companionMode: "four-file",
	});
	const storyId = "03-story-implementor-workflow";
	const storyTitle = "Story 3: Story Implementor Workflow";
	const storyPath = join(specPackRoot, "stories", `${storyId}.md`);
	await writeTextFile(storyPath, `# ${storyTitle}\n`);
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

	return {
		specPackRoot,
		storyId,
		storyTitle,
		storyPath,
		epicPath: join(specPackRoot, "epic.md"),
		techDesignPath: join(specPackRoot, "tech-design.md"),
		techDesignCompanionPaths: [
			join(specPackRoot, "tech-design-cli-runtime.md"),
			join(specPackRoot, "tech-design-skill-process.md"),
		],
		testPlanPath: join(specPackRoot, "test-plan.md"),
	};
}

export async function createVerifierSpecPack(
	scope: string,
	options: {
		storyBody?: string;
	} = {},
): Promise<{
	specPackRoot: string;
	storyId: string;
	storyTitle: string;
	storyPath: string;
	epicPath: string;
	techDesignPath: string;
	techDesignCompanionPaths: string[];
	testPlanPath: string;
}> {
	const specPackRoot = await createSpecPack(scope, {
		companionMode: "four-file",
	});
	const storyId = "04-story-verification-workflow";
	const storyTitle = "Story 4: Story Verification Workflow";
	const storyPath = join(specPackRoot, "stories", `${storyId}.md`);
	await writeTextFile(storyPath, options.storyBody ?? `# ${storyTitle}\n`);
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

	return {
		specPackRoot,
		storyId,
		storyTitle,
		storyPath,
		epicPath: join(specPackRoot, "epic.md"),
		techDesignPath: join(specPackRoot, "tech-design.md"),
		techDesignCompanionPaths: [
			join(specPackRoot, "tech-design-cli-runtime.md"),
			join(specPackRoot, "tech-design-skill-process.md"),
		],
		testPlanPath: join(specPackRoot, "test-plan.md"),
	};
}

export interface FakeProviderResponse {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	lastMessage?: string;
	delayMs?: number;
}

export async function writeFakeProviderExecutable(params: {
	binDir: string;
	provider: "claude" | "codex";
	responses?: FakeProviderResponse[];
	version?: string;
	authStatus?: "authenticated" | "missing";
	authStdout?: string;
	authStderr?: string;
}) {
	const prefix = params.provider.toUpperCase().replace(/-/g, "_");
	const scriptPath = join(params.binDir, params.provider);
	const logPath = join(params.binDir, `${params.provider}-invocations.jsonl`);
	const responsesPath = join(
		params.binDir,
		`${params.provider}-responses.json`,
	);
	const cursorPath = join(params.binDir, `${params.provider}-cursor.txt`);

	await writeTextFile(
		responsesPath,
		`${JSON.stringify(params.responses ?? [], null, 2)}\n`,
	);
	await writeTextFile(cursorPath, "0\n");
	await writeTextFile(
		scriptPath,
		[
			"#!/usr/bin/env node",
			'import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";',
			'import { setTimeout as sleep } from "node:timers/promises";',
			'import { basename } from "node:path";',
			"",
			"const provider = basename(process.argv[1]);",
			'const prefix = provider.toUpperCase().replace(/-/g, "_");',
			'const envKey = (name) => prefix + "_" + name;',
			"const args = process.argv.slice(2);",
			'const logPath = process.env[envKey("LOG_PATH")];',
			"const envSnapshot = {",
			"  PATH: process.env.PATH,",
			"  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,",
			"  NODE_OPTIONS: process.env.NODE_OPTIONS,",
			"};",
			"",
			"if (logPath) {",
			'  appendFileSync(logPath, JSON.stringify({ provider, cwd: process.cwd(), args, env: envSnapshot }) + "\\n");',
			"}",
			"",
			'if (args.length === 1 && args[0] === "--version") {',
			'  process.stdout.write(process.env[envKey("VERSION")] ?? provider + " 1.0.0");',
			'  process.exit(Number(process.env[envKey("VERSION_EXIT_CODE")] ?? 0));',
			"}",
			"",
			'if (args[0] === "auth" && args[1] === "status") {',
			'  const authStatus = process.env[envKey("AUTH_STATUS")] ?? "authenticated";',
			'  if (authStatus === "authenticated") {',
			'    process.stdout.write(process.env[envKey("AUTH_STDOUT")] ?? "authenticated");',
			"    process.exit(0);",
			"  }",
			'  process.stderr.write(process.env[envKey("AUTH_STDERR")] ?? "missing");',
			"  process.exit(1);",
			"}",
			"",
			'const responsesPath = process.env[envKey("RESPONSES_PATH")];',
			'const cursorPath = process.env[envKey("CURSOR_PATH")];',
			"if (!responsesPath || !cursorPath) {",
			'  process.stderr.write("Missing fake provider response configuration");',
			"  process.exit(1);",
			"}",
			"",
			'const responses = JSON.parse(readFileSync(responsesPath, "utf8"));',
			'const rawCursor = existsSync(cursorPath) ? readFileSync(cursorPath, "utf8").trim() : "0";',
			'const cursor = Number(rawCursor || "0");',
			"const response = responses[cursor] ?? responses[responses.length - 1] ?? {",
			'  stderr: "No fake provider response configured",',
			"  exitCode: 1,",
			"};",
			"writeFileSync(cursorPath, String(cursor + 1));",
			'const outputLastMessageFlagIndex = args.findIndex((arg) => arg === "-o" || arg === "--output-last-message");',
			"const outputLastMessagePath = outputLastMessageFlagIndex >= 0 ? args[outputLastMessageFlagIndex + 1] : undefined;",
			'if (outputLastMessagePath && typeof response.lastMessage === "string") {',
			"  writeFileSync(outputLastMessagePath, response.lastMessage);",
			"}",
			"if (typeof response.delayMs === 'number' && response.delayMs > 0) {",
			"  await sleep(response.delayMs);",
			"}",
			"if (response.stderr) {",
			"  process.stderr.write(response.stderr);",
			"}",
			"if (response.stdout) {",
			"  process.stdout.write(response.stdout);",
			"}",
			"process.exit(Number(response.exitCode ?? 0));",
			"",
		].join("\n"),
	);
	await chmod(scriptPath, 0o755);

	return {
		logPath,
		env: {
			[`${prefix}_LOG_PATH`]: logPath,
			[`${prefix}_RESPONSES_PATH`]: responsesPath,
			[`${prefix}_CURSOR_PATH`]: cursorPath,
			[`${prefix}_VERSION`]: params.version ?? `${params.provider} 1.0.0`,
			[`${prefix}_AUTH_STATUS`]: params.authStatus ?? "authenticated",
			...(params.authStdout
				? {
						[`${prefix}_AUTH_STDOUT`]: params.authStdout,
					}
				: {}),
			...(params.authStderr
				? {
						[`${prefix}_AUTH_STDERR`]: params.authStderr,
					}
				: {}),
		} satisfies Record<string, string>,
	};
}

export async function readJsonLines<T>(path: string): Promise<T[]> {
	const content = await Bun.file(path).text();
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

export interface CliRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export async function runSourceCli(
	args: string[],
	options: {
		env?: Record<string, string | undefined>;
	} = {},
): Promise<CliRunResult> {
	return await new Promise<CliRunResult>((resolveResult, reject) => {
		const proc = spawn(
			process.execPath,
			["--import", "tsx", "src/bin/lbuild-impl.ts", ...args],
			{
				cwd: ROOT,
				env: {
					...process.env,
					...options.env,
					FORCE_COLOR: "0",
				},
			},
		);

		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		proc.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		proc.on("error", reject);
		proc.on("close", (exitCode) => {
			resolveResult({
				exitCode: exitCode ?? 1,
				stdout,
				stderr,
			});
		});
	});
}

export function parseJsonOutput<T = LooseJsonOutput>(stdout: string): T {
	return JSON.parse(stdout.trim()) as T;
}
