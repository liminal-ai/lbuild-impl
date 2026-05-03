import { dirname } from "node:path";

import { z } from "zod";

import { writeAtomic } from "../infra/fs-atomic.js";
import type { ProviderLifecycleEvent, ProviderName } from "./provider-adapters";
import { appendFile, mkdir } from "./runtime-deps";

const PROVIDER_OUTPUT_EVENT_INTERVAL_MS = 30_000;
const runtimeProviderSchema = z.enum(["claude-code", "codex", "copilot"]);
const providerLivenessStateSchema = z.enum([
	"starting",
	"startup-failed",
	"active-with-output",
	"active-silent",
	"stalled",
	"timed-out",
	"completed",
]);
const runtimeVerifierLaneStateSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
]);

const runtimeStreamPathsSchema = z
	.object({
		stdoutPath: z.string().min(1),
		stderrPath: z.string().min(1),
	})
	.strict();

const runtimeProgressPathsSchema = z
	.object({
		statusPath: z.string().min(1),
		progressPath: z.string().min(1),
	})
	.strict();

export const runtimeStatusStateSchema = z.enum([
	"running",
	"completed",
	"failed",
]);

export const runtimeProgressEventNameSchema = z.enum([
	"command-started",
	"provider-spawned",
	"active-silent",
	"first-output-received",
	"provider-output",
	"startup-failed",
	"stalled",
	"provider-exit",
	"timeout",
	"completed",
	"failed",
	"initial-pass-started",
	"initial-pass-completed",
	"self-review-pass-started",
	"self-review-pass-completed",
	"verifier-started",
	"verifier-completed",
]);

const runtimeProgressMetadataSchema = z.record(z.string(), z.unknown());
const runtimeVerifierLaneSchema = z
	.object({
		label: z.string().min(1),
		provider: runtimeProviderSchema,
		state: runtimeVerifierLaneStateSchema,
		providerLiveness: providerLivenessStateSchema,
		lastOutputAt: z.string().min(1).nullable(),
		stalledAt: z.string().min(1).nullable().optional(),
		lastEvent: runtimeProgressEventNameSchema,
		lastEventSummary: z.string().min(1),
	})
	.strict();

export const runtimeProgressEventSchema = z
	.object({
		timestamp: z.string().min(1),
		command: z.string().min(1),
		phase: z.string().min(1),
		event: runtimeProgressEventNameSchema,
		summary: z.string().min(1),
		metadata: runtimeProgressMetadataSchema.optional(),
	})
	.strict();

export const runtimeStatusSchema = z
	.object({
		version: z.literal(1),
		command: z.string().min(1),
		status: runtimeStatusStateSchema,
		phase: z.string().min(1),
		startedAt: z.string().min(1),
		updatedAt: z.string().min(1),
		lastOutputAt: z.string().min(1).nullable(),
		stalledAt: z.string().min(1).nullable().optional(),
		providerLiveness: providerLivenessStateSchema,
		provider: runtimeProviderSchema,
		pid: z.number().int().positive().nullable(),
		cwd: z.string().min(1),
		timeoutMs: z.number().int().positive(),
		configuredStartupTimeoutMs: z.number().int().positive().optional(),
		configuredSilenceTimeoutMs: z.number().int().positive().optional(),
		artifactPath: z.string().min(1),
		streamPaths: runtimeStreamPathsSchema,
		progressPaths: runtimeProgressPathsSchema,
		lastEvent: runtimeProgressEventNameSchema,
		lastEventSummary: z.string().min(1),
		selfReviewPassesCompleted: z.number().int().nonnegative().optional(),
		selfReviewPassesPlanned: z.number().int().nonnegative().optional(),
		verifiersCompleted: z.number().int().nonnegative().optional(),
		verifiersPlanned: z.number().int().positive().optional(),
		verifierLanes: z.array(runtimeVerifierLaneSchema).optional(),
	})
	.strict();

export type RuntimeStatusState = z.infer<typeof runtimeStatusStateSchema>;
export type RuntimeProgressEventName = z.infer<
	typeof runtimeProgressEventNameSchema
>;
export type RuntimeProgressEvent = z.infer<typeof runtimeProgressEventSchema>;
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;
export type RuntimeStreamPaths = RuntimeStatus["streamPaths"];
export type RuntimeProgressPaths = RuntimeStatus["progressPaths"];
export type RuntimeVerifierLane = z.infer<typeof runtimeVerifierLaneSchema>;

