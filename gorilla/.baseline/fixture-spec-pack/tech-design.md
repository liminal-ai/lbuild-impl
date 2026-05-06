# Technical Design: Animal Summary Fixture

## Purpose
This fixture exists only for Story 5 gorilla runs. It is intentionally small, but every document and support file maps to a real package operation.

## Layout
- `stories/` contains three stories with concrete file targets under `target-codebase/`.
- `target-codebase/` is a tiny Node project with two verification scripts.
- `seed-review-reports/` provides two pretty-printed JSON review artifacts for `epic-reverify`.
- `seed-fix-batches/` provides one epic fix batch for `epic-fix`.
- `impl-run.*.json` routes provider-backed flows through Claude Code, Codex, or the forced-stall shim.

## Provider Routing
| Config | Primary use |
| --- | --- |
| `impl-run.claude.json` | Smoke path for `story-implement`, `story-self-review`, and `story-verify` |
| `impl-run.codex.json` | Resume and epic-reverify path |
| `impl-run.stall.json` | Forced stall path using the local `gorilla/shims/codex` shim |

## Verification Gates
- Story Gate: `npm run green-verify`
- Epic Gate: `npm run verify-all`

The spec-pack root `package.json` forwards those scripts into `target-codebase/` so gate discovery has a stable local package contract.

## Target Codebase Notes
- `src/report.js` formats per-animal output.
- `src/summary.js` aggregates the sample data.
- `data/animals.json` is the real mutation surface for small fixes.
- `scripts/green-verify.mjs` checks that the formatter and data are still aligned.
- `scripts/verify-all.mjs` extends the green gate with README coverage.

## Seed Artifacts
- `seed-review-reports/claude-code-pass.json`
- `seed-review-reports/codex-revise.json`
- `seed-fix-batches/epic fix-batch-01.md`

These are intentionally easy to diff and inspect so the gorilla operator can cite them while running `epic-reverify` and `epic-fix`.
