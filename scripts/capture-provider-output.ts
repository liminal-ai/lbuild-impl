import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	executeResumeScenario,
	executeScenario,
	type ParserScenarioName,
	type RealProviderName,
} from "../tests/support/fixtures/real-provider-scenarios";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_ROOT = join(
	ROOT,
	"tests",
	"support",
	"parser-contract-fixtures",
	"providers",
);
const PROVIDERS: RealProviderName[] = ["claude-code", "codex"];
const SCENARIOS: ParserScenarioName[] = [
	"smoke",
	"resume",
	"structured-output",
	"stall",
];

function parseArgs() {
	const args = process.argv.slice(2);
	const providers = new Set<RealProviderName>();
	const scenarios = new Set<ParserScenarioName>();

	for (const arg of args) {
		if (arg.startsWith("--provider=")) {
			providers.add(arg.slice("--provider=".length) as RealProviderName);
			continue;
		}
		if (arg.startsWith("--scenario=")) {
			scenarios.add(arg.slice("--scenario=".length) as ParserScenarioName);
			continue;
		}
		if (arg === "--all") {
			for (const provider of PROVIDERS) {
				providers.add(provider);
			}
			for (const scenario of SCENARIOS) {
				scenarios.add(scenario);
			}
			continue;
		}

		throw new Error(`Unknown argument: ${arg}`);
	}

	return {
		providers: providers.size > 0 ? [...providers] : PROVIDERS,
		scenarios: scenarios.size > 0 ? [...scenarios] : SCENARIOS,
	};
}

function captureDate(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/New_York",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

async function main() {
	const { providers, scenarios } = parseArgs();
	const capturedOn = captureDate();

	for (const provider of providers) {
		for (const scenario of scenarios) {
			const executed =
				scenario === "resume"
					? (await executeResumeScenario(provider)).resumed
					: await executeScenario(provider, scenario);

			if (executed.result.exitCode !== 0) {
				throw new Error(
					`Capture failed for ${provider}/${scenario}: ${executed.result.stderr || "provider exited non-zero"}`,
				);
			}

			const fixturePath = join(FIXTURE_ROOT, provider, `${scenario}.txt`);
			const header = [
				`# Provider: ${provider}`,
				`# Command: ${executed.command}`,
				`# Captured: ${capturedOn}`,
				`# Scenario: ${scenario}`,
				"# Fixture content follows \u2193",
			].join("\n");
			const fixtureBody = executed.result.stdout;
			await mkdir(dirname(fixturePath), {
				recursive: true,
			});
			await writeFile(
				fixturePath,
				fixtureBody.length > 0 ? `${header}\n${fixtureBody}\n` : `${header}\n`,
			);
			process.stdout.write(
				`captured ${provider}/${scenario} -> ${fixturePath}\n`,
			);
		}
	}
}

await main();
