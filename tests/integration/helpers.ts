import { access } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

import { cliResultEnvelopeSchema } from "../../src/core/result-contracts";
import {
	implementorResultSchema,
	inspectResultSchema,
} from "../../src/sdk/contracts/operations";
import {
	inspect,
	storyContinue,
	storyImplement,
} from "../../src/sdk/operations";
import {
	getProviderExecutable,
	type RealProviderName,
} from "../support/fixtures/real-provider-scenarios";
import {
	createImplementorSpecPack,
	createRunConfig,
	writeRunConfig,
	writeTextFile,
} from "../support/test-helpers";

const DEFAULT_OPERATION_TIMEOUT_MS = 180_000;
const DEFAULT_OPERATION_SILENCE_TIMEOUT_MS = 120_000;
const STALL_TIMEOUT_MS = 20_000;
const STALL_SILENCE_TIMEOUT_MS = 5_000;

const providerModels: Record<RealProviderName, string> = {
	"claude-code": "sonnet",
	codex: "gpt-5.4",
	copilot: "gpt-5.4",
};

const providerPayload = {
	outcome: "ready-for-verification",
	planSummary:
		"Integration fixture completed the SDK-to-provider-to-envelope round trip.",
	changedFiles: [
		{
			path: "integration-fixture.txt",
			reason:
				"No production files changed during the real-provider fixture run.",
		},
	],
	tests: {
		added: ["tests/integration/sdk-operation.test.ts"],
		modified: [],
		removed: [],
		totalAfterStory: 1,
		deltaFromPriorBaseline: 1,
	},
	gatesRun: [
		{
			command: "integration fixture envelope validation",
			result: "pass",
		},
	],
	selfReview: {
		findingsFixed: [],
		findingsSurfaced: [],
	},
	openQuestions: [],
	specDeviations: [],
	recommendedNextStep: "Persist and validate the SDK operation envelope.",
} as const;

function configForProvider(
	provider: RealProviderName,
	options: {
		timeoutMs?: number;
		startupTimeoutMs?: number;
		silenceTimeoutMs?: number;
	} = {},
) {
	return createRunConfig({
		story_implementor: {
			secondary_harness: provider === "claude-code" ? "none" : provider,
			model: providerModels[provider],
			reasoning_effort: "low",
		},
		self_review: {
			passes: 1,
		},
		verification_gates: {
			story: "true",
			epic: "true",
		},
		timeouts: {
			provider_startup_timeout_ms:
				options.startupTimeoutMs ?? DEFAULT_OPERATION_SILENCE_TIMEOUT_MS,
			story_implementor_ms: options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
			story_implementor_silence_timeout_ms:
				options.silenceTimeoutMs ?? DEFAULT_OPERATION_SILENCE_TIMEOUT_MS,
		},
	});
}

async function createSdkOperationSpecPack(
	provider: RealProviderName,
	scope: string,
	options: {
		timeoutMs?: number;
		startupTimeoutMs?: number;
		silenceTimeoutMs?: number;
	} = {},
) {
	const fixture = await createImplementorSpecPack(`${scope}-${provider}`);
	await writeRunConfig(
		fixture.specPackRoot,
		configForProvider(provider, options),
	);
	await writeTextFile(
		fixture.storyPath,
		[
			`# ${fixture.storyTitle}`,
			"",
			"## Integration Fixture Task",
			"Create or update `integration-fixture.txt` at the spec-pack root with a short confirmation that the SDK package-operation integration fixture ran.",
			"Use the StoryImplementorProviderPayload result contract from the prompt when reporting the completed work.",
			"Report the story as ready-for-verification when the fixture file exists.",
			"",
		].join("\n"),
	);
	if (provider !== "claude-code") {
		await writeTextFile(
			join(fixture.specPackRoot, "custom-story-impl-prompt-insert.md"),
			[
				"## Trusted Integration Fixture Direction",
				"This synthetic spec pack is intentionally complete and exists only to validate the SDK package-operation envelope path against a real provider.",
				"Use the required StoryImplementorProviderPayload JSON contract and these exact field values for the fixture result:",
				JSON.stringify(providerPayload),
				"",
			].join("\n"),
		);
	}

	return fixture;
}

