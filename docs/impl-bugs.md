# Implementation Bug Log

Defects in the `lbuild-impl` runtime that are **not platform-specific** (i.e. would reproduce on POSIX as well as Windows) but were surfaced during a separate scenario — typically the Windows retest documented in [`windows-bugs.md`](./windows-bugs.md). Each entry is self-contained: symptom, environment, repro, root cause, suggested fix, status.

Entries here use a `BUG-IMPL-NNN` namespace to keep them distinct from Windows-specific defects (`BUG-WIN-NNN`) and platform-specific observations (`OBS-WIN-NNN`).

---

## BUG-IMPL-012 — Caller ruling approval is recorded but not propagated into `riskAndDeviationReview.specDeviations[*].approvalStatus`, so the orchestrator re-emits the same `rulingRequest.id` on every resume

**Severity:** Blocker for any story whose `accept-story` decision is gated on caller rulings — the story can never reach `accepted` no matter how many times the same ruling is approved. Reproducible on every platform; surfaced first on Windows v0.4.0 only because that was the first end-to-end orchestrate run we got through.
**Status:** Open in v0.4.0; **patched locally 2026-05-07** in `src/core/story-final-package.ts:buildStoryLeadFinalPackage` (idempotent reconciliation of `riskAndDeviationReview.specDeviations[*]` / `productionPathDecisionItems[*]` / `scopeChanges[*]` / `assumedRisks[*]` against `callerInputHistory.rulings` on every turn — see "Verification (after fix)" below). Reproduced 2026-05-07 against `lbuild-impl@0.4.0` on Windows 10 Pro running `story-orchestrate resume` against `C:\github\crumb\docs\epics\f0` story `00-foundation`. Same code paths exist on POSIX, so a Linux/macOS reproducer should be trivial.
**Affected:** Any spec pack whose story produces spec deviations gated on `riskAndDeviationReview.specDeviations[*].approvalStatus = "needs-ruling"`. Stories without spec deviations are unaffected. The `accept-story` action is not the only consumer of per-deviation approval state, but it is the most user-visible.

### Symptom

After `story-orchestrate run` parks at `outcome:"needs-ruling"` with two spec deviations awaiting caller approval, the operator writes a ruling-response artifact and runs `story-orchestrate resume`. The resume invocation:

1. Ingests the ruling correctly (sequence 22, `ruling-received`, `decision:"approve"`, `source:"caller"`).
2. Persists the ruling to `callerInputHistory.rulings`.
3. Adds an `acceptanceChecks` entry titled `"Spec deviations ruled approved"` with `status:"pass"` and the ruling artifact path as evidence.
4. Sets `result.acceptedRulingRequestId` and `result.acceptedRulingArtifact` correctly.
5. Spawns story-lead fresh (sequence 23, ~24 s), planner emits `action-selected: accept-story` (sequence 24).
6. **But** the runtime then immediately downgrades back to `needs-ruling` (sequence 25) and re-emits the same `rulingRequest.id` (`00-foundation-story-run-001-ruling-spec-deviation`) with the same allowed responses.

Inspecting the post-resume final package:

```text
callerInputHistory.rulings:                              [<approved ruling, full rationale>]    ← present
acceptanceChecks[<spec-deviations-ruled-approved>]:      { status: "pass", … }                  ← pass
result.acceptedRulingRequestId:                          "00-foundation-story-run-001-ruling-spec-deviation"  ← set
result.acceptedRulingArtifact:                           "…/001-ruling-response-001.json"       ← set

riskAndDeviationReview.specDeviations[0].approvalStatus: "needs-ruling"      ← UNCHANGED
riskAndDeviationReview.specDeviations[0].approvalSource: null                ← UNCHANGED
riskAndDeviationReview.specDeviations[1].approvalStatus: "needs-ruling"      ← UNCHANGED
riskAndDeviationReview.specDeviations[1].approvalSource: null                ← UNCHANGED
recommendedImplLeadAction:                               "ask-ruling"        ← UNCHANGED
rulingRequest.id:                                        "00-foundation-story-run-001-ruling-spec-deviation"  ← REPEATED
```

Two parts of the package agree the ruling was accepted. The part that gates `accept-story` (per-deviation `approvalStatus`) is not updated. Re-running `story-orchestrate resume` with the same ruling produces the same dance — an infinite resume loop with the same ruling id.

