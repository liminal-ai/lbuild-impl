import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ROOT } from "../../support/test-helpers";

describe("schema derivation", () => {
	test("TC-4.3a: provider payload schemas derive from canonical contracts", async () => {
		const implementorSource = await readFile(
			join(ROOT, "src/core/story-implementor.ts"),
			"utf8",
		);
		const verifierSource = await readFile(
			join(ROOT, "src/core/story-verifier.ts"),
			"utf8",
		);
		const fixSource = await readFile(
			join(ROOT, "src/core/epic-fix.ts"),
			"utf8",
		);
		const reverifySource = await readFile(
			join(ROOT, "src/core/epic-reverifier.ts"),
			"utf8",
		);
		const epicVerifierSource = await readFile(
			join(ROOT, "src/core/epic-reviewer.ts"),
			"utf8",
		);

		expect(implementorSource).toContain("implementorResultSchema.shape");
		expect(implementorSource).toContain("implementorResultBaseSchema");
		expect(verifierSource).toContain("storyVerifierResultSchema.shape");
		expect(verifierSource).toContain("storyVerifierResultBaseSchema");
		expect(fixSource).toContain("epicFixProviderPayloadSchema");
		expect(fixSource).toContain("buildFixResult");
		expect(reverifySource).toContain("epicReverifyProviderPayloadSchema");
		expect(reverifySource).toContain("buildReverifyResult");
		expect(epicVerifierSource).toContain("epicVerifierResultSchema");
	});

	test("TC-4.3b: quick-fix consumes the canonical result contract instead of a workflow-local payload", async () => {
		const operationsSource = await readFile(
			join(ROOT, "src/sdk/contracts/operations.ts"),
			"utf8",
		);
		const quickFixSource = await readFile(
			join(ROOT, "src/core/quick-fix.ts"),
			"utf8",
		);
		const resultContractsSource = await readFile(
			join(ROOT, "src/core/result-contracts.ts"),
			"utf8",
		);

		expect(resultContractsSource).toContain(
			"export const quickFixResultSchema",
		);
		expect(operationsSource).toContain(
			"type QuickFixResult as CoreQuickFixPayload",
		);
		expect(quickFixSource).not.toContain("interface QuickFixResultPayload");
	});
});
