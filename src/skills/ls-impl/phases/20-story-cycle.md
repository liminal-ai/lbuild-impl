# Story Cycle

Stage 3 runs once per story in order. For each story you launch implementation, run explicit self-review, review verification, route any follow-up, run the final story gate yourself, record a receipt, and advance. Repeat until every story is accepted.

If you use `story-orchestrate`, treat it as a story-lead helper for one story rather than as outer acceptance authority. Story-lead can own the internal story loop and hand back a final package, but impl-lead still reviews that package, finishes the receipt, makes the story commit, and decides whether the story is actually accepted.

## Story-orchestrate lifecycle

`story-orchestrate` keeps two vocabularies visible at the same time:

- `status` stays caller-facing: `running`, `accepted`, `needs-ruling`, `blocked`, `failed`, `interrupted`
- `lifecycleState` explains where the current attempt sits inside the story-lead loop: `initialized`, `awaiting_story_lead_action`, `running_child_operation`, `recording_result`, `terminal`

```mermaid
stateDiagram-v2
    [*] --> initialized
    initialized --> awaiting_story_lead_action
    awaiting_story_lead_action --> running_child_operation: implement/continue/self-review/verify/quick-fix
    awaiting_story_lead_action --> recording_result: accept/block/fail/request-ruling
    awaiting_story_lead_action --> failed: planner invalid or context overflow
    running_child_operation --> recording_result: child completed
    running_child_operation --> interrupted: caller/runtime interruption
    running_child_operation --> failed: unrecoverable runtime error
    recording_result --> awaiting_story_lead_action: non-terminal result recorded
    recording_result --> terminal: accepted
    recording_result --> terminal: needs-ruling
    recording_result --> terminal: blocked
    recording_result --> terminal: failed
    recording_result --> terminal: interrupted
```

Caller implications:

- `initialized` means setup exists but no planner turn has safely started yet.
- `awaiting_story_lead_action` means the next fresh planner turn should return exactly one bounded action.
- `running_child_operation` means the runtime is executing one bounded step, so keep polling durable artifacts instead of rerouting blindly.
- `recording_result` means the runtime is writing evidence and ledger updates before it claims the next state.
- `terminal` means read the public `status` plus the final package to decide the impl-lead follow-up.

Terminal `status` meanings:

- `accepted` still requires impl-lead review, receipt completion, gates, and the story commit.
- `needs-ruling` means the story hit an authority boundary and the caller must decide.
- `blocked` means a named blocker prevented safe progress.
- `failed` means the attempt ended in an unrecoverable runtime or planner failure.
- `interrupted` means resume from the last durable checkpoint rather than guessing from memory.

Update `State` and `Current Phase` in `team-impl-log.md` as you move through the steps. Recovery uses these values to resume from the right place.

| Step | State | Current Phase |
|---|---|---|
| 1 — Launch implementation | `STORY_ACTIVE` | `implement` |
| 2 — Launch self-review | `STORY_ACTIVE` | `self-review` |
| 3 — Launch verification | `STORY_ACTIVE` | `verify` |
| Consulting `21-verification-and-fix-routing.md` | `STORY_ACTIVE` | `fix-routing` |
| 4–5 — Story gate + baseline check | `STORY_ACTIVE` | `gate` |
| 6 — Receipt and commit | `STORY_ACTIVE` | `accept` |
| Advance between stories | `BETWEEN_STORIES` | — |

## Confirm the active story

Before any work, confirm which story is active from the ordered story list in `team-impl-log.md`. At the start of a new story, confirm `Current Story` matches the story file you're about to implement.

When you background any provider-backed CLI call in this phase, keep following its runtime progress on the heartbeat cadence instead of waiting only on the background job notification. This avoids the failure mode where the orchestrator waits indefinitely on a hung task even though `status.json`, `updatedAt`, `lastOutputAt`, or the stream logs already show that something is wrong. Use `references/ls-impl-process-playbook.md` for the polling procedure.

- In Codex, keep the same exec session open, poll again with empty input, and do not final while the command is still active.
- In Claude Code, Monitor may be used when available; do not assume that Monitor exists in Codex.
- Heartbeats are summaries on `stderr`, not replacements for the final JSON envelope on `stdout`.
- The caller harness receives the heartbeat. The provider harness may be different.

## 1. Launch implementation

```bash
lbuild-impl story-implement --spec-pack-root <path> --story-id <story-id> --json
```

Route on the outcome:

- **`ready-for-verification`** — proceed to step 2 with the returned continuation handle.
- **`needs-followup-fix`** — consult `21-verification-and-fix-routing.md`.
- **`needs-human-ruling`** — surface to the user; do not auto-fix.
- **`blocked`** — inspect blockers, resolve, retry.

Record the implementor result artifact path.

## 2. Launch self-review

```bash
lbuild-impl story-self-review --spec-pack-root <path> --story-id <story-id> --provider <provider> --session-id <id> --json
```

Route on the outcome:

- **`ready-for-verification`** — proceed to step 3.
- **`needs-followup-fix`** — consult `21-verification-and-fix-routing.md`.
- **`needs-human-ruling`** — surface to the user; do not auto-fix.
- **`blocked`** — inspect blockers, resolve, retry.

Record the self-review batch artifact path.

## 3. Launch verification

Initial verifier pass:

```bash
lbuild-impl story-verify --spec-pack-root <path> --story-id <story-id> --json
```

Follow-up verifier pass:

```bash
lbuild-impl story-verify --spec-pack-root <path> --story-id <story-id> --provider <provider> --session-id <id> (--response-file <path> | --response-text <text>) [--orchestrator-context-file <path> | --orchestrator-context-text <text>] --json
```

Route on the outcome:

- **`pass`** — proceed to step 4.
- **`revise`** — consult `21-verification-and-fix-routing.md`; rerun verification after fixes.
- **`block`** — inspect blockers, resolve, retry.

The first verifier pass starts the retained verifier session for the story. Follow-up verifier passes resume that same session with the implementor's response and any orchestrator framing needed for convergence. Record the verifier result artifact path and the retained verifier continuation handle.

## 4. Run the final story gate

The CLI does not accept stories. You do. Run the story gate command recorded in `team-impl-log.md`:

- Passes cleanly — proceed to step 5.
- Fails — route the failure through `21-verification-and-fix-routing.md`; treat it as a finding, not a pause.

## 5. Compare cumulative baselines

Compare the current total test count to the prior accepted baseline (in the log). A count below expectation is a regression; block acceptance and investigate before proceeding.

## 6. Record the receipt and accept

Write a pre-acceptance receipt into `team-impl-log.md` with:

- story id and title
- implementor result artifact path
- verifier result artifact paths
- any `story-orchestrate` final package, `logHandoff`, and story receipt draft paths when story-lead was used
- story gate command run and its result
- disposition (`fixed`, `accepted-risk`, or `defer`) for every unresolved finding
- open risks remaining after acceptance
- cumulative baseline before and after this story

Once the receipt is complete and every finding has a disposition, commit the story's changes. The commit is part of acceptance: until it lands, the story remains in `accept` phase and recovery will expect the commit before advancing.

If story-lead carried `accepted-risk` or `defer` items, preserve them in the receipt and carry them forward into the cleanup batch before epic verification.

## Advance

Update `Current Story` in the log:

- If more stories remain — set `Current Story` to the next story, `State` to `BETWEEN_STORIES`, and return to step 1.
- If this was the last story — set `State` to `PRE_EPIC_VERIFY` and proceed to `phases/23-cleanup-and-closeout.md`.
