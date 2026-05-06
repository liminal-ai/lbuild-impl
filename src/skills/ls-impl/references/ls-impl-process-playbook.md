# LS Impl Process Playbook

This is the main process reference after setup. Use it to decide which bounded CLI operation comes next and what evidence must be written back into `team-impl-log.md`.

## Stage Map

1. Setup: resolve the spec pack, initialize or resume `team-impl-log.md`, and discover verification gates.
2. Preflight: validate the authored run configuration before any provider-backed work starts.
3. Story validate: run `story-orchestrate validate` for the active story to confirm readiness before launch and make sure the baseline needed for later acceptance is available.
4. Story cycle: implement, self-review, verify, run the final story gate, record the story receipt, then decide whether to advance.
5. Closeout: run `epic-review`, route `epic-fix`, use `epic-reverify` until convergence, then run the epic gate on that converged candidate.

## Setup Rules

- Use `inspect` for structural discovery.
- Do not start implementation until the story gate and epic gate are recorded.
- Expect `preflight` to persist resolved `verification_gates` into `impl-run.config.json` for downstream commands; record that persisted gate choice in the log.
- When gate-discovery rationale is available, record candidate gates considered and why the selected story and epic gates won.
- If gate policy is ambiguous after checking project policy docs and package scripts, pause with a user decision instead of guessing.
- Resume from disk artifacts, not conversation memory.
- Before starting a story, run `story-orchestrate validate` and do not launch `story-orchestrate run` until validate returns `ready`.

## Durable Artifacts

- `impl-run.config.json`: the run shape chosen by the orchestrator
- `team-impl-log.md`: the durable record of state, gates, receipts, and risks
- CLI result artifacts under `artifacts/`: machine-readable evidence returned by each bounded operation
- Story operation artifacts live under `artifacts/<story-id>/`; quick-fix artifacts live under `artifacts/quick-fix/`.
- Runtime progress artifacts for provider-backed operations:
  - `progress/<artifact-base>.status.json`: latest pollable snapshot
  - `progress/<artifact-base>.progress.jsonl`: lifecycle history
  - `streams/<artifact-base>.stdout.log` and `.stderr.log`: raw provider output

## Polling Long-Running Work

- When a provider-backed operation is still running, keep the live command open and check the runtime artifacts on disk rather than waiting blind.
- Heartbeat lines on `stderr` are monitoring prompts, not routing results. They preserve exact JSON stdout and repeat the command name, elapsed time, status artifact, latest progress, silence duration, and next polling action.
- Heartbeat wording is for the caller harness that is watching the command, not necessarily for the provider harness doing the child work.
- In Codex, keep the original exec session open. Poll that same running session with empty input on the heartbeat cadence, then inspect the referenced status artifact if you need more detail. Do not final while the command is still running.
- In Claude Code, use Monitor when it is available. If Monitor is not available, keep following the attached command output and status artifact directly. Do not assume Monitor exists in Codex.
- Poll artifacts in this order:
  - read `status.json`
  - compare `updatedAt` and `lastOutputAt`
  - tail the stream logs if you need more detail
- Use `status.json` to answer:
  - Is the process alive?
  - Which phase is it in?
  - When did it last emit output?
- Use these bands as reporting guidance only:
  - `healthy` — output or lifecycle update within 5 minutes
  - `slow` — no output for 5 to 15 minutes
  - `suspected-stall` — no output for 15+ minutes
  - `hard-stall` — no output for 30+ minutes
- Do not reroute, accept, or fail the story from runtime progress alone. The final JSON envelope remains the routing source of truth.

## Story Receipt Minimum

Before accepting a story, record:

- the story id and title
- the implementor result artifact
- the verifier result artifacts
- the exact story gate command and result
- the disposition of every unresolved finding
- Use `fixed`, `accepted-risk`, and `defer` as the allowed disposition labels.
- the open risks that remain after the acceptance decision
- the cumulative test baseline before the story
- the cumulative test baseline after the story

## Story Acceptance Gate

- When implementation evidence and verifier results are complete, run the final story gate yourself instead of treating verifier output as acceptance.
- Run `bun run green-verify` as the canonical story gate unless the recorded project policy says otherwise.
- Do not accept the story until the recorded gate result, finding dispositions, and open-risk review all support progression.

## Story Progression Rules

