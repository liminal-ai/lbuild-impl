import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "vitest";

import { ROOT } from "../../support/test-helpers";

const allowedEnvelopeCodes = new Set([
	"INVALID_INPUT",
	"INVALID_SPEC_PACK",
	"INVALID_RUN_CONFIG",
	"VERIFICATION_GATE_UNRESOLVED",
	"PROVIDER_UNAVAILABLE",
	"PROVIDER_TIMEOUT",
	"PROVIDER_STALLED",
	"PROVIDER_OUTPUT_INVALID",
	"CONTINUATION_HANDLE_INVALID",
	"PROMPT_INSERT_INVALID",
	"ATOMIC_WRITE_FAILED",
	"INDEX_RESERVATION_FAILED",
	"STORY_LEAD_CONTEXT_OVERFLOW",
	"INTERNAL_ERROR",
]);

test("TC-4.2a: envelope code literals stay within the closed Q8 taxonomy", async () => {
	const { execSync } = await import("node:child_process");
	const paths = execSync(`find ${join(ROOT, "src")} -name '*.ts' -type f`, {
		encoding: "utf8",
	})
		.trim()
		.split("\n")
		.filter(Boolean);
	const violations: string[] = [];

	for (const path of paths) {
		const source = await readFile(path, "utf8");
		for (const match of source.matchAll(/\bcode:\s*["']([A-Z_]+)["']/g)) {
			const code = match[1] ?? "";
			if (!allowedEnvelopeCodes.has(code)) {
				violations.push(`${path}: ${code}`);
			}
		}
	}

	expect(violations).toEqual([]);
});
