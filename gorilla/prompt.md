# Gorilla Prompt

Use the built package against the source-only fixture and record evidence in the canonical layout.

## Setup
1. Run `npx tsx gorilla/reset.ts`.
2. Run `npm run build`.
3. Set `CLI="node ./dist/bin/lbuild-impl.js"`.
4. Set `SPEC="./gorilla/fixture-spec-pack"`.
5. Create today's evidence directory: `mkdir -p "gorilla/evidence/<YYYY-MM-DD>"`.
6. Use the `*-smoke` run-config files for release evidence. They keep provider calls bounded with short startup, operation, and silence timeouts.

## Canonical Evidence Layout
- Write one Markdown file per scenario under `gorilla/evidence/<YYYY-MM-DD>/<provider>-<scenario>.md`.
- `<provider>` must be one of `claude-code`, `codex`.
- `<scenario>` must be one of `smoke`, `resume`, `structured-output`, `stall`.
- Do not write deliberate-drift sanity checks into `gorilla/evidence/`; record them in `gorilla/self-test-log.md`.

## Operation Matrix

### Claude Code Smoke
Purpose: prove the Claude Code provider can execute the read-only verifier path against the fixture without mutating the target codebase.

- `inspect`: `$CLI inspect --spec-pack-root "$SPEC" --json`
- `preflight`: `$CLI preflight --spec-pack-root "$SPEC" --config "impl-run.claude-smoke.json" --json`
- `story-verify`: `$CLI story-verify --spec-pack-root "$SPEC" --story-id 00-foundation --config "impl-run.claude-smoke.json" --json`

Save the smoke report to `gorilla/evidence/<YYYY-MM-DD>/claude-code-smoke.md`.

### Codex Resume
Purpose: prove a Codex implementation operation returns a continuation handle and that `story-continue` can resume it.

- `story-implement`: `$CLI story-implement --spec-pack-root "$SPEC" --story-id 03-smoke-continuation --config "impl-run.codex-smoke.json" --json`
- `story-continue`: reuse the returned continuation handle with `$CLI story-continue --spec-pack-root "$SPEC" --story-id 03-smoke-continuation --provider <provider> --session-id <sessionId> --followup-text "Reply with one sentence confirming the continuation handle works. Do not make additional file edits unless required." --config "impl-run.codex-smoke.json" --json`

Save the resume report to `gorilla/evidence/<YYYY-MM-DD>/codex-resume.md`.

### Codex Structured Output
Purpose: prove Codex can return the quick-fix structured payload for a tiny target-codebase-only edit.

- `quick-fix`: `$CLI quick-fix --spec-pack-root "$SPEC" --config "impl-run.codex-smoke.json" --working-directory "$SPEC/target-codebase" --request-text "Make exactly one documentation-only edit: change the README H1 from 'Animal Summary Target Codebase' to 'Animal Summary Smoke Fixture'. Do not edit any other file." --json`

Save the structured-output report to `gorilla/evidence/<YYYY-MM-DD>/codex-structured-output.md`.

### Codex Stall
Purpose: prove the runtime reports provider stalls quickly instead of hanging.

1. Export `PATH="$(pwd)/gorilla/shims:$PATH"` so the local `codex` shim is chosen first.
2. Run `$CLI story-implement --spec-pack-root "$SPEC" --story-id 00-foundation --config "impl-run.stall-smoke.json" --json`.
3. Confirm the envelope surfaces a blocked stall outcome rather than hanging indefinitely.
4. Reset `PATH` after the run.

Save the stall report to `gorilla/evidence/<YYYY-MM-DD>/codex-stall.md`.

## Evidence Expectations
- Use `gorilla/evidence-template.md` for every report.
- Record the exact command you ran for each operation.
- Include the returned envelope status and outcome.
- Verify the persisted artifact path on disk for each operation.
- When a continuation handle appears, record whether you exercised it.
- If expected and actual shapes diverge, call that out explicitly under divergences.

## Non-Smoke Operations
The release matrix intentionally does not run these broader operations. Run this section only for a full operation coverage pass, not for bounded release evidence. Use implementation-grade configs and record any reports outside the canonical release matrix unless a release lead explicitly asks for them.

- `story-self-review`: after `story-implement` or `story-continue` returns a continuation handle, run `$CLI story-self-review --spec-pack-root "$SPEC" --story-id 03-smoke-continuation --provider <provider> --session-id <sessionId> --passes 1 --config "impl-run.codex.json" --json`
- `epic-verify`: `$CLI epic-verify --spec-pack-root "$SPEC" --config "impl-run.claude.json" --json`
- `epic-synthesize`: `$CLI epic-synthesize --spec-pack-root "$SPEC" --verifier-report "$SPEC/seed-verifier-reports/codex-revise.json" --verifier-report "$SPEC/seed-verifier-reports/claude-code-pass.json" --config "impl-run.codex.json" --json`
- `epic-cleanup`: `$CLI epic-cleanup --spec-pack-root "$SPEC" --cleanup-batch "$SPEC/seed-cleanup-batches/cleanup-batch-01.md" --config "impl-run.codex.json" --json`

## Deliberate Drift Self-Test
Introduce one known parser mismatch, rerun the affected path, confirm the divergence is surfaced, then document the result in `gorilla/self-test-log.md`.
