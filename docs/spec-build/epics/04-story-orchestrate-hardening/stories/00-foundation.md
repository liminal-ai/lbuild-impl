# Story 0: Foundation, State Vocabulary, and Test Plan

### Summary
<!-- Jira: Summary field -->

Establish state vocabulary, state diagram, AC-to-test mapping, and execution-question ownership before runtime changes.

### Description
<!-- Jira: Description field -->

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

**Objective:** Create the shared story-orchestrate language and traceability baseline used by every implementation story.

**In Scope:**
- State-machine diagram and vocabulary for story-orchestrate lifecycle
- AC-to-test or manual verification mapping for the full epic
- Execution Questions 1-6 captured for implementation planning

**Out of Scope:**
- Runtime behavior changes beyond documentation and test-plan scaffolding
- Business epic creation

**Dependencies:** None

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-3.1:** Story-orchestrate exposes a clear state-machine diagram and state vocabulary in developer-facing documentation.

- **TC-3.1a: State diagram exists**
  - Given: A maintainer reads the story-orchestrate developer documentation
  - When: The maintainer looks for the story run lifecycle
  - Then: A state-machine diagram shows the allowed normal and terminal paths
- **TC-3.1b: State names are defined**
  - Given: A state name appears in CLI output, snapshots, or logs
  - When: The maintainer reads the state vocabulary
  - Then: The state name has a plain description and caller implication

**AC-5.9:** The test plan maps each AC in this epic to at least one test or manual verification item.

- **TC-5.9a: Complete test mapping**
  - Given: The test plan for this epic
  - When: A reviewer checks AC-to-test traceability
  - Then: Every AC in this epic maps to an automated test, manual verification item, or documented maintainer-run check

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story creates the shared implementation vocabulary used by the later runtime stories. It should establish the explicit lifecycle model, action legality vocabulary, fixtures, and traceability baseline before changing runtime behavior. Keep this story light on runtime mutation; it is the foundation that prevents later stories from inventing state names, test files, or verification rules independently.

The public result vocabulary stays compatible with existing story-run artifacts: `running`, `accepted`, `needs-ruling`, `blocked`, `failed`, and `interrupted`. The stricter state-machine position is represented separately as `lifecycleState`. This separation is important because the epic is a hardening pass, not an artifact migration.

#### Implementation Targets

| Area | Files |
|------|-------|
| State machine | `src/core/story-lead-state-machine.ts` |
| State/action tests | `tests/unit/core/story-lead-state-machine.test.ts` |
| Shared fixtures | `tests/support/fixtures/story-orchestrate-context.ts` |
| Test map | `docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md` |

#### Design References

- [tech-design.md §State Machine](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:66), lines 66-88
- [tech-design.md §Module Architecture](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:102), lines 102-150
- [tech-design.md §Story Lead State](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:368), lines 368-400
- [tech-design.md §Work Breakdown Chunk 0](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:641), lines 641-655
- [test-plan.md §Verification Gates](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:7), lines 7-17
- [test-plan.md §TC Mapping](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:120), lines 120-123 and 176-207

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-3.1a | `tests/package/skills/ls-impl-story-cycle.test.ts` | developer docs include the state-machine diagram |
| TC-3.1b | `tests/unit/core/story-lead-state-machine.test.ts` | each persisted state has a plain description and caller implication |
| TC-5.9a | `docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md` | every AC maps to a test, manual item, or maintainer-run check |

#### Non-TC Decided Tests

- `tests/unit/core/story-run-ledger.test.ts`: snapshot writer persists `lifecycleState` beside public `status`.
- `tests/unit/core/story-lead-state-machine.test.ts`: story-lead action schema rejects extra keys after action discrimination.

#### Verification

- Targeted: `bun run test -- --run tests/unit/core/story-lead-state-machine.test.ts`
- Story gate: `npm run green-verify`
- Story completion gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] State diagram and vocabulary exist in developer-facing documentation
- [ ] Test plan maps every AC to an automated test, manual verification item, or maintainer-run check
- [ ] Execution Questions 1-6 are recorded with owners or implementation-plan disposition
- [ ] `story-verify` returns `pass`
- [ ] `npm run green-verify` passes
- [ ] `npm run verify-all` passes
- [ ] Receipt is complete
- [ ] Story commit is landed
