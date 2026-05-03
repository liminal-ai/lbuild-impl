# Story 6: Artifact and Evidence Integrity

### Summary
<!-- Jira: Summary field -->

Guarantee non-empty child-operation artifacts, durable artifact writes before state advancement, and current-run evidence provenance in final packages.

### Description
<!-- Jira: Description field -->

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

**Objective:** Make story-run evidence reliable enough for planner context, final review, and recovery.

**In Scope:**
- Non-empty implement, verify, and quick-fix artifacts
- Artifact-before-state advancement
- Failed artifact write blocking state advancement
- Final package evidence provenance
- Preseeded scaffold rejection as current-run proof

**Out of Scope:**
- Integration suite gate behavior owned by Story 7
- Provider liveness owned by Story 5

**Dependencies:** Story 3

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-5.1:** Result artifacts are non-empty for completed child operations.

- **TC-5.1a: Implement artifact non-empty**
  - Given: A story implement or continue child operation completes
  - When: The runtime writes its result artifact
  - Then: The artifact exists and is non-empty
- **TC-5.1b: Verify artifact non-empty**
  - Given: A story verify child operation completes
  - When: The runtime writes its result artifact
  - Then: The artifact exists and is non-empty
- **TC-5.1c: Quick-fix artifact non-empty**
  - Given: A quick-fix child operation completes
  - When: The runtime writes its result artifact
  - Then: The artifact exists and is non-empty

**AC-5.2:** Artifact writes are durable before dependent state advances.

- **TC-5.2a: State waits for artifact**
  - Given: A child operation returns a result
  - When: The runtime advances story-run state
  - Then: The associated artifact has already been written durably
- **TC-5.2b: Failed write blocks advancement**
  - Given: The runtime cannot write a required result artifact
  - When: The write fails
  - Then: The story-run state does not advance as though the artifact exists

**AC-5.3:** Final packages distinguish runtime-created evidence from preexisting files.

- **TC-5.3a: Runtime evidence provenance**
  - Given: A final package references an evidence artifact
  - When: The final package is inspected
  - Then: It identifies evidence produced during the current run separately from preexisting or scaffolded artifacts
- **TC-5.3b: Preseeded scaffold not accepted as proof**
  - Given: A fixture contains preseeded artifact-like files
  - When: The runtime evaluates current-run evidence
  - Then: The runtime does not count preseeded files as proof of current-run behavior

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story makes durable evidence trustworthy. A child operation result is not usable evidence until its required artifact exists and is non-empty. State advancement waits for durable artifact write success. Final packages distinguish current-run proof from prior-run, caller-input, fixture, or preexisting files.

This story should use real temp spec packs and real artifact writes for normal behavior. Mock filesystem errors only when testing failure paths.

#### Implementation Targets

| Area | Files |
|------|-------|
| Artifact writing | `src/core/artifact-writer.ts` |
| Ledger state advancement | `src/core/story-run-ledger.ts` |
| Final package evidence | `src/core/story-final-package.ts` |
| Tests | `tests/unit/core/story-run-ledger.test.ts`, `tests/unit/core/story-final-package.test.ts`, `tests/unit/core/story-lead-stateless.test.ts` |

#### Design References

- [tech-design.md §Flow 3](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:238), lines 238-256
- [tech-design.md §Flow 6](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:326), lines 326-341
- [tech-design.md §Work Breakdown Chunk 6](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:740), lines 740-753
- [test-plan.md §Mock Strategy](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:19), lines 19-25
- [test-plan.md §Anti-Shim Integration Coverage](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:27), lines 27-41
- [test-plan.md §TC Mapping](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:157), lines 157-163

#### Test Mapping

| TC | Test File | Test Description |
|----|-----------|------------------|
| TC-5.1a, TC-5.1b, TC-5.1c | `tests/unit/core/story-run-ledger.test.ts` | implement/continue, verify, and quick-fix artifacts exist and are non-empty |
| TC-5.2a, TC-5.2b | `tests/unit/core/story-run-ledger.test.ts` | state waits for durable artifact write and failed writes block advancement |
| TC-5.3a, TC-5.3b | `tests/unit/core/story-final-package.test.ts` | final package marks current-run evidence and rejects preseeded files as current proof |

#### Non-TC Decided Tests

None.

#### Anti-Shim Requirements

- Pre-create artifact-like files before a run and assert they are marked preexisting or rejected as proof.
- Evidence tests should enter through runtime/ledger/final-package behavior with real temp filesystem writes.
- Do not accept a file merely because it has the expected name or path.

#### Verification

- Targeted: `bun run test -- --run tests/unit/core/story-run-ledger.test.ts tests/unit/core/story-final-package.test.ts tests/unit/core/story-lead-stateless.test.ts`
- Story gate: `npm run green-verify`
- Story completion gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Completed child operations write non-empty required artifacts
- [ ] Story-run state advances only after required artifacts are durably written
- [ ] Failed writes block dependent state advancement
- [ ] Final packages separate current-run evidence from preexisting files
- [ ] Fixtures with preseeded artifact-like files are not accepted as current-run proof
- [ ] `story-verify` returns `pass`
- [ ] `npm run green-verify` passes
- [ ] `npm run verify-all` passes
- [ ] Receipt is complete
- [ ] Story commit is landed
