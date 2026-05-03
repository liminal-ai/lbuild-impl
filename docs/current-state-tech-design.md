# Current State Tech Design

Generated: 2026-04-30

This document records the implemented architecture of `lbuild-impl` as it exists after the first public release hardening pass.

## Package Surface

The package is ESM-only and targets Node 24 or newer.

Published surfaces:

- Package root export: `lbuild-impl`
- SDK export: `lbuild-impl/sdk`
- Contracts export: `lbuild-impl/sdk/contracts`
- Errors export: `lbuild-impl/sdk/errors`
- CLI binary: `lbuild-impl`

The build is produced by `tsup`, followed by `scripts/ensure-bin-shebang.mjs` to keep the CLI executable shape valid.

## CLI And SDK Shape

The CLI entrypoint is `src/bin/lbuild-impl.ts`. Command modules live under `src/cli/commands/` and act as thin invocation wrappers around SDK operations.

The SDK public entrypoint is `src/sdk/index.ts`. SDK operations live under `src/sdk/operations/`; shared SDK contracts live under `src/sdk/contracts/`; typed SDK errors live under `src/sdk/errors/`.

The CLI and SDK share core runtime behavior instead of maintaining separate implementations.

## Runtime Core

The runtime core under `src/core/` owns:

- Spec-pack discovery and validation.
- Run configuration parsing.
- Prompt and reference assembly.
- Story and epic operation orchestration.
- Provider adapter dispatch.
- Result-envelope construction and classification.
- Artifact writing and continuation/progress persistence.

Atomic artifact writes are implemented in `src/infra/fs-atomic.ts` with temp-file write, sync, close, and rename behavior. Environment construction is implemented in `src/infra/env-allowlist.ts`; allowlisted parent variables are retained and caller-provided overrides win explicitly.

## Provider Layer

Provider adapters live under `src/core/provider-adapters/`.

Current provider binaries:

- Claude Code: `claude`
- Codex: `codex`
- Copilot: standalone `copilot` CLI installed from `@github/copilot`

Provider checks and adapters return structured runtime results. The real-provider integration gate installs the provider CLIs in GitHub Actions, authenticates Codex with `OPENAI_API_KEY`, and exercises the integration test suite directly through `npm run verify-all`. If provider binaries, auth, or required environment are missing when integration is invoked, the suite fails loudly instead of skipping.

## Release Automation

Active workflows:

- `.github/workflows/ci.yml`: push and pull request CI.
- `.github/workflows/integration.yml`: manual and weekly real-provider integration.
- `.github/workflows/publish.yml`: tag-push publish and manual dry-run rehearsal.

CI, gorilla evidence, and integration gates run on `blacksmith-2vcpu-ubuntu-2404`. The final npm publish job runs on `ubuntu-latest` because npm provenance currently requires a GitHub-hosted runner.

The publish workflow has four jobs:

- `default-ci`: validates manual inputs, installs dependencies, runs `npm run verify`, and runs `npm run test:package`.
- `integration`: installs/authenticates real provider CLIs and runs `npm run test:integration`.
- `gorilla-evidence`: validates committed gorilla evidence freshness and report shape.
- `publish`: builds on a GitHub-hosted runner, verifies version markers, and either publishes live with npm provenance on tag push or performs manual dry-run validation.

Manual publish runs cannot publish live. Live publication only occurs from a pushed `vX.Y.Z` tag.

## Gorilla Evidence

The release evidence contract is a bounded four-report matrix:

- `claude-code-smoke.md`
- `codex-resume.md`
- `copilot-structured-output.md`
- `codex-stall.md`

Evidence is stored under `gorilla/evidence/<YYYY-MM-DD>/`. The release gate accepts the freshest dated directory inside the configured freshness window and rejects reports with unresolved divergences.

The non-release gorilla prompt can exercise broader operation coverage, but the release gate intentionally checks the bounded matrix above.

## Test Architecture

Vitest has three projects:

- `default`: `tests/unit/**/*.test.ts`
- `package`: `tests/package/**/*.test.ts`
- `integration`: `tests/integration/**/*.test.ts`

Support helpers and parser-contract fixtures live under `tests/support/`.

The default CI workflow runs the default and package projects. The publish workflow adds real-provider integration and gorilla evidence gates before publishing.

## Operational Constraints

The repo contains historical epic docs that were written before the final package name, runner choice, test topology, and release evidence policy settled. Use this current-state document and the release runbook for present-day behavior.

Real-provider tests require valid `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GH_TOKEN` secrets in CI. Local integration runs require equivalent credentials and installed provider CLIs.

Manual release rehearsal validates a GitHub-visible ref, not an unpushed local tag. If the version already exists on npm, the dry-run path validates package shape with `npm pack --dry-run --json`.
