import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const COMMANDS_DIR = join(ROOT, "src/cli/commands");
const COMMAND_HELPERS = new Set([
	"shared.ts",
	"skill.ts",
	"story-orchestrate.ts",
]);
const IMPORT_SPECIFIER_PATTERN =
	/import(?:\s+type)?[\s\S]*?\sfrom\s+["']([^"']+)["'];/g;
const ALLOWED_COMMAND_IMPORTS = new Set([
	"citty",
	"node:fs/promises",
	"node:path",
	"../../sdk/index.js",
	"../../sdk/operations/index.js",
	"./shared.js",
	"./story-orchestrate-run.js",
]);

async function listCommandModules(): Promise<string[]> {
	const entries = await readdir(COMMANDS_DIR);
	return entries
		.filter((entry) => entry.endsWith(".ts") && !COMMAND_HELPERS.has(entry))
		.sort();
}

function importedSpecifiers(source: string): string[] {
	return [...source.matchAll(IMPORT_SPECIFIER_PATTERN)].map((match) => {
		return match[1] as string;
	});
}

test("TC-3.2a: command modules stay thin and shell-only", async () => {
	for (const fileName of await listCommandModules()) {
		const source = await readFile(join(COMMANDS_DIR, fileName), "utf8");

		expect(source).toContain('from "citty"');
		expect(source).toContain('from "../../sdk/index.js"');
		expect(source).toContain("emitCommandEnvelope(");
		for (const specifier of importedSpecifiers(source)) {
			expect(
				ALLOWED_COMMAND_IMPORTS.has(specifier),
				`${fileName} imports ${specifier}; command modules may only import parser helpers, the public SDK surface, shared envelope/exit helpers, and Node file/path primitives for CLI argument ingestion.`,
			).toBe(true);
		}
		expect(source).not.toContain("runStoryImplement(");
		expect(source).not.toContain("runStoryContinue(");
		expect(source).not.toContain("runStorySelfReview(");
		expect(source).not.toContain("runStoryVerify(");
		expect(source).not.toContain("runEpicFix(");
		expect(source).not.toContain("runEpicReverify(");
		expect(source).not.toContain("runEpicReview(");
		expect(source).not.toContain("inspectSpecPack(");
		expect(source).not.toContain("createResultEnvelope(");
		expect(source).not.toContain("writeJsonArtifact(");
		expect(source).not.toContain("process.exit(");
		expect(source).not.toContain("process.exitCode =");
	}
});
