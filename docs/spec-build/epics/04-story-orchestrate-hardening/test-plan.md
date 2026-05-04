# Test Plan: Story-Orchestrate Hardening and Process Refinement

## Purpose

This test plan maps Epic 04 test conditions to concrete automated, integration, package, and manual verification items. Tests should enter through CLI/SDK/runtime public surfaces and mock only external boundaries: provider processes, filesystem failures, and platform-specific executable lookup.

## Verification Gates

| Gate | Command | Required Use |
|------|---------|--------------|
| Red | `npm run red-verify` | After adding tests/stubs before implementation |
| Green | `npm run green-verify` | Story gate |
| Deep | `npm run verify-all` | Story completion and epic closeout gate |
| Targeted | `bun run test -- --run <files>` | Targeted Vitest slices |
| Integration | `npm run test:integration` | Real-provider integration diagnosis and release evidence |

Raw `bun test` is not an accepted verification path.

## Mock Strategy

Provider processes are external. Unit and package tests should fake provider binaries, child process spawn/exec, or provider adapter results. Internal runtime modules such as the ledger, state machine, context builder, and story lead loop should be exercised together through SDK operations where practical.

Filesystem writes are an external boundary only when testing write failure behavior. Normal story-run tests should use real temp directories and real artifact writes.

Integration tests are real-provider tests. If the integration command is invoked and provider binaries, auth, or required environment are missing, the tests fail with a prerequisite error. They do not skip internally.

## Anti-Shim Integration Coverage

Some failures from Epic 03 looked plausible because artifacts, scaffolds, or provider envelopes existed even when the current run had not actually produced the proof being claimed. Epic 04 tests need explicit anti-shim coverage in the places where models tend to fake success.

| Risk | Required Test Shape | Mock Boundary |
|------|---------------------|---------------|
| Preseeded artifact counted as current proof | Create artifact-like files before the run, execute `story-orchestrate`, and assert final evidence marks them as preexisting or rejects them as proof | Real temp filesystem, controlled provider fixture allowed |
| Planner prompt only references artifacts instead of including them | Build a run with prior implement/verifier/quick-fix artifacts and inspect the actual planner input sent to the provider adapter | Mock provider adapter capture only |
| Integration suite silently passes without auth | Invoke integration tests with missing auth in an integration environment and assert prerequisite failure | No provider mock |
| `verify-all` omits integration while claiming deep verification | Inspect package script and run a controlled failing integration prerequisite to prove `verify-all` reaches integration | No integration mock for gate proof |
| Quiet provider call replaced by instant mock success | Use a fake executable child process that starts, stays quiet past the old startup window, then exits successfully | Fake process boundary, not mocked runner function |
| Windows executable lookup hard-coded to POSIX names | Test lookup against PATH/PATHEXT fixtures containing `.cmd`/`.bat` and POSIX binaries | Mock filesystem/PATH lookup only |
| Codex resume schema drift hidden by permissive parsing | Feed resume output that lacks required schema fields and assert invalid-provider-output/schema-drift failure | Fixture output, real parser |

These tests are not philosophical purity checks. They protect the exact areas where a model can make the implementation look done by inserting a mock, fallback, fixture, or scaffold in the path being verified.

## Non-TC Decided Tests

These tests come from implementation risk discovered during design. They do not map 1:1 to an epic TC, but they should be carried into the relevant stories.

| Test | File | Reason |
|------|------|--------|
| Snapshot reader rejects removed `storyLeadSession` fields | `tests/unit/core/story-run-ledger.test.ts` | The cleaned story-run contract no longer tolerates planner-session persistence in snapshots |
| Snapshot writer persists `lifecycleState` beside public `status` | `tests/unit/core/story-run-ledger.test.ts` | Keeps state-machine detail separate from terminal/public status vocabulary |
| Story-lead action schema rejects extra keys after action discrimination | `tests/unit/core/story-lead-state-machine.test.ts` | Prevents loose action envelopes from hiding model drift |
| Planner provider invocation ignores returned story-lead session id on later planner turns | `tests/unit/core/story-lead-stateless.test.ts` | Protects the no-hidden-conversation-memory principle |
| Context builder records largest context sources on overflow | `tests/unit/core/story-lead-context.test.ts` | Makes fail-loud overflow diagnosable without summarizing |