export interface RuntimeProgressTrackerInput {
	command: string;
	phase: string;
	provider: ProviderName;
	cwd: string;
	timeoutMs: number;
	configuredStartupTimeoutMs?: number;
	configuredSilenceTimeoutMs?: number;
	artifactPath: string;
	streamPaths: RuntimeStreamPaths;
	progressPaths: RuntimeProgressPaths;
	selfReviewPassesCompleted?: number;
	selfReviewPassesPlanned?: number;
	verifiersCompleted?: number;
	verifiersPlanned?: number;
	verifierLanes?: Array<{
		label: string;
		provider: ProviderName;
	}>;
}

export class RuntimeProgressTracker {
	private status: RuntimeStatus;
	private writeChain = Promise.resolve();
	private firstOutputReceived = false;
	private lastProviderOutputEventAt: number | null = null;
	private laneOutputState = new Map<
		string,
		{
			firstOutputReceived: boolean;
			lastProviderOutputEventAt: number | null;
		}
	>();

	private constructor(status: RuntimeStatus) {
		this.status = status;
	}

	static async start(
		input: RuntimeProgressTrackerInput,
	): Promise<RuntimeProgressTracker> {
		await Promise.all([
			mkdir(dirname(input.progressPaths.statusPath), { recursive: true }),
			mkdir(dirname(input.progressPaths.progressPath), { recursive: true }),
		]);

		const timestamp = new Date().toISOString();
		const tracker = new RuntimeProgressTracker(
			runtimeStatusSchema.parse({
				version: 1,
				command: input.command,
				status: "running",
				phase: input.phase,
				startedAt: timestamp,
				updatedAt: timestamp,
				lastOutputAt: null,
				providerLiveness: "starting",
				provider: input.provider,
				pid: null,
				cwd: input.cwd,
				timeoutMs: input.timeoutMs,
				...(typeof input.configuredStartupTimeoutMs === "number"
					? {
							configuredStartupTimeoutMs: input.configuredStartupTimeoutMs,
						}
					: {}),
				...(typeof input.configuredSilenceTimeoutMs === "number"
					? {
							configuredSilenceTimeoutMs: input.configuredSilenceTimeoutMs,
						}
					: {}),
				artifactPath: input.artifactPath,
				streamPaths: input.streamPaths,
				progressPaths: input.progressPaths,
				lastEvent: "command-started",
				lastEventSummary: `${input.command} started.`,
				...(typeof input.selfReviewPassesCompleted === "number"
					? {
							selfReviewPassesCompleted: input.selfReviewPassesCompleted,
						}
					: {}),
				...(typeof input.selfReviewPassesPlanned === "number"
					? {
							selfReviewPassesPlanned: input.selfReviewPassesPlanned,
						}
					: {}),
				...(typeof input.verifiersCompleted === "number"
					? {
							verifiersCompleted: input.verifiersCompleted,
						}
					: {}),
				...(typeof input.verifiersPlanned === "number"
					? {
							verifiersPlanned: input.verifiersPlanned,
						}
					: {}),
				...(input.verifierLanes
					? {
							verifierLanes: input.verifierLanes.map((lane) => ({
								label: lane.label,
								provider: lane.provider,
								state: "pending" as const,
								providerLiveness: "starting" as const,
								lastOutputAt: null,
								lastEvent: "command-started" as const,
								lastEventSummary: `${lane.label} is pending.`,
							})),
						}
					: {}),
			}),
		);

		await tracker.recordEvent({
			phase: input.phase,
			event: "command-started",
			summary: `${input.command} started.`,
		});

		return tracker;
	}

	async flush(): Promise<void> {
		await this.writeChain;
	}

	getSnapshot(): RuntimeStatus {
		return runtimeStatusSchema.parse(structuredClone(this.status));
	}

