# Story 2: Stateless Story-Lead Planner Context

### Summary
<!-- Jira: Summary field -->

Make each story-lead planner turn a fresh provider call over the full durable story-run record, including all prior self-notes and child artifacts.

### Description
<!-- Jira: Description field -->

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

**Objective:** Remove hidden story-lead provider conversation memory from planner continuity and make durable artifacts the source of truth.

**In Scope:**
- Fresh story-lead planner calls with no provider session resume
- Planner context assembly from story file, test plan, snapshot, event history, artifacts, caller inputs, and self-notes
- Exclusion of epic, tech design, and git workspace state by default
- Seeded first-turn self-note instructions
- Context overflow fail-loud behavior
- Allowed action validation and child failure recovery record

**Out of Scope:**
- Normal-path summarization or compaction
- Default story-lead access to epic, tech design, git status, or git diff
- Separate model-based error router

**Dependencies:** Story 0

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-2.1:** Story-lead planner turns do not resume a prior story-lead provider conversation session.

- **TC-2.1a: No provider session resume for story lead**
  - Given: A story run has already completed one story-lead planner turn
  - When: The runtime asks the story lead for the next action
  - Then: The planner call is made without resuming the prior story-lead provider conversation session
- **TC-2.1b: Snapshot omits story-lead provider session dependency**
  - Given: A story-run snapshot is written after a planner turn
  - When: The snapshot is inspected
  - Then: The story-lead planner does not require a persisted provider conversation session id to continue

**AC-2.2:** Each story-lead planner turn receives the active story file.

- **TC-2.2a: Story file included**
  - Given: A story-lead planner turn starts
  - When: The planner input is assembled
  - Then: The active story file content is included

**AC-2.3:** Each story-lead planner turn receives the full test plan.

- **TC-2.3a: Test plan included**
  - Given: A story-lead planner turn starts
  - When: The planner input is assembled
  - Then: The test plan content is included

**AC-2.4:** Each story-lead planner turn receives current story-run state and event history.

- **TC-2.4a: Snapshot included**
  - Given: A story run has current state
  - When: A planner turn starts
  - Then: The current snapshot is included
- **TC-2.4b: Event history included**
  - Given: A story run has prior events
  - When: A planner turn starts
  - Then: The full story-run event history is included

**AC-2.5:** Each story-lead planner turn receives full prior child-operation result artifacts.

- **TC-2.5a: Implementor artifacts included**
  - Given: A prior implement or continue operation produced a result artifact
  - When: A later planner turn starts
  - Then: The full result artifact is included
- **TC-2.5b: Verifier artifacts included**
  - Given: A prior verifier operation produced a result artifact
  - When: A later planner turn starts
  - Then: The full verifier result artifact is included
- **TC-2.5c: Quick-fix artifacts included**
  - Given: A prior quick-fix operation produced a result artifact
  - When: A later planner turn starts
  - Then: The full quick-fix result artifact is included

**AC-2.6:** Story-lead planner context does not include epic, tech design, or git workspace state by default.

- **TC-2.6a: Epic excluded**
  - Given: A story-lead planner turn starts
  - When: The planner input is assembled
  - Then: The epic file content is not included
- **TC-2.6b: Tech design excluded**
  - Given: A story-lead planner turn starts
  - When: The planner input is assembled
  - Then: Tech design content is not included
- **TC-2.6c: Git workspace state excluded**
  - Given: A story-lead planner turn starts
  - When: The planner input is assembled
  - Then: Git status, git diff, and workspace-diff summaries are not included by default

**AC-2.7:** Story-lead planner actions include a durable self-note field.

- **TC-2.7a: Self-note accepted**
  - Given: The story lead returns an action with a self-note
  - When: The runtime records the action
  - Then: The self-note is stored in the story-run record
- **TC-2.7b: Missing self-note allowed**
  - Given: The story lead returns an otherwise valid action without a self-note
  - When: The runtime records the action
  - Then: The action remains valid and no blank note is invented

