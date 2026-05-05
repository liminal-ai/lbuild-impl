import { describe, expect, test } from "vitest";

import { runSourceCli } from "../../support/test-helpers";

describe("story-orchestrate help", () => {
	test("TC-1.2a keeps primitive story commands visible in root CLI help while making story-orchestrate the default path", async () => {
		const run = await runSourceCli(["--help"]);

		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain(
			"3. orchestrate  Run story-orchestrate for the normal one-story execution path.",
		);
		expect(run.stdout).toContain(
			"story-orchestrate   Run, resume, validate, or inspect one durable story-lead attempt through the composed story-lead loop.",
		);
		expect(run.stdout).toContain(
			"story-implement     Lower-level initial implementation pass for one story.",
		);
		expect(run.stdout).toContain(
			"story-continue      Lower-level retained story implementation follow-up.",
		);
		expect(run.stdout).toContain(
			"story-self-review   Lower-level retained story self-review pass.",
		);
		expect(run.stdout).toContain(
			"story-verify        Lower-level start or continue story verification.",
		);
		expect(run.stdout).toContain(
			"lbuild-impl story-orchestrate run --spec-pack-root ./docs/spec-build/epics/my-epic --story-id 00-foundation --json",
		);
	});

	test("TC-1.4a exposes top-level story-orchestrate help as the composed story operation", async () => {
		const run = await runSourceCli(["story-orchestrate", "--help"]);

		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain(
			"Run, resume, validate, or inspect one story through the composed story-lead loop.",
		);
	});

	test("exposes validate help that describes deterministic readiness checks before run", async () => {
		const run = await runSourceCli(["story-orchestrate", "validate", "--help"]);

		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain(
			"Validate deterministic story-orchestrate readiness and capture pre-story baseline seed data.",
		);
		expect(run.stdout).toContain(
			"story-orchestrate requires story_lead_provider",
		);
	});

	test("TC-1.4a/TC-1.4b exposes run help that describes the composed loop and required config", async () => {
		const run = await runSourceCli(["story-orchestrate", "run", "--help"]);

		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain(
			"Run one story through the composed story-lead loop after orienting from durable story artifacts.",
		);
		expect(run.stdout).toContain(
			"story-orchestrate requires story_lead_provider",
		);
	});

	test("TC-1.4a/TC-1.4b exposes resume help that describes resuming the composed loop from durable state", async () => {
		const run = await runSourceCli(["story-orchestrate", "resume", "--help"]);

		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain(
			"Resume or reopen one story in the composed story-lead loop from durable state.",
		);
		expect(run.stdout).toContain(
			"story-orchestrate requires story_lead_provider",
		);
	});

	test("TC-1.4a/TC-1.4b exposes status help that describes reading durable composed-loop status", async () => {
		const run = await runSourceCli(["story-orchestrate", "status", "--help"]);

		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain(
			"Read durable status for one story in the composed story-lead loop.",
		);
		expect(run.stdout).toContain(
			"story-orchestrate requires story_lead_provider",
		);
	});
});
