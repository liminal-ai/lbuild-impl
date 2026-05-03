# Story 5: Provider Liveness, Verifier Accounting, and Stale Process Handling

### Summary
<!-- Jira: Summary field -->

Fix quiet provider liveness, report verifier lanes independently, and clean up or mark stale child provider processes after interruptions.

### Description
<!-- Jira: Description field -->

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

**Objective:** Prevent valid quiet providers from being killed while preserving clear startup, stall, lane, and interruption evidence.

**In Scope:**
- Claude Code `-p` non-streaming quiet-call behavior
- Provider liveness states for startup, output, silence, stall, and completion
- Multi-lane verifier status and terminal accounting
- Interrupted-run stale process cleanup or abandonment records

**Out of Scope:**
- Provider config alias removal owned by Story 4
- Artifact provenance owned by Story 6

**Dependencies:** Story 4

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.6:** Non-streaming Claude Code `-p` provider calls are not failed merely because no output appears before final completion.

- **TC-4.6a: Quiet healthy Claude call survives startup window**
  - Given: A Claude Code `-p` call has started successfully and remains quiet while work is active
  - When: The old startup timeout interval elapses
  - Then: The runtime does not kill the provider solely for lack of streamed output
- **TC-4.6b: True startup failure still fails**
  - Given: A Claude Code provider process fails to start or exits immediately
  - When: The runtime monitors startup
  - Then: The runtime fails with a startup error

**AC-4.7:** Provider liveness reporting distinguishes startup, first output, progress, silence, and terminal completion.

- **TC-4.7a: Liveness state reported**
  - Given: A provider-backed operation is active
  - When: The caller inspects status or progress
  - Then: The output distinguishes whether the operation is starting, active with output, active but silent, stalled, or terminal
- **TC-4.7b: Silence does not equal stall before threshold**
  - Given: A provider-backed operation is quiet but below its stall threshold
  - When: Status is reported
  - Then: The operation is reported as active but silent rather than failed

**AC-4.8:** Multi-lane verifier runs report lane status independently.

- **TC-4.8a: Lane-specific status**
  - Given: Multiple verifier lanes are running
  - When: One lane is quiet, one lane completes, and one lane is still active
  - Then: Status reports each lane separately
- **TC-4.8b: Mixed lane status not prematurely terminal**
  - Given: At least one verifier lane is still active
  - When: Another lane reports failure or silence
  - Then: The verifier batch does not report final terminal failure until the batch terminal conditions are met

**AC-4.9:** Stale provider processes from interrupted runs are cleaned up or explicitly marked abandoned.

- **TC-4.9a: Stale process cleanup**
  - Given: A story-orchestrate run is interrupted while provider child processes are active
  - When: The runtime handles interruption
  - Then: Active child processes are stopped or recorded as abandoned with enough identity to investigate
- **TC-4.9b: New run does not confuse old process output**
  - Given: A new story-orchestrate run starts after an interrupted run
  - When: Old provider output appears or old artifacts remain
  - Then: The new run does not treat old process output as current-run evidence

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story fixes the provider/process failures that can make orchestration look dead when it is healthy, or healthy when it is actually stale. Startup health, first output, active silence, true stall, terminal completion, and whole-run timeout must be distinct states.

Claude Code `-p --output-format json` is the sharp case: after successful spawn, no streamed output is expected until final completion. Lack of output after spawn is `active-silent`; it is not a startup failure by itself.

#### Implementation Targets

| Area | Files |
|------|-------|
| Shared provider lifecycle | `src/core/provider-adapters/shared.ts` |
| Claude Code behavior | `src/core/provider-adapters/claude-code.ts` |
| Verifier lane accounting | `src/core/epic-verifier.ts` |
| Story-run cleanup | `src/core/story-lead.ts` |
| Tests | `tests/unit/core/provider-liveness.test.ts`, `tests/unit/core/epic-verifier-lane-accounting.test.ts`, `tests/unit/core/story-lead-process-cleanup.test.ts` |

#### Design References

- [tech-design.md §Flow 5](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:279), lines 279-324
- [tech-design.md §Provider Liveness Interface](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:602), lines 602-615
- [tech-design.md §Work Breakdown Chunk 5](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:724), lines 724-738
- [test-plan.md §Anti-Shim Integration Coverage](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:27), lines 27-41
- [test-plan.md §TC Mapping](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:149), lines 149-156

#### Test Mapping

| TC | Test File | Test Description |
|----|-----------|------------------|
| TC-4.6a, TC-4.6b, TC-4.7a, TC-4.7b | `tests/unit/core/provider-liveness.test.ts` | quiet healthy Claude calls survive startup window; true startup failures still fail; liveness reports all states |
| TC-4.8a, TC-4.8b | `tests/unit/core/epic-verifier-lane-accounting.test.ts` | verifier lanes report independently and do not prematurely terminal-fail mixed active batches |
| TC-4.9a, TC-4.9b | `tests/unit/core/story-lead-process-cleanup.test.ts` | interrupted runs stop or mark child processes abandoned and new runs reject old output as evidence |

#### Non-TC Decided Tests

None.

#### Anti-Shim Requirements

- Provider liveness tests must use a fake executable child process that starts, stays quiet past the old startup window, then exits successfully.
- Do not satisfy quiet-call coverage with a mocked runner function that immediately returns success.
- Stale-process tests must include run identity so old process output cannot be accepted as current-run evidence.

#### Verification

- Targeted: `bun run test -- --run tests/unit/core/provider-liveness.test.ts tests/unit/core/epic-verifier-lane-accounting.test.ts tests/unit/core/story-lead-process-cleanup.test.ts`
- Story gate: `npm run green-verify`
- Story completion gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Quiet healthy Claude Code `-p` calls are not killed only for lack of output
- [ ] True startup failures still fail as startup errors
- [ ] Status distinguishes provider liveness states
- [ ] Verifier lanes report independently and batch terminal accounting waits for terminal conditions
- [ ] Interrupted child processes are stopped or recorded as abandoned with identity
- [ ] New runs do not treat old process output as current evidence
- [ ] `story-verify` returns `pass`
- [ ] `npm run green-verify` passes
- [ ] `npm run verify-all` passes
- [ ] Receipt is complete
- [ ] Story commit is landed
