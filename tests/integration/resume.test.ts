import { describe, expect, test } from "vitest";

import {
	assertExecutableOnPath,
	assertIntegrationPrerequisites,
	assertProviderAuthAvailable,
	assertPersistedEnvelope,
	envelopeFailureSummary,
	runResume,
	sdkEnvelopeSchemas,
} from "./helpers";

assertIntegrationPrerequisites();
const providers = ["claude-code", "codex", "copilot"] as const;

describe("real-provider resume coverage", () => {
	for (const provider of providers) {
		test(`TC-5.1b/TC-5.4b: ${provider} package continuation reuses the session handle without auth skip behavior`, async () => {
			await assertExecutableOnPath(provider);
			const { initial, resumed } = await runResume(provider);
			assertProviderAuthAvailable(provider, initial);

			expect(initial.status, envelopeFailureSummary(initial)).toBe("ok");
			expect(initial.result?.continuation.sessionId).toEqual(
				expect.any(String),
			);
			expect(resumed).toBeDefined();
			if (!resumed) {
				throw new Error(
					"Expected resume operation to execute after initial run.",
				);
			}
			assertProviderAuthAvailable(provider, resumed);
			expect(resumed.command).toBe("story-continue");
			expect(resumed.status, envelopeFailureSummary(resumed)).toBe("ok");
			expect(resumed.result?.continuation.sessionId).toBe(
				initial.result?.continuation.sessionId,
			);
			expect(resumed.result?.sessionId).toBe(
				initial.result?.continuation.sessionId,
			);
			const persisted = await assertPersistedEnvelope<typeof resumed>(resumed);
			expect(sdkEnvelopeSchemas.implementor.parse(persisted)).toEqual(resumed);
		}, 360_000);
	}
});
