import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "vitest";

import { resolveRepoRootFromModuleUrl } from "../../../scripts/sync-impl-cli-assets";
import { ROOT } from "../../support/test-helpers";

test("TC-6.1a resolves embedded asset directories from a Windows-safe repo root path", () => {
	const repoRoot = "C:\\repo";

	expect(join(repoRoot, "src", "prompts")).toBe("C:\\repo/src/prompts");
	expect(join(repoRoot, "src", "skills")).toBe("C:\\repo/src/skills");
});

test("TC-6.1a uses fileURLToPath for module URL conversion instead of URL.pathname", async () => {
	const scriptSource = await readFile(
		join(ROOT, "scripts", "sync-impl-cli-assets.ts"),
		"utf8",
	);

	expect(scriptSource).toContain('fileURLToPath(new URL("..", moduleUrl))');
	expect(scriptSource).not.toContain('new URL("..", import.meta.url).pathname');
	expect(typeof resolveRepoRootFromModuleUrl(import.meta.url)).toBe("string");
});
