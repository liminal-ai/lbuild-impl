import { runEpicReview } from "../../core/epic-reviewer.js";
import { epicVerifierBatchResultSchema } from "../../core/result-contracts.js";
import {
	type EpicReviewInput,
	type EpicReviewResult,
	epicReviewInputSchema,
} from "../contracts/operations.js";
import {
	buildUnexpectedEnvelope,
	finalizeEnvelope,
	parseSdkInput,
	resolveOperationArtifactPath,
	withSdkExecutionContext,
} from "./shared.js";

export async function epicReview(
	input: EpicReviewInput,
): Promise<EpicReviewResult> {
	const parsedInput = parseSdkInput(epicReviewInputSchema, input);

	return await withSdkExecutionContext(parsedInput, async () => {
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveOperationArtifactPath({
			command: "epic-review",
			specPackRoot: parsedInput.specPackRoot,
			artifactPath: parsedInput.artifactPath,
			group: "epic",
			fileName: "epic-review",
		});

		try {
			const outcome = await runEpicReview({
				specPackRoot: parsedInput.specPackRoot,
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
				command: "epic-review",
				artifactPath,
				startedAt,
				outcome: outcome.outcome,
				resultSchema: epicVerifierBatchResultSchema,
				result: outcome.result,
				errors: outcome.errors,
				warnings: outcome.warnings,
			});
		} catch (error) {
			const envelope = buildUnexpectedEnvelope({
				command: "epic-review",
				artifactPath,
				startedAt,
				outcome: "block",
				error,
			});
			return await finalizeEnvelope({
				command: envelope.command,
				artifactPath,
				startedAt,
				outcome: envelope.outcome,
				resultSchema: epicVerifierBatchResultSchema,
				errors: envelope.errors,
			});
		}
	});
}
