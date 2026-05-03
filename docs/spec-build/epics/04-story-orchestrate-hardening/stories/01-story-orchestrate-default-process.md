# Story 1: Story-Orchestrate Becomes the Default Process

### Summary
<!-- Jira: Summary field -->

Update skill, process, and CLI guidance so normal story work runs through `story-orchestrate` while primitive operations remain documented as lower-level tools.

### Description
<!-- Jira: Description field -->

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

**Objective:** Make the composed story-lead loop the taught happy path without removing primitive CLI or SDK operations.

**In Scope:**
- Implementation skill happy path for `story-orchestrate`
- Primitive operation reference guidance as building blocks and recovery tools
- Story-lead scoped completion boundary and caller actions for terminal results
- CLI help and local-vs-global CLI guidance
- Approved targeted test command guidance

**Out of Scope:**
- Removing primitive operations
- Full README rewrite beyond changed behavior

**Dependencies:** Story 0

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-1.1:** The implementation skill identifies `story-orchestrate` as the normal story execution path.

- **TC-1.1a: Skill happy path uses story-orchestrate**
  - Given: A fresh implementation agent reads the implementation skill
  - When: The agent looks for the normal story execution workflow
  - Then: The documented happy path directs the agent to run `story-orchestrate`
- **TC-1.1b: Primitive-chain happy path removed**
  - Given: A fresh implementation agent reads the story-cycle guidance
  - When: The agent looks for the default story workflow
  - Then: The guidance does not present manual primitive chaining as the primary path

**AC-1.2:** Primitive story operations remain documented as lower-level operations.

- **TC-1.2a: Primitive operations retained**
  - Given: A maintainer needs to run a lower-level operation directly
  - When: The maintainer reviews CLI help or reference guidance
  - Then: `story-implement`, `story-continue`, `story-self-review`, `story-verify`, and `quick-fix` remain available
- **TC-1.2b: Primitive operations described as building blocks**
  - Given: A fresh implementation agent reads primitive operation guidance
  - When: The agent compares primitive operations with `story-orchestrate`
  - Then: The docs describe primitive operations as building blocks, reference tools, or recovery tools rather than the normal path

**AC-1.3:** `story-orchestrate` guidance explains the boundary between story-lead scoped completion and implementation-lead acceptance.

- **TC-1.3a: Story-lead completion boundary**
  - Given: `story-orchestrate` returns `accepted`
  - When: The implementation lead reads the result guidance
  - Then: The guidance says story-lead scoped acceptance still requires implementation-lead review, receipt completion, verification gates, and commit handling
- **TC-1.3b: Non-accepted terminal results**
  - Given: `story-orchestrate` returns `blocked`, `failed`, `interrupted`, or `needs-ruling`
  - When: The implementation lead reads the result guidance
  - Then: The guidance identifies the caller action expected for that result

**AC-1.4:** CLI help for `story-orchestrate` identifies it as the composed story operation.

- **TC-1.4a: Help surface describes role**
  - Given: A user runs `lbuild-impl story-orchestrate --help`
  - When: Help text is displayed
  - Then: The help describes `story-orchestrate` as the operation that runs one story through the story-lead loop
- **TC-1.4b: Help surface points to required config**
  - Given: A user reads `story-orchestrate` help
  - When: Provider configuration is described
  - Then: The help states that `story_lead_provider` is required

**AC-1.5:** The process docs warn callers to use the local CLI for unreleased commands.

- **TC-1.5a: Local CLI guidance**
  - Given: An implementation agent works on the current branch
  - When: The agent reads runtime invocation guidance
  - Then: The guidance distinguishes global published `lbuild-impl` from the local branch CLI
- **TC-1.5b: Missing global command not treated as product defect**
  - Given: A command exists locally but not in the globally installed CLI
  - When: The agent follows the guidance
  - Then: The agent uses the local CLI instead of reporting a missing global command as a product failure

**AC-5.6:** Raw Bun test runner usage is not presented as an accepted verification path.

