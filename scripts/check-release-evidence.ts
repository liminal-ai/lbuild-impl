import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EVIDENCE_ROOT = join(ROOT, "gorilla", "evidence");
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const EVIDENCE_DIRECTORY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const EVIDENCE_FILE_PATTERN =
	/^(claude-code|codex)-(smoke|resume|structured-output|stall)\.md$/u;
const DEFAULT_REQUIRED_REPORTS = [
	"claude-code-smoke.md",
	"codex-resume.md",
	"codex-structured-output.md",
	"codex-stall.md",
] as const;
const CLEAN_FINDING_VALUES = new Set([
	"none",
	"n/a",
	"na",
	"no unexpected behaviors",
	"none recorded",
]);

interface EvidenceDirectory {
	name: string;
	path: string;
	date: Date;
	ageInDays: number;
}

function parseRequiredReports(matrix: string | undefined): string[] {
	if (!matrix) {
		return [...DEFAULT_REQUIRED_REPORTS];
	}

	const reports = matrix
		.split(",")
		.map((report) => report.trim())
		.filter(Boolean);

	if (reports.length === 0) {
		throw new Error(
			"Invalid evidence matrix: expected one or more comma-separated <provider>-<scenario>.md reports.",
		);
	}

	for (const report of reports) {
		if (!EVIDENCE_FILE_PATTERN.test(report)) {
			throw new Error(
				`Invalid evidence matrix report ${report}. Expected <provider>-<scenario>.md using canonical providers and scenarios.`,
			);
		}
	}

	return [...new Set(reports)].sort((left, right) => left.localeCompare(right));
}

function parseIsoDate(value: string): Date {
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Invalid ISO date: ${value}`);
	}

	return parsed;
}

function normalizeFindingValue(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[`*_]/gu, "")
		.replace(/\.$/u, "")
		.replace(/\s+/gu, " ");
}

function readUnexpectedBehaviors(markdown: string, filePath: string): string {
	const divergencesSectionMatch = markdown.match(
		/## Divergences([\s\S]*?)(?:\n## |\s*$)/u,
	);
	if (!divergencesSectionMatch?.[1]) {
		throw new Error(
			`Release evidence file ${filePath} is missing the ## Divergences section.`,
		);
	}

	const unexpectedBehaviorsMatch = divergencesSectionMatch[1].match(
		/^- Unexpected behaviors observed:\s*(.+)$/mu,
	);
	if (!unexpectedBehaviorsMatch?.[1]) {
		throw new Error(
			`Release evidence file ${filePath} is missing a same-line "- Unexpected behaviors observed: ..." entry.`,
		);
	}

	return normalizeFindingValue(unexpectedBehaviorsMatch[1]);
}

async function collectEvidenceDirectories(
	evidenceRoot: string,
	referenceDate: Date,
): Promise<EvidenceDirectory[]> {
	const entries = await readdir(evidenceRoot, { withFileTypes: true });
	const directories: EvidenceDirectory[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory() || !EVIDENCE_DIRECTORY_PATTERN.test(entry.name)) {
			continue;
		}

		const directoryDate = parseIsoDate(entry.name);
		const ageInDays = Math.floor(
			(referenceDate.getTime() - directoryDate.getTime()) / DAY_IN_MS,
		);

		directories.push({
			name: entry.name,
			path: join(evidenceRoot, entry.name),
			date: directoryDate,
			ageInDays,
		});
	}

	return directories.sort(
		(left, right) => right.date.getTime() - left.date.getTime(),
	);
}

async function main() {
	const { values } = parseArgs({
		options: {
			"evidence-root": {
				type: "string",
			},
			"reference-date": {
				type: "string",
			},
			"release-window-days": {
				type: "string",
			},
			matrix: {
				type: "string",
			},
		},
	});

	const evidenceRoot = resolve(
		values["evidence-root"] ?? DEFAULT_EVIDENCE_ROOT,
	);
	const referenceDate = parseIsoDate(
		values["reference-date"] ?? new Date().toISOString().slice(0, 10),
	);
	const releaseWindowDays = Number.parseInt(
		values["release-window-days"] ?? "7",
		10,
	);
	const requiredReports = parseRequiredReports(values.matrix);

	if (
		!Number.isInteger(releaseWindowDays) ||
		Number.isNaN(releaseWindowDays) ||
		releaseWindowDays < 0
	) {
		throw new Error(
			`Invalid release window: ${values["release-window-days"] ?? "7"}. Expected a non-negative integer.`,
		);
	}

	const allDatedDirectories = await collectEvidenceDirectories(
		evidenceRoot,
		referenceDate,
	);
	const eligibleDirectories = allDatedDirectories.filter(
		(directory) =>
			directory.ageInDays >= 0 && directory.ageInDays <= releaseWindowDays,
	);

	if (eligibleDirectories.length === 0) {
		const freshestDirectory = allDatedDirectories[0];
		throw new Error(
			freshestDirectory
				? `No gorilla evidence directory found within ${releaseWindowDays} days of ${referenceDate.toISOString().slice(0, 10)}. Latest committed directory: ${freshestDirectory.name}.`
				: `No gorilla evidence directory found in ${evidenceRoot}.`,
		);
	}

	const selectedDirectory = eligibleDirectories[0];
	const files = await readdir(selectedDirectory.path, { withFileTypes: true });
	const evidenceFiles = files
		.filter((entry) => entry.isFile() && EVIDENCE_FILE_PATTERN.test(entry.name))
		.map((entry) => join(selectedDirectory.path, entry.name))
		.sort((left, right) => left.localeCompare(right));

	if (evidenceFiles.length === 0) {
		throw new Error(
			`Gorilla evidence directory ${selectedDirectory.name} is missing canonical <provider>-<scenario>.md reports.`,
		);
	}

	const evidenceFileNames = new Set(
		evidenceFiles.map(
			(filePath) => filePath.split(/[\\/]/u).at(-1) ?? filePath,
		),
	);
	const missingReports = requiredReports.filter(
		(report) => !evidenceFileNames.has(report),
	);
	if (missingReports.length > 0) {
		throw new Error(
			`Gorilla evidence directory ${selectedDirectory.name} is missing required release report(s): ${missingReports.join(", ")}. Required matrix: ${requiredReports.join(", ")}.`,
		);
	}

	for (const filePath of evidenceFiles) {
		const unexpectedBehaviors = readUnexpectedBehaviors(
			await readFile(filePath, "utf8"),
			filePath,
		);

		if (!CLEAN_FINDING_VALUES.has(unexpectedBehaviors)) {
			throw new Error(
				`Gorilla evidence file ${filePath} reports unresolved findings: ${unexpectedBehaviors}.`,
			);
		}
	}

	console.log(
		`Release gorilla evidence is fresh in ${selectedDirectory.name} with required matrix ${requiredReports.join(", ")} and ${evidenceFiles.length} clean report(s).`,
	);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
