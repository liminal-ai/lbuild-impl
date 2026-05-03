import { describe, expect, test } from "vitest";

import {
	assertExecutableOnPath,
	assertProviderAuthAvailable,
	runRealProviderStall,
} from "./helpers";

const providers = ["claude-code", "codex"] as const;

describe("provider stall coverage", () => {
	for (const provider of providers) {
		test(`TC-5.1d/TC-5.4c: ${provider} real provider stall returns a blocked envelope instead of a partial fallback`, async () => {
			await assertExecutableOnPath(provider);
			const { envelope, stallProxyUrl } = await runRealProviderStall(provider);
			assertProviderAuthAvailable(provider, envelope);

			expect(envelope.command).toBe("story-implement");
			expect(envelope.status).toBe("blocked");
			expect(["PROVIDER_STALLED", "PROVIDER_TIMEOUT"]).toContain(
				envelope.errors[0]?.code,
			);
			expect(envelope.errors[0]?.message).toMatch(/stalled|timed out/i);
			expect(stallProxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		}, 120_000);
	}
});
