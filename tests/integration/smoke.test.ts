import { describe, expect, test } from "vitest";

import {
	assertExecutableOnPath,
	assertProviderAuthAvailable,
	assertPersistedEnvelope,
	envelopeFailureSummary,
	runSmoke,
	sdkEnvelopeSchemas,
} from "./helpers";

const providers = ["claude-code", "codex", "copilot"] as const;

describe("real-provider smoke coverage", () => {
	for (const provider of providers) {
		test(`TC-5.1a/TC-5.4b/TC-5.4c: ${provider} package operation returns a valid envelope and artifact without auth skips or fallback paths`, async () => {
			await assertExecutableOnPath(provider);
			const { envelope } = await runSmoke(provider);
			assertProviderAuthAvailable(provider, envelope);

			expect(envelope.command).toBe("story-implement");
			expect(envelope.status, envelopeFailureSummary(envelope)).toBe("ok");
			expect(envelope.outcome).toBe("ready-for-verification");
			expect(envelope.result?.continuation.sessionId).toEqual(
				expect.any(String),
			);
			expect(envelope.artifacts[0]?.path).toEqual(expect.any(String));
			const persisted =
				await assertPersistedEnvelope<typeof envelope>(envelope);
			expect(sdkEnvelopeSchemas.implementor.parse(persisted)).toEqual(envelope);
		}, 240_000);
	}
});
