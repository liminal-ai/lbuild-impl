import { execFile, spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { promisify } from "node:util";

import { describe, expect, test, vi } from "vitest";

import {
	epicFix,
	epicReverify,
	epicReview,
	type FileSystemAdapter,
	inspect,
	preflight,
	quickFix,
	type SpawnImplementation,
	storyContinue,
	storyImplement,
	storySelfReview,
	storyVerify,
} from "../../../src/sdk/index";
import {
	createImplementorSpecPack,
	createRunConfig,
	createSpecPack,
	createTempDir,
	parseJsonOutput,
	ROOT,
	writeFakeProviderExecutable,
	writeRunConfig,
} from "../../support/test-helpers";

const execFileAsync = promisify(execFile);

describe("sdk operations", () => {
	test("TC-2.4a SDK returns envelopes without process.exit or stdout writes", async () => {
		const specPackRoot = await createSpecPack("sdk-no-shell");
		const continuationHandle = {
			provider: "claude-code" as const,
			sessionId: "session-123",
			storyId: "00-foundation",
		};
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as never);

		const envelopes = await Promise.all([
			inspect({
				specPackRoot,
			}),
			preflight({
				specPackRoot,
			}),
			epicReverify({
				specPackRoot,
				reviewReportPaths: ["missing-report.json"],
			}),
			epicReview({
				specPackRoot,
			}),
			epicFix({
				specPackRoot,
				fixBatchPath: join(specPackRoot, "fix-batch.md"),
			}),
			quickFix({
				specPackRoot,
				request: "Apply a tiny fix",
			}),
			storyImplement({
				specPackRoot,
				storyId: "00-foundation",
			}),
			storyContinue({
				specPackRoot,
				storyId: "00-foundation",
				continuationHandle,
				followupRequest: "Continue",
			}),
			storySelfReview({
				specPackRoot,
				storyId: "00-foundation",
				continuationHandle,
				passes: 1,
				passArtifactPaths: [],
			}),
			storyVerify({
				specPackRoot,
				storyId: "00-foundation",
			}),
		]);

		expect(exitSpy).not.toHaveBeenCalled();
		expect(stdoutSpy).not.toHaveBeenCalled();
		expect(envelopes).toHaveLength(10);

		for (const envelope of envelopes) {
			expect(envelope.version).toBe(1);
			expect(envelope.command).toMatch(/^[a-z-]+$/);
			expect(Array.isArray(envelope.errors)).toBe(true);
			expect(Array.isArray(envelope.warnings)).toBe(true);
			expect(Array.isArray(envelope.artifacts)).toBe(true);
			expect(typeof envelope.startedAt).toBe("string");
			expect(typeof envelope.finishedAt).toBe("string");
		}
	});

	test("TC-2.4b SDK is callable from a Node script through the package export", {
		timeout: 120_000,
	}, async () => {
		const specPackRoot = await createSpecPack("sdk-script");

		await execFileAsync("npm", ["run", "build"], {
			cwd: ROOT,
			env: {
				...process.env,
				FORCE_COLOR: "0",
			},
		});

		const { stdout } = await execFileAsync(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				[
					"import { inspect } from 'lbuild-impl/sdk';",
					"const result = await inspect({ specPackRoot: process.argv[1] });",
					"process.stdout.write(JSON.stringify(result));",
				].join("\n"),
				specPackRoot,
			],
			{
				cwd: ROOT,
				env: {
					...process.env,
					FORCE_COLOR: "0",
				},
			},
		);

		const envelope =
			parseJsonOutput<Awaited<ReturnType<typeof inspect>>>(stdout);
		expect(envelope.command).toBe("inspect");
		expect(envelope.status).toBe("ok");
		expect(envelope.outcome).toBe("ready");
	});

	test("TC-2.5a filesystem and subprocess adapters are honored", async () => {
		const { specPackRoot, storyId } = await createImplementorSpecPack("sdk-di");
		await writeRunConfig(
			specPackRoot,
			createRunConfig({
				story_implementor: {
					secondary_harness: "none",
					model: "claude-sonnet",
					reasoning_effort: "high",
				},
				verification_gates: {
					story: "npm run green-verify",
					epic: "npm run verify-all",
				},
			}),
		);

		const binDir = await createTempDir("sdk-di-provider-bin");
		const providerPayload = {
			outcome: "ready-for-verification",
			planSummary: "Implemented the requested story changes.",
			changedFiles: [
				{
					path: "src/sdk/index.ts",
					reason: "Expose the programmatic SDK surface.",
				},
			],
			tests: {
				added: ["tests/sdk/operations.test.ts"],
				modified: [],
				removed: [],
				totalAfterStory: 1,
				deltaFromPriorBaseline: 1,
			},
			gatesRun: [
				{
					command: "npm run green-verify",
					result: "pass",
				},
			],
			selfReview: {
				findingsFixed: [],
				findingsSurfaced: [],
			},
			openQuestions: [],
			specDeviations: [],
			recommendedNextStep: "Run verification.",
		};
		const { env, logPath } = await writeFakeProviderExecutable({
			binDir,
			provider: "claude",
			responses: [
				{
					stderr: "provider side stderr\n",
					stdout: JSON.stringify({
						sessionId: "session-123",
						result: providerPayload,
					}),
				},
			],
		});

		const fsCalls: string[] = [];
		const streamCalls: string[] = [];
		const streamContents = new Map<string, string>();
		const wrapFsCall = <TArgs extends unknown[], TResult>(
			name: string,
			implementation: (...args: TArgs) => Promise<TResult>,
		) => {
			return async (...args: TArgs) => {
				fsCalls.push(name);
				return await implementation(...args);
			};
		};
		const createWriteStreamAdapter: FileSystemAdapter["createWriteStream"] = (
			path,
		) => {
			const outputPath = path.toString();
			streamCalls.push(outputPath);
			streamContents.set(outputPath, "");
			return new Writable({
				write(chunk, _encoding, callback) {
					streamContents.set(
						outputPath,
						`${streamContents.get(outputPath) ?? ""}${chunk.toString()}`,
					);
					callback();
				},
			}) as ReturnType<NonNullable<FileSystemAdapter["createWriteStream"]>>;
		};
		const fsAdapter: FileSystemAdapter = {
			access: wrapFsCall("access", fs.access) as FileSystemAdapter["access"],
			createWriteStream: createWriteStreamAdapter,
			mkdir: wrapFsCall("mkdir", fs.mkdir) as FileSystemAdapter["mkdir"],
			readFile: wrapFsCall(
				"readFile",
				fs.readFile,
			) as FileSystemAdapter["readFile"],
			readdir: wrapFsCall(
				"readdir",
				fs.readdir,
			) as FileSystemAdapter["readdir"],
			stat: wrapFsCall("stat", fs.stat) as FileSystemAdapter["stat"],
			writeFile: wrapFsCall(
				"writeFile",
				fs.writeFile,
			) as FileSystemAdapter["writeFile"],
		};

		const spawnCalls: string[] = [];
		const spawnAdapter = ((...args: Parameters<typeof nodeSpawn>) => {
			spawnCalls.push(args[0] as string);
			return nodeSpawn(...args);
		}) as unknown as SpawnImplementation;

		const streamDir = await createTempDir("sdk-di-streams");
		const stdoutPath = join(streamDir, "provider.stdout.log");
		const stderrPath = join(streamDir, "provider.stderr.log");

		const envelope = await storyImplement({
			specPackRoot,
			storyId,
			env: {
				...env,
				PATH: `${binDir}:${process.env.PATH ?? ""}`,
			},
			fs: fsAdapter,
			spawn: spawnAdapter,
			streamOutputPaths: {
				stdoutPath,
				stderrPath,
			},
		});

		expect(envelope.status).toBe("ok");
		expect(envelope.outcome).toBe("ready-for-verification");
		expect(spawnCalls).toContain("claude");
		expect(fsCalls).toEqual(
			expect.arrayContaining([
				"access",
				"mkdir",
				"readFile",
				"readdir",
				"stat",
				"writeFile",
			]),
		);
		expect(streamCalls).toEqual([stdoutPath, stderrPath]);
		expect(streamContents.get(stdoutPath)).toContain(
			'"sessionId":"session-123"',
		);
		expect(streamContents.get(stderrPath)).toBe("provider side stderr\n");
		// If the default node stream handled these paths, it would create files here.
		await expect(fs.access(stdoutPath)).rejects.toThrow();
		await expect(fs.access(stderrPath)).rejects.toThrow();
		expect(await fs.readFile(logPath, "utf8")).toContain('"provider":"claude"');
	});
});