## Planned Test Files

| Test File | Purpose |
|-----------|---------|
| `tests/unit/core/story-lead-state-machine.test.ts` | State/action vocabulary, invalid action errors |
| `tests/unit/core/story-lead-context.test.ts` | Full planner context inclusion/exclusion, self-notes, overflow |
| `tests/unit/core/story-lead-stateless.test.ts` | No story-lead session resume, action execution loop behavior |
| `tests/unit/core/story-run-discovery.test.ts` | Resume by run id/story id, ambiguity, candidate selection |
| `tests/unit/core/config-schema.test.ts` | Required provider, alias rejection, timeout settings |
| `tests/unit/core/provider-liveness.test.ts` | Startup/silence/stall/timeout lifecycle |
| `tests/unit/core/epic-verifier-lane-accounting.test.ts` | Multi-lane verifier status and terminal accounting |
| `tests/unit/core/story-lead-process-cleanup.test.ts` | Stale provider process cleanup/abandonment |
| `tests/unit/core/story-run-ledger.test.ts` | Artifact-before-state advancement, notes/events, reopen preservation |
| `tests/unit/core/story-final-package.test.ts` | Evidence provenance and preseeded-artifact rejection |
| `tests/unit/core/runtime-identity.test.ts` | Invocation source and version reporting |
| `tests/unit/core/provider-adapter.test.ts` | Codex sandbox/resume schema-drift behavior |
| `tests/unit/infra/fs-atomic.test.ts` | Windows transient rename retry |
| `tests/unit/infra/env-allowlist.test.ts` | Windows env variable preservation |
| `tests/unit/core/provider-executable-resolution.test.ts` | Windows shim and POSIX executable lookup |
| `tests/unit/scripts/sync-impl-cli-assets.test.ts` | Windows-safe module URL path conversion |
| `tests/package/cli/story-orchestrate-help.test.ts` | CLI help and local/global guidance |
| `tests/package/cli/story-orchestrate-status.test.ts` | Running/terminal story-orchestrate status output |
| `tests/package/package-scripts.test.ts` | `verify-all` includes integration |
| `tests/package/skills/ls-impl-story-cycle.test.ts` | Skill normal path and primitive de-emphasis |
| `tests/package/release/version-0-4.test.ts` | Version files and CLI reported version |
| `tests/integration/helpers.test.ts` | Integration prerequisite failure behavior |
| `tests/integration/*.test.ts` | Real-provider integration, fail-if-invoked prerequisites |
| `docs/spec-build/epics/04-story-orchestrate-hardening/windows-smoke-checklist.md` | Maintainer-run Windows smoke evidence |

## TC Mapping

