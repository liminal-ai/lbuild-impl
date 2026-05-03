import { delimiter, extname, join } from "node:path";

import { access } from "./runtime-deps.js";

const DEFAULT_WINDOWS_PATHEXT = [".com", ".exe", ".bat", ".cmd"] as const;

function splitPathEntries(
	pathValue: string,
	platform: NodeJS.Platform,
): string[] {
	const separator = platform === "win32" ? ";" : delimiter;
	return pathValue
		.split(separator)
		.map((entry) => entry.trim().replace(/^"(.*)"$/u, "$1"))
		.filter((entry) => entry.length > 0);
}

function normalizeWindowsPathext(pathextValue?: string): string[] {
	if (!pathextValue) {
		return [...DEFAULT_WINDOWS_PATHEXT];
	}

	const extensions = pathextValue
		.split(";")
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.length > 0)
		.map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));

	return extensions.length > 0
		? [...new Set(extensions)]
		: [...DEFAULT_WINDOWS_PATHEXT];
}

function looksLikePath(executable: string): boolean {
	return executable.includes("/") || executable.includes("\\");
}

export function isWindowsCommandShim(path: string): boolean {
	return /\.(?:cmd|bat)$/iu.test(path);
}

function quoteWindowsCmdArg(value: string): string {
	return `"${value.replaceAll('"', '\\"')}"`;
}

export function buildWindowsCommandShimInvocation(input: {
	executable: string;
	args: string[];
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): {
	file: string;
	args: string[];
} {
	return {
		file: input.env?.COMSPEC ?? process.env.COMSPEC ?? "cmd.exe",
		args: [
			"/d",
			"/s",
			"/c",
			[input.executable, ...input.args].map(quoteWindowsCmdArg).join(" "),
		],
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function resolveProviderExecutable(input: {
	executable: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	platform?: NodeJS.Platform;
}): Promise<string> {
	const platform = input.platform ?? process.platform;
	if (platform !== "win32") {
		return input.executable;
	}

	if (looksLikePath(input.executable) || extname(input.executable).length > 0) {
		return input.executable;
	}

	const pathValue = input.env?.PATH ?? process.env.PATH ?? "";
	const pathEntries = splitPathEntries(pathValue, platform);
	if (pathEntries.length === 0) {
		return input.executable;
	}

	const extensions = normalizeWindowsPathext(
		input.env?.PATHEXT ?? process.env.PATHEXT,
	);
	for (const directory of pathEntries) {
		for (const candidate of [
			input.executable,
			...extensions.map((extension) => `${input.executable}${extension}`),
		]) {
			const candidatePath = join(directory, candidate);
			if (await pathExists(candidatePath)) {
				return candidatePath;
			}
		}
	}

	return input.executable;
}