**AC-2.8:** Later story-lead planner turns receive all prior self-notes.

- **TC-2.8a: All prior self-notes included**
  - Given: A story run contains multiple prior story-lead self-notes
  - When: A later planner turn starts
  - Then: All prior self-notes are included
- **TC-2.8b: Latest note may be highlighted without dropping older notes**
  - Given: A story run contains multiple prior self-notes
  - When: The planner input emphasizes the most recent note
  - Then: Earlier notes remain present in the planner input

**AC-2.9:** The first story-lead planner turn includes seeded self-note instructions.

- **TC-2.9a: Seeded example present**
  - Given: The first planner turn of a story run starts
  - When: The planner input is assembled
  - Then: It includes a seeded example showing how the story lead can leave a note for a future turn
- **TC-2.9b: Seeded note not treated as prior runtime output**
  - Given: The first planner turn receives seeded note instructions
  - When: Later run history is inspected
  - Then: The seeded instruction is distinguishable from self-notes produced by prior story-lead actions

**AC-2.10:** Story-lead planner calls fail loudly when full durable context exceeds provider limits.

- **TC-2.10a: Context overflow is explicit**
  - Given: The full required story-lead planner context exceeds the selected provider's hard input limit
  - When: The runtime prepares or sends the planner call
  - Then: The run fails with a context-overflow error that identifies the story id, story run id, provider, and context source that caused the overflow
- **TC-2.10b: Context overflow does not summarize silently**
  - Given: The full required story-lead planner context exceeds the selected provider's hard input limit
  - When: The runtime handles the overflow
  - Then: The runtime does not summarize, compact, truncate, or omit required story-run artifacts to continue the planner call

**AC-2.11:** Story-lead planner context is self-contained without epic or tech design files.

- **TC-2.11a: Story-local requirements source**
  - Given: A story-lead planner turn starts
  - When: The planner input is assembled
  - Then: The story file and test plan are presented as the requirements source for story-local acceptance
- **TC-2.11b: Missing story-local acceptance context routes to caller**
  - Given: The story file and test plan do not contain enough information for the story lead to decide the next action
  - When: The story lead cannot proceed from the provided story-local context
  - Then: The story lead returns `needs-ruling` or another documented terminal result rather than requesting the epic or tech design by default

**AC-3.2:** Story-lead actions are bounded to the allowed state-machine actions.

- **TC-3.2a: Valid action accepted**
  - Given: The story lead returns an allowed action for the current state
  - When: The runtime validates the action
  - Then: The action is accepted and executed
- **TC-3.2b: Invalid action rejected**
  - Given: The story lead returns an action that is not allowed for the current state
  - When: The runtime validates the action
  - Then: The runtime rejects the action with a structured error that identifies the current state and invalid action

**AC-3.7:** Story-orchestrate handles child operation failure without losing the story-run record.

- **TC-3.7a: Child failure recorded**
  - Given: A child operation fails
  - When: The runtime records the result
  - Then: The story-run record includes the failure envelope and the next story-lead planner turn receives it
- **TC-3.7b: Runtime crash leaves recovery artifacts**
  - Given: The runtime crashes after a child operation returns but before the next planner turn completes
  - When: The caller inspects the story-run artifacts
  - Then: The latest completed child operation result is recoverable

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the core runtime refactor. The story lead stops using provider conversation memory as continuity. Every planner turn is a fresh provider call over durable story-run memory: story file, full test plan, snapshot, event history, result artifacts, caller inputs, all prior self-notes, and state/action rules.

The runtime should replace or reshape the current story-lead prompt path so it does not inherit generic prompt assembly that can pull in the tech design. The story lead may use child-operation continuation handles, but those handles belong to child operations, not to story-lead planner continuity.

#### Implementation Targets