| TC | Test File / Check | Test Description | Coverage Notes |
|----|-------------------|------------------|----------------|
| TC-1.1a | `tests/package/skills/ls-impl-story-cycle.test.ts` | skill happy path directs normal story execution to `story-orchestrate` | Automated text/package |
| TC-1.1b | `tests/package/skills/ls-impl-story-cycle.test.ts` | primitive-chain happy path is not presented as primary workflow | Automated text/package |
| TC-1.2a | `tests/package/cli/story-orchestrate-help.test.ts` | primitive story commands remain available in CLI help/reference | Automated package |
| TC-1.2b | `tests/package/skills/ls-impl-story-cycle.test.ts` | primitive operations are described as building blocks/recovery tools | Automated text/package |
| TC-1.3a | `tests/package/skills/ls-impl-story-cycle.test.ts` | story-lead `accepted` still requires impl-lead acceptance tasks | Automated text/package |
| TC-1.3b | `tests/package/skills/ls-impl-story-cycle.test.ts` | blocked/failed/interrupted/needs-ruling guidance names caller action | Automated text/package |
| TC-1.4a | `tests/package/cli/story-orchestrate-help.test.ts` | `story-orchestrate --help` describes composed one-story operation | Automated package |
| TC-1.4b | `tests/package/cli/story-orchestrate-help.test.ts` | help states `story_lead_provider` is required | Automated package |
| TC-1.5a | `tests/package/skills/ls-impl-story-cycle.test.ts` | guidance distinguishes local CLI from global published CLI | Automated text/package |
| TC-1.5b | `tests/package/skills/ls-impl-story-cycle.test.ts` | guidance says missing unreleased global command is not product defect | Automated text/package |
| TC-2.1a | `tests/unit/core/story-lead-stateless.test.ts` | second planner turn calls provider without prior story-lead resume session id | Automated unit |
| TC-2.1b | `tests/unit/core/story-lead-stateless.test.ts` | snapshot does not require/persist story-lead provider session for continuation | Automated unit |
| TC-2.2a | `tests/unit/core/story-lead-context.test.ts` | active story file full content included | Automated unit |
| TC-2.3a | `tests/unit/core/story-lead-context.test.ts` | full test plan content included | Automated unit |
| TC-2.4a | `tests/unit/core/story-lead-context.test.ts` | current snapshot included | Automated unit |
| TC-2.4b | `tests/unit/core/story-lead-context.test.ts` | full event history included | Automated unit |
| TC-2.5a | `tests/unit/core/story-lead-context.test.ts` | implement/continue result artifact content included in full | Automated unit |
| TC-2.5b | `tests/unit/core/story-lead-context.test.ts` | verifier result artifact content included in full | Automated unit |
| TC-2.5c | `tests/unit/core/story-lead-context.test.ts` | quick-fix artifact content included in full | Automated unit |
| TC-2.6a | `tests/unit/core/story-lead-context.test.ts` | epic file content excluded | Automated unit |
| TC-2.6b | `tests/unit/core/story-lead-context.test.ts` | tech design content excluded | Automated unit |
| TC-2.6c | `tests/unit/core/story-lead-context.test.ts` | git status/diff/workspace summaries excluded | Automated unit |
| TC-2.7a | `tests/unit/core/story-run-ledger.test.ts` | action self-note is stored in story-run record | Automated unit |
| TC-2.7b | `tests/unit/core/story-run-ledger.test.ts` | missing self-note does not invalidate action or invent blank note | Automated unit |
| TC-2.8a | `tests/unit/core/story-lead-context.test.ts` | all prior self-notes included in later planner context | Automated unit |
| TC-2.8b | `tests/unit/core/story-lead-context.test.ts` | latest note can be highlighted while older notes remain | Automated unit |
| TC-2.9a | `tests/unit/core/story-lead-context.test.ts` | first planner turn includes seeded self-note example | Automated unit |
| TC-2.9b | `tests/unit/core/story-run-ledger.test.ts` | seeded instruction is distinguishable from runtime-produced notes | Automated unit |
| TC-2.10a | `tests/unit/core/story-lead-context.test.ts` | context overflow error includes story/provider/source diagnostics | Automated unit |
| TC-2.10b | `tests/unit/core/story-lead-context.test.ts` | overflow does not summarize, truncate, or omit required artifacts | Automated unit |
| TC-2.11a | `tests/unit/core/story-lead-context.test.ts` | story and test plan presented as requirements source | Automated unit |
| TC-2.11b | `tests/unit/core/story-lead-stateless.test.ts` | insufficient story-local context routes to documented terminal result | Automated unit |
| TC-3.1a | `tests/package/skills/ls-impl-story-cycle.test.ts` | developer docs include state-machine diagram | Automated text/package |
| TC-3.1b | `tests/unit/core/story-lead-state-machine.test.ts` | each persisted state has plain description/caller implication | Automated unit |
| TC-3.2a | `tests/unit/core/story-lead-state-machine.test.ts` | valid action accepted for current state | Automated unit |
| TC-3.2b | `tests/unit/core/story-lead-state-machine.test.ts` | invalid action rejected with state/action error | Automated unit |
| TC-3.3a | `tests/unit/core/story-lead-state-machine.test.ts` | accepted terminal result includes impl-lead evidence requirement | Automated unit/package |
| TC-3.3b | `tests/unit/core/story-lead-state-machine.test.ts` | needs-ruling terminal result includes ruling request | Automated unit |
| TC-3.3c | `tests/unit/core/story-lead-state-machine.test.ts` | blocked terminal result includes blocker detail | Automated unit |
| TC-3.3d | `tests/unit/core/story-lead-state-machine.test.ts` | failed terminal result includes failure detail | Automated unit |
| TC-3.3e | `tests/unit/core/story-lead-state-machine.test.ts` | interrupted terminal result includes recovery guidance | Automated unit |
| TC-3.4a | `tests/package/cli/story-orchestrate-status.test.ts` | running status shows state, latest event, child op, status path, elapsed time | Automated package |
| TC-3.4b | `tests/package/cli/story-orchestrate-status.test.ts` | terminal status shows terminal result and final package path | Automated package |
| TC-3.5a | `tests/unit/core/story-run-discovery.test.ts` | resume by run id reconstructs state from artifacts | Automated unit |
| TC-3.5b | `tests/unit/core/story-run-discovery.test.ts` | resume by story id resolves single resumable run | Automated unit |
| TC-3.5c | `tests/unit/core/story-run-discovery.test.ts` | ambiguous resume lists candidates | Automated unit |
| TC-3.6a | `tests/unit/core/story-run-ledger.test.ts` | reopening preserves prior final package | Automated unit |
| TC-3.6b | `tests/unit/core/story-run-ledger.test.ts` | reopening appends event with caller rationale | Automated unit |
| TC-3.7a | `tests/unit/core/story-lead-stateless.test.ts` | child failure envelope recorded and passed to next planner turn | Automated unit |
| TC-3.7b | `tests/unit/core/story-run-ledger.test.ts` | crash after child result leaves recoverable artifact | Automated unit |
| TC-3.8a | `tests/unit/core/story-lead-state-machine.test.ts` | validation errors use documented state/action names | Automated unit |
| TC-4.1a | `tests/unit/core/config-schema.test.ts` | missing `story_lead_provider` fails before story work | Automated unit |
| TC-4.1b | `tests/unit/core/config-schema.test.ts` | valid `story_lead_provider` accepted | Automated unit |
| TC-4.2a | `tests/unit/core/config-schema.test.ts` | `story_lead` without provider is rejected with guidance | Automated unit |
| TC-4.2b | `tests/unit/core/config-schema.test.ts` | `story_lead` is not normalized to `story_lead_provider` | Automated unit |
| TC-4.3a | `tests/package/skills/ls-impl-story-cycle.test.ts` | guidance shows Codex `gpt-5.5` as recommended setup | Automated text/package |
| TC-4.3b | `tests/package/skills/ls-impl-story-cycle.test.ts` | guidance says one planner turn returns one bounded action | Automated text/package |
| TC-4.4a | `tests/unit/core/config-schema.test.ts` | planner call uses planner timeout, not child timeout | Automated unit |
| TC-4.4b | `tests/unit/core/story-lead-stateless.test.ts` | planner timeout failure identifies planner timeout | Automated unit |
| TC-4.5a | `tests/unit/core/story-lead-stateless.test.ts` | whole-run timeout interrupts or stops run per documented behavior | Automated unit |
| TC-4.5b | `tests/unit/core/story-lead-stateless.test.ts` | whole-run timeout reported distinctly from planner/child timeout | Automated unit |
| TC-4.6a | `tests/unit/core/provider-liveness.test.ts` | quiet healthy Claude `-p` call survives old startup window | Automated unit |
| TC-4.6b | `tests/unit/core/provider-liveness.test.ts` | true startup failure still fails | Automated unit |
| TC-4.7a | `tests/unit/core/provider-liveness.test.ts` | liveness reports starting/output/silent/stalled/terminal states | Automated unit |
| TC-4.7b | `tests/unit/core/provider-liveness.test.ts` | silence below threshold is active-silent, not failed | Automated unit |
| TC-4.8a | `tests/unit/core/epic-verifier-lane-accounting.test.ts` | verifier status reports lane-specific state | Automated unit |
| TC-4.8b | `tests/unit/core/epic-verifier-lane-accounting.test.ts` | mixed lane status does not prematurely mark batch terminal | Automated unit |
| TC-4.9a | `tests/unit/core/story-lead-process-cleanup.test.ts` | interrupted run stops or records active child processes as abandoned | Automated unit |
| TC-4.9b | `tests/unit/core/story-lead-process-cleanup.test.ts` | new run does not treat old process output as current evidence | Automated unit |
| TC-5.1a | `tests/unit/core/story-run-ledger.test.ts` | implement/continue artifact exists and is non-empty | Automated unit |
| TC-5.1b | `tests/unit/core/story-run-ledger.test.ts` | verify artifact exists and is non-empty | Automated unit |
| TC-5.1c | `tests/unit/core/story-run-ledger.test.ts` | quick-fix artifact exists and is non-empty | Automated unit |
| TC-5.2a | `tests/unit/core/story-run-ledger.test.ts` | state waits for durable artifact write | Automated unit |
| TC-5.2b | `tests/unit/core/story-run-ledger.test.ts` | failed write blocks state advancement | Automated unit |
| TC-5.3a | `tests/unit/core/story-final-package.test.ts` | final package marks current-run evidence separately | Automated unit |
| TC-5.3b | `tests/unit/core/story-final-package.test.ts` | preseeded files are not counted as current-run proof | Automated unit |
| TC-5.4a | `tests/integration/helpers.test.ts` or integration suite | missing integration flag/prereq fails when integration command invoked | Automated integration |
| TC-5.4b | `tests/integration/*.test.ts` | missing provider auth fails instead of skip | Automated integration |
| TC-5.4c | `tests/integration/*.test.ts` | no mock/partial fallback inside integration run | Automated integration |
| TC-5.5a | `tests/package/package-scripts.test.ts` | `verify-all` includes integration suite | Automated package |
| TC-5.5b | `docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md` and story DoD | story validation requires `verify-all` | Process/test-plan check |
| TC-5.6a | `tests/package/skills/ls-impl-story-cycle.test.ts` | targeted test guidance uses Vitest command | Automated text/package |
| TC-5.6b | `tests/package/skills/ls-impl-story-cycle.test.ts` | raw Bun runner warning present | Automated text/package |
| TC-5.7a | `tests/unit/core/runtime-identity.test.ts` | invocation source is local/global/bundled/unknown | Automated unit |
| TC-5.7b | `tests/unit/core/runtime-identity.test.ts` | version included when available | Automated unit |
| TC-5.7c | `tests/unit/core/runtime-identity.test.ts` | unknown source explicitly reported | Automated unit |
| TC-5.8a | `tests/package/cli/story-orchestrate-status.test.ts` | active status includes progress marker/latest event | Automated package |
| TC-5.8b | `tests/package/cli/story-orchestrate-status.test.ts` | terminal output includes marker and final artifact reference | Automated package |
| TC-5.9a | this file | every AC maps to test/manual item | Review check |
| TC-6.1a | `tests/unit/scripts/sync-impl-cli-assets.test.ts` | Windows file URL conversion avoids doubled drive paths | Automated unit |
| TC-6.2a | `tests/unit/core/provider-executable-resolution.test.ts` | Windows `.cmd`/`.bat` provider shims found | Automated unit |
| TC-6.2b | `tests/unit/core/provider-executable-resolution.test.ts` | POSIX provider lookup still works | Automated unit |
| TC-6.3a | `tests/unit/infra/env-allowlist.test.ts` | Windows-required env vars preserved | Automated unit |
| TC-6.3b | `tests/package/skills/ls-impl-story-cycle.test.ts` | env filtering policy documented | Automated text/package |
| TC-6.4a | `tests/unit/infra/fs-atomic.test.ts` | transient Windows rename failure retries with backoff | Automated unit |
| TC-6.4b | `tests/unit/infra/fs-atomic.test.ts` | non-transient write error still fails | Automated unit |
| TC-6.5a | `tests/unit/core/provider-adapter.test.ts` | Codex sandbox policy is configurable/applied | Automated unit |
| TC-6.5b | `tests/package/skills/ls-impl-story-cycle.test.ts` | Codex sandbox guidance present | Automated text/package |
| TC-6.6a | `tests/unit/core/provider-adapter.test.ts` | Codex resume preserves schema expectations or uses documented strategy | Automated unit |
| TC-6.6b | `tests/unit/core/provider-adapter.test.ts` | Codex resume schema drift produces clear error | Automated unit |
| TC-6.7a | `docs/spec-build/epics/04-story-orchestrate-hardening/windows-smoke-checklist.md` | Windows smoke checklist exists | Manual artifact |
| TC-6.7b | implementation log closeout | Parallels Windows result recorded | Manual maintainer check |
| TC-6.8a | `tests/package/release/version-0-4.test.ts` | package and version files report `0.4.0` | Automated package |
| TC-6.8b | `tests/unit/core/runtime-identity.test.ts` / CLI package test | built CLI reports `0.4.0` | Automated unit/package |

