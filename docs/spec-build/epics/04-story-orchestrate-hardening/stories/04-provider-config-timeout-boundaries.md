# Story 4: Provider Config and Timeout Boundaries

### Summary
<!-- Jira: Summary field -->

Require `story_lead_provider`, remove the legacy alias, document the recommended Codex `gpt-5.5` setup, and separate planner-turn and whole-run timeouts.

### Description
<!-- Jira: Description field -->

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

**Objective:** Make provider configuration explicit and make timeout failures identify the budget that expired.

**In Scope:**
- Required `story_lead_provider` validation
- Removal of `story_lead` alias normalization
- Codex `gpt-5.5` one-turn story-lead guidance
- Dedicated planner timeout
- Separate whole-run timeout for run and resume

**Out of Scope:**
- Claude Code quiet-call liveness handling owned by Story 5
- Automatic provider fallback

**Dependencies:** Story 2

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.1:** `story-orchestrate` requires explicit `story_lead_provider`.

- **TC-4.1a: Missing story_lead_provider fails**
  - Given: The run config does not define `story_lead_provider`
  - When: The caller runs `story-orchestrate`
  - Then: The command fails before starting story work with a message that identifies the missing required config
- **TC-4.1b: Valid story_lead_provider accepted**
  - Given: The run config defines `story_lead_provider`
  - When: The caller runs `story-orchestrate`
  - Then: The runtime uses that provider for story-lead planner turns

**AC-4.2:** The legacy `story_lead` provider alias is removed.

- **TC-4.2a: Alias rejected**
  - Given: The run config defines `story_lead` but not `story_lead_provider`
  - When: The caller runs `story-orchestrate`
  - Then: The command fails with guidance to use `story_lead_provider`
- **TC-4.2b: Alias not normalized**
  - Given: The run config defines `story_lead`
  - When: The config is loaded
  - Then: The runtime does not silently normalize it to `story_lead_provider`

**AC-4.3:** Story-lead provider guidance documents the recommended Codex `gpt-5.5` one-turn setup.

- **TC-4.3a: Recommended provider documented**
  - Given: A maintainer reads story-orchestrate configuration guidance
  - When: The maintainer looks for a typical story-lead provider setup
  - Then: The guidance shows Codex `gpt-5.5` as the recommended current setup
- **TC-4.3b: One planner turn documented**
  - Given: A maintainer reads story-lead provider guidance
  - When: The maintainer looks for turn behavior
  - Then: The guidance says each planner call should allow one story-lead turn that returns one bounded action

**AC-4.4:** Story-lead planner calls use a dedicated planner-turn timeout.

- **TC-4.4a: Dedicated planner timeout used**
  - Given: The run config defines a story-lead planner timeout
  - When: A story-lead planner call starts
  - Then: The planner call uses the planner timeout rather than a child implementor or verifier timeout
- **TC-4.4b: Planner timeout failure is specific**
  - Given: A story-lead planner call exceeds its planner timeout
  - When: The runtime reports failure
  - Then: The error identifies the story-lead planner timeout rather than a child operation timeout

**AC-4.5:** `story-orchestrate` run and resume use a separate whole-run timeout.

- **TC-4.5a: Whole-run timeout enforced**
  - Given: A story-orchestrate run exceeds its configured whole-run timeout
  - When: The timeout is reached
  - Then: The runtime stops the run or marks it interrupted according to documented behavior
- **TC-4.5b: Whole-run timeout distinct from planner timeout**
  - Given: A child operation and planner calls remain within their own timeouts but total run time exceeds the whole-run timeout
  - When: The whole-run timeout is reached
  - Then: The runtime reports a whole-run timeout

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story makes provider selection and timeout layering explicit before the deeper provider-liveness work. `story-orchestrate` must fail before mutating story-run state when `story_lead_provider` is missing. The legacy `story_lead` field is rejected rather than normalized.

Planner timeout and whole-run timeout are separate budgets. A planner timeout describes one fresh story-lead provider call returning one action. A whole-run timeout covers the full `story-orchestrate run` or `resume` invocation across planner and child operations.

#### Implementation Targets

| Area | Files |
|------|-------|
| Config schema | `src/core/config-schema.ts` |
| Runtime timeout use | `src/core/story-lead.ts` |
| Skill guidance | `src/skills/ls-impl/operations/31-provider-resolution.md`, `src/skills/ls-impl/phases/20-story-cycle.md` |
| Tests | `tests/unit/core/config-schema.test.ts`, `tests/unit/core/story-lead-stateless.test.ts`, `tests/package/skills/ls-impl-story-cycle.test.ts` |

#### Design References

- [tech-design.md §Flow 5](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:279), lines 279-310
- [tech-design.md §Work Breakdown Chunk 4](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:708), lines 708-722
- [test-plan.md §TC Mapping](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:139), lines 139-148

#### Required Config Behavior

| Config Field | Default | Applies To |
|--------------|---------|------------|
| `story_lead_provider` | none; required | story-lead planner provider |
| `story_lead_planner_ms` | `600_000` | one planner call |
| `story_orchestrate_ms` | `7_200_000` | one whole `run` or `resume` invocation |
| `provider_startup_timeout_ms` | existing default `300_000` | process spawn/startup failure |
| `provider_active_silence_timeout_ms` | provider-specific | active provider silence after startup |

#### Test Mapping

| TC | Test File | Test Description |
|----|-----------|------------------|
| TC-4.1a, TC-4.1b, TC-4.2a, TC-4.2b, TC-4.4a | `tests/unit/core/config-schema.test.ts` | missing provider fails, valid provider passes, alias is rejected, planner timeout is resolved distinctly |
| TC-4.3a, TC-4.3b | `tests/package/skills/ls-impl-story-cycle.test.ts` | docs recommend Codex `gpt-5.5` and one planner turn per action |
| TC-4.4b, TC-4.5a, TC-4.5b | `tests/unit/core/story-lead-stateless.test.ts` | planner timeout and whole-run timeout fail with distinct diagnostics |

#### Non-TC Decided Tests

None.

#### Verification

- Targeted: `bun run test -- --run tests/unit/core/config-schema.test.ts tests/unit/core/story-lead-stateless.test.ts tests/package/skills/ls-impl-story-cycle.test.ts`
- Story gate: `npm run green-verify`
- Story completion gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Missing `story_lead_provider` fails before story work starts
- [ ] Legacy `story_lead` is rejected and not normalized
- [ ] Provider docs show Codex `gpt-5.5` one-turn setup
- [ ] Planner timeout and whole-run timeout are distinct in resolved runtime behavior
- [ ] Timeout errors name the relevant budget
- [ ] `story-verify` returns `pass`
- [ ] `npm run green-verify` passes
- [ ] `npm run verify-all` passes
- [ ] Receipt is complete
- [ ] Story commit is landed