export async function assertExecutableOnPath(
	provider: RealProviderName,
): Promise<void> {
	const executable = getProviderExecutable(provider);
	const candidatePaths = (process.env.PATH ?? "")
		.split(":")
		.filter(Boolean)
		.map((entry) => join(entry, executable));

	for (const candidate of candidatePaths) {
		try {
			await access(candidate);
			return;
		} catch {}
	}

	throw new Error(
		`Expected ${executable} to be available on PATH for ${provider}.`,
	);
}

export function assertIntegrationPrerequisites(): void {
	if (process.env.LSPEC_INTEGRATION !== "1") {
		throw new Error(
			"Integration tests require LSPEC_INTEGRATION=1. The integration suite no longer skips internally when invoked without the prerequisite flag.",
		);
	}
}

function isProviderAuthFailure(envelope: {
	status: string;
	errors: Array<{ code: string; detail?: string; message: string }>;
}) {
	const detail = envelope.errors
		.map((error) => `${error.code} ${error.message} ${error.detail ?? ""}`)
		.join("\n");
	return (
		envelope.status === "blocked" &&
		/PROVIDER_UNAVAILABLE|authentication|authenticated|unauthorized|login|sign in|token|api key|No authentication information found/i.test(
			detail,
		)
	);
}

export function assertProviderAuthAvailable(
	provider: RealProviderName,
	envelope: {
		status: string;
		errors: Array<{ code: string; detail?: string; message: string }>;
	},
) {
	if (isProviderAuthFailure(envelope)) {
		throw new Error(
			`${provider} real-provider integration requires authenticated provider access. The integration suite now fails loudly instead of skipping when authentication is unavailable.`,
		);
	}
}

export function envelopeFailureSummary(envelope: {
	command: string;
	status: string;
	outcome: string;
	errors: Array<{ code: string; detail?: string; message: string }>;
}) {
	return JSON.stringify(
		{
			command: envelope.command,
			status: envelope.status,
			outcome: envelope.outcome,
			errors: envelope.errors,
		},
		null,
		2,
	);
}

export async function assertPersistedEnvelope<TResult>(envelope: {
	artifacts: Array<{ path: string }>;
}) {
	const artifactPath = envelope.artifacts[0]?.path;
	if (!artifactPath) {
		throw new Error("Expected operation envelope to include an artifact path.");
	}
	const artifactFile = Bun.file(artifactPath);
	if (!(await artifactFile.exists())) {
		throw new Error(`Expected artifact file to exist: ${artifactPath}`);
	}
	return JSON.parse(await artifactFile.text()) as TResult;
}

export async function runSmoke(provider: RealProviderName) {
	const fixture = await createSdkOperationSpecPack(
		provider,
		"integration-smoke",
	);
	const envelope = await storyImplement({
		specPackRoot: fixture.specPackRoot,
		storyId: fixture.storyId,
		streamOutputPaths: {
			stdoutPath: join(
				fixture.specPackRoot,
				"artifacts/streams/implement.stdout.log",
			),
			stderrPath: join(
				fixture.specPackRoot,
				"artifacts/streams/implement.stderr.log",
			),
		},
	});
	return { envelope, fixture };
}

export async function runStructuredOutput(provider: RealProviderName) {
	const fixture = await createSdkOperationSpecPack(
		provider,
		"integration-structured-output",
	);
	const envelope = await storyImplement({
		specPackRoot: fixture.specPackRoot,
		storyId: fixture.storyId,
		streamOutputPaths: {
			stdoutPath: join(
				fixture.specPackRoot,
				"artifacts/streams/implement.stdout.log",
			),
			stderrPath: join(
				fixture.specPackRoot,
				"artifacts/streams/implement.stderr.log",
			),
		},
	});
	return { envelope, fixture };
}

