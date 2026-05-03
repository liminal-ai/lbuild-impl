import { filterEnv } from "../infra/env-allowlist.js";
import {
	buildWindowsCommandShimInvocation,
	isWindowsCommandShim,
	resolveProviderExecutable,
} from "./provider-executable.js";
import type { ImplRunConfig, SecondaryHarness } from "./config-schema";
import { resolveGitRepoRoot } from "./git-repo";
import type { HarnessAvailability, ProviderMatrix } from "./result-contracts";
import { getExecFileImplementation } from "./runtime-deps";

const DEFAULT_PROVIDER_CHECK_TIMEOUT_MS = 1_000;

function redactSensitiveText(text: string): string {
	return text
		.replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [REDACTED]")
		.replace(
			/\b(token|auth|authorization|api[_-]?key)\s*[:=]\s*\S+/gi,
			"$1=[REDACTED]",
		);
}

async function runCommand(params: {
	file: string;
	args: string[];
	cwd: string;
	env?: Record<string, string | undefined>;
	timeoutMs: number;
	platform?: NodeJS.Platform;
}) {
	const mergedEnv = {
		...process.env,
		...params.env,
	};
	const resolvedExecutable = await resolveProviderExecutable({
		executable: params.file,
		env: mergedEnv,
		platform: params.platform,
	});
	const command =
		process.platform === "win32" && isWindowsCommandShim(resolvedExecutable)
			? buildWindowsCommandShimInvocation({
					executable: resolvedExecutable,
					args: params.args,
					env: mergedEnv,
				})
			: {
					file: resolvedExecutable,
					args: params.args,
				};
	try {
		const result = await new Promise<{ stdout: string; stderr: string }>(
			(resolveResult, reject) => {
				getExecFileImplementation()(
					command.file,
					command.args,
					{
						cwd: params.cwd,
						env: filterEnv(process.env, params.env),
						timeout: params.timeoutMs,
						encoding: "utf8",
					},
					(error, stdout, stderr) => {
						if (error) {
							Object.assign(error, {
								stdout,
								stderr,
							});
							reject(error);
							return;
						}

						resolveResult({
							stdout,
							stderr,
						});
					},
				);
			},
		);
		return {
			success: true as const,
			stdout: redactSensitiveText(result.stdout.trim()),
			stderr: redactSensitiveText(result.stderr.trim()),
		};
	} catch (error) {
		const failed = error as {
			stdout?: string;
			stderr?: string;
			code?: string | number;
			message?: string;
			killed?: boolean;
			signal?: string;
		};
		return {
			success: false as const,
			stdout: redactSensitiveText(failed.stdout?.trim() ?? ""),
			stderr: redactSensitiveText(
				failed.stderr?.trim() ?? failed.message ?? String(error),
			),
			code: failed.code,
			timedOut: failed.signal === "SIGTERM" || failed.killed === true,
		};
	}
}

function executableForHarness(
	harness: "claude-code" | SecondaryHarness,
): string | null {
	switch (harness) {
		case "claude-code":
			return "claude";
		case "codex":
			return "codex";
		case "copilot":
			return "copilot";
		case "none":
			return null;
	}
}

function authCommandForHarness(
	harness: "claude-code" | SecondaryHarness,
): string[] | undefined {
	switch (harness) {
		case "claude-code":
		case "copilot":
			return ["auth", "status"];
		case "codex":
			return undefined;
		case "none":
			return undefined;
	}
}

function failureNotes(
	result: {
		stderr: string;
		timedOut?: boolean;
		code?: string | number;
	},
	executable: string,
	step: string,
): string[] {
	if (result.stderr) {
		return [result.stderr];
	}

	if (result.timedOut) {
		return [`${executable} ${step} timed out`];
	}

	return [`Unable to execute ${executable} ${step}`];
}

type AuthCheckOutcome =
	| { kind: "missing-auth-command" }
	| { kind: "explicit-auth-failure" }
	| { kind: "unknown" };

const providerPreflightMissingAuthCommandPatterns = [
	/unexpected auth invocation/i,
] as const;
const providerPreflightExplicitAuthFailurePatterns = [
	/\bmissing\b/i,
	/not logged in/i,
	/unauth/i,
	/sign in/i,
] as const;

function providerPreflightStderrMatches(
	stderr: string,
	patterns: readonly RegExp[],
): boolean {
	// Quarantined exception: these auth status commands do not expose a stable
	// structured error channel, so preflight classifies a narrow stderr vocabulary.
	return patterns.some((pattern) => pattern.test(stderr));
}