- Prepare the next story from the committed codebase, the ordered story list, `team-impl-log.md`, and the recorded artifacts on disk.
- Do not rely on ad hoc memory or prior chat context to decide what happens next.
- If `story-orchestrate` was used, treat its final package as story-lead output for one story only. Impl-lead still decides whether to accept, reject, reopen, or request a ruling at the run level.
- Compare the current total test count to the prior accepted baseline before accepting the story.
- If the current total is lower than the prior accepted baseline, treat it as a regression and block acceptance until resolved.
- If the current total meets or exceeds the prior accepted baseline, record the new baseline and continue the acceptance decision.
- After acceptance, update the receipt and cumulative baseline fields before moving the log back to `BETWEEN_STORIES`.
- Advance to the next story only after acceptance is recorded, the receipt is complete, the cumulative baseline is updated, and the log state returns to `BETWEEN_STORIES`.

## Fix Routing Rules

- If `story-implement` returns `needs-human-ruling`, keep the surfaced uncertainty explicit and pause for an orchestrator routing decision instead of auto-fixing it away.
- After a clean `story-implement` or `story-continue` result, run `story-self-review` with the explicit continuation handle before you dispatch `story-verify`.
- Use `story-verify` initial mode to start the retained verifier session for the story. After the implementor responds, use `story-verify` follow-up mode with the explicit verifier continuation handle, the full implementor response, and any concise orchestrator framing needed for convergence.
- The orchestrator never overrides verification-identified blockers. Route blockers to the implementor, back through verification, or to the user for a ruling.
- When that uncertainty is surfaced, choose explicitly from this routing menu:
  - `story-continue` with the same-session implementor when more context-aware follow-up work can likely resolve it without changing the plan shape.
  - `story-self-review` when the retained session is ready for bounded same-session review before verification.
  - `quick-fix` for a small bounded correction that does not justify restarting the full story implementor workflow.
  - Human escalation when design ambiguity or product intent is still blocking progress.
- If the retained verifier and implementor still disagree materially, do not auto-resolve the disagreement. Keep both the verifier evidence and implementor response visible and route to retained verifier follow-up or human escalation.
- Use `quick-fix` only for small mechanical corrections that do not justify restarting the full story implementor workflow.
- Never allow non-specified or non-designed shims, mocks, fake adapters, test-only branches, or placeholder production paths without explicit user approval.
- Treat declared `specDeviations` as routing signals. Do not let them become passive receipt notes.
- Do not accept a verifier blocker as risk because an implementor says it is out of scope unless concrete spec or tech-design evidence supports that interpretation and the user or verifier accepts it.

## Epic Closeout Rules

- For every multi-story epic, run `epic-review` before final closeout.
- Do not close the epic directly from accepted stories.
- Do not offer or invent a skip path around epic review.
- `epic-reverify` is the normal follow-up review loop after epic-level fixes. Do not restart fresh epic review by default after every fix.
- Use `epic-fix` only for the specific bounded current review items you want to address now.
- Treat `ready-for-closeout` as evidence to review, not as automatic epic acceptance.
- The epic gate must pass on the converged candidate state before closeout.

## Recovery Rule

If execution is interrupted, restart from the files on disk: `team-impl-log.md`, `impl-run.config.json`, and the command result artifacts already written under `artifacts/`.

- Recover the active story, current phase, and any retained implementor continuation handle from `team-impl-log.md` before dispatching more work.
- Recover the retained verifier continuation handle as well when verification is active or follow-up verification is expected next.
- Keep `Current Phase` coarse and `Last Completed Checkpoint` specific so an interrupted story cycle can resume from the last durable step.
- Compare the recorded phase and checkpoint to the expected result artifact for that phase before resuming.
- If an in-flight implementor, quick-fix, or verifier step has no durable result artifact yet, treat it as incomplete rather than assuming it finished.
- Use the recorded artifact paths to reopen the latest implementor and verifier evidence instead of reconstructing state from memory.
- Use completed artifacts already on disk as evidence and route only the missing or invalidated work.
- Replay from the last completed checkpoint when the durable inputs on disk make that replay safe.
- When replay is needed, trust valid persisted artifacts and resume only the smallest missing bounded step.
- If retained provider sessions have accumulated too much context or gate output, prefer fresh rehydration from the durable files instead of repeatedly resuming the same session.
- If the replay boundary is unclear, pause for human ruling instead of guessing from memory.
- Do not ask for the prior conversation to be restored before resuming the run.
- Resume from the durable files on disk even when the orchestration session has been compacted or restarted.
