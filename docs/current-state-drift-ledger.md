# Current State Drift Ledger

Generated: 2026-05-01

This ledger records the main places where implemented reality has intentionally moved beyond, narrowed, or corrected the historical epic docs.

## Package Identity

Historical drafts used broader standalone SDK/CLI naming. Current package identity is the unscoped public npm package `lbuild-impl`, with CLI binary `lbuild-impl`.

## Version Status

The package release marker is `0.3.0`. Any doc that still describes the project as only `0.1.0` or first-publish pending is stale.

## Test Topology

The current test layout is tier-first:

- `tests/unit/**`
- `tests/package/**`
- `tests/integration/**`
- `tests/support/**`

Historical paths that referenced flatter test locations should be treated as acceptance traceability, not current navigation.

## CI Runner

Active GitHub Actions verification gates run on Blacksmith with `blacksmith-2vcpu-ubuntu-2404`. The final npm publish job intentionally runs on GitHub-hosted `ubuntu-latest` so npm provenance can verify the runner environment.

## Release Evidence Scope

The release gorilla gate enforces a bounded four-report matrix:

- `claude-code-smoke.md`
- `codex-resume.md`
- `codex-structured-output.md`
- `codex-stall.md`

Earlier provider-by-scenario wording in the epic design should be read as the broader gorilla capability, not the current release gate.

## Manual Publish Rehearsal

Manual publish workflow runs validate a GitHub-visible ref and never publish live. If the requested version already exists on npm, the manual dry-run path uses `npm pack --dry-run --json` to validate package shape instead of attempting `npm publish --dry-run` for an already-published version.

## Runtime Contract Fixes

The current implementation has the corrected runtime behavior expected after release hardening:

- `inspect` is read-only.
- Internal/programming failures classify as `error`, not `blocked`.
- Caller-provided environment overrides win explicitly.
- Atomic writes sync the temp file before rename.
- Public version surfaces read package metadata instead of hardcoded stale literals.
- Lint is clean under the current gate.

## Release Evidence And CI Evidence

The latest verified release automation evidence is:

- Live `v0.3.0` Publish workflow: GitHub Actions run `25197337957`
- Blacksmith `default-ci` gate: job `73880814695`
- Blacksmith `gorilla-evidence` gate: job `73880814701`
- Blacksmith `integration` gate: job `73880962070`
- GitHub-hosted provenance publish job: job `73881155110`
