import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { mkdir, open, rename, rm } from "../core/runtime-deps.js";
import { AtomicWriteError } from "../sdk/errors/classes.js";

const WINDOWS_RENAME_RETRY_DELAYS_MS = [20, 50, 100] as const;
const WINDOWS_TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);

export async function writeAtomic(
	path: string,
	content: string | Buffer,
): Promise<void> {
	const directory = dirname(path);
	const tempPath = `${path}.tmp.${randomUUID()}`;

	await mkdir(directory, {
		recursive: true,
	});

	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(tempPath, "w");
		await handle.writeFile(content);
		await handle.sync();
		await handle.close();
		handle = undefined;

		await renameWithRetry(tempPath, path);
		await syncDirectory(directory);
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await rm(tempPath, {
			force: true,
		}).catch(() => undefined);
		throw new AtomicWriteError(
			`Atomic write failed for ${path}`,
			error instanceof Error ? error.message : String(error),
			{
				cause: error,
			},
		);
	}
}

async function renameWithRetry(sourcePath: string, destinationPath: string) {
	let lastError: unknown;

	for (
		let attempt = 0;
		attempt <= WINDOWS_RENAME_RETRY_DELAYS_MS.length;
		attempt += 1
	) {
		try {
			await rename(sourcePath, destinationPath);
			return;
		} catch (error) {
			lastError = error;
			if (
				!isTransientWindowsRenameError(error) ||
				attempt === WINDOWS_RENAME_RETRY_DELAYS_MS.length
			) {
				throw error;
			}

			await sleep(WINDOWS_RENAME_RETRY_DELAYS_MS[attempt] ?? 0);
		}
	}

	throw lastError;
}

function isTransientWindowsRenameError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string" &&
		WINDOWS_TRANSIENT_RENAME_CODES.has(error.code)
	);
}

async function sleep(delayMs: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, delayMs);
	});
}

async function syncDirectory(directory: string): Promise<void> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(directory, "r");
		await handle.sync();
	} catch {
		// Some platforms/filesystems do not allow fsync on directories.
	} finally {
		await handle?.close().catch(() => undefined);
	}
}
