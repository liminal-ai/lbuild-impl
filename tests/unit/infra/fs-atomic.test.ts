import type { FileHandle } from "node:fs/promises";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "vitest";
import { withRuntimeDeps } from "../../../src/core/runtime-deps";
import { writeAtomic } from "../../../src/infra/fs-atomic";
import { AtomicWriteError } from "../../../src/sdk/errors";
import { createTempDir } from "../../support/test-helpers";

test("TC-6.4b: writeAtomic preserves the prior file when a non-transient rename failure occurs", async () => {
	const tempDir = await createTempDir("fs-atomic-rename-failure");
	const targetPath = join(tempDir, "artifact.json");
	await writeFile(targetPath, '{"before":true}\n', "utf8");
	let attempts = 0;

	await expect(
		withRuntimeDeps(
			{
				fs: {
					rename: async () => {
						attempts += 1;
						const error = new Error("rename failed");
						Object.assign(error, {
							code: "EACCES",
						});
						throw error;
					},
				},
			},
			async () => writeAtomic(targetPath, '{"after":true}\n'),
		),
	).rejects.toBeInstanceOf(AtomicWriteError);

	expect(await readFile(targetPath, "utf8")).toBe('{"before":true}\n');
	expect(attempts).toBe(1);
	expect(
		(await readdir(tempDir)).filter((name) => name.includes(".tmp.")),
	).toEqual([]);
});

test("TC-6.4a: writeAtomic retries transient Windows rename failures before succeeding", async () => {
	const tempDir = await createTempDir("fs-atomic-rename-retry");
	const targetPath = join(tempDir, "artifact.json");
	const events: string[] = [];
	let attempts = 0;

	await withRuntimeDeps(
		{
			fs: {
				rename: async () => {
					attempts += 1;
					events.push(`rename-${attempts}`);
					if (attempts < 3) {
						const error = new Error("file busy");
						Object.assign(error, {
							code: attempts === 1 ? "EPERM" : "EBUSY",
						});
						throw error;
					}
				},
			},
		},
		async () => writeAtomic(targetPath, '{"after":true}\n'),
	);

	expect(attempts).toBe(3);
	expect(events).toEqual(["rename-1", "rename-2", "rename-3"]);
});

test("TC-6.4a: writeAtomic fsyncs and closes the temp file before rename", async () => {
	const tempDir = await createTempDir("fs-atomic-durability-order");
	const targetPath = join(tempDir, "artifact.json");
	const events: string[] = [];

	const fileHandle = {
		writeFile: async () => {
			events.push("write-temp");
		},
		sync: async () => {
			events.push("fsync-temp");
		},
		close: async () => {
			events.push("close-temp");
		},
	};
	const directoryHandle = {
		sync: async () => {
			events.push("fsync-dir");
		},
		close: async () => {
			events.push("close-dir");
		},
	};

	await withRuntimeDeps(
		{
			fs: {
				open: async (path) =>
					(String(path).includes(".tmp.")
						? fileHandle
						: directoryHandle) as unknown as FileHandle,
				rename: async () => {
					events.push("rename");
				},
			},
		},
		async () => writeAtomic(targetPath, '{"after":true}\n'),
	);

	expect(events).toEqual([
		"write-temp",
		"fsync-temp",
		"close-temp",
		"rename",
		"fsync-dir",
		"close-dir",
	]);
});
