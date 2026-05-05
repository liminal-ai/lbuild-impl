import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import {
	GORILLA_EVIDENCE_DIR,
	GORILLA_PROMPT_PATH,
	GORILLA_README_PATH,
	GORILLA_SELF_TEST_LOG_PATH,
} from "./helpers";

test("TC-5.9a: evidence directory layout convention documented", async () => {
	const readme = await readFile(GORILLA_README_PATH, "utf8");
	const prompt = await readFile(GORILLA_PROMPT_PATH, "utf8");

	await access(GORILLA_EVIDENCE_DIR, constants.F_OK);
	await access(GORILLA_SELF_TEST_LOG_PATH, constants.F_OK);

	expect(readme).toContain(
		"gorilla/evidence/<YYYY-MM-DD>/<provider>-<scenario>.md",
	);
	expect(readme).toContain("claude-code");
	expect(readme).toContain("codex");
	expect(readme).toContain("smoke");
	expect(readme).toContain("resume");
	expect(readme).toContain("structured-output");
	expect(readme).toContain("stall");
	expect(prompt).toContain("gorilla/self-test-log.md");
});