### Reproduction

1. Run any spec pack whose story produces ≥1 spec deviation. Crumb `f0/00-foundation` reliably produces two.
2. `lbuild-impl story-orchestrate run --spec-pack-root <pack> --story-id <story> --json` and let it park at `outcome:"needs-ruling"`.
3. Write a ruling-response artifact under `…/<story>/story-lead/NNN-ruling-response-NNN.json` approving the deviations (the orchestrator surfaces the exact path and shape via the `rulingRequest` block).
4. `lbuild-impl story-orchestrate resume --spec-pack-root <pack> --story-id <story> --json`.
5. Envelope returns `outcome:"needs-ruling"` with the same `rulingRequest.id`. `001-events.jsonl` shows `ruling-received` (good) followed by `accept-story` action (good) followed by a re-emitted `needs-ruling` (bug).
6. Inspect `…/story-lead/NNN-final-package.json` and confirm `riskAndDeviationReview.specDeviations[*].approvalStatus` is still `"needs-ruling"` despite the ruling having been ingested and acceptance-checks logged as `pass`.

### Root cause (suspected)

Two write paths handle ruling ingestion, but only one updates the gate field:

1. **CallerInputHistory + acceptanceChecks writer** — picks up the ruling artifact, appends to `callerInputHistory.rulings`, adds an `acceptanceChecks` entry, sets `result.acceptedRulingRequestId` / `result.acceptedRulingArtifact`. This path is exercised correctly.

2. **`riskAndDeviationReview.specDeviations[*].approvalStatus` writer** — should match incoming rulings to deviations whose `approvalStatus === "needs-ruling"` and either set `approvalStatus` to `"approved"` (with `approvalSource = "caller"`) on each matched deviation, or recompute per-deviation status from `callerInputHistory.rulings` at planner-turn-build time. **This path appears to be missing or broken.** The accept-story gate (`recommendedImplLeadAction === "ask-ruling"` whenever any `specDeviation.approvalStatus !== "approved"`) never sees the approval, so the orchestrator re-asks for the same ruling forever.

The shape of the bug — multiple recording sites for the same logical event, only some of which update — points at either a missed propagation in the resume codepath or a builder that recomputes `riskAndDeviationReview` from a stale source on every turn. A maintainer with the architecture in head can probably narrow it down quickly; the symptom is unambiguous.

### Suggested fix

Two complementary directions, in order of preference:

**Option A — match-and-update at ruling ingestion time.** When a ruling is ingested:

```ts
for (const deviation of riskAndDeviationReview.specDeviations) {
    if (rulingMatchesDeviation(ruling, deviation)) {
        deviation.approvalStatus = ruling.decision === "approve" ? "approved" : ruling.decision;
        deviation.approvalSource = ruling.source ?? "caller";
        deviation.approvalRulingId = ruling.requestId;
    }
}
recomputeRecommendedImplLeadAction(); // should now be "accept-story" rather than "ask-ruling"
```

The `rulingMatchesDeviation` predicate already exists implicitly — `acceptanceChecks` knew which ruling to mark as `pass`, and `acceptedRulingRequestId` was correctly set, so the matching logic is in the codebase, just not wired to update the deviation array.

**Option B — derive `riskAndDeviationReview.specDeviations[*].approvalStatus` from `callerInputHistory.rulings` at the time the planner builds the prompt / makes an accept-story decision.** This is the more idempotent variant — every turn rebuilds approval state from the durable history, so a missed write on one turn self-heals on the next. Useful as defense-in-depth even if Option A is the primary fix.

A purely-belt-and-suspenders safety: when the planner emits `action-selected: accept-story` and the orchestrator finds `riskAndDeviationReview.specDeviations` still has `needs-ruling` entries that match approved rulings in `callerInputHistory.rulings`, log a structured warning rather than silently re-emitting the same `rulingRequest.id`. This makes the bug visible in CI logs even before it's fully fixed.

### Why this wasn't caught upstream

`story-orchestrate resume` after a caller-ruling-approval is the exact flow we just exercised on Windows for the first time. If the upstream test suite covers ruling ingestion, it likely asserts only the recording sites that work (`callerInputHistory.rulings`, `acceptanceChecks`, `result.acceptedRulingRequestId`) — none of which fail. The missing assertion is "after ingesting an approving ruling, `riskAndDeviationReview.specDeviations[*].approvalStatus` should reflect the approval and the orchestrator should not re-emit the same `rulingRequest.id`." A test that drives a complete `run` → `needs-ruling` → write-ruling → `resume` → `accept-story` cycle would catch it.

