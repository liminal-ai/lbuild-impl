# Stage Map

The run passes through five stages. You are currently in stage 1.

## 1. Skill onboarding

Read the CLI-delivered skill docs in order, capture retained notes, and build a durable mental model that will survive context compaction. Exit when you can name the operating model, the stages, and what initialization must establish.

## 2. Initialization

Find the spec pack, confirm it is complete, read it in the correct order, create or resume durable state, discover verification gates, and run `preflight`. Exit when `team-impl-log.md` and `impl-run.config.json` are current and `preflight` returns `ready`.

Guidance: `setup/10-spec-pack-discovery.md`, `setup/11-spec-pack-read-order.md`, `setup/12-run-setup.md`.

## 3. Story cycle

For each story in order: prepare any story-local config, run `story-orchestrate validate`, launch implementation only after validation is `ready`, review verifier evidence, route follow-up work, run the final story gate yourself, record the receipt, and advance. The cycle repeats until every story is accepted and committed.

Guidance: `phases/20-story-cycle.md`, `phases/21-verification-and-fix-routing.md`.

## 4. Recovery (conditional)

Enter recovery if the session is interrupted, compacted, or resumed in a fresh chat. Rebuild state from `team-impl-log.md`, `impl-run.config.json`, and the CLI artifacts already on disk — not from memory of prior turns. Return to the stage you were in once state is reconstructed.

Guidance: `phases/22-recovery-and-resume.md`.

## 5. Closeout

After all stories are accepted: run `epic-review`, expect findings, route `epic-fix` when needed, and use `epic-reverify` as the normal follow-up review loop until the epic is ready for closeout. The epic gate must pass on that converged candidate state before you close the epic.

Guidance: `phases/23-cleanup-and-closeout.md`.

## Blocked transitions

Pause for a user decision rather than improvising when:

- required spec-pack files are missing or the layout is invalid
- verification gate policy is ambiguous after precedence-order discovery
- verifier and implementor evidence still disagree materially and you cannot resolve it from the retained convergence loop
- the replay boundary during recovery is unclear
- epic-review or epic-reverify findings require product judgment