	recordEvent(input: {
		phase?: string;
		event: RuntimeProgressEventName;
		summary: string;
		metadata?: Record<string, unknown>;
		status?: RuntimeStatusState;
		patch?:
			| Partial<Omit<RuntimeStatus, "streamPaths" | "progressPaths">>
			| ((
					status: RuntimeStatus,
			  ) => Partial<Omit<RuntimeStatus, "streamPaths" | "progressPaths">>);
		lastOutputAt?: string | null;
	}): Promise<void> {
		const timestamp = new Date().toISOString();

		return this.enqueue(async () => {
			if (input.phase) {
				this.status.phase = input.phase;
			}
			if (input.status) {
				this.status.status = input.status;
			}
			if (input.patch) {
				const patch =
					typeof input.patch === "function"
						? input.patch(structuredClone(this.status))
						: input.patch;
				Object.assign(this.status, patch);
			}
			if (typeof input.lastOutputAt !== "undefined") {
				this.status.lastOutputAt = input.lastOutputAt;
			}

			this.status.updatedAt = timestamp;
			this.status.lastEvent = input.event;
			this.status.lastEventSummary = input.summary;

			await appendFile(
				this.status.progressPaths.progressPath,
				`${JSON.stringify(
					runtimeProgressEventSchema.parse({
						timestamp,
						command: this.status.command,
						phase: this.status.phase,
						event: input.event,
						summary: input.summary,
						...(input.metadata ? { metadata: input.metadata } : {}),
					}),
				)}\n`,
			);
			await this.writeStatus();
		});
	}

	markCompleted(
		summary: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		return this.recordEvent({
			phase: "finalizing",
			event: "completed",
			summary,
			metadata,
			status: "completed",
		});
	}

	markFailed(
		summary: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		return this.recordEvent({
			phase: "finalizing",
			event: "failed",
			summary,
			metadata,
			status: "failed",
		});
	}

	async updateSnapshot(input: {
		patch?:
			| Partial<Omit<RuntimeStatus, "streamPaths" | "progressPaths">>
			| ((
					status: RuntimeStatus,
			  ) => Partial<Omit<RuntimeStatus, "streamPaths" | "progressPaths">>);
		lastOutputAt?: string | null;
	}): Promise<void> {
		const timestamp = new Date().toISOString();

		return this.enqueue(async () => {
			if (input.patch) {
				const patch =
					typeof input.patch === "function"
						? input.patch(structuredClone(this.status))
						: input.patch;
				Object.assign(this.status, patch);
			}
			if (typeof input.lastOutputAt !== "undefined") {
				this.status.lastOutputAt = input.lastOutputAt;
			}
			this.status.updatedAt = timestamp;
			await this.writeStatus();
		});
	}

	handleProviderLifecycle(event: ProviderLifecycleEvent): void {
		this.handleProviderLifecycleInternal(event);
	}

	handleVerifierLaneLifecycle(
		laneLabel: string,
		event: ProviderLifecycleEvent,
	): void {
		this.handleProviderLifecycleInternal(event, {
			laneLabel,
			allowOverallFailureState: false,
		});
	}

	recordVerifierLaneStarted(input: {
		label: string;
		provider: ProviderName;
		phase: string;
		summary: string;
		metadata?: Record<string, unknown>;
	}): Promise<void> {
		return this.recordEvent({
			phase: input.phase,
			event: "verifier-started",
			summary: input.summary,
			metadata: {
				verifierLabel: input.label,
				...(input.metadata ?? {}),
			},
			patch: (status) => ({
				provider: input.provider,
				verifierLanes: this.patchVerifierLanes(status, input.label, (lane) => ({
					...lane,
					provider: input.provider,
					state: "running",
					providerLiveness: "starting",
					lastEvent: "verifier-started",
					lastEventSummary: input.summary,
				})),
			}),
		});
	}

	recordVerifierLaneCompleted(input: {
		label: string;
		provider: ProviderName;
		phase: string;
		summary: string;
		metadata?: Record<string, unknown>;
		verifiersCompleted: number;
	}): Promise<void> {
		return this.recordEvent({
			phase: input.phase,
			event: "verifier-completed",
			summary: input.summary,
			metadata: {
				verifierLabel: input.label,
				...(input.metadata ?? {}),
			},
			patch: (status) => ({
				provider: input.provider,
				verifiersCompleted: input.verifiersCompleted,
				verifierLanes: this.patchVerifierLanes(status, input.label, (lane) => ({
					...lane,
					provider: input.provider,
					state: "completed",
					providerLiveness:
						lane.providerLiveness === "startup-failed" ||
						lane.providerLiveness === "stalled" ||
						lane.providerLiveness === "timed-out"
							? lane.providerLiveness
							: "completed",
					lastEvent: "verifier-completed",
					lastEventSummary: input.summary,
				})),
			}),
		});
	}