- **TC-5.6a: Targeted tests use Vitest command**
  - Given: A maintainer reads test guidance
  - When: The maintainer looks for targeted test commands
  - Then: The guidance uses `bun run test -- --run <files>` or the repository-approved Vitest command, not raw `bun test`
- **TC-5.6b: Raw Bun warning present**
  - Given: A maintainer reads verification guidance
  - When: Raw Bun runner risks are described
  - Then: The guidance says raw `bun test` bypasses repo Vitest configuration and should not be used

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story aligns the user-facing process surfaces with the runtime direction. The implementation skill and CLI help should teach `story-orchestrate` as the normal story path. Primitive commands remain present, but their placement and wording should make them lower-level building blocks, recovery tools, or diagnostic tools.

The local/global CLI distinction belongs in the same guidance because this repo dogfoods unreleased commands. A missing command in the globally installed package is not evidence that the current branch is broken.

#### Implementation Targets

| Area | Files |
|------|-------|
| Skill process | `src/skills/ls-impl/SKILL.md`, `src/skills/ls-impl/phases/20-story-cycle.md` |
| Provider guidance | `src/skills/ls-impl/operations/31-provider-resolution.md` |
| CLI help | `src/cli/commands/story-orchestrate.ts`, `src/cli/commands/story-orchestrate-run.ts`, `src/cli/commands/story-orchestrate-resume.ts`, `src/cli/commands/story-orchestrate-status.ts` |
| Package tests | `tests/package/skills/ls-impl-story-cycle.test.ts`, `tests/package/cli/story-orchestrate-help.test.ts` |

#### Design References

- [tech-design.md §Flow 1](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:154), lines 154-175
- [tech-design.md §Responsibility Matrix](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:137), lines 137-150
- [tech-design.md §Verification Scripts](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:627), lines 627-639
- [tech-design.md §Work Breakdown Chunk 1](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:656), lines 656-672
- [test-plan.md §TC Mapping](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:88), lines 88-97 and 169-170

#### Test Mapping

| TC | Test File | Test Description |
|----|-----------|------------------|
| TC-1.1a, TC-1.1b | `tests/package/skills/ls-impl-story-cycle.test.ts` | skill happy path points to `story-orchestrate` and removes primitive-chain happy path |
| TC-1.2a, TC-1.4a, TC-1.4b | `tests/package/cli/story-orchestrate-help.test.ts` | primitive commands remain available and `story-orchestrate --help` describes the composed operation and required provider |
| TC-1.2b, TC-1.3a, TC-1.3b, TC-1.5a, TC-1.5b | `tests/package/skills/ls-impl-story-cycle.test.ts` | guidance labels primitives correctly, names caller terminal actions, and distinguishes local from global CLI |
| TC-5.6a, TC-5.6b | `tests/package/skills/ls-impl-story-cycle.test.ts` | targeted test guidance uses Vitest command and warns against raw `bun test` |

#### Non-TC Decided Tests

None.

#### Technical Notes

- Keep primitive operations documented; do not remove commands or SDK exports.
- Avoid README-scale rewrite unless needed to keep changed CLI behavior accurate.
- Use the exact repo-approved targeted command: `bun run test -- --run <files>`.

#### Verification

- Targeted: `bun run test -- --run tests/package/skills/ls-impl-story-cycle.test.ts tests/package/cli/story-orchestrate-help.test.ts`
- Story gate: `npm run green-verify`
- Story completion gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Skill happy path points to `story-orchestrate`
- [ ] Primitive operations remain visible as lower-level operations
- [ ] CLI help identifies required `story_lead_provider`
- [ ] Guidance distinguishes local branch CLI from global published CLI
- [ ] Targeted test guidance uses repo-approved Vitest command
- [ ] `story-verify` returns `pass`
- [ ] `npm run green-verify` passes
- [ ] `npm run verify-all` passes
- [ ] Receipt is complete
- [ ] Story commit is landed
