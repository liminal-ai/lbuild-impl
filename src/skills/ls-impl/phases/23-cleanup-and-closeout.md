# Closeout

Stage 5 runs after all stories are accepted. The default closeout path is one epic review loop:

`epic-review -> epic-fix -> epic-reverify -> epic-fix -> epic-reverify ...`

Stop the loop only when the current epic review state is converged and the epic gate has passed on that same candidate state.

| Step | State | Current Phase |
|---|---|---|
| Enter from `phases/20-story-cycle.md` | `PRE_EPIC_VERIFY` | — |
| 1 — Run epic review | `EPIC_VERIFY_ACTIVE` | `epic-review` |
| 2 — Run epic fix | `EPIC_VERIFY_ACTIVE` | `epic-fix` |
| 3 — Run epic reverify | `EPIC_VERIFY_ACTIVE` | `epic-reverify` |
| 4 — Run final epic gate | `EPIC_VERIFY_ACTIVE` | `epic-gate` |
| Complete | `COMPLETE` | — |

## 1. Run epic review

```bash
lbuild-impl epic-review --spec-pack-root <path> --json
```

Route on the outcome:

- **`pass`** — you may still choose one bounded `epic-fix` round for selected non-blocking items before closeout, otherwise proceed to step 3.
- **`revise`** — compile a bounded fix batch and proceed to step 2.
- **`blocked`** — inspect blockers, resolve, retry.

`epic-review` is the fresh wide-net closeout review. When more than one reviewer is configured, the runtime performs the internal canonical reconciliation step before returning the final result.

## 2. Run epic fix

```bash
lbuild-impl epic-fix --spec-pack-root <path> --fix-batch <artifact-path> --json
```

Compile the fix batch from the specific current epic-review findings you actually want to address now. Do not use `epic-fix` as a dumping ground for broad redesign work or human-ruling items.

Route on the outcome:

- **`cleaned`** — proceed to step 3.
- **`needs-more-fix`** — refine the bounded fix batch and run another fix round if you want another bounded pass.
- **`blocked`** — inspect blockers, resolve, retry.

## 3. Run epic reverify

```bash
lbuild-impl epic-reverify --spec-pack-root <path> --review-report <path> --json
```

Pass the current canonical `epic-review` artifact via `--review-report`. Reverify is the normal follow-up review loop after epic-level fixes.

Route on the outcome:

- **`ready-for-closeout`** — proceed to step 4.
- **`needs-fixes`** — return to step 2 with a refined bounded fix batch.
- **`needs-more-verification`** — decide whether the epic needs another fresh `epic-review` round or a human ruling.
- **`blocked`** — inspect blockers, resolve, retry.

## 4. Run the final epic gate

The CLI does not close epics. You do. Run the epic gate command recorded in `team-impl-log.md`:

- Passes cleanly — record the result, set `State` to `COMPLETE`, and notify the user that the run is complete.
- Fails — route the failure back into the epic fix/reverify loop; do not close the epic on a failing gate.

## Exit

The current epic review state is converged, the epic gate passed on that same candidate state, and the log is updated to `State: COMPLETE`. At that point, check in with the human about commit/push/PR rather than assuming publication steps.
