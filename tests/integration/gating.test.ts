import { describe, expect, test } from "vitest";

import {
	assertExecutableOnPath,
	assertIntegrationPrerequisites,
} from "./helpers";

assertIntegrationPrerequisites();
const providers = ["claude-code", "codex", "copilot"] as const;

describe("integration gating", () => {
	test("TC-5.4a: integration project runs only after LSPEC_INTEGRATION is supplied explicitly", async () => {
		expect(process.env.LSPEC_INTEGRATION).toBe("1");

		for (const provider of providers) {
			await assertExecutableOnPath(provider);
		}
	});
});
