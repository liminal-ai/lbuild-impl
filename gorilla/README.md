# Gorilla Integration Pack

This directory holds the source-only release verification fixture for Story 5.

## Layout
- `fixture-spec-pack/`: the runnable spec pack and tiny target codebase.
- `.baseline/fixture-spec-pack/`: reset source used by `gorilla/reset.ts`.
- `prompt.md`: the operator prompt that walks every CLI operation.
- `evidence-template.md`: the required report shape for each gorilla run.
- `gorilla/evidence/<YYYY-MM-DD>/<provider>-<scenario>.md`: canonical release evidence layout.
- `self-test-log.md`: maintainer-only deliberate-drift sanity checks, separate from release evidence.
- `shims/codex`: a no-output shim used to force the stall scenario.

## Enums
- Providers: `claude-code`, `codex`
- Scenarios: `smoke`, `resume`, `structured-output`, `stall`

## Release Matrix
The default release gate requires these canonical reports in a fresh dated evidence directory:

- `claude-code-smoke.md`
- `codex-resume.md`
- `codex-structured-output.md`
- `codex-stall.md`

Use `scripts/check-release-evidence.ts --matrix ...` only for an intentionally documented release-specific matrix.

Release evidence should use the fixture's `*-smoke` run-config files. Those configs keep real-provider operations short and bounded so a provider contract break records a fast, useful failure instead of running a full implementation pass.

## Reset
Run `npx tsx gorilla/reset.ts` before a fresh gorilla pass. The reset restores `gorilla/fixture-spec-pack/` from `gorilla/.baseline/fixture-spec-pack/` byte-for-byte at the file-content level and removes any extra files created during a prior run.
