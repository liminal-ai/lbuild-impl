# Changelog

## Unreleased

## 0.4.0 - 2026-05-03

- Adds configurable `story_lead` provider composition for `story-orchestrate`, including Codex and Claude-backed smoke coverage before a default provider is locked in.
- Refreshes the CLI-delivered `ls-impl` skill so caller-harness versus provider-harness language, story-id recovery, commit obligations, and cleanup handoff guidance match the shipped orchestration surface.
- Updates README and current-state docs to describe `story-orchestrate`, caller-facing heartbeats, and story-lead runtime boundaries.
- Hardens Windows compatibility with file URL path conversion, PATHEXT-aware provider lookup, Windows env preservation, and retry-on-lock atomic writes.
- Adds Codex sandbox/approval policy guidance plus clearer resume schema-drift handling for retained runs.

## 0.3.0 - 2026-05-01

- Adds CLI-delivered `ls-impl` skill onboarding through `lbuild-impl skill ls-impl`, with bounded markdown chunk reads and an auto-generated skill directory.
- Adds public SDK helpers for loading embedded skill content and reading individual skill chunks.
- Embeds editable skill markdown assets in the package build so the CLI and SDK stay version-aligned with the implementation runtime.

## 0.2.3 - 2026-04-30

- Restores npm provenance by running only the final publish job on GitHub-hosted runners while keeping CI, gorilla evidence, and real-provider integration gates on Blacksmith.

## 0.2.2 - 2026-04-30

- Reworks the root CLI help into an agent-oriented onboarding screen that appears for no args, `-h`, and `--help`.
- Clarifies the relationship between `liminal-spec` spec packs and `lbuild-impl` story build/verify workflows.
- Refreshes README, current-state docs, and the release runbook after the initial public publish and Blacksmith CI migration.
- Loosens help-output tests so they guard CLI behavior without freezing specific help wording.
- Published from Blacksmith without npm provenance; superseded by `0.2.3` for a provenance-backed publish.

## 0.2.0 - 2026-04-29

- Hardens release gates with strict real-provider auth behavior, package-shape testing, runtime version sync, and a coherent manual dry-run workflow.
- Makes CLI/SDK contracts safer: read-only `inspect`, unknown flag rejection, corrected internal-error classification, env override semantics, and richer provider diagnostics.
- Adds bounded gorilla smoke configs and real four-report release evidence for Claude Code, Codex, Copilot, and stall handling.
- Improves durability and artifact hygiene with fsynced atomic writes and stale reservation cleanup.
- Reconciles epic/spec/test-plan docs with the implemented `lbuild-impl` package, release matrix, and three-project Vitest topology.

## 0.1.0 - 2026-04-29

- First public release of `lbuild-impl`.
- Ships the standalone CLI and SDK runtime, real-provider verification layers, and release automation.
