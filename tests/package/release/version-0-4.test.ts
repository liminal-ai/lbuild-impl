import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "vitest";

import { buildPackage, ROOT, run } from "../dist/helpers";

test("TC-6.8a/TC-6.8b ships and reports version 0.4.0", {
	timeout: 120_000,
}, async () => {
	const packageJson = JSON.parse(
		await readFile(join(ROOT, "package.json"), "utf8"),
	) as {
		version?: string;
	};
	const versionMarker = (await readFile(join(ROOT, "VERSION"), "utf8")).trim();

	expect(packageJson.version).toBe("0.4.0");
	expect(versionMarker).toBe("0.4.0");

	await buildPackage();

	const { stdout, stderr } = await run(process.execPath, [
		join(ROOT, "dist", "bin", "lbuild-impl.js"),
		"--version",
	]);

	expect(stderr).toBe("");
	expect(stdout.trim()).toBe("0.4.0");
});
