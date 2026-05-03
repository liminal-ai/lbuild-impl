import { describe, expect, test } from "vitest";

import { packageVersion } from "../../../src/package-metadata.js";
import {
	createRuntimeIdentity,
	detectRuntimeInvocationSource,
} from "../../../src/core/runtime-identity.js";

describe("runtime identity", () => {
	test("TC-5.7a detects local-source invocation from a repo checkout", () => {
		expect(
			detectRuntimeInvocationSource({
				entryPath: "/workspace/lbuild-impl/dist/bin/lbuild-impl.js",
				packageRootPath: "/workspace/lbuild-impl",
				packageRootHasGitDir: true,
				packageRootHasSrcDir: true,
				packageRootHasPackageJson: true,
			}),
		).toBe("local-source");
	});

	test("TC-5.7a detects global-package invocation when only packaged markers exist", () => {
		expect(
			detectRuntimeInvocationSource({
				entryPath:
					"/usr/local/lib/node_modules/lbuild-impl/dist/bin/lbuild-impl.js",
				packageRootPath: "/usr/local/lib/node_modules/lbuild-impl",
				packageRootHasGitDir: false,
				packageRootHasSrcDir: false,
				packageRootHasPackageJson: true,
			}),
		).toBe("global-package");
	});

	test("TC-5.7a detects bundled-skill invocation from known skill paths", () => {
		expect(
			detectRuntimeInvocationSource({
				entryPath:
					"/Users/lee/.codex/skills/lbuild-impl/dist/bin/lbuild-impl.js",
			}),
		).toBe("bundled-skill");
	});

	test("TC-5.7b includes the runtime version in the assembled identity", () => {
		expect(createRuntimeIdentity().version).toBe(packageVersion);
	});

	test("TC-5.7c reports unknown explicitly when the source cannot be classified", () => {
		expect(
			createRuntimeIdentity({
				entryPath: "/tmp/external-runner.js",
				version: "9.9.9",
			}),
		).toEqual({
			version: "9.9.9",
			invocationSource: "unknown",
			entryPath: "/tmp/external-runner.js",
		});
	});
});
