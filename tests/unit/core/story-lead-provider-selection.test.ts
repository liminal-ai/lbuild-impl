import { describe, expect, test } from "vitest";
import { runStoryLead } from "../../../src/core/story-lead";
import { createStoryRunLedger } from "../../../src/core/story-run-ledger";
import {
	createStoryOrchestrateSpecPack,
	seedPrimitiveArtifact,
} from "../../support/story-orchestrate-fixtures";
import {
	createTempDir,
	createRunConfig,
	readJsonLines,
	writeFakeProviderExecutable,
	writeRunConfig,
} from "../../support/test-helpers";

function codexJsonlEventStream(sessionId: string, finalText: string): string {
	return [
		JSON.stringify({
			type: "thread.started",
			thread_id: sessionId,
		}),
		JSON.stringify({
			type: "item.completed",
			item: {
				id: "item_1",
				type: "agent_message",
				text: finalText,
			},
		}),
		JSON.stringify({
			type: "turn.completed",
		}),
	].join("\n");
}

describe("story-lead provider selection", () => {
	test("TC-2.1a, TC-2.1b, TC-2.9a, and TC-2.9b launch the configured Codex story-lead provider without persisting planner session state", async () => {
		const { specPackRoot, storyId } = await createStoryOrchestrateSpecPack(
			"story-lead-provider-selection",
			{
				includeStoryLead: true,
			},
		);
		await writeRunConfig(
			specPackRoot,
			createRunConfig({
				story_lead_provider: {
					secondary_harness: "codex",
					model: "gpt-5.4",
					reasoning_effort: "high",
				},
			}),
		);
		await seedPrimitiveArtifact({
			specPackRoot,
			storyId,
			fileName: "001-implementor.json",
			payload: {
				command: "story-implement",
				outcome: "ready-for-verification",
			},
		});
		await seedPrimitiveArtifact({
			specPackRoot,
			storyId,
			fileName: "002-verifier.json",
			payload: {
				command: "story-verify",
				outcome: "pass",
			},
		});

		const providerBinDir = await createTempDir(
			"story-lead-provider-selection-bin",
		);
		const sessionId = "codex-story-lead-session-001";
		const { env, logPath } = await writeFakeProviderExecutable({
			binDir: providerBinDir,
			provider: "codex",
			responses: [
				{
					stdout: codexJsonlEventStream(
						sessionId,
						JSON.stringify({
							action: "accept-story",
							rationale:
								"Configured Codex story-lead provider accepted the preseeded primitive evidence for provider-selection coverage.",
							inputs: {
								summary:
									"Configured Codex story-lead provider accepted the preseeded primitive evidence for provider-selection coverage.",
								acceptanceCheckRefs: ["configured-provider-session"],
								acceptanceChecks: [
									{
										name: "configured-provider-session",
										status: "pass",
										evidence: [
											`${specPackRoot}/artifacts/${storyId}/001-implementor.json`,
											`${specPackRoot}/artifacts/${storyId}/002-verifier.json`,
										],
										reasoning:
											"The configured Codex story-lead provider produced a valid bounded action.",
									},
								],
								recommendedImplLeadAction: "accept",
							},
						}),
					),
					lastMessage: JSON.stringify({
						action: "accept-story",
						rationale:
							"Configured Codex story-lead provider accepted the preseeded primitive evidence for provider-selection coverage.",
						inputs: {
							summary:
								"Configured Codex story-lead provider accepted the preseeded primitive evidence for provider-selection coverage.",
							acceptanceCheckRefs: ["configured-provider-session"],
							acceptanceChecks: [
								{
									name: "configured-provider-session",
									status: "pass",
									evidence: [
										`${specPackRoot}/artifacts/${storyId}/001-implementor.json`,
										`${specPackRoot}/artifacts/${storyId}/002-verifier.json`,
									],
									reasoning:
										"The configured Codex story-lead provider produced a valid bounded action.",
								},
							],
							recommendedImplLeadAction: "accept",
						},
					}),
				},
			],
		});

		const ledger = createStoryRunLedger({
			specPackRoot,
			storyId,
		});
		const runtime = await runStoryLead({
			specPackRoot,
			storyId,
			ledger,
			mode: "run",
			env: {
				PATH: `${providerBinDir}:${process.env.PATH ?? ""}`,
				...env,
			},
			startedFromPrimitiveArtifacts: [
				`${specPackRoot}/artifacts/${storyId}/001-implementor.json`,
				`${specPackRoot}/artifacts/${storyId}/002-verifier.json`,
			],
		});

		if (runtime.case !== "completed") {
			throw new Error(
				"Expected the configured story-lead provider run to complete.",
			);
		}

		const attempt = await ledger.getAttemptByStoryRunId(runtime.storyRunId);
		const invocations = await readJsonLines<{
			args: string[];
			cwd: string;
			provider: string;
		}>(logPath);
		const events = await readJsonLines<
			Array<{
				type: string;
				summary: string;
				data?: Record<string, unknown>;
			}>[number]
		>(runtime.eventHistoryPath);

		expect(attempt?.currentSnapshot).not.toHaveProperty("storyLeadSession");
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "story-lead-provider-started",
					summary:
						"Fresh story-lead provider turn executed without planner session resume.",
					data: expect.objectContaining({
						provider: "codex",
						model: "gpt-5.4",
						sessionId,
					}),
				}),
				expect.objectContaining({
					type: "story-lead-action-selected",
					summary: "Story-lead selected accept-story.",
					data: expect.objectContaining({
						actionType: "accept-story",
					}),
				}),
			]),
		);
		expect(invocations).toHaveLength(1);
		expect(invocations[0]?.provider).toBe("codex");
		expect(invocations[0]?.args).not.toContain("resume");
		expect(invocations[0]?.args.join(" ")).not.toContain("--resume");
		expect(invocations[0]?.args.slice(0, 6)).toEqual([
			"-s",
			"danger-full-access",
			"exec",
			"--json",
			"-m",
			"gpt-5.4",
		]);
		expect(invocations[0]?.args).toContain("model_reasoning_effort=high");
		expect(invocations[0]?.args).not.toContain("--output-schema");
		expect(invocations[0]?.args).toContain("-o");
		expect(invocations[0]?.args.join(" ")).toContain(
			`You are the story lead for \`${storyId}\``,
		);
		expect(invocations[0]?.args.join(" ")).toContain(
			"# Story Lead Base Prompt",
		);
		expect(invocations[0]?.args.join(" ")).toContain("## Action Protocol");
		expect(invocations[0]?.args.join(" ")).toContain("## Acceptance Rubric");
		expect(invocations[0]?.args.join(" ")).toContain("## Ruling Boundaries");
	});
});
