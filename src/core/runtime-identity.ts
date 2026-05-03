import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { packageRootPath, packageVersion } from "../package-metadata.js";

export const runtimeInvocationSourceSchema = z.enum([
	"local-source",
	"global-package",
	"bundled-skill",
	"unknown",
]);

export const runtimeIdentitySchema = z
	.object({
		version: z.string().min(1),
		invocationSource: runtimeInvocationSourceSchema,
		entryPath: z.string().min(1).optional(),
	})
	.strict();

export type RuntimeIdentity = z.infer<typeof runtimeIdentitySchema>;

interface DetectRuntimeInvocationSourceInput {
	entryPath?: string;
	packageRootPath?: string;
	packageRootHasGitDir?: boolean;
	packageRootHasSrcDir?: boolean;
	packageRootHasPackageJson?: boolean;
}

function normalizePath(path: string): string {
	return resolve(path).replaceAll("\\", "/");
}

function pathInsideRoot(rootPath: string, candidatePath: string): boolean {
	const normalizedRoot = normalizePath(rootPath);
	const normalizedCandidate = normalizePath(candidatePath);

	return (
		normalizedCandidate === normalizedRoot ||
		normalizedCandidate.startsWith(`${normalizedRoot}/`)
	);
}

function looksLikeBundledSkillPath(path: string): boolean {
	const normalized = normalizePath(path);

	return (
		normalized.includes("/.codex/skills/") ||
		normalized.includes("/.agents/skills/") ||
		(normalized.includes("/plugins/cache/") && normalized.includes("/skills/"))
	);
}

function resolveEntryPath(input: {
	entryPath?: string;
	entryUrl?: string;
	packageRootPath?: string;
}): string | undefined {
	if (input.entryPath) {
		return resolve(input.entryPath);
	}

	if (input.entryUrl) {
		return fileURLToPath(input.entryUrl);
	}

	const candidateArgvPath = process.argv[1];
	if (candidateArgvPath && input.packageRootPath) {
		const resolvedArgvPath = resolve(candidateArgvPath);
		if (pathInsideRoot(input.packageRootPath, resolvedArgvPath)) {
			return resolvedArgvPath;
		}
	}

	return fileURLToPath(import.meta.url);
}

export function detectRuntimeInvocationSource(
	input: DetectRuntimeInvocationSourceInput,
): RuntimeIdentity["invocationSource"] {
	const { entryPath, packageRootPath: rootPath } = input;
	const candidatePath = entryPath ?? rootPath;

	if (candidatePath && looksLikeBundledSkillPath(candidatePath)) {
		return "bundled-skill";
	}

	if (
		entryPath &&
		rootPath &&
		input.packageRootHasGitDir &&
		input.packageRootHasSrcDir &&
		pathInsideRoot(rootPath, entryPath)
	) {
		return "local-source";
	}

	if (
		entryPath &&
		rootPath &&
		input.packageRootHasPackageJson &&
		pathInsideRoot(rootPath, entryPath)
	) {
		return "global-package";
	}

	return "unknown";
}

export function createRuntimeIdentity(
	input: {
		entryPath?: string;
		entryUrl?: string;
		packageRootPath?: string;
		version?: string;
	} = {},
): RuntimeIdentity {
	const resolvedPackageRootPath = input.packageRootPath ?? packageRootPath;
	const resolvedEntryPath = resolveEntryPath({
		entryPath: input.entryPath,
		entryUrl: input.entryUrl,
		packageRootPath: resolvedPackageRootPath,
	});

	const invocationSource = detectRuntimeInvocationSource({
		entryPath: resolvedEntryPath,
		packageRootPath: resolvedPackageRootPath,
		packageRootHasGitDir: resolvedPackageRootPath
			? existsSync(join(resolvedPackageRootPath, ".git"))
			: false,
		packageRootHasSrcDir: resolvedPackageRootPath
			? existsSync(join(resolvedPackageRootPath, "src"))
			: false,
		packageRootHasPackageJson: resolvedPackageRootPath
			? existsSync(join(resolvedPackageRootPath, "package.json"))
			: false,
	});

	return runtimeIdentitySchema.parse({
		version: input.version ?? packageVersion,
		invocationSource,
		...(resolvedEntryPath ? { entryPath: resolvedEntryPath } : {}),
	});
}
