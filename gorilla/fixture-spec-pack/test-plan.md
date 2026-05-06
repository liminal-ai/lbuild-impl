# Test Plan: Animal Summary Fixture

## Goal
Exercise the gorilla pack against a realistic but tiny spec pack whose documents, gates, and seed artifacts are easy to understand by inspection.

## Planned Checks

### Story 0
- Confirm `target-codebase/package.json` exposes `green-verify` and `verify-all`.
- Confirm `green-verify` fails when `src/report.js` or `data/animals.json` is malformed.

### Story 1
- Run `quick-fix` against `target-codebase/` and verify the returned envelope records changed files and tests.
- Run `story-implement`, `story-self-review`, and `story-verify` against `stories/01-structured-output-hardening.md`.

### Story 2
- Run `epic-review`, `epic-reverify`, and `epic-fix`.
- Capture one evidence report per gorilla scenario: smoke, resume, structured-output, stall.

## Manual Notes
- Use `gorilla/reset.ts` before every fresh run.
- Keep the evidence files under `gorilla/evidence/<YYYY-MM-DD>/`.
- Record deliberate-drift sanity checks in `gorilla/self-test-log.md`, not under release evidence.
