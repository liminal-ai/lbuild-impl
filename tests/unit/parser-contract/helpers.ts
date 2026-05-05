import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ROOT } from "../../support/test-helpers";

const FIXTURE_ROOT = join(
	ROOT,
	"tests/support/parser-contract-fixtures/providers",
);

export interface ParserFixture {
	name: string;
	stdout: string;
	provenance: {
		provider: string;
		command: string;
		captured: string;
		scenario: string;
	};
}

const PROVENANCE_PATTERN =
	/^# Provider: (?<provider>.+)\n# Command: (?<command>.+)\n# Captured: (?<captured>\d{4}-\d{2}-\d{2})\n# Scenario: (?<scenario>[a-z-]+)\n# Fixture content follows ↓\n?/m;

export async function readProviderFixtures(
	provider: "claude-code" | "codex",
): Promise<ParserFixture[]> {
	const providerDir = join(FIXTURE_ROOT, provider);
	const entries = (await readdir(providerDir)).filter(
		(entry) => entry !== ".gitkeep",
	);

	const fixtures: ParserFixture[] = [];
	for (const entry of entries) {
		const fixture = await readFile(join(providerDir, entry), "utf8");
		const match = fixture.match(PROVENANCE_PATTERN);
		if (!match?.groups) {
			throw new Error(
				`Fixture ${provider}/${entry} is missing provenance metadata.`,
			);
		}

		const stdout = fixture.slice(match[0].length);
		fixtures.push({
			name: entry,
			stdout,
			provenance: {
				provider: match.groups.provider,
				command: match.groups.command,
				captured: match.groups.captured,
				scenario: match.groups.scenario,
			},
		});
	}

	return fixtures.sort((left, right) => left.name.localeCompare(right.name));
}
