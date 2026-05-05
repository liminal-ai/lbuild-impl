# Current State: lbuild-impl

Generated: 2026-05-02

This is a Config A compact current-state baseline. The repository is small enough that one functional baseline, one technical baseline, one code map, and one drift ledger are more useful than a large reconstructed architecture packet.

## Status

`lbuild-impl` is a standalone Node 24+ npm package that exposes the Liminal Build implementation runtime as both a CLI and SDK. The current release marker is `lbuild-impl@0.3.0`.

The package is no longer just an epic artifact. It has a tested distribution surface, real-provider integration gates, committed gorilla release evidence, and a live publish workflow.

Recent release evidence:

- Live `v0.3.0` Publish workflow succeeded in run `25197337957`.
- Blacksmith `default-ci` gate succeeded in job `73880814695`.
- Blacksmith `gorilla-evidence` gate succeeded in job `73880814701`.
- Blacksmith `integration` gate succeeded in job `73880962070`.
- GitHub-hosted final publish job succeeded in job `73881155110` with npm provenance.

## Functional Baseline

The CLI binary is `lbuild-impl`. The SDK exports the same operation family through `lbuild-impl/sdk`.

Current operations:

- `inspect`
- `preflight`
- `story-orchestrate`
- `story-implement`
- `story-continue`
- `story-self-review`
- `story-verify`
- `quick-fix`
- `epic-verify`
- `epic-synthesize`
- `epic-cleanup`
- `skill`

Each operation returns or prints a versioned result envelope. Envelopes carry the command name, status, outcome, error details when applicable, warnings, artifact references, timestamps, and operation-specific data.

The `skill` command is the exception to the envelope contract: it is a model-facing markdown delivery surface for the `ls-impl` orchestration skill. The root load prints authored skill onboarding plus an auto-generated directory, and chunk loads return bounded markdown sections with carry-forward guidance.

`story-orchestrate` adds a durable story-lead surface on top of the primitive operations. It can validate, start, resume, and inspect one story-owned attempt, while impl-lead remains responsible for outer acceptance, log updates, story commits, and cleanup carry-forward. The validate surface is the deterministic pre-run checkpoint: it reuses inspect/preflight/discovery logic, captures a pre-story baseline seed, and surfaces start blockers before expensive provider work begins. When callers pass an explicit unknown story-run id to `resume` or `status`, the operation returns `invalid-story-run-id` instead of silently selecting another attempt. Resume responses that accept a review request or ruling also surface the durable persisted caller-input artifact path in the result.

The implementation runtime writes durable artifacts under the spec pack. `inspect` is intentionally read-only. Mutating operations reserve artifact paths, write through atomic helpers, and preserve continuation/progress information where the operation supports it.

Provider-backed operations support Claude Code and Codex through provider adapters. Primitive commands and `story-orchestrate` emit caller-facing heartbeat summaries on `stderr` while work is active, without changing the exact final JSON envelope on `stdout`. Real-provider integration runs are invoked through `npm run test:integration` and `npm run verify-all`; when provider binaries, auth, or required environment are missing, the integration suite fails loudly instead of skipping internally.

## Release Baseline

The active release path is documented in `docs/release-runbook.md`.

Release automation uses:

- Node 24.
- Blacksmith runner label `blacksmith-2vcpu-ubuntu-2404` for CI, gorilla evidence, and integration gates.
- Default CI gate: `npm run verify` plus `npm run test:package`.
- Real-provider gate: `npm run test:integration`.
- Gorilla evidence gate: `scripts/check-release-evidence.ts`.
- Version sync gate: `scripts/check-release-version-sync.ts`.
- Final npm publish on a GitHub-hosted runner with `npm publish --access public --provenance`.

Manual `workflow_dispatch` publish runs are rehearsal-only. They validate the release candidate and run dry-run publication logic. If the requested package version already exists on npm, the workflow validates package shape with `npm pack --dry-run --json` instead of trying to republish the existing version.

## Test Baseline

Tests are organized by execution tier:

- `tests/unit/**`: default local and CI tests.
- `tests/package/**`: package shape, release workflow, distribution, and runbook tests.
- `tests/integration/**`: real-provider harness tests.
- `tests/support/**`: shared helpers and fixtures.

Common gates:

- `npm run verify`: format check, lint, typecheck, captured baseline guard, and unit tests.
- `npm run test:package`: package/release tests.
- `npm run test:integration`: real-provider integration tests.
- `npm run verify-all`: default, package, and integration gates. This is the deep story-completion and epic-closeout gate.
- `npm run pack-and-install-smoke`: local package install smoke.

## Read Path

For current implementation work, read these first:

1. `docs/current-state.md`
2. `docs/current-state-tech-design.md`
3. `docs/current-state-code-map.md`
4. `docs/release-runbook.md`
5. `gorilla/README.md` and `gorilla/prompt.md` for release evidence work

The original epic docs under `docs/spec-build/epics/02-standalone-liminal-sdk-cli/` remain useful for historical intent and acceptance traceability. When they disagree with current-state docs, current code, tests, and workflows are the source of truth.
