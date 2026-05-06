import { describe, expect, test } from "vitest";

import { getEmbeddedPromptAssets } from "../../../src/core/prompt-assets";

describe("prompt asset content contracts", () => {
	test("TC-3.1a story implementor prompt contains role, artifact reading order, self-review rules, and result placeholders", () => {
		const assets = getEmbeddedPromptAssets();
		const prompt = assets.base["story-implementor"];

		expect(prompt).toContain("Role Stance");
		expect(prompt).toContain("Artifact Reading Order");
		expect(prompt).toContain("Self-Review");
		expect(prompt).toContain("{{RESULT_CONTRACT_NAME}}");
		expect(prompt).toContain("{{RESULT_CONTRACT_SCHEMA}}");
	});

	test("TC-3.1a story implementor prompt excludes CLAUDE.md, prior story files, and team-impl-log.md from the reading contract", () => {
		const assets = getEmbeddedPromptAssets();
		const prompt = assets.base["story-implementor"];

		expect(prompt).not.toContain("CLAUDE.md");
		expect(prompt).not.toContain("prior story files");
		expect(prompt).not.toContain("team-impl-log.md");
	});

	test("TC-3.1b story verifier prompt contains evidence rules, severity guidance, AC/TC checks, and routing placeholders", () => {
		const assets = getEmbeddedPromptAssets();
		const prompt = assets.base["story-verifier"];

		expect(prompt).toContain("Evidence Rules");
		expect(prompt).toContain("Severity");
		expect(prompt).toContain("AC / TC Coverage");
		expect(prompt).toContain("Follow-Up Convergence");
		expect(prompt).toContain("{{PRIOR_OPEN_FINDINGS}}");
		expect(prompt).toContain("{{FOLLOWUP_RESPONSE}}");
		expect(prompt).toContain("{{ORCHESTRATOR_CONTEXT}}");
		expect(prompt).toContain("{{ROUTING_GUIDANCE}}");
		expect(prompt).toContain("{{RESULT_CONTRACT_SCHEMA}}");
	});

	test("TC-3.4c quick-fix prompt stays free of story-aware structured contract requirements", () => {
		const assets = getEmbeddedPromptAssets();
		const prompt = assets.base["quick-fixer"];

		expect(prompt).toContain("{{FOLLOWUP_REQUEST}}");
		expect(prompt).not.toContain("{{RESULT_CONTRACT_NAME}}");
		expect(prompt).not.toContain("Return exactly one JSON object");
		expect(prompt).not.toContain("story-id");
		expect(prompt).not.toContain("reading journey");
	});

	test("TC-3.4c no embedded base prompt references team-impl-log.md", () => {
		const assets = getEmbeddedPromptAssets();

		for (const prompt of Object.values(assets.base)) {
			expect(prompt).not.toContain("team-impl-log.md");
		}
	});

	test("story lead prompt assets define the role charter, durable-state summary, action protocol, acceptance rubric, and ruling boundaries", () => {
		const assets = getEmbeddedPromptAssets();
		const prompt = assets.base["story-lead"];

		expect(prompt).toContain("Role Charter");
		expect(prompt).toContain("Authority Boundary");
		expect(prompt).toContain("Durable State Summary");
		expect(prompt).toContain("{{DURABLE_STATE_SUMMARY}}");
		expect(assets.snippets["story-lead-action-protocol"]).toContain(
			"Valid action shapes",
		);
		expect(assets.snippets["story-lead-acceptance-rubric"]).toContain(
			"Acceptance Rubric",
		);
		expect(assets.snippets["story-lead-ruling-boundaries"]).toContain(
			"Ruling Boundaries",
		);
	});

	test("TC-8.1c epic reviewer prompt contains cross-story and production-path audit expectations", () => {
		const assets = getEmbeddedPromptAssets();
		const prompt = assets.base["epic-reviewer"];

		expect(prompt).toContain("Cross-Story Checks");
		expect(prompt).toContain("Architecture Consistency");
		expect(prompt).toContain("whole codebase");
		expect(prompt).toContain("Production Path Audit");
	});

	test("TC-8.3a epic reverifier prompt distinguishes confirmed issues from disputed or unconfirmed issues", () => {
		const assets = getEmbeddedPromptAssets();
		const prompt = assets.base["epic-reverifier"];

		expect(prompt).toContain("Confirmed Issues");
		expect(prompt).toContain("Disputed or Unconfirmed Issues");
		expect(prompt).toContain("independently verify");
		expect(prompt).toContain("codebase");
		expect(prompt).toContain("{{RESULT_CONTRACT_NAME}}");
		expect(prompt).toContain("{{RESULT_CONTRACT_SCHEMA}}");
	});

	test("story implementor prompt exposes the provider payload schema placeholder", () => {
		const assets = getEmbeddedPromptAssets();
		const prompt = assets.base["story-implementor"];

		expect(prompt).toContain("{{RESULT_CONTRACT_SCHEMA}}");
	});

	test("story verifier prompt exposes the provider payload schema placeholder", () => {
		const assets = getEmbeddedPromptAssets();
		const prompt = assets.base["story-verifier"];

		expect(prompt).toContain("{{RESULT_CONTRACT_SCHEMA}}");
	});

	test("self-review snippets stay story-scoped while checking handoff obligations and production-path gaps", () => {
		const assets = getEmbeddedPromptAssets();

		expect(assets.snippets["self-review-pass-2"]).toContain(
			"provided story, tech-design, and test-plan handoff",
		);
		expect(assets.snippets["self-review-pass-3"]).toContain(
			"production-path gap, placeholder, or handoff obligation gap",
		);
	});
});