## Chunk Test Counts

| Chunk | Automated Tests | Manual Checks |
|-------|-----------------|---------------|
| Chunk 0: State vocabulary and test plan | 8-12 | 0 |
| Chunk 1: Default process docs | 8-12 | 0 |
| Chunk 2: Stateless planner context | 18-26 | 0 |
| Chunk 3: State/resume/reopen/results | 16-24 | 0 |
| Chunk 4: Config and timeout boundaries | 12-18 | 0 |
| Chunk 5: Provider liveness/process handling | 14-22 | 0 |
| Chunk 6: Artifact/evidence integrity | 10-16 | 0 |
| Chunk 7: Gates/integration/runtime identity | 12-18 | 0-1 |
| Chunk 8: Windows/release | 14-20 | 1 Windows smoke |

Estimated total: 112-168 automated tests plus one maintainer-run Windows smoke checklist. The upper bound is acceptable because many rows are small contract tests and several can share fixtures.

## Manual Windows Smoke Checklist

Create `windows-smoke-checklist.md` during Chunk 8 with these steps:

1. Build/install on Windows in Parallels.
2. Run `lbuild-impl --help`.
3. Run `lbuild-impl preflight` against a fixture spec pack.
4. Run provider lookup/preflight for installed provider shims.
5. Run a basic provider-backed operation where credentials are available.
6. Run `story-orchestrate --help`.
7. Run a minimal `story-orchestrate status` or mocked-provider smoke where feasible.
8. Record result, environment, version, and blockers in the implementation log.

## Reconciliation Checklist

- [ ] Every epic TC appears in the TC Mapping table.
- [ ] Every planned test file has at least one mapped TC.
- [ ] Every chunk lists test count estimates.
- [ ] `verify-all` includes integration and fails if integration prerequisites are absent.
- [ ] No raw `bun test` command appears as accepted guidance.
- [ ] Manual Windows smoke is represented as closeout evidence, not as a default CI requirement.
