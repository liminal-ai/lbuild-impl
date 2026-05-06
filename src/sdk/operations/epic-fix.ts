import { runEpicFix } from "../../core/epic-fix.js";
import { epicFixResultSchema } from "../../core/result-contracts.js";
import {
	type EpicFixInput,
	type EpicFixResult,
	epicFixInputSchema,
} from "../contracts/operations.js";
import {
	buildUnexpectedEnvelope,
	finalizeEnvelope,
	parseSdkInput,
	resolveOperationArtifactPath,
	withSdkExecutionContext,
} from "./shared.js";

export async function epicFix(input: EpicFixInput): Promise<EpicFixResult> {
	const parsedInput = parseSdkInput(epicFixInputSchema, input);

	return await withSdkExecutionContext(parsedInput, async () => {
		const startedAt = new Date().toISOString();
		const artifactPath = await resolveOperationArtifactPath({
			command: "epic-fix",
			specPackRoot: parsedInput.specPackRoot,
			artifactPath: parsedInput.artifactPath,
			group: "fix",
			fileName: "fix-result",
		});

		try {
			const outcome = await runEpicFix({
				specPackRoot: parsedInput.specPackRoot,
				fixBatchPath: parsedInput.fixBatchPath,
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
				command: "epic-fix",
				artifactPath,
				startedAt,
				outcome: outcome.outcome,
				resultSchema: epicFixResultSchema,
				result: outcome.result,
				errors: outcome.errors,
				warnings: outcome.warnings,
			});
		} catch (error) {
			const envelope = buildUnexpectedEnvelope({
				command: "epic-fix",
				artifactPath,
				startedAt,
				error,
			});
			return await finalizeEnvelope({
				command: envelope.command,
				artifactPath,
				startedAt,
				outcome: envelope.outcome,
				resultSchema: epicFixResultSchema,
				errors: envelope.errors,
			});
		}
	});
}
