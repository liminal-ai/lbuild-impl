import { describe, expect, test } from "vitest";

import {
	assertExecutableOnPath,
	assertProviderAuthAvailable,
	assertPersistedEnvelope,
	envelopeFailureSummary,
	runInspectStructuredOperation,
	runStructuredOutput,
	sdkEnvelopeSchemas,
} from "./helpers";

const providers = ["claude-code", "codex"] as const;

describe("real-provider structured-output coverage", () => {
	for (const provider of providers) {
		test(`TC-5.1c/TC-5.4c: ${provider} package operation forwards parsed structured output into the SDK envelope without fallback shims`, async () => {
			await assertExecutableOnPath(provider);
			const { envelope } = await runStructuredOutput(provider);
			assertProviderAuthAvailable(provider, envelope);

			expect(envelope.status, envelopeFailureSummary(envelope)).toBe("ok");
			const parsedEnvelope = sdkEnvelopeSchemas.implementor.parse(envelope);
			expect(parsedEnvelope.result).toEqual(envelope.result);
			expect(parsedEnvelope.result?.outcome).toBe("ready-for-verification");
			expect(parsedEnvelope.result?.continuation.sessionId).toEqual(
				expect.any(String),
			);
			const persisted =
				await assertPersistedEnvelope<typeof envelope>(envelope);
			expect(sdkEnvelopeSchemas.implementor.parse(persisted).result).toEqual(
				envelope.result,
			);
		}, 240_000);
	}

	test("TC-5.1c: inspect structured output parses through the canonical SDK envelope schema", async () => {
		await assertExecutableOnPath("codex");
		const { envelope } = await runInspectStructuredOperation("codex");
		expect(envelope.command).toBe("inspect");
		expect(envelope.status).toBe("ok");
		expect(envelope.result?.status).toBe("ready");
		const persisted = await assertPersistedEnvelope<typeof envelope>(envelope);
		expect(sdkEnvelopeSchemas.inspect.parse(persisted)).toEqual(envelope);
	});
});
