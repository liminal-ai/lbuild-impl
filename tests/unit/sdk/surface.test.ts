import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import * as sdk from "../../../src/sdk/index";
import { ROOT } from "../../support/test-helpers";

const sdkExports = sdk as Record<string, unknown>;

const EXPECTED_RUNTIME_EXPORTS = [
	"AtomicWriteError",
	"attachedProgressEventSchema",
	"ConfigLoadError",
	"ContinuationHandleInvalidError",
	"ImplCliError",
	"IndexReservationError",
	"InternalError",
	"InvalidInputError",
	"InvalidRunConfigError",
	"InvalidSpecPackError",
	"PromptInsertError",
	"PromptInsertInvalidError",
	"ProviderOutputInvalidError",
	"ProviderStalledError",
	"ProviderTimeoutError",
	"ProviderUnavailableError",
	"VerificationGateUnresolvedError",
	"cliArtifactRefSchema",
	"cliErrorSchema",
	"cliResultEnvelopeSchema",
	"cliStatusSchema",
	"callerHarnessSchema",
	"continuationHandleSchema",
	"callerRulingRequestSchema",
	"callerRulingResponseSchema",
	"epicFix",
	"epicFixInputSchema",
	"epicFixResultSchema",
	"epicReverifyResultSchema",
	"epicReverify",
	"epicVerifierBatchResultSchema",
	"epicReview",
	"epicReverifyInputSchema",
	"epicReviewInputSchema",
	"implLeadReviewRequestSchema",
	"implementorResultSchema",
	"inspect",
	"inspectInputSchema",
	"inspectResultSchema",
	"loadSkill",
	"preflight",
	"preflightInputSchema",
	"preflightResultSchema",
	"providerIdSchema",
	"quickFix",
	"quickFixInputSchema",
	"quickFixResultSchema",
	"readSkillChunk",
	"storyLeadFinalPackageSchema",
	"storyContinue",
	"storyContinueInputSchema",
	"storyImplement",
	"storyImplementInputSchema",
	"storyOrchestrateResumeInputSchema",
	"storyOrchestrateResumeResultSchema",
	"storyOrchestrateResume",
	"storyOrchestrateRunInputSchema",
	"storyOrchestrateRunResultSchema",
	"storyOrchestrateRun",
	"storyOrchestrateStatusInputSchema",
	"storyOrchestrateStatusResultSchema",
	"storyOrchestrateStatus",
	"storyOrchestrateValidateInputSchema",
	"storyOrchestrateValidateResultSchema",
	"storyOrchestrateValidate",
	"storySelfReview",
	"storySelfReviewInputSchema",
	"storySelfReviewResultSchema",
	"storyRunCurrentSnapshotSchema",
	"storyVerifierResultSchema",
	"storyVerify",
	"storyVerifyInputSchema",
	"version",
] as const;

const COMMAND_TO_FUNCTION = {
	"epic-fix": "epicFix",
	"epic-reverify": "epicReverify",
	"epic-review": "epicReview",
	inspect: "inspect",
	preflight: "preflight",
	"quick-fix": "quickFix",
	skill: "loadSkill",
	"story-continue": "storyContinue",
	"story-implement": "storyImplement",
	"story-orchestrate": "storyOrchestrateRun",
	"story-self-review": "storySelfReview",
	"story-verify": "storyVerify",
} as const;

describe("sdk surface", () => {
	test("TC-2.1a every CLI command has a corresponding SDK function", async () => {
		const binSource = await readFile(
			join(ROOT, "src/bin/lbuild-impl.ts"),
			"utf8",
		);
		const commandNames = [
			...binSource.matchAll(/^\s*(?:"([^"]+)"|([a-z-]+)):\s+\w+Command,?$/gm),
		]
			.map((match) => match[1] ?? match[2] ?? "")
			.filter(Boolean);

		expect(commandNames.sort()).toEqual(
			Object.keys(COMMAND_TO_FUNCTION).sort(),
		);

		for (const commandName of commandNames) {
			const functionName =
				COMMAND_TO_FUNCTION[commandName as keyof typeof COMMAND_TO_FUNCTION];
			expect(typeof sdkExports[functionName]).toBe("function");
		}
	});

	test("TC-2.2a public exports are explicit and enumerated from the SDK index", async () => {
		const indexSource = await readFile(join(ROOT, "src/sdk/index.ts"), "utf8");

		expect(indexSource).not.toContain("../core/");
		expect(Object.keys(sdk).sort()).toEqual(
			[...EXPECTED_RUNTIME_EXPORTS].sort(),
		);
	});

	test("TC-2.2b package exports declare distinct SDK subpaths", async () => {
		const packageJson = JSON.parse(
			await readFile(join(ROOT, "package.json"), "utf8"),
		) as {
			exports?: Record<string, unknown>;
			bin?: Record<string, string>;
		};

		expect(packageJson.exports).toMatchObject({
			".": expect.any(Object),
			"./sdk": expect.any(Object),
			"./sdk/contracts": expect.any(Object),
			"./sdk/errors": expect.any(Object),
		});
		expect(packageJson.bin).toEqual({
			"lbuild-impl": "dist/bin/lbuild-impl.js",
		});
	});

	test("TC-2.3a public SDK type declarations avoid any and unknown in operation signatures", async () => {
		const sourceFiles = [
			join(ROOT, "src/sdk/index.ts"),
			join(ROOT, "src/sdk/contracts/envelope.ts"),
			join(ROOT, "src/sdk/contracts/operations.ts"),
		];

		for (const filePath of sourceFiles) {
			const source = await readFile(filePath, "utf8");
			const publicTypeSection = source.includes(
				"const continuationHandleInputSchema",
			)
				? (source.split("const continuationHandleInputSchema")[0] ?? source)
				: source;
			expect(publicTypeSection).not.toMatch(/\bany\b/);
			expect(publicTypeSection).not.toMatch(/\bunknown\b/);
		}
	});
});
