import { describe, test } from "vitest";

import { assertExecutableOnPath } from "./helpers";

const providers = ["claude-code", "codex", "copilot"] as const;

describe("integration gating", () => {
	test("TC-5.4a: integration project fails loudly when required provider executables are unavailable", async () => {
		for (const provider of providers) {
			await assertExecutableOnPath(provider);
		}
	});
});
