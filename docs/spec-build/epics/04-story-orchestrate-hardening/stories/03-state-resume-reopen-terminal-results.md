# Story 3: Story-Orchestrate State, Resume, Reopen, and Terminal Results

### Summary
<!-- Jira: Summary field -->

Expose caller-readable terminal results, status output, resume behavior, reopen history, and terminal progress markers.

### Description
<!-- Jira: Description field -->

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

**Objective:** Make story-orchestrate recovery and terminal interpretation understandable from logs, snapshots, CLI output, and artifacts.

**In Scope:**
- Accepted, needs-ruling, blocked, failed, and interrupted terminal results
- Status output for active and terminal runs
- Resume by run id and story id, including ambiguity handling
- Reopen history preservation
- Caller-readable state/action names in errors
- Progress and terminal markers for long-running operations

**Out of Scope:**
- Planner context assembly changes owned by Story 2
- Provider liveness internals owned by Story 5

**Dependencies:** Story 2

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-3.3:** Story-orchestrate terminal results are explicit.

- **TC-3.3a: Accepted terminal result**
  - Given: The story lead determines the story is complete at story-lead scope
  - When: The run reaches terminal state
  - Then: The result is `accepted` and includes evidence needed for implementation-lead review
- **TC-3.3b: Needs-ruling terminal result**
  - Given: The story lead cannot decide without caller input
  - When: The run reaches terminal state
  - Then: The result is `needs-ruling` and includes the specific ruling request
- **TC-3.3c: Blocked terminal result**
  - Given: The story cannot proceed because of a missing prerequisite or external blocker
  - When: The run reaches terminal state
  - Then: The result is `blocked` and includes blocker details
- **TC-3.3d: Failed terminal result**
  - Given: The story lead or runtime reaches a non-recoverable failure
  - When: The run reaches terminal state
  - Then: The result is `failed` and includes the failure details
- **TC-3.3e: Interrupted terminal result**
  - Given: The caller or runtime interrupts active work
  - When: The run records interruption
  - Then: The result is `interrupted` and includes recovery guidance

**AC-3.4:** `story-orchestrate status` shows current state, latest event, latest child operation, and terminal result when present.

- **TC-3.4a: Running status**
  - Given: A story run is active
  - When: The caller runs `story-orchestrate status`
  - Then: The output includes current state, latest event, latest child operation, status artifact path, and elapsed time
- **TC-3.4b: Terminal status**
  - Given: A story run has reached a terminal result
  - When: The caller runs `story-orchestrate status`
  - Then: The output includes the terminal result and final package path

**AC-3.5:** `story-orchestrate resume` reconstructs story-run state from durable artifacts.

- **TC-3.5a: Resume by run id**
  - Given: A previous story run has durable artifacts
  - When: The caller resumes by run id
  - Then: The runtime reconstructs state from artifacts and continues or reports terminal status
- **TC-3.5b: Resume by story id**
  - Given: A story has one resumable non-terminal run
  - When: The caller resumes by story id
  - Then: The runtime resolves the run and continues or reports status
- **TC-3.5c: Ambiguous resume**
  - Given: A story has multiple possible resumable runs
  - When: The caller resumes by story id without a run id
  - Then: The runtime fails with a clear ambiguity message listing candidate runs

**AC-3.6:** Reopening a story run preserves prior final packages and appends new events.

- **TC-3.6a: Prior final package preserved**
  - Given: A story run has a prior final package
  - When: The run is reopened for additional work
  - Then: The prior final package remains available as historical evidence
- **TC-3.6b: Reopen event recorded**
  - Given: A story run is reopened
  - When: The runtime records the reopen
  - Then: The event history contains a reopen event with caller rationale

**AC-3.8:** State and action names in errors are caller-readable.

- **TC-3.8a: Error names are understandable**
  - Given: A state or action validation error occurs
  - When: The error is shown to a caller
  - Then: The error uses the same documented state and action names shown in the state-machine vocabulary

