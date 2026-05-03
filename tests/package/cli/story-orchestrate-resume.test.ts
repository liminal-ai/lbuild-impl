import { describe, expect, test } from "vitest";

import { createStoryRunLedger } from "../../../src/core/story-run-ledger";
import { parseJsonOutput, runSourceCli } from "../../support/test-helpers";
import {
	createStoryOrchestrateSpecPack,
	seedStoryRunAttempt,
} from "../../support/story-orchestrate-fixtures";
import {
	createTempDir,
	writeFakeProviderExecutable,
	writeTextFile,
} from "../../support/test-helpers";

function providerWrapper(sessionId: string, payload: unknown): string {
	return JSON.stringify({
		sessionId,
		result: payload,
	});
}

describe("story-orchestrate resume CLI", () => {
	test("TC-2.6a accepts a valid review request file and reopens an accepted attempt as a new story-run", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-resume-review-request",
			{
				includeStoryLead: true,
			},
		);
		const providerBinDir = await createTempDir(
			"story-orchestrate-resume-review-request-bin",
		);
		const storyLead = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: providerWrapper(
						"codex-story-orchestrate-resume-review-request-001",
						{
							action: "block-story",
							rationale:
								"Keep the reopened attempt blocked while the requested handoff pass is still outstanding.",
							inputs: {
								reason: "Please reopen this story for one more handoff pass.",
								evidence: ["review-001"],
							},
						},
					),
				},
			],
		});
		const acceptedAttempt = await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "accepted",
			finalPackageOutcome: "accepted",
		});
		for (const artifactPath of [
			`/tmp/spec-pack/artifacts/${storyId}/001-implementor.json`,
			`/tmp/spec-pack/artifacts/${storyId}/002-verifier.json`,
		]) {
			await writeTextFile(
				artifactPath,
				`${JSON.stringify({ ok: true }, null, 2)}\n`,
			);
		}
		const reviewRequestPath = `${specPackRoot}/review-request.json`;
		await writeTextFile(
			reviewRequestPath,
			`${JSON.stringify(
				{
					source: "impl-lead",
					decision: "reopen",
					summary: "Please reopen this story for one more handoff pass.",
					items: [
						{
							id: "review-001",
							severity: "major",
							concern: "Receipt notes are missing.",
							requiredResponse: "Add the missing receipt notes.",
						},
					],
				},
				null,
				2,
			)}\n`,
		);

		const run = await runSourceCli(
			[
				"story-orchestrate",
				"resume",
				"--spec-pack-root",
				specPackRoot,
				"--story-id",
				storyId,
				"--story-run-id",
				acceptedAttempt.storyRunId,
				"--review-request-file",
				reviewRequestPath,
				"--json",
			],
			{
				env: {
					PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
					...storyLead.env,
				},
			},
		);
		const envelope = parseJsonOutput<{
			outcome: string;
			result: {
				case: string;
				storyRunId: string;
				acceptedReviewRequestArtifact?: {
					kind: string;
					path: string;
					provenance?: string;
				};
				finalPackage: {
					callerInputHistory: {
						reviewRequests: Array<{ summary: string }>;
					};
				};
			};
		}>(run.stdout);

		expect(run.exitCode).toBe(3);
		expect(envelope.outcome).toBe("blocked");
		expect(envelope.result.case).toBe("completed");
		expect(envelope.result.storyRunId).not.toBe(acceptedAttempt.storyRunId);
		expect(envelope.result.acceptedReviewRequestArtifact).toEqual({
			kind: "review-request",
			path: expect.stringContaining("review-request-001.json"),
			provenance: "caller-input",
		});
		expect(
			envelope.result.finalPackage.callerInputHistory.reviewRequests[0]
				?.summary,
		).toBe("Please reopen this story for one more handoff pass.");
	});

	test("TC-2.6c rejects an invalid review request file without mutating story-run state", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-resume-invalid-review-request",
		);
		await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "accepted",
			finalPackageOutcome: "accepted",
		});
		const reviewRequestPath = `${specPackRoot}/invalid-review-request.json`;
		await writeTextFile(
			reviewRequestPath,
			`${JSON.stringify(
				{
					source: "impl-lead",
					summary: "Missing required fields on purpose.",
				},
				null,
				2,
			)}\n`,
		);

		const run = await runSourceCli([
			"story-orchestrate",
			"resume",
			"--spec-pack-root",
			specPackRoot,
			"--story-id",
			storyId,
			"--review-request-file",
			reviewRequestPath,
			"--json",
		]);
		const envelope = parseJsonOutput<{
			outcome: string;
			result: {
				case: string;
				storyId: string;
			};
		}>(run.stdout);
		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});

		expect(run.exitCode).toBe(1);
		expect(envelope.outcome).toBe("invalid-review-request");
		expect(envelope.result.case).toBe("invalid-review-request");
		expect(
			(await ledger.listAttempts()).map((attempt) => attempt.storyRunId),
		).toHaveLength(1);
	});

	test("returns invalid-story-run-id instead of selecting another attempt when an explicit storyRunId is unknown", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-orchestrate-resume-invalid-run-id",
		);
		await seedStoryRunAttempt({
			specPackRoot,
			storyId,
			status: "interrupted",
			finalPackageOutcome: "interrupted",
		});

		const run = await runSourceCli([
			"story-orchestrate",
			"resume",
			"--spec-pack-root",
			specPackRoot,
			"--story-id",
			storyId,
			"--story-run-id",
			"00-foundation-story-run-999",
			"--json",
		]);
		const envelope = parseJsonOutput<{
			outcome: string;
			result: {
				case: string;
				storyId: string;
				storyRunId: string;
			};
		}>(run.stdout);

		expect(run.exitCode).toBe(1);
		expect(envelope.outcome).toBe("invalid-story-run-id");
		expect(envelope.result).toEqual({
			case: "invalid-story-run-id",
			storyId,
			storyRunId: "00-foundation-story-run-999",
		});
	});
});
