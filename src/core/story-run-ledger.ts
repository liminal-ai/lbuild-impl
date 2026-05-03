import { basename, dirname, join, resolve } from "node:path";

import { writeAtomic } from "../infra/fs-atomic.js";
import {
	type AppendStoryRunEventInput,
	appendStoryRunEventInputSchema,
	type StoryLeadFinalPackage,
	storyLeadFinalPackageSchema,
	type StoryRunCurrentSnapshot,
	storyRunCurrentSnapshotSchema,
	type StoryRunEvent,
	storyRunEventSchema,
	type WriteCurrentSnapshotInput,
	writeCurrentSnapshotInputSchema,
	type WriteFinalPackageInput,
	writeFinalPackageInputSchema,
} from "./story-orchestrate-contracts.js";
import { pathExists, readTextFile } from "./fs-utils.js";
import {
	appendFile,
	mkdir,
	readdirDirents,
	writeFile,
} from "./runtime-deps.js";

const STORY_LEAD_DIRNAME = "story-lead";
const INDEX_PATTERN = /^(\d{3})-/;
const CURRENT_FILE_PATTERN = /^(\d{3})-current\.json$/;
const FINAL_PACKAGE_SUFFIX = "-final-package.json";
const EVENT_HISTORY_SUFFIX = "-events.jsonl";
const STREAM_BASENAME_SUFFIX = "-story-lead";

export interface StoryRunAttemptPaths {
	attempt: number;
	attemptKey: string;
	storyRunId: string;
	artifactDir: string;
	currentSnapshotPath: string;
	eventHistoryPath: string;
	finalPackagePath: string;
	progressStatusPath: string;
	progressHistoryPath: string;
	stdoutPath: string;
	stderrPath: string;
}

export interface StoryRunAttemptRecord extends StoryRunAttemptPaths {
	currentSnapshot: StoryRunCurrentSnapshot;
	finalPackage?: StoryLeadFinalPackage;
}

export interface StoryRunLedger {
	createAttempt(): Promise<StoryRunAttemptPaths>;
	listAttempts(): Promise<StoryRunAttemptRecord[]>;
	getAttemptByStoryRunId(
		storyRunId: string,
	): Promise<StoryRunAttemptRecord | null>;
	readCurrentSnapshot(path: string): Promise<StoryRunCurrentSnapshot>;
	readFinalPackage(path: string): Promise<StoryLeadFinalPackage>;
	writeCurrentSnapshot(input: WriteCurrentSnapshotInput): Promise<void>;
	appendEvent(input: AppendStoryRunEventInput): Promise<void>;
	writeFinalPackage(input: WriteFinalPackageInput): Promise<void>;
}

function storyLeadArtifactDir(specPackRoot: string, storyId: string): string {
	return join(resolve(specPackRoot), "artifacts", storyId, STORY_LEAD_DIRNAME);
}

function buildAttemptPaths(
	artifactDir: string,
	attempt: number,
	storyId: string,
): StoryRunAttemptPaths {
	const attemptKey = String(attempt).padStart(3, "0");
	const storyRunId = `${storyId}-story-run-${attemptKey}`;
	const streamBaseName = `${attemptKey}${STREAM_BASENAME_SUFFIX}`;

	return {
		attempt,
		attemptKey,
		storyRunId,
		artifactDir,
		currentSnapshotPath: join(artifactDir, `${attemptKey}-current.json`),
		eventHistoryPath: join(artifactDir, `${attemptKey}${EVENT_HISTORY_SUFFIX}`),
		finalPackagePath: join(artifactDir, `${attemptKey}${FINAL_PACKAGE_SUFFIX}`),
		progressStatusPath: join(
			artifactDir,
			"progress",
			`${streamBaseName}.status.json`,
		),
		progressHistoryPath: join(
			artifactDir,
			"progress",
			`${streamBaseName}.progress.jsonl`,
		),
		stdoutPath: join(artifactDir, "streams", `${streamBaseName}.stdout.log`),
		stderrPath: join(artifactDir, "streams", `${streamBaseName}.stderr.log`),
	};
}

function extractAttemptFromCurrentPath(path: string): number | null {
	const match = basename(path).match(CURRENT_FILE_PATTERN);
	if (!match?.[1]) {
		return null;
	}

	const parsed = Number.parseInt(match[1], 10);
	return Number.isFinite(parsed) ? parsed : null;
}

async function findNextAttempt(artifactDir: string): Promise<number> {
	let maxAttempt = 0;
	const directories = [
		artifactDir,
		join(artifactDir, "progress"),
		join(artifactDir, "streams"),
	];

	for (const directory of directories) {
		try {
			const entries = await readdirDirents(directory);
			for (const entry of entries) {
				if (entry.isDirectory()) {
					continue;
				}

				const match = entry.name.match(INDEX_PATTERN);
				if (!match?.[1]) {
					continue;
				}

				const parsed = Number.parseInt(match[1], 10);
				if (Number.isFinite(parsed)) {
					maxAttempt = Math.max(maxAttempt, parsed);
				}
			}
		} catch {
			// Treat missing directories as empty.
		}
	}

	return maxAttempt + 1;
}

async function reserveCurrentSnapshotPath(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, "", { flag: "wx" });
}

async function writeProgressStatus(
	progressStatusPath: string,
	snapshot: StoryRunCurrentSnapshot,
): Promise<void> {
	await writeAtomic(progressStatusPath, `${JSON.stringify(snapshot)}\n`);
}