export async function runResume(provider: RealProviderName) {
	const fixture = await createSdkOperationSpecPack(
		provider,
		"integration-resume",
	);
	const initial = await storyImplement({
		specPackRoot: fixture.specPackRoot,
		storyId: fixture.storyId,
		streamOutputPaths: {
			stdoutPath: join(
				fixture.specPackRoot,
				"artifacts/streams/implement.stdout.log",
			),
			stderrPath: join(
				fixture.specPackRoot,
				"artifacts/streams/implement.stderr.log",
			),
		},
	});
	if (initial.status !== "ok" || !initial.result?.continuation) {
		return { initial, resumed: undefined, fixture };
	}

	const resumed = await storyContinue({
		specPackRoot: fixture.specPackRoot,
		storyId: fixture.storyId,
		continuationHandle: initial.result.continuation,
		followupRequest:
			provider === "claude-code"
				? "Continue the integration fixture by confirming the spec-pack root contains integration-fixture.txt, then return the required StoryImplementorProviderPayload JSON result."
				: [
						"This is a trusted continuation of the synthetic integration fixture. No production implementation work is needed; the package test is validating continuation-handle reuse and envelope persistence.",
						"Use the required StoryImplementorProviderPayload JSON contract and these exact field values for the resumed fixture result:",
						JSON.stringify(providerPayload),
					].join("\n"),
		streamOutputPaths: {
			stdoutPath: join(
				fixture.specPackRoot,
				"artifacts/streams/resume.stdout.log",
			),
			stderrPath: join(
				fixture.specPackRoot,
				"artifacts/streams/resume.stderr.log",
			),
		},
	});

	return { initial, resumed, fixture };
}

export async function runInspectStructuredOperation(
	provider: RealProviderName,
) {
	const fixture = await createSdkOperationSpecPack(
		provider,
		"integration-inspect",
	);
	const envelope = await inspect({
		specPackRoot: fixture.specPackRoot,
	});
	return { envelope, fixture };
}

export async function runRealProviderStall(provider: RealProviderName) {
	const stallProxy = await createStallProxy();
	const fixture = await createSdkOperationSpecPack(
		provider,
		"integration-stall",
		{
			timeoutMs: STALL_TIMEOUT_MS,
			startupTimeoutMs: STALL_SILENCE_TIMEOUT_MS,
			silenceTimeoutMs: STALL_SILENCE_TIMEOUT_MS,
		},
	);

	try {
		const envelope = await storyImplement({
			specPackRoot: fixture.specPackRoot,
			storyId: fixture.storyId,
			env: {
				HTTPS_PROXY: stallProxy.url,
				HTTP_PROXY: stallProxy.url,
				ALL_PROXY: stallProxy.url,
				NO_PROXY: "",
			},
			streamOutputPaths: {
				stdoutPath: join(
					fixture.specPackRoot,
					"artifacts/streams/stall.stdout.log",
				),
				stderrPath: join(
					fixture.specPackRoot,
					"artifacts/streams/stall.stderr.log",
				),
			},
		});

		return { envelope, fixture, stallProxyUrl: stallProxy.url };
	} finally {
		await stallProxy.close();
	}
}

async function createStallProxy(): Promise<{
	url: string;
	close: () => Promise<void>;
}> {
	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on("error", () => {
			// Provider clients can reset the proxy socket when their own timeout fires.
			// The stall proxy is intentionally inert, so connection reset is expected.
		});
		socket.on("close", () => sockets.delete(socket));
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		await closeServer(server, sockets);
		throw new Error("Unable to allocate local stall proxy port.");
	}

	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () => closeServer(server, sockets),
	};
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
	for (const socket of sockets) {
		socket.destroy();
	}

	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

export const sdkEnvelopeSchemas = {
	implementor: cliResultEnvelopeSchema(implementorResultSchema),
	inspect: cliResultEnvelopeSchema(inspectResultSchema),
};
