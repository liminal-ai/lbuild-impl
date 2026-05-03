import type { ImplCliError } from "../sdk/errors/base.js";
import { InternalError } from "../sdk/errors/classes.js";
import { ConfigLoadError } from "./config-schema";

const blockedWorkflowErrorCodes = new Set([
	"INVALID_SPEC_PACK",
	"INVALID_RUN_CONFIG",
	"VERIFICATION_GATE_UNRESOLVED",
	"PROVIDER_UNAVAILABLE",
	"PROVIDER_STARTUP_FAILED",
	"PROVIDER_TIMEOUT",
	"PROVIDER_STALLED",
	"PROVIDER_OUTPUT_INVALID",
	"CONTINUATION_HANDLE_INVALID",
	"PROMPT_INSERT_INVALID",
	"ATOMIC_WRITE_FAILED",
	"INDEX_RESERVATION_FAILED",
]);

export function classifyCommandError(
	error: unknown,
	blockedOutcome: "blocked" | "block" = "blocked",
): {
	code: string;
	outcome: "blocked" | "block" | "error";
} {
	if (error instanceof ConfigLoadError) {
		return {
			code: "INVALID_RUN_CONFIG",
			outcome: blockedOutcome,
		};
	}

	if (isImplCliError(error)) {
		return {
			code: error.code,
			outcome: blockedWorkflowErrorCodes.has(error.code)
				? blockedOutcome
				: "error",
		};
	}

	return {
		code: new InternalError("Unexpected package failure.").code,
		outcome: "error",
	};
}

function isImplCliError(error: unknown): error is ImplCliError {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code.length > 0
	);
}