function parseAuthCheckOutcome(stderr: string): AuthCheckOutcome {
	if (
		providerPreflightStderrMatches(
			stderr,
			providerPreflightMissingAuthCommandPatterns,
		)
	) {
		return { kind: "missing-auth-command" };
	}

	if (
		providerPreflightStderrMatches(
			stderr,
			providerPreflightExplicitAuthFailurePatterns,
		)
	) {
		return { kind: "explicit-auth-failure" };
	}

	return { kind: "unknown" };
}

async function checkHarnessAvailability(input: {
	harness: "claude-code" | SecondaryHarness;
	cwd: string;
	env?: Record<string, string | undefined>;
	timeoutMs: number;
	platform?: NodeJS.Platform;
}): Promise<HarnessAvailability> {
	const executable = executableForHarness(input.harness);
	if (!executable) {
		return {
			harness: "none",
			available: true,
			tier: "binary-present",
			authStatus: "unknown",
			notes: [],
		};
	}

	const version = await runCommand({
		file: executable,
		args: ["--version"],
		cwd: input.cwd,
		env: input.env,
		timeoutMs: input.timeoutMs,
		platform: input.platform,
	});
	if (!version.success) {
		return {
			harness: input.harness,
			available: false,
			tier: "unavailable",
			authStatus: version.code === "ENOENT" ? "missing" : "unknown",
			notes: failureNotes(version, executable, "--version"),
		};
	}

	const authCommand = authCommandForHarness(input.harness);
	if (!authCommand) {
		return {
			harness: input.harness,
			available: true,
			tier: "binary-present",
			version: version.stdout,
			authStatus: "unknown",
			notes: [
				`No non-mutating auth status command is available for ${input.harness}.`,
			],
		};
	}

	const auth = await runCommand({
		file: executable,
		args: authCommand,
		cwd: input.cwd,
		env: input.env,
		timeoutMs: input.timeoutMs,
		platform: input.platform,
	});
	if (!auth.success) {
		const authOutcome = parseAuthCheckOutcome(auth.stderr);

		if (authOutcome.kind === "missing-auth-command") {
			return {
				harness: input.harness,
				available: true,
				tier: "binary-present",
				version: version.stdout,
				authStatus: "unknown",
				notes: failureNotes(auth, executable, "auth status"),
			};
		}

		if (!auth.timedOut && authOutcome.kind !== "explicit-auth-failure") {
			return {
				harness: input.harness,
				available: true,
				tier: "auth-unknown",
				version: version.stdout,
				authStatus: "unknown",
				notes: failureNotes(auth, executable, "auth status"),
			};
		}

		return {
			harness: input.harness,
			available: false,
			tier: "unavailable",
			version: version.stdout,
			authStatus:
				authOutcome.kind === "explicit-auth-failure" ? "missing" : "unknown",
			notes: failureNotes(auth, executable, "auth status"),
		};
	}

	return {
		harness: input.harness,
		available: true,
		tier: "authenticated-known",
		version: version.stdout,
		authStatus: "authenticated",
		notes: auth.stdout ? [auth.stdout] : [],
	};
}

function requestedSecondaryHarnesses(
	config: ImplRunConfig,
): SecondaryHarness[] {
	const harnesses = new Set<SecondaryHarness>();
	for (const assignment of [
		config.story_lead_provider,
		config.story_implementor,
		config.quick_fixer,
		config.story_verifier,
		...config.epic_verifiers,
		config.epic_synthesizer,
	]) {
		if (assignment && assignment.secondary_harness !== "none") {
			harnesses.add(assignment.secondary_harness);
		}
	}
	return [...harnesses];
}

export async function resolveProviderMatrix(input: {
	specPackRoot: string;
	config: ImplRunConfig;
	env?: Record<string, string | undefined>;
	timeoutMs?: number;
	platform?: NodeJS.Platform;
}): Promise<ProviderMatrix> {
	const cwd =
		(await resolveGitRepoRoot(input.specPackRoot)) ?? input.specPackRoot;
	const timeoutMs = input.timeoutMs ?? DEFAULT_PROVIDER_CHECK_TIMEOUT_MS;
	const primary = await checkHarnessAvailability({
		harness: "claude-code",
		cwd,
		env: input.env,
		timeoutMs,
		platform: input.platform,
	});
	const secondary: HarnessAvailability[] = [];

	for (const harness of requestedSecondaryHarnesses(input.config)) {
		secondary.push(
			await checkHarnessAvailability({
				harness,
				cwd,
				env: input.env,
				timeoutMs,
				platform: input.platform,
			}),
		);
	}

	return {
		primary,
		secondary,
	};
}