async function appendProgressEvent(
	progressHistoryPath: string,
	event: StoryRunEvent,
): Promise<void> {
	await mkdir(dirname(progressHistoryPath), { recursive: true });
	await appendFile(progressHistoryPath, `${JSON.stringify(event)}\n`);
}

async function maybeReadJson<T>(path: string): Promise<T | null> {
	if (!(await pathExists(path))) {
		return null;
	}

	const content = await readTextFile(path);
	const trimmed = content.trim();
	if (trimmed.length === 0) {
		return null;
	}

	return JSON.parse(trimmed) as T;
}

function normalizeSnapshotForRead(
	snapshot: StoryRunCurrentSnapshot,
): StoryRunCurrentSnapshot {
	if (!("storyLeadSession" in snapshot)) {
		return snapshot;
	}

	const { storyLeadSession: _deprecatedStoryLeadSession, ...rest } =
		snapshot as StoryRunCurrentSnapshot & {
			storyLeadSession?: unknown;
		};
	return rest;
}

export function createStoryRunLedger(input: {
	specPackRoot: string;
	storyId: string;
}): StoryRunLedger {
	const artifactDir = storyLeadArtifactDir(input.specPackRoot, input.storyId);

	return {
		async createAttempt() {
			await mkdir(artifactDir, { recursive: true });

			for (;;) {
				const attempt = await findNextAttempt(artifactDir);
				const paths = buildAttemptPaths(artifactDir, attempt, input.storyId);
				try {
					await reserveCurrentSnapshotPath(paths.currentSnapshotPath);
					return paths;
				} catch (error) {
					if (
						!(error instanceof Error) ||
						!("code" in error) ||
						error.code !== "EEXIST"
					) {
						throw error;
					}
				}
			}
		},

		async listAttempts() {
			if (!(await pathExists(artifactDir))) {
				return [];
			}

			const entries = await readdirDirents(artifactDir);
			const currentFiles = entries
				.filter(
					(entry) => entry.isFile() && CURRENT_FILE_PATTERN.test(entry.name),
				)
				.map((entry) => join(artifactDir, entry.name))
				.sort((left, right) => left.localeCompare(right));
			const attempts: StoryRunAttemptRecord[] = [];

			for (const currentSnapshotPath of currentFiles) {
				const currentSnapshotRaw =
					await maybeReadJson<StoryRunCurrentSnapshot>(currentSnapshotPath);
				if (!currentSnapshotRaw) {
					continue;
				}

				const currentSnapshot = normalizeSnapshotForRead(
					storyRunCurrentSnapshotSchema.parse(currentSnapshotRaw),
				);
				const attempt = extractAttemptFromCurrentPath(currentSnapshotPath);
				if (!attempt) {
					continue;
				}

				const paths = buildAttemptPaths(artifactDir, attempt, input.storyId);
				const finalPackageRaw = await maybeReadJson<StoryLeadFinalPackage>(
					paths.finalPackagePath,
				);
				const finalPackage = finalPackageRaw
					? storyLeadFinalPackageSchema.parse(finalPackageRaw)
					: undefined;

				attempts.push({
					...paths,
					currentSnapshot,
					...(finalPackage ? { finalPackage } : {}),
				});
			}

			return attempts.sort((left, right) => left.attempt - right.attempt);
		},

		async getAttemptByStoryRunId(storyRunId: string) {
			const attempts = await this.listAttempts();
			return (
				attempts.find((attempt) => attempt.storyRunId === storyRunId) ?? null
			);
		},

		async readCurrentSnapshot(path: string) {
			const payload = await maybeReadJson<StoryRunCurrentSnapshot>(path);
			return normalizeSnapshotForRead(
				storyRunCurrentSnapshotSchema.parse(payload),
			);
		},

		async readFinalPackage(path: string) {
			const payload = await maybeReadJson<StoryLeadFinalPackage>(path);
			return storyLeadFinalPackageSchema.parse(payload);
		},

		async writeCurrentSnapshot(payload: WriteCurrentSnapshotInput) {
			const parsed = writeCurrentSnapshotInputSchema.parse(payload);
			const paths = buildAttemptPaths(
				artifactDir,
				parsed.snapshot.attempt,
				input.storyId,
			);

			await writeAtomic(
				paths.currentSnapshotPath,
				`${JSON.stringify(parsed.snapshot)}\n`,
			);
			await writeProgressStatus(paths.progressStatusPath, parsed.snapshot);
		},

		async appendEvent(payload: AppendStoryRunEventInput) {
			const parsed = appendStoryRunEventInputSchema.parse(payload);
			const attempt = Number.parseInt(parsed.storyRunId.slice(-3), 10);
			const paths = buildAttemptPaths(artifactDir, attempt, input.storyId);
			const event = storyRunEventSchema.parse(parsed.event);

			await mkdir(dirname(paths.eventHistoryPath), { recursive: true });
			await appendFile(paths.eventHistoryPath, `${JSON.stringify(event)}\n`);
			await appendProgressEvent(paths.progressHistoryPath, event);
		},

		async writeFinalPackage(payload: WriteFinalPackageInput) {
			const parsed = writeFinalPackageInputSchema.parse(payload);
			const paths = buildAttemptPaths(
				artifactDir,
				parsed.finalPackage.attempt,
				input.storyId,
			);

			await writeAtomic(
				paths.finalPackagePath,
				`${JSON.stringify(parsed.finalPackage)}\n`,
			);
		},
	};
}