	recordVerifierLaneFailed(input: {
		label: string;
		provider: ProviderName;
		phase: string;
		summary: string;
		metadata?: Record<string, unknown>;
	}): Promise<void> {
		return this.recordEvent({
			phase: input.phase,
			event: "failed",
			summary: input.summary,
			metadata: {
				verifierLabel: input.label,
				...(input.metadata ?? {}),
			},
			patch: (status) => ({
				provider: input.provider,
				verifierLanes: this.patchVerifierLanes(status, input.label, (lane) => ({
					...lane,
					provider: input.provider,
					state: "failed",
					lastEvent: "failed",
					lastEventSummary: input.summary,
				})),
			}),
		});
	}

	private handleProviderLifecycleInternal(
		event: ProviderLifecycleEvent,
		options?: {
			laneLabel?: string;
			allowOverallFailureState?: boolean;
		},
	): void {
		const laneLabel = options?.laneLabel;
		const allowOverallFailureState = options?.allowOverallFailureState ?? true;
		const laneState =
			typeof laneLabel === "string"
				? (this.laneOutputState.get(laneLabel) ?? {
						firstOutputReceived: false,
						lastProviderOutputEventAt: null,
					})
				: null;

		switch (event.type) {
			case "provider-spawned": {
				void this.recordEvent({
					event: "provider-spawned",
					summary:
						typeof laneLabel === "string"
							? typeof event.pid === "number"
								? `${laneLabel} provider spawned with pid ${event.pid}.`
								: `${laneLabel} provider spawned.`
							: typeof event.pid === "number"
								? `Provider spawned with pid ${event.pid}.`
								: "Provider spawned.",
					metadata:
						typeof event.pid === "number"
							? {
									...(laneLabel ? { verifierLabel: laneLabel } : {}),
									pid: event.pid,
								}
							: laneLabel
								? {
										verifierLabel: laneLabel,
									}
								: undefined,
					patch: (status) => ({
						pid: event.pid,
						providerLiveness: "starting",
						...(laneLabel
							? {
									verifierLanes: this.patchVerifierLanes(
										status,
										laneLabel,
										(lane) => ({
											...lane,
											state: "running",
											providerLiveness: "starting",
											lastEvent: "provider-spawned",
											lastEventSummary:
												typeof event.pid === "number"
													? `${laneLabel} provider spawned with pid ${event.pid}.`
													: `${laneLabel} provider spawned.`,
										}),
									),
								}
							: {}),
					}),
				});
				return;
			}
			case "startup-failed": {
				void this.recordEvent({
					event: "startup-failed",
					summary: laneLabel
						? `${laneLabel} failed startup before provider output was observed.`
						: "Provider failed startup before output was observed.",
					metadata: {
						...(laneLabel ? { verifierLabel: laneLabel } : {}),
						reason: event.reason,
						elapsedMs: event.elapsedMs,
						configuredStartupTimeoutMs: event.configuredStartupTimeoutMs,
					},
					...(allowOverallFailureState ? { status: "failed" as const } : {}),
					patch: (status) => ({
						providerLiveness: "startup-failed",
						...(laneLabel
							? {
									verifierLanes: this.patchVerifierLanes(
										status,
										laneLabel,
										(lane) => ({
											...lane,
											state: "failed",
											providerLiveness: "startup-failed",
											lastEvent: "startup-failed",
											lastEventSummary: `${laneLabel} failed startup before provider output was observed.`,
										}),
									),
								}
							: {}),
					}),
				});
				return;
			}
			case "active-silent": {
				void this.recordEvent({
					event: "active-silent",
					summary: laneLabel
						? `${laneLabel} is active but silent.`
						: "Provider is active but silent.",
					metadata: {
						...(laneLabel ? { verifierLabel: laneLabel } : {}),
						silenceMs: event.silenceMs,
						configuredSilenceTimeoutMs: event.configuredSilenceTimeoutMs,
						configuredStartupTimeoutMs: event.configuredStartupTimeoutMs,
					},
					patch: (status) => ({
						providerLiveness: "active-silent",
						...(laneLabel
							? {
									verifierLanes: this.patchVerifierLanes(
										status,
										laneLabel,
										(lane) => ({
											...lane,
											state: lane.state === "pending" ? "running" : lane.state,
											providerLiveness: "active-silent",
											lastEvent: "active-silent",
											lastEventSummary: `${laneLabel} is active but silent.`,
										}),
									),
								}
							: {}),
					}),
				});
				return;
			}
			case "output": {
				const lastOutputAt = event.timestamp;
				if (laneLabel && laneState && !laneState.firstOutputReceived) {
					laneState.firstOutputReceived = true;
					laneState.lastProviderOutputEventAt = Date.parse(event.timestamp);
					this.laneOutputState.set(laneLabel, laneState);
					void this.recordEvent({
						event: "first-output-received",
						summary: `${laneLabel} received first provider ${event.stream} output.`,
						metadata: {
							verifierLabel: laneLabel,
							stream: event.stream,
						},
						lastOutputAt,
						patch: (status) => ({
							providerLiveness: "active-with-output",
							verifierLanes: this.patchVerifierLanes(
								status,
								laneLabel,
								(lane) => ({
									...lane,
									state: "running",
									providerLiveness: "active-with-output",
									lastOutputAt,
									lastEvent: "first-output-received",
									lastEventSummary: `${laneLabel} received first provider ${event.stream} output.`,
								}),
							),
						}),
					});
					return;
				}
				if (!this.firstOutputReceived) {
					this.firstOutputReceived = true;
					this.lastProviderOutputEventAt = Date.parse(event.timestamp);
					void this.recordEvent({
						event: "first-output-received",
						summary: `First provider ${event.stream} output received.`,
						metadata: {
							stream: event.stream,
						},
						lastOutputAt,
						patch: {
							providerLiveness: "active-with-output",
						},
					});
					return;
				}

				const currentEventAt = Date.parse(event.timestamp);
				if (laneLabel && laneState) {
					if (
						laneState.lastProviderOutputEventAt === null ||
						currentEventAt - laneState.lastProviderOutputEventAt >=
							PROVIDER_OUTPUT_EVENT_INTERVAL_MS
					) {
						laneState.lastProviderOutputEventAt = currentEventAt;
						this.laneOutputState.set(laneLabel, laneState);
						void this.recordEvent({
							event: "provider-output",
							summary: `${laneLabel} provider ${event.stream} output continues.`,
							metadata: {
								verifierLabel: laneLabel,
								stream: event.stream,
							},
							lastOutputAt,
							patch: (status) => ({
								providerLiveness: "active-with-output",
								verifierLanes: this.patchVerifierLanes(
									status,
									laneLabel,
									(lane) => ({
										...lane,
										state: "running",
										providerLiveness: "active-with-output",
										lastOutputAt,
										lastEvent: "provider-output",
										lastEventSummary: `${laneLabel} provider ${event.stream} output continues.`,
									}),
								),
							}),
						});
						return;
					}

					void this.updateSnapshot({
						lastOutputAt,
						patch: (status) => ({
							providerLiveness: "active-with-output",
							verifierLanes: this.patchVerifierLanes(
								status,
								laneLabel,
								(lane) => ({
									...lane,
									state: "running",
									providerLiveness: "active-with-output",
									lastOutputAt,
								}),
							),
						}),
					});
					return;
				}

				if (
					this.lastProviderOutputEventAt === null ||
					currentEventAt - this.lastProviderOutputEventAt >=
						PROVIDER_OUTPUT_EVENT_INTERVAL_MS
				) {
					this.lastProviderOutputEventAt = currentEventAt;
					void this.recordEvent({
						event: "provider-output",
						summary: `Provider ${event.stream} output continues.`,
						metadata: {
							stream: event.stream,
						},
						lastOutputAt,
						patch: {
							providerLiveness: "active-with-output",
						},
					});
					return;
				}

				void this.updateSnapshot({
					lastOutputAt,
					patch: {
						providerLiveness: "active-with-output",
					},
				});
				return;
			}
			case "timeout": {
				void this.recordEvent({
					event: "timeout",
					summary: laneLabel
						? `${laneLabel} provider timed out after ${event.elapsedMs}ms.`
						: `Provider timed out after ${event.elapsedMs}ms.`,
					metadata: {
						...(laneLabel ? { verifierLabel: laneLabel } : {}),
						elapsedMs: event.elapsedMs,
						configuredTimeoutMs: event.configuredTimeoutMs,
					},
					...(allowOverallFailureState ? { status: "failed" as const } : {}),
					patch: (status) => ({
						providerLiveness: "timed-out",
						...(laneLabel
							? {
									verifierLanes: this.patchVerifierLanes(
										status,
										laneLabel,
										(lane) => ({
											...lane,
											state: "failed",
											providerLiveness: "timed-out",
											lastEvent: "timeout",
											lastEventSummary: `${laneLabel} provider timed out after ${event.elapsedMs}ms.`,
										}),
									),
								}
							: {}),
					}),
				});
				return;
			}
			case "stalled": {
				void this.recordEvent({
					event: "stalled",
					summary: laneLabel
						? `${laneLabel} provider stalled after ${event.silenceMs}ms without output.`
						: `Provider stalled after ${event.silenceMs}ms without output.`,
					metadata: {
						...(laneLabel ? { verifierLabel: laneLabel } : {}),
						silenceMs: event.silenceMs,
						configuredSilenceTimeoutMs: event.configuredSilenceTimeoutMs,
						configuredStartupTimeoutMs: event.configuredStartupTimeoutMs,
					},
					...(allowOverallFailureState ? { status: "failed" as const } : {}),
					patch: (status) => ({
						providerLiveness: "stalled",
						stalledAt: event.timestamp,
						...(laneLabel
							? {
									verifierLanes: this.patchVerifierLanes(
										status,
										laneLabel,
										(lane) => ({
											...lane,
											state: "failed",
											providerLiveness: "stalled",
											stalledAt: event.timestamp,
											lastEvent: "stalled",
											lastEventSummary: `${laneLabel} provider stalled after ${event.silenceMs}ms without output.`,
										}),
									),
								}
							: {}),
					}),
				});
				return;
			}
			case "provider-exit": {
				void this.recordEvent({
					event: "provider-exit",
					summary:
						typeof laneLabel === "string"
							? typeof event.exitCode === "number"
								? `${laneLabel} provider exited with code ${event.exitCode}.`
								: `${laneLabel} provider exited.`
							: typeof event.exitCode === "number"
								? `Provider exited with code ${event.exitCode}.`
								: "Provider exited.",
					metadata: {
						...(laneLabel ? { verifierLabel: laneLabel } : {}),
						exitCode: event.exitCode,
						signal: event.signal,
						elapsedMs: event.elapsedMs,
						configuredTimeoutMs: event.configuredTimeoutMs,
					},
					patch: (status) => ({
						providerLiveness:
							event.exitCode === 0 && status.status === "running"
								? "completed"
								: status.providerLiveness,
						...(laneLabel
							? {
									verifierLanes: this.patchVerifierLanes(
										status,
										laneLabel,
										(lane) => ({
											...lane,
											state:
												event.exitCode === 0 && lane.state === "running"
													? "completed"
													: lane.state,
											providerLiveness:
												event.exitCode === 0 &&
												lane.providerLiveness !== "startup-failed" &&
												lane.providerLiveness !== "stalled" &&
												lane.providerLiveness !== "timed-out"
													? "completed"
													: lane.providerLiveness,
											lastEvent: "provider-exit",
											lastEventSummary:
												typeof event.exitCode === "number"
													? `${laneLabel} provider exited with code ${event.exitCode}.`
													: `${laneLabel} provider exited.`,
										}),
									),
								}
							: {}),
					}),
				});
				return;
			}
		}
	}

	private patchVerifierLanes(
		status: RuntimeStatus,
		label: string,
		mutate: (lane: RuntimeVerifierLane) => RuntimeVerifierLane,
	): RuntimeVerifierLane[] | undefined {
		if (!status.verifierLanes) {
			return undefined;
		}

		return status.verifierLanes.map((lane) =>
			lane.label === label ? mutate(lane) : lane,
		);
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		this.writeChain = this.writeChain.then(task, task);
		return this.writeChain;
	}

	private async writeStatus(): Promise<void> {
		await writeAtomic(
			this.status.progressPaths.statusPath,
			`${JSON.stringify(runtimeStatusSchema.parse(this.status), null, 2)}\n`,
		);
	}
}
