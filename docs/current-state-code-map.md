# Current State Code Map

Generated: 2026-05-02

Use this as a guided read of the current implementation.

## Start Here

- `package.json`: package identity, exports, CLI binary, scripts, Node engine, and distribution files.
- `.github/workflows/ci.yml`: default Blacksmith CI gate.
- `.github/workflows/integration.yml`: scheduled/manual real-provider gate.
- `.github/workflows/publish.yml`: release rehearsal and live publish gate.
- `docs/release-runbook.md`: maintainer release procedure.

## CLI Surface

- `src/bin/lbuild-impl.ts`: CLI entrypoint and command registration.
- `src/cli/commands/*.ts`: thin command wrappers for each operation.
- `src/cli/output.ts`: text/JSON output behavior.
- `src/cli/envelope.ts`: CLI envelope presentation helpers.

Story-orchestrate surface:

- `src/cli/commands/story-orchestrate*.ts`: `run`, `validate`, `resume`, and `status` wrappers.

## SDK Surface

- `src/sdk/index.ts`: public SDK exports.
- `src/sdk/operations/*.ts`: operation entrypoints.
- `src/sdk/contracts/*.ts`: public operation and envelope contracts.
- `src/sdk/errors/*.ts`: public typed error hierarchy.

## Runtime Core

- `src/core/result-contracts.ts`: canonical envelope and artifact result construction.
- `src/core/config-schema.ts`: run configuration schema.
- `src/core/spec-pack.ts`: spec-pack loading and validation.
- `src/core/artifact-writer.ts`: artifact allocation and persistence.
- `src/core/runtime-progress.ts`: progress/status persistence.
- `src/core/command-errors.ts`: error classification for CLI and SDK callers.
- `src/core/heartbeat.ts`: primitive and story-level caller heartbeat emission.
- `src/core/story-run-discovery.ts`: durable story-run selection by story id / story run id.
- `src/core/story-run-ledger.ts`: current snapshot, event history, and final-package persistence for story-lead attempts.
- `src/core/story-lead.ts`: story-lead runtime surface, provider composition, and durable recovery.
- `src/core/review-ruling.ts`: review-request and ruling history shaping for story-lead resume/final-package state.
- `src/core/story-final-package.ts`: story-lead final package assembly, log handoff, and cleanup handoff shaping.
- `src/core/story-implementor.ts`: story implementation orchestration.
- `src/core/story-verifier.ts`: story verification orchestration.
- `src/core/quick-fix.ts`: bounded fix orchestration.
- `src/core/epic-verifier.ts`: epic verification orchestration.
- `src/core/epic-synthesizer.ts`: epic synthesis orchestration.
- `src/core/epic-cleanup.ts`: cleanup-batch orchestration.

## Provider Layer

- `src/core/provider-adapters/claude-code.ts`: Claude Code adapter.
- `src/core/provider-adapters/codex.ts`: Codex adapter.
- `src/core/provider-adapters/shared.ts`: shared provider runner utilities.
- `src/core/provider-checks.ts`: provider availability and auth checks.
- `src/core/provider-adapters/codex-output-schema.ts`: Codex structured-output schema handling.

## Infrastructure

- `src/infra/env-allowlist.ts`: subprocess environment construction.
- `src/infra/fs-atomic.ts`: durable atomic write helper.
- `src/package-metadata.ts`: package name/version metadata used by runtime surfaces.

## Prompt Assets

- `src/prompts/base/*.md`: operation base prompts.
- `src/prompts/snippets/*.md`: reusable prompt sections.
- `src/references/*.md`: embedded reference material.
- `src/core/embedded-assets.generated.ts`: generated embedded asset payload.

## Tests

- `tests/unit/**`: fast default test project.
- `tests/package/**`: package, release, workflow, dist, and installation tests.
- `tests/integration/**`: real-provider harness tests.
- `tests/support/**`: shared test helpers and parser-contract fixtures.

Important release tests:

- `tests/package/release/workflow.test.ts`: publish workflow structure and release gates.
- `tests/package/release/runbook.test.ts`: release runbook structural coverage.
- `tests/package/release/evidence-script.test.ts`: gorilla evidence checker behavior.
- `tests/package/cli/pack-and-install-smoke.test.ts`: install smoke coverage.

## Gorilla And Release Helpers

- `gorilla/README.md`: gorilla fixture layout and release matrix.
- `gorilla/prompt.md`: operator prompt for evidence generation.
- `gorilla/evidence-template.md`: required evidence report shape.
- `gorilla/reset.ts`: fixture reset helper.
- `scripts/check-release-evidence.ts`: release evidence gate.
- `scripts/check-release-version-sync.ts`: package/changelog/version gate.
- `scripts/pack-and-install-smoke.ts`: local npm pack and install smoke.
