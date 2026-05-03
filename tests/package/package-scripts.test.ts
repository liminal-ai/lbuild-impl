import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

async function readScripts(): Promise<Record<string, string>> {
	const packageJson = JSON.parse(
		await readFile(join(ROOT, "package.json"), "utf8"),
	) as {
		scripts: Record<string, string>;
	};

	return packageJson.scripts;
}

describe("package scripts", () => {
	test("TC-5.5a: verify-all includes the integration suite through the package script", async () => {
		const scripts = await readScripts();

		expect(scripts["test:integration"]).toBe(
			"vitest run --project integration",
		);
		expect(scripts["verify-all"]).toBe(
			"npm run verify && npm run test:package && npm run test:integration",
		);
	});
});
