import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "vitest";

import { ROOT } from "../../support/test-helpers";

const PUBLISH_WORKFLOW_PATH = join(ROOT, ".github", "workflows", "publish.yml");
const BLACKSMITH_RUNNER = "runs-on: blacksmith-2vcpu-ubuntu-2404";

async function readPublishWorkflow(): Promise<string> {
	return await readFile(PUBLISH_WORKFLOW_PATH, "utf8");
}

test("TC-6.5a: workflow triggers on tag push", async () => {
	const workflow = await readPublishWorkflow();

	expect(workflow).toContain("push:");
	expect(workflow).toContain("tags:");
	expect(workflow).toContain('- "v*.*.*"');
	expect(workflow).not.toContain("branches:");
});

test("TC-6.5b: default-CI gate blocks publish on failure", async () => {
	const workflow = await readPublishWorkflow();

	expect(workflow).toContain("default-ci:");
	expect(workflow).toContain("needs:");
	expect(workflow).toContain("- default-ci");
	expect(workflow).toContain("npm run verify");
	expect(workflow).toContain("npm run test:package");
	expect(workflow).toContain("if: $" + "{{ success() }}");
});

test("TC-6.5c: publish no longer depends on a GitHub Actions integration gate", async () => {
	const workflow = await readPublishWorkflow();

	expect(workflow).toContain(
		"needs:\n      - default-ci\n      - gorilla-evidence",
	);
	expect(workflow).not.toContain("integration:");
	expect(workflow).not.toContain("codex login --with-api-key");
	expect(workflow).not.toContain("npm run test:integration");
});

test("workflow_dispatch checks out a GitHub-visible ref and validates release tag input", async () => {
	const workflow = await readPublishWorkflow();

	expect(workflow).toContain(
		"RELEASE_REF: $" +
			"{{ github.event_name == 'workflow_dispatch' && inputs.ref || github.ref }}",
	);
	expect(workflow).toContain("ref:");
	expect(workflow).toContain("GitHub-visible branch, SHA, or ref");
	expect(workflow).toContain("Validate manual release inputs");
	expect(workflow).toContain('requested="$' + '{{ inputs.tag }}"');
	expect(workflow).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+$");
	expect(workflow).not.toContain("refs/tags/$" + "{requested}^{commit}");
	expect(workflow).toContain(
		"Manual workflow_dispatch runs only support dry_run=true.",
	);
});

test("TC-6.5d: gorilla evidence required for publish", async () => {
	const workflow = await readPublishWorkflow();

	expect(workflow).toContain("gorilla-evidence:");
	expect(workflow).toContain("scripts/check-release-evidence.ts");
	expect(workflow).toContain("--release-window-days");
	expect(workflow).toContain("RELEASE_WINDOW_DAYS");
});

test("TC-6.5e: all gates green publishes", async () => {
	const workflow = await readPublishWorkflow();

	expect(workflow).toContain("scripts/check-release-version-sync.ts");
	expect(workflow).toContain("npm publish --access public --provenance");
	expect(workflow).toContain(
		"npm publish --access public --provenance --dry-run",
	);
	expect(workflow).toContain('npm view "$package_id" version');
	expect(workflow).toContain("npm pack --dry-run --json");
	expect(workflow).toContain(
		"Manual workflow_dispatch runs only support dry_run=true.",
	);
	expect(workflow).toContain("registry-url: https://registry.npmjs.org");
});

test("workflow YAML remains release-ready", async () => {
	const workflowsDir = join(ROOT, ".github", "workflows");
	const workflowFiles = (await readdir(workflowsDir)).filter((fileName) =>
		fileName.endsWith(".yml"),
	);

	expect(workflowFiles.length).toBeGreaterThanOrEqual(2);

	for (const fileName of workflowFiles) {
		const workflow = await readFile(join(workflowsDir, fileName), "utf8");
		expect(workflow).toContain("name:");
		expect(workflow).toContain("jobs:");
		expect(workflow).not.toContain("\t");
		expect(workflow).toContain("uses: actions/checkout@v5");
		expect(workflow).toContain("uses: actions/setup-node@v6");
		if (fileName === "publish.yml") {
			expect(workflow).toContain(BLACKSMITH_RUNNER);
			expect(workflow).toContain("runs-on: ubuntu-latest");
			continue;
		}
		expect(workflow).toContain(BLACKSMITH_RUNNER);
		expect(workflow).not.toContain("runs-on: ubuntu-latest");
	}
});
