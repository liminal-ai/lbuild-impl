import { join, resolve } from "node:path";
import { InvalidSpecPackError } from "../sdk/errors/classes.js";
import { pathExists } from "./fs-utils.js";
import { readdirDirents, stat } from "./runtime-deps.js";
import {
	type StoryRunSelection,
	storyRunSelectionSchema,
} from "./story-orchestrate-contracts.js";
import { resolveStoryOrder } from "./story-order.js";
import { createStoryRunLedger } from "./story-run-ledger.js";

async function listPrimitiveArtifacts(
	specPackRoot: string,
	storyId: string,
): Promise<string[]> {
	const storyArtifactDir = join(resolve(specPackRoot), "artifacts", storyId);
	if (!(await pathExists(storyArtifactDir))) {
		return [];
	}

	const entries = await readdirDirents(storyArtifactDir);
	const candidatePaths = entries
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.endsWith(".json") &&
				!entry.name.includes("story-orchestrate") &&
				!entry.name.endsWith("-current.json") &&
				!entry.name.endsWith("-final-package.json"),
		)
		.map((entry) => join(storyArtifactDir, entry.name))
		.sort((left, right) => left.localeCompare(right));

	const durablePaths: string[] = [];
	for (const path of candidatePaths) {
		try {
			const fileStat = await stat(path);
			if (fileStat.size > 0) {
				durablePaths.push(path);
			}
		} catch {
			continue;
		}
	}

	return durablePaths;
}

export async function discoverStoryRunState(input: {
	specPackRoot: string;
	storyId: string;
	storyRunId?: string;
}): Promise<StoryRunSelection> {
	const resolvedRoot = resolve(input.specPackRoot);
	const storiesDir = join(resolvedRoot, "stories");

	if (!(await pathExists(storiesDir))) {
		throw new InvalidSpecPackError(
			`Story inventory is unavailable because stories/ is missing under ${resolvedRoot}.`,
		);
	}

	const storyOrder = await resolveStoryOrder(storiesDir);
	const storyExists = storyOrder.stories.some(
		(candidate) => candidate.id === input.storyId,
	);

	if (!storyExists) {
		return storyRunSelectionSchema.parse({
			case: "invalid-story-id",
			storyId: input.storyId,
		});
	}
	const ledger = createStoryRunLedger({
		specPackRoot: resolvedRoot,
		storyId: input.storyId,
	});
	const attempts = await ledger.listAttempts();
	const explicitAttempt = input.storyRunId
		? (attempts.find((attempt) => attempt.storyRunId === input.storyRunId) ??
			null)
		: null;
	if (input.storyRunId && explicitAttempt === null) {
		return storyRunSelectionSchema.parse({
			case: "invalid-story-run-id",
			storyId: input.storyId,
			storyRunId: input.storyRunId,
		});
	}
	const candidatePool = explicitAttempt ? [explicitAttempt] : attempts;

	if (candidatePool.length === 0) {
		const primitiveArtifacts = await listPrimitiveArtifacts(
			resolvedRoot,
			input.storyId,
		);
		if (primitiveArtifacts.length > 0) {
			return storyRunSelectionSchema.parse({
				case: "start-from-primitive-artifacts",
				sourceArtifactPaths: primitiveArtifacts,
			});
		}

		return storyRunSelectionSchema.parse({
			case: "start-new",
		});
	}

	const acceptedAttempts = candidatePool.filter(
		(attempt) =>
			attempt.currentSnapshot.status === "accepted" && attempt.finalPackage,
	);
	const activeAttempts = candidatePool.filter(
		(attempt) => attempt.currentSnapshot.status === "running",
	);
	const resumableAttempts = candidatePool.filter(
		(attempt) =>
			attempt.currentSnapshot.status !== "running" &&
			!(attempt.currentSnapshot.status === "accepted" && attempt.finalPackage),
	);

	if (
		acceptedAttempts.length === 1 &&
		activeAttempts.length === 0 &&
		resumableAttempts.length === 0
	) {
		const [acceptedAttempt] = acceptedAttempts;
		return storyRunSelectionSchema.parse({
			case: "existing-accepted-attempt",
			storyRunId: acceptedAttempt.storyRunId,
			finalPackagePath: acceptedAttempt.finalPackagePath,
		});
	}

	if (activeAttempts.length === 1 && resumableAttempts.length === 0) {
		const [activeAttempt] = activeAttempts;
		return storyRunSelectionSchema.parse({
			case: "active-attempt-exists",
			storyRunId: activeAttempt.storyRunId,
			currentSnapshotPath: activeAttempt.currentSnapshotPath,
		});
	}

	if (resumableAttempts.length === 1 && activeAttempts.length === 0) {
		const [resumableAttempt] = resumableAttempts;
		return storyRunSelectionSchema.parse({
			case: "resume-required",
			storyRunId: resumableAttempt.storyRunId,
			currentSnapshotPath: resumableAttempt.currentSnapshotPath,
		});
	}

	return storyRunSelectionSchema.parse({
		case: "ambiguous-story-run",
		candidates: candidatePool
			.sort(
				(left, right) =>
					right.currentSnapshot.updatedAt.localeCompare(
						left.currentSnapshot.updatedAt,
					) || left.storyRunId.localeCompare(right.storyRunId),
			)
			.map((attempt) => ({
				storyRunId: attempt.storyRunId,
				status: attempt.currentSnapshot.status,
				updatedAt: attempt.currentSnapshot.updatedAt,
				currentSnapshotPath: attempt.currentSnapshotPath,
				...(attempt.finalPackage
					? { finalPackagePath: attempt.finalPackagePath }
					: {}),
			})),
	});
}