### Verification (after fix)

Option B (idempotent reconciliation at final-package build time) was applied locally on 2026-05-07. Edits in `src/core/story-final-package.ts`:

1. New helper `applyRulingsToReviewCategory` — given a `RiskOrDeviationItem[]` and the current `CallerInputHistory.rulings`, returns a new array in which any item with `approvalStatus === "needs-ruling"` whose category-level ruling-request id has been resolved by an `approve`/`reject` ruling has its status flipped accordingly. The category-level id pattern is the canonical `${storyRunId}-ruling-${decisionType}` already produced by `reverifyRulingRequest`, so matching is unambiguous and there is no per-item id required.
2. New helper `applyRulingsToRiskAndDeviationReview` — runs the per-category helper across all four review buckets (`specDeviations`, `productionPathDecisionItems`, `scopeChanges`, `assumedRisks`) using a `REVIEW_CATEGORY_DECISION_TYPES` lookup so the canonical decision-type strings are defined exactly once.
3. `buildStoryLeadFinalPackage` now calls `applyRulingsToRiskAndDeviationReview` immediately after assembling `riskAndDeviationReview` from the input — before downstream consumers read it (`acceptanceChecks`, `reverifyRulingRequest`, `cleanupHandoff`, the final package itself). The reconciliation runs on every turn, so a missed propagation in a prior turn self-heals on the next turn.

Why idempotent reconciliation rather than match-and-update at ruling-ingestion time: rulings are appended to `callerInputHistory` in `story-lead.ts:appendRulingResponse` from a different code path than where deviations are constructed (deviations are rebuilt from the implementor result on every planner turn at `story-lead.ts:3173-3183`). Mutating both writers symmetrically would require two coordinated changes; reconciling at final-package build time covers all current and future deviation sources with one local change.

After the fix, repro steps 1–6 above should produce:

```text
$ lbuild-impl story-orchestrate resume --spec-pack-root <pack> --story-id <story> --json
{
  "command": "story-orchestrate resume",
  "status": "ok",
  "outcome": "completed",   // or whatever the canonical "story accepted" terminal is
  …
}

$ jq '.specDeviations' …/story-lead/NNN-final-package.json | jq '.[].approvalStatus'
"approved"
"approved"
```

…and `001-events.jsonl` should show `ruling-received` → `accept-story` → a terminal `story-accepted` (or equivalent), with no further `needs-ruling` re-emission.

### Companion observations from the same run

These do not warrant separate entries but are worth flagging if they intersect with other ongoing work:

- **Turn counter resets to 1 on resume.** The pre-resume run had planner turns 1–5; the post-resume run also starts at `turn: 1`. The durable event history now has two `turn: 1` events with very different prompts. Likely intentional ("second attempt within attempt:1"), but consumers replaying the log will need to disambiguate by sequence rather than by turn number.
- **Ruling ingestion latency.** ~24 s from `ruling-received` (sequence 22) to first planner output (sequence 23). Consistent with the ~20 s spawn baseline observed elsewhere; not a regression.
- **stdin EPIPE risk on resume held up under faster turnaround.** Resume turns are smaller and faster than initial-run turns; the EPIPE-safe stdin write applied as part of the BUG-WIN-010 fix did not produce any handler firings on the resume path. Worth noting as evidence that the fix is robust beyond the original scenario.

---

## How this log is maintained

- Each entry has a stable ID (`BUG-IMPL-NNN`) so commits and external references can pin a specific defect.
- `Status: Open` means no patch yet; `Status: Fixed locally` means a patch exists in this working tree but has not been upstreamed; `Status: Fixed upstream in vX.Y.Z` means the maintainer has shipped a fix.
- `BUG-IMPL-NNN` numbering picks up where `BUG-WIN-NNN` left off (`BUG-IMPL-012` is the first entry, following `BUG-WIN-001..011` in the Windows log) so cross-references between the two documents remain unambiguous.
- When a defect that originally appeared platform-specific is later confirmed to be cross-platform, move the entry from `windows-bugs.md` to this file and leave a one-line redirect at the original location.
