import { runEpicReverify } from "../../core/epic-reverifier.js";
import { epicReverifyResultSchema } from "../../core/result-contracts.js";
import {
	type EpicReverifyResult,
	type EpicReverifyInput,
	epicReverifyInputSchema,
} from "../contracts/operations.js";
import {
	buildUnexpectedEnvelope,
	finalizeEnvelope,
	parseSdkInput,
	resolveOperationArtifactPath,
	withSdkExecutionContext,
} from "./shared.js";

export async function epicReverify(
	input: EpicReverifyInput,
): Promise<EpicReverifyResult> {
	const parsedInput = parseSdkInput(epicReverifyInputSchema, input);

	return await withSdkExecutionContext(parsedInput, async () => {
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveOperationArtifactPath({
			command: "epic-reverify",
			specPackRoot: parsedInput.specPackRoot,
			artifactPath: parsedInput.artifactPath,
			group: "epic",
			fileName: "epic-reverify",
		});

		if (parsedInput.reviewReportPaths.length === 0) {
			return await finalizeEnvelope({
				command: "epic-reverify",
				artifactPath,
				startedAt,
				outcome: "error",
				resultSchema: epicReverifyResultSchema,
				errors: [
					{
						code: "INVALID_INPUT",
						message: "Provide at least one review report path.",
					},
				],
			});
		}

		try {
			const outcome = await runEpicReverify({
				specPackRoot: parsedInput.specPackRoot,
				reviewReportPaths: parsedInput.reviewReportPaths,
				provider: parsedInput.provider,
				sessionId: parsedInput.sessionId,
				configPath: parsedInput.configPath,
				env: parsedInput.env,
				artifactPath,
				streamOutputPaths: parsedInput.streamOutputPaths,
				runtimeProgressPaths: parsedInput.runtimeProgressPaths,
				callerHarness: parsedInput.callerHarness,
				heartbeatCadenceMinutes: parsedInput.heartbeatCadenceMinutes,
				disableHeartbeats: parsedInput.disableHeartbeats,
				progressListener: parsedInput.progressListener,
			});
			return await finalizeEnvelope({
				command: "epic-reverify",
				artifactPath,
				startedAt,
				outcome: outcome.outcome,
				resultSchema: epicReverifyResultSchema,
				result: outcome.result,
				errors: outcome.errors,
				warnings: outcome.warnings,
			});
		} catch (error) {
			const envelope = buildUnexpectedEnvelope({
				command: "epic-reverify",
				artifactPath,
				startedAt,
				error,
			});
			return await finalizeEnvelope({
				command: envelope.command,
				artifactPath,
				startedAt,
				outcome: envelope.outcome,
				resultSchema: epicReverifyResultSchema,
				errors: envelope.errors,
			});
		}
	});
}
