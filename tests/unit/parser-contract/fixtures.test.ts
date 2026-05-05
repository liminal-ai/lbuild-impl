import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ROOT } from "../../support/test-helpers";

const FIXTURE_ROOT = join(
	ROOT,
	"tests/support/parser-contract-fixtures/providers",
);
const PROVIDERS = ["claude-code", "codex"] as const;
const SCENARIOS = ["resume", "smoke", "stall", "structured-output"] as const;

describe("parser-contract fixture provenance", () => {
	test("TC-4.8b.2: fixture directories exist for every provider", async () => {
		const entries = await readdir(FIXTURE_ROOT);
		expect(entries.sort()).toEqual(PROVIDERS.slice().sort());
	});

	test("TC-4.8b.2: any committed fixture declares provenance metadata", async () => {
		for (const provider of PROVIDERS) {
			const providerDir = join(FIXTURE_ROOT, provider);
			const entries = (await readdir(providerDir)).filter(
				(name) => name !== ".gitkeep",
			);
			expect(entries.sort()).toEqual(
				SCENARIOS.map((scenario) => `${scenario}.txt`).sort(),
			);

			for (const entry of entries) {
				const fixture = await readFile(join(providerDir, entry), "utf8");
				expect(fixture).toMatch(
					/^# Provider: .+\n# Command: .+\n# Captured: \d{4}-\d{2}-\d{2}\n# Scenario: [a-z-]+\n# Fixture content follows ↓/,
				);
				const captured = fixture.match(
					/^# Captured: (\d{4}-\d{2}-\d{2})/m,
				)?.[1];
				expect(Number.isNaN(Date.parse(captured ?? ""))).toBe(false);
				expect(fixture).toContain(`# Provider: ${provider}`);
			}
		}
	});
});
