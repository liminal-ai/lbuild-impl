import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function collectFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectFiles(fullPath)));
			continue;
		}
		if (entry.isFile() && fullPath.endsWith(".ts")) {
			files.push(fullPath);
		}
	}

	return files;
}

async function runBuild(): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn("npm", ["run", "build"], {
			cwd: ROOT,
			env: {
				...process.env,
				FORCE_COLOR: "0",
			},
		});

		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}

			reject(new Error(`npm run build exited with code ${code}`));
		});
	});
}

describe("foundation", () => {
	test("TC-1.1a: package directory contains the required entries", async () => {
		const entries = await readdir(ROOT);

		expect(entries).toContain("src");
		expect(entries).toContain("tests");
		expect(entries).toContain("package.json");
		expect(entries).toContain("tsconfig.json");
		expect(entries).toContain("vitest.config.ts");
	});

	test("TC-1.2a: no Bun test-runner imports remain", async () => {
		const forbiddenDoubleQuoteImport = `from "${"bun"}:test"`;
		const forbiddenSingleQuoteImport = `from '${"bun"}:test'`;
		const filePaths = [
			...(await collectFiles(join(ROOT, "src"))),
			...(await collectFiles(join(ROOT, "tests"))),
		];

		for (const filePath of filePaths) {
			const content = await readFile(filePath, "utf8");
			expect(content).not.toContain(forbiddenDoubleQuoteImport);
			expect(content).not.toContain(forbiddenSingleQuoteImport);
		}
	});

	test("TC-1.3a: package.json declares all verification tiers", async () => {
		const pkg = JSON.parse(
			await readFile(join(ROOT, "package.json"), "utf8"),
		) as {
			scripts: Record<string, string>;
		};

		expect(pkg.scripts["red-verify"]).toBeTruthy();
		expect(pkg.scripts.verify).toBeTruthy();
		expect(pkg.scripts["test:package"]).toBeTruthy();
		expect(pkg.scripts["green-verify"]).toBeTruthy();
		expect(pkg.scripts["verify-all"]).toBeTruthy();
	});

	test("package.json exposes the package root and SDK subpath", async () => {
		const pkg = JSON.parse(
			await readFile(join(ROOT, "package.json"), "utf8"),
		) as {
			exports: Record<string, { import: string; types: string }>;
		};

		expect(pkg.exports["."]).toEqual({
			import: "./dist/sdk/index.js",
			types: "./dist/sdk/index.d.ts",
		});
		expect(pkg.exports["./sdk"]).toEqual({
			import: "./dist/sdk/index.js",
			types: "./dist/sdk/index.d.ts",
		});
	});

	test("TC-1.4a: build output includes CLI and SDK artifacts after build", {
		timeout: 120_000,
	}, async () => {
		await runBuild();

		expect(existsSync(join(ROOT, "dist", "bin", "lbuild-impl.js"))).toBe(true);
		expect(existsSync(join(ROOT, "dist", "bin", "lbuild-impl.d.ts"))).toBe(
			true,
		);
		expect(existsSync(join(ROOT, "dist", "sdk", "index.js"))).toBe(true);
		expect(existsSync(join(ROOT, "dist", "sdk", "index.d.ts"))).toBe(true);
	});

	test("TC-1.6a: ci workflow runs verify on push and pull_request", async () => {
		const workflow = await readFile(
			join(ROOT, ".github", "workflows", "ci.yml"),
			"utf8",
		);

		expect(workflow).toContain("push:");
		expect(workflow).toContain("pull_request:");
		expect(workflow).toContain("runs-on: blacksmith-2vcpu-ubuntu-2404");
		expect(workflow).not.toContain("runs-on: ubuntu-latest");
		expect(workflow).toContain("node-version: 24");
		expect(workflow).toContain("npm run verify");
		expect(workflow).toContain("npm run test:package");
	});

	test("no dedicated GitHub Actions integration workflow is shipped", async () => {
		expect(
			existsSync(join(ROOT, ".github", "workflows", "integration.yml")),
		).toBe(false);
	});
});
