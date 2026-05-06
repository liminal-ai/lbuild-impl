import {
	loadRunConfig,
	mergeVerificationGates,
	resolveConfiguredVerificationGates,
	writeRunConfig,
} from "../../core/config-schema.js";
import { resolveVerificationGates } from "../../core/gate-discovery.js";
import { inspectPromptAssets } from "../../core/prompt-assets.js";
import { resolveProviderMatrix } from "../../core/provider-checks.js";
import { preflightResultSchema } from "../../core/result-contracts.js";
import { inspectSpecPack } from "../../core/spec-pack.js";
import {
	type PreflightInput,
	type PreflightResult,
	preflightInputSchema,
} from "../contracts/operations.js";
import {
	buildUnexpectedEnvelope,
	finalizeEnvelope,
	parseSdkInput,
	resolveOperationArtifactPath,
	withSdkExecutionContext,
} from "./shared.js";

function unavailableProviderErrors(
	providerMatrix: Awaited<ReturnType<typeof resolveProviderMatrix>>,
) {
	const errors: Array<{
		code: string;
		message: string;
		detail?: string;
	}> = [];

	if (providerMatrix.primary.tier === "unavailable") {
		errors.push({
			code: "PROVIDER_UNAVAILABLE",
			message: "Primary harness is unavailable",
			detail: providerMatrix.primary.notes.join("; "),
		});
	}

	for (const provider of providerMatrix.secondary) {
		if (provider.tier === "unavailable") {
			errors.push({
				code: "PROVIDER_UNAVAILABLE",
				message: `Requested secondary harness is unavailable: ${provider.harness}`,
				detail: provider.notes.join("; "),
			});
		}
	}

	return errors;
}

function authStatusUnknownNotes(
	providerMatrix: Awaited<ReturnType<typeof resolveProviderMatrix>>,
) {
	return [providerMatrix.primary, ...providerMatrix.secondary]
		.filter(
			(provider) =>
				provider.tier === "binary-present" || provider.tier === "auth-unknown",
		)
		.map(
			(provider) =>
				`${provider.harness} auth status unknown — proceed if CLI works in your environment.`,
		);
}

export async function preflight(
	input: PreflightInput,
): Promise<PreflightResult> {
	const parsedInput = parseSdkInput(preflightInputSchema, input);

	return await withSdkExecutionContext(parsedInput, async () => {
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveOperationArtifactPath({
			command: "preflight",
			specPackRoot: parsedInput.specPackRoot,
			artifactPath: parsedInput.artifactPath,
		});

		try {
			const inspectResult = await inspectSpecPack(parsedInput.specPackRoot);
			if (inspectResult.status !== "ready") {
				return await finalizeEnvelope({
					command: "preflight",
					artifactPath,
					startedAt,
					outcome: inspectResult.status,
					resultSchema: preflightResultSchema,
					errors: [
						{
							code: "INVALID_SPEC_PACK",
							message:
								inspectResult.status === "blocked"
									? "Spec-pack inspection failed"
									: "Spec-pack inspection requires a user decision",
							detail:
								inspectResult.blockers.join("; ") ||
								inspectResult.notes.join("; "),
						},
					],
				});
			}

			let validatedConfig = await loadRunConfig({
				specPackRoot: inspectResult.specPackRoot,
				configPath: parsedInput.configPath,
			});
			const providerMatrix = await resolveProviderMatrix({
				specPackRoot: inspectResult.specPackRoot,
				config: validatedConfig,
				env: parsedInput.env,
			});
			const gateResolution = await resolveVerificationGates({
				specPackRoot: inspectResult.specPackRoot,
				explicitStoryGate: parsedInput.storyGate,
				explicitEpicGate: parsedInput.epicGate,
				persistedVerificationGates:
					resolveConfiguredVerificationGates(validatedConfig),
			});
			const promptAssets = inspectPromptAssets();
			const notes = [
				...inspectResult.notes,
				...authStatusUnknownNotes(providerMatrix),
			];

			if (
				gateResolution.status === "ready" &&
				gateResolution.verificationGates
			) {
				const nextConfig = mergeVerificationGates(
					validatedConfig,
					gateResolution.verificationGates,
				);
				const currentStoryGate = validatedConfig.verification_gates?.story;
				const currentEpicGate = validatedConfig.verification_gates?.epic;

				if (
					currentStoryGate !== nextConfig.verification_gates?.story ||
					currentEpicGate !== nextConfig.verification_gates?.epic
				) {
					await writeRunConfig({
						specPackRoot: inspectResult.specPackRoot,
						configPath: parsedInput.configPath,
						config: nextConfig,
					});
					validatedConfig = nextConfig;
					notes.push(
						"Persisted resolved verification_gates into impl-run.config.json for downstream CLI commands.",
					);
				}
			}

			if (
				[
					validatedConfig.story_lead_provider,
					validatedConfig.story_implementor,
					validatedConfig.quick_fixer,
					validatedConfig.story_verifier,
					...validatedConfig.epic_verifiers,
					validatedConfig.epic_reverifier,
				].every(
					(assignment) =>
						!assignment || assignment.secondary_harness === "none",
				)
			) {
				notes.push(
					"GPT-capable secondary harnesses are unavailable for this run; the orchestrator should record the Claude-only degraded mode.",
				);
			}

			const providerErrors = unavailableProviderErrors(providerMatrix);
			const blockers: string[] = [];
			const errors: Array<{
				code: string;
				message: string;
				detail?: string;
			}> = [];
			let outcome: "ready" | "needs-user-decision" | "blocked" = "ready";

			if (providerErrors.length > 0) {
				outcome = "blocked";
				errors.push(...providerErrors);
				blockers.push(...providerErrors.map((error) => error.message));
			} else if (
				!promptAssets.basePromptsReady ||
				!promptAssets.snippetsReady
			) {
				outcome = "blocked";
				errors.push({
					code: "INVALID_SPEC_PACK",
					message: "Embedded prompt assets are incomplete",
					detail: promptAssets.notes.join("; "),
				});
				blockers.push("Embedded prompt assets are incomplete");
			} else if (gateResolution.status === "needs-user-decision") {
				outcome = "needs-user-decision";
				errors.push(...gateResolution.errors);
				notes.push(...gateResolution.notes);
			}

			return await finalizeEnvelope({
				command: "preflight",
				artifactPath,
				startedAt,
				outcome,
				resultSchema: preflightResultSchema,
				result: {
					status: outcome,
					validatedConfig,
					providerMatrix,
					verificationGates: gateResolution.verificationGates,
					configValidationNotes: [],
					promptAssets,
					blockers,
					notes,
				},
				errors,
			});
		} catch (error) {
			const envelope = buildUnexpectedEnvelope({
				command: "preflight",
				artifactPath,
				startedAt,
				outcome: "blocked",
				error,
			});
			return await finalizeEnvelope({
				command: envelope.command,
				artifactPath,
				startedAt,
				outcome: envelope.outcome,
				resultSchema: preflightResultSchema,
				errors: envelope.errors,
			});
		}
	});
}
