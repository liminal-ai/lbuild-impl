import { join, relative, resolve } from "node:path";

import { readdirDirents } from "./runtime-deps.js";

const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const IGNORED_PREFIXES = ["node_modules", "dist", ".test-tmp"];

function shouldIgnore(relativePath: string): boolean {
	return IGNORED_PREFIXES.some(
		(prefix) =>
			relativePath === prefix || relativePath.startsWith(`${prefix}/`),
	);
}

async function collectMatchingTestFiles(
	root: string,
	dir: string,
): Promise<number> {
	const entries = await readdirDirents(dir);
	let count = 0;

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		const relativePath = relative(root, fullPath).replace(/\\/g, "/");
		if (shouldIgnore(relativePath)) {
			continue;
		}

		if (entry.isDirectory()) {
			count += await collectMatchingTestFiles(root, fullPath);
			continue;
		}

		if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
			count += 1;
		}
	}

	return count;
}

export async function captureStoryBaselineSeed(input: {
	workspaceRoot: string;
}): Promise<{
	workspaceRoot: string;
	baselineBeforeCurrentStory: number;
	testFilePattern: string;
}> {
	const workspaceRoot = resolve(input.workspaceRoot);
	const baselineBeforeCurrentStory = await collectMatchingTestFiles(
		workspaceRoot,
		workspaceRoot,
	);

	return {
		workspaceRoot,
		baselineBeforeCurrentStory,
		testFilePattern: TEST_FILE_PATTERN.source,
	};
}