| Area | Files |
|------|-------|
| Planner loop | `src/core/story-lead.ts` |
| Prompt/context assembly | `src/core/story-lead-prompt.ts`, `src/core/story-lead-context.ts` |
| Contracts | `src/core/story-orchestrate-contracts.ts` |
| Ledger notes/events | `src/core/story-run-ledger.ts` |
| Unit tests | `tests/unit/core/story-lead-context.test.ts`, `tests/unit/core/story-lead-stateless.test.ts`, `tests/unit/core/story-run-ledger.test.ts` |

#### Design References

- [tech-design.md §Context](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:21), lines 21-29
- [tech-design.md §Runtime Loop](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:31), lines 31-64
- [tech-design.md §Flow 2](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:177), lines 177-216
- [tech-design.md §Flow 3](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:218), lines 218-256
- [tech-design.md §Action Envelope](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:402), lines 402-514
- [tech-design.md §Planner Context](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:540), lines 540-581
- [tech-design.md §Context Overflow](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:583), lines 583-600
- [tech-design.md §Work Breakdown Chunk 2](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:674), lines 674-689
- [test-plan.md §Anti-Shim Integration Coverage](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:27), lines 27-41
- [test-plan.md §TC Mapping](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:98), lines 98-123 and 136-137

#### Test Mapping

| TC | Test File | Test Description |
|----|-----------|------------------|
| TC-2.1a, TC-2.1b | `tests/unit/core/story-lead-stateless.test.ts` | later planner turns do not resume a story-lead provider session and snapshots do not depend on one |
| TC-2.2a, TC-2.3a, TC-2.4a, TC-2.4b, TC-2.5a, TC-2.5b, TC-2.6a, TC-2.6b, TC-2.6c, TC-2.8a, TC-2.8b, TC-2.10a, TC-2.11a | `tests/unit/core/story-lead-context.test.ts` | planner context includes required full sources, excludes forbidden sources, includes all notes, and fails loudly on overflow |
| TC-2.7a, TC-2.7b, TC-2.9b | `tests/unit/core/story-run-ledger.test.ts` | self-notes persist correctly and seeded instructions remain distinguishable from runtime notes |
| TC-2.9a | `tests/unit/core/story-lead-context.test.ts` | first planner turn includes seeded self-note example |
| TC-2.11b, TC-3.7a, TC-3.7b | `tests/unit/core/story-lead-stateless.test.ts` | insufficient story-local context and child failures route through documented durable results |
| TC-3.2a, TC-3.2b | `tests/unit/core/story-lead-state-machine.test.ts` | action validation accepts allowed actions and rejects invalid state/action pairs |

#### Non-TC Decided Tests

- `tests/unit/core/story-lead-stateless.test.ts`: planner provider invocation ignores any returned story-lead session id on later planner turns.
- `tests/unit/core/story-lead-context.test.ts`: context builder records largest sources on overflow.
- `tests/unit/core/story-run-ledger.test.ts`: snapshot reader tolerates and ignores deprecated `storyLeadSession` on old artifacts.

#### Anti-Shim Requirements

- Assert against the actual serialized planner input sent to the provider adapter.
- Artifact assertions must prove full artifact content is embedded, not only artifact paths or summaries.
- Do not add a `read-context` action for normal story-run history.
- Do not summarize, compact, truncate, or omit required context to keep a planner call alive.

#### Verification

- Targeted: `bun run test -- --run tests/unit/core/story-lead-context.test.ts tests/unit/core/story-lead-stateless.test.ts tests/unit/core/story-run-ledger.test.ts tests/unit/core/story-lead-state-machine.test.ts`
- Story gate: `npm run green-verify`
- Story completion gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Planner turns do not resume prior story-lead provider sessions
- [ ] Planner input contains required durable context and excludes default-prohibited sources
- [ ] Self-notes are stored and replayed across planner turns
- [ ] Context overflow fails explicitly without summarization or truncation
- [ ] Invalid actions are rejected with structured errors
- [ ] Child operation failures remain recoverable from story-run artifacts
- [ ] `story-verify` returns `pass`
- [ ] `npm run green-verify` passes
- [ ] `npm run verify-all` passes
- [ ] Receipt is complete
- [ ] Story commit is landed
