# Story 7: Verification Gates, Integration Tests, and Runtime Identity

### Summary
<!-- Jira: Summary field -->

Make integration tests fail instead of skip, require `verify-all` for story completion, and report runtime identity.

### Description
<!-- Jira: Description field -->

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

**Objective:** Close the proof loop so story completion uses real gates and runtime output identifies what ran.

**In Scope:**
- Integration prerequisite failures with no internal skips or fallbacks
- `verify-all` inclusion of integration suite and story completion requirement
- Runtime invocation source and version output

**Out of Scope:**
- Approved targeted Vitest command guidance owned by Story 1
- Terminal progress markers owned by Story 3
- AC-to-test mapping baseline owned by Story 0
- Artifact provenance owned by Story 6

**Dependencies:** Stories 5-6

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-5.4:** Integration tests do not skip or fallback internally.

- **TC-5.4a: Missing integration flag does not silently pass integration suite**
  - Given: The integration test command is invoked without required integration prerequisites
  - When: Integration tests run
  - Then: The tests fail with a clear prerequisite error rather than skipping
- **TC-5.4b: Missing provider auth fails integration test**
  - Given: Integration tests require provider authentication and auth is unavailable
  - When: Integration tests run
  - Then: The tests fail rather than using a skip or fallback mode
- **TC-5.4c: No partial-integration fallback**
  - Given: An integration test cannot reach the real integration surface it claims to test
  - When: The test runs
  - Then: The test fails rather than substituting a mock or partial integration path

**AC-5.5:** `verify-all` includes integration tests and is the story completion gate.

- **TC-5.5a: Verify-all runs integration suite**
  - Given: `npm run verify-all` is invoked
  - When: The command runs
  - Then: The integration test suite is included
- **TC-5.5b: Story validation requires verify-all**
  - Given: A story is ready for completion
  - When: The implementation process validates story completion
  - Then: `npm run verify-all` is required in addition to `story-verify` and `npm run green-verify`

**AC-5.7:** Runtime identity is visible in command output or artifacts.

- **TC-5.7a: Local vs global identity visible**
  - Given: A caller runs the CLI
  - When: The runtime writes status or diagnostic output
  - Then: The output or artifact includes an invocation-source value of `local-source`, `global-package`, `bundled-skill`, or `unknown`
- **TC-5.7b: Version visible**
  - Given: A caller inspects runtime identity
  - When: Version information is available
  - Then: The runtime version is included
- **TC-5.7c: Unknown identity is explicit**
  - Given: The runtime cannot determine whether it was launched from local source, global package, or bundled skill
  - When: Runtime identity is reported
  - Then: The invocation source is reported as `unknown` rather than omitted

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story makes verification gates and runtime identity high-signal. Integration can be excluded by choosing a command that does not run it, but once integration is invoked it fails when provider binaries, auth, or required environment are missing. `verify-all` must actually include integration.

Runtime identity is a small cross-cutting helper attached to status/final artifacts and diagnostics. It reports version, invocation source, and entry path when available. Unknown source is explicit.

#### Implementation Targets

| Area | Files |
|------|-------|
| Integration behavior | `tests/integration/**`, `tests/integration/helpers.ts`, `tests/integration/*.test.ts` |
| Gate script proof | `package.json`, `tests/package/package-scripts.test.ts` |
| Runtime identity | `src/core/runtime-identity.ts`, `src/package-metadata.ts`, `tests/unit/core/runtime-identity.test.ts` |
| Verification guidance | `src/skills/ls-impl/phases/50-verify.md`, `tests/package/skills/ls-impl-story-cycle.test.ts` |

#### Design References

- [tech-design.md §Flow 6](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:326), lines 326-353
- [tech-design.md §Runtime Identity Interface](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:617), lines 617-625
- [tech-design.md §Verification Scripts](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:627), lines 627-639
- [tech-design.md §Work Breakdown Chunk 7](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:755), lines 755-772
- [test-plan.md §Mock Strategy](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:19), lines 19-25
- [test-plan.md §Anti-Shim Integration Coverage](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:27), lines 27-41
- [test-plan.md §TC Mapping](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:164), lines 164-176

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-5.4a | `tests/integration/helpers.test.ts` or integration suite | missing integration flag/prereq fails when integration command is invoked |
| TC-5.4b, TC-5.4c | `tests/integration/*.test.ts` | missing provider auth fails and no mock/partial fallback is used inside integration |
| TC-5.5a | `tests/package/package-scripts.test.ts` | `verify-all` includes integration suite |
| TC-5.5b | story DoD and `test-plan.md` | story validation requires `verify-all` |
| TC-5.7a, TC-5.7b, TC-5.7c | `tests/unit/core/runtime-identity.test.ts` | invocation source and version are reported, with explicit `unknown` |

Related dependency reference: Story 3 owns status/final progress marker behavior. This story only needs to preserve those gates in `verify-all`; it does not implement marker behavior.

#### Non-TC Decided Tests

None.

#### Anti-Shim Requirements

- Do not mark integration tests skipped when provider auth or binaries are missing.
- Do not replace real integration claims with fixture providers or partial mock paths.
- Prove `verify-all` reaches integration through the package script, not by documentation alone.

#### Verification

- Targeted: `bun run test -- --run tests/package/package-scripts.test.ts tests/unit/core/runtime-identity.test.ts tests/package/skills/ls-impl-story-cycle.test.ts tests/package/cli/story-orchestrate-status.test.ts`
- Integration: `npm run test:integration`
- Story gate: `npm run green-verify`
- Story completion gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Integration tests fail clearly when prerequisites or provider auth are missing
- [ ] Integration tests do not substitute mocks or partial paths for claimed real integration surfaces
- [ ] `verify-all` includes the integration suite and is required for story completion
- [ ] Runtime status or diagnostics include invocation source and version, with explicit `unknown` when unresolved
- [ ] `story-verify` returns `pass`
- [ ] `npm run green-verify` passes
- [ ] `npm run verify-all` passes
- [ ] Receipt is complete
- [ ] Story commit is landed