**AC-5.8:** Terminal progress markers are available for long-running operations.

- **TC-5.8a: Active progress marker**
  - Given: A long-running provider-backed operation is active
  - When: The caller reads status output
  - Then: The output includes a current progress marker or latest event
- **TC-5.8b: Terminal marker**
  - Given: A long-running operation completes
  - When: The caller reads status or final output
  - Then: The output includes a terminal marker and final artifact reference

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story turns the durable story-run record into the caller-facing recovery surface. `status`, `resume`, and `reopen` should reconstruct state from artifacts rather than hidden provider state. Terminal results should tell the implementation lead what happened and what to do next.

Keep the public status vocabulary stable and expose the stricter `lifecycleState` beside it. Reopen preserves prior final packages and appends new events; it does not overwrite earlier evidence.

#### Implementation Targets

| Area | Files |
|------|-------|
| Run discovery/resume | `src/core/story-run-discovery.ts` |
| Ledger/reopen/final package references | `src/core/story-run-ledger.ts` |
| Runtime terminal handling | `src/core/story-lead.ts` |
| CLI surfaces | `src/cli/commands/story-orchestrate-status.ts`, `src/cli/commands/story-orchestrate-resume.ts` |
| Tests | `tests/unit/core/story-run-discovery.test.ts`, `tests/unit/core/story-run-ledger.test.ts`, `tests/package/cli/story-orchestrate-status.test.ts` |

#### Design References

- [tech-design.md §State Machine](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:66), lines 66-88
- [tech-design.md §Flow 4](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:258), lines 258-277
- [tech-design.md §Snapshot Compatibility](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:516), lines 516-538
- [tech-design.md §Work Breakdown Chunk 3](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:691), lines 691-706
- [test-plan.md §TC Mapping](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:124), lines 124-138 and 174-175

#### Test Mapping

| TC | Test File | Test Description |
|----|-----------|------------------|
| TC-3.3a, TC-3.3b, TC-3.3c, TC-3.3d, TC-3.3e, TC-3.8a | `tests/unit/core/story-lead-state-machine.test.ts` | terminal results and validation errors use caller-readable names and details |
| TC-3.4a, TC-3.4b, TC-5.8a, TC-5.8b | `tests/package/cli/story-orchestrate-status.test.ts` | running and terminal status show state, events, child operation, progress markers, and final package path |
| TC-3.5a, TC-3.5b, TC-3.5c | `tests/unit/core/story-run-discovery.test.ts` | resume by run id/story id reconstructs state and reports ambiguity |
| TC-3.6a, TC-3.6b | `tests/unit/core/story-run-ledger.test.ts` | reopen preserves final package and appends rationale event |

Related dependency reference: Story 2 owns child-operation recoverability; this story consumes that durable result behavior when rendering resume/status outcomes.

#### Non-TC Decided Tests

- `tests/unit/core/story-run-ledger.test.ts`: snapshot reader rejects removed `storyLeadSession`.
- `tests/unit/core/story-run-ledger.test.ts`: snapshot writer persists `lifecycleState` beside public `status`.

#### Verification

- Targeted: `bun run test -- --run tests/unit/core/story-run-discovery.test.ts tests/unit/core/story-run-ledger.test.ts tests/package/cli/story-orchestrate-status.test.ts tests/unit/core/story-lead-state-machine.test.ts`
- Story gate: `npm run green-verify`
- Story completion gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Terminal results include caller implications and evidence references
- [ ] `story-orchestrate status` reports active and terminal run details
- [ ] `story-orchestrate resume` reconstructs from durable artifacts and handles ambiguity clearly
- [ ] Reopened runs preserve prior final packages and record rationale
- [ ] Errors use documented state and action names
- [ ] Long-running operation output includes progress and terminal markers
- [ ] `story-verify` returns `pass`
- [ ] `npm run green-verify` passes
- [ ] `npm run verify-all` passes
- [ ] Receipt is complete
- [ ] Story commit is landed
