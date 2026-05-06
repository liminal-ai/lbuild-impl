# Codex Structured Output Evidence

## Scenario
- Date: 2026-04-29
- Provider: codex
- Scenario: structured-output
- Operator: Codex

## Operations Invoked
- Command: `node ./dist/bin/lbuild-impl.js quick-fix --spec-pack-root ./gorilla/fixture-spec-pack --config impl-run.codex-smoke.json --working-directory ./gorilla/fixture-spec-pack/target-codebase --request-text "Make exactly one documentation-only edit: change the README H1 from 'Animal Summary Target Codebase' to 'Animal Summary Smoke Fixture'. Do not edit any other file." --json`
- Purpose: Prove Codex can return the bounded quick-fix structured payload through the built CLI.
- Notes: The run used the bounded `impl-run.codex-smoke.json` config and modified only the gorilla fixture target-codebase README heading.

## Envelope Returned
- Status: ok
- Outcome: ready-for-verification
- Errors: none
- Warnings: none

## Artifact Verified
- Artifact path: `/Users/leemoore/code/lspec-core/gorilla/fixture-spec-pack/artifacts/quick-fix/001-quick-fix.json`
- Exists on disk: yes
- Verification notes: The persisted envelope recorded `provider: codex`, `model: gpt-5.5`, a non-truncated raw provider output preview, and the raw provider output log path. The provider changed only `gorilla/fixture-spec-pack/target-codebase/README.md`, replacing the H1 with `Animal Summary Smoke Fixture`.

## Continuation Handle Exercised
- Applicable: no
- Provider: n/a
- Session id: n/a
- Follow-up command: n/a
- Result: `quick-fix` is intentionally bounded and story-agnostic, so this structured-output scenario does not use a retained continuation handle.

## Divergences
- Expected shape: `quick-fix` returns a structured outer envelope with provider/model/raw-output metadata while the provider performs exactly one bounded documentation-only edit.
- Actual shape: matched.
- Unexpected behaviors observed: none

## Next Step
- Recommended follow-up: Keep the structured-output release smoke on a single-file documentation edit so the report stays fast, deterministic, and easy to audit.
