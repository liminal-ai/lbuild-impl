# Epic: Story-Orchestrate Hardening and Process Refinement

This epic defines requirements for making `story-orchestrate` the normal story implementation path in `lbuild-impl`. The runtime keeps the lower-level story operations, but the implementation skill and primary CLI workflow move toward a story-level orchestrator that can drive one story through implementation, review, verification, fix routing, and story-lead scoped completion.

---

## Onboarding Context

`lbuild-impl` runs implementation operations for Liminal Spec packs. A spec pack contains story files, a test plan, implementation configuration, and supporting artifacts. The runtime exposes primitive operations such as `story-implement`, `story-verify`, `quick-fix`, and `epic-verify`, plus the composed `story-orchestrate` operation.

`story-orchestrate` launches a story lead for one story. The story lead chooses one bounded action at a time. The runtime executes that action, records the result, and asks the story lead for the next action until the story reaches a story-lead scoped terminal result.

This epic hardens that loop. The story lead must not rely on hidden provider conversation state. Each planner turn receives the durable story-run record as the source of truth: story file, test plan, current snapshot, event history, prior result artifacts, prior story-lead self-notes, and caller-supplied story-run inputs. The runtime may still use provider sessions for child implementation and verification operations where those operations require them, but the story lead planner does not persist conversational memory across planner turns.

The epic also carries follow-up hardening from the EPIC 3 implementation run: provider liveness and timeout behavior, artifact reliability, integration test behavior, Windows compatibility, skill guidance, versioning, and proof quality.

---

## User Profile

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

---

## Feature Overview

`story-orchestrate` becomes the default story implementation path for the implementation skill and primary workflow. Primitive operations remain available as CLI and SDK building blocks, but the skill stops presenting them as the normal happy path for story work.

The story lead planner becomes stateless across provider calls. Each planner turn is a fresh bounded call that receives the complete durable story-run context. The runtime records all child operation results and all story-lead self-notes so a later planner turn can reason from the actual story history without relying on provider conversation persistence.

Provider configuration and liveness behavior become explicit. `story-orchestrate` requires `story_lead_provider`; the legacy `story_lead` alias is removed. Story-lead planner calls use their own turn timeout. The full `story-orchestrate` run uses a separate wall-clock timeout. Claude Code and other provider-backed long operations must not be killed merely because a valid non-streaming provider call stays quiet until final output.

The epic also hardens evidence and execution surfaces discovered while dogfooding EPIC 3: no fallback integration-test skips, reliable artifact writes, stale provider cleanup, clearer multi-lane verifier accounting, Windows compatibility, runtime identity clarity, and a `0.4.0` release.

### Flow Summary

- [Story-Orchestrate Default Process](#1-story-orchestrate-default-process) - Skill and CLI guidance make `story-orchestrate` the normal story path while retaining primitive operations as building blocks. AC: `AC-1.1-AC-1.5`
- [Stateless Story-Lead Planner](#2-stateless-story-lead-planner) - Each story-lead planner turn receives full durable story-run context and records self-notes for later turns. AC: `AC-2.1-AC-2.11`
- [Story-Orchestrate State and Terminal Results](#3-story-orchestrate-state-and-terminal-results) - The story run exposes understandable states, transitions, terminal results, and recovery behavior. AC: `AC-3.1-AC-3.8`
- [Provider Configuration, Timeouts, and Liveness](#4-provider-configuration-timeouts-and-liveness) - Story-lead provider config is explicit and long-running provider work has correct timeout/liveness behavior. AC: `AC-4.1-AC-4.9`
- [Evidence, Artifacts, and Test Integrity](#5-evidence-artifacts-and-test-integrity) - Runtime artifacts, verification evidence, and integration tests are high-signal and do not fall back to empty or skipped proof. AC: `AC-5.1-AC-5.9`
- [Windows Compatibility and Release 0.4.0](#6-windows-compatibility-and-release-040) - The CLI handles known Windows blockers and ships the hardening work as version `0.4.0`. AC: `AC-6.1-AC-6.8`

---

## Scope

### In Scope

- `story-orchestrate` as the normal story implementation path in skill guidance
- De-emphasis of `story-implement`, `story-verify`, and related primitive operations in skill process docs while retaining them as CLI/SDK operations
- Stateless story-lead planner turns with no persisted provider conversation session
- Full durable story-run context included on every story-lead planner turn
- Durable story-lead self-notes included in later story-lead planner turns
- Seeded first-turn self-note instructions showing the story lead how to leave notes for future turns
- Required `story_lead_provider` configuration for `story-orchestrate`
- Removal of the legacy `story_lead` provider alias
- Story-lead provider guidance for Codex `gpt-5.5` with one planner turn per action
- Dedicated story-lead planner turn timeout
- Separate whole-run timeout for `story-orchestrate run` and `resume`
- Claude Code `-p` and other provider-backed long-operation timeout/liveness fixes where non-streaming providers may be quiet until final output
- Clear state-machine vocabulary, state diagram, and terminal result meanings
- Story-run recovery behavior after interruption or restart
- Full result artifacts included in the story-lead context by default
- Artifact write reliability for story, verifier, self-review, quick-fix, and final package outputs
- Multi-lane verifier progress and terminal accounting hardening
- Stale provider process cleanup or abandonment handling after interrupted runs
- Integration tests that fail when required integration prerequisites are missing
- Windows compatibility fixes identified from the Windows bug log
- Runtime identity clarity between global published CLI, local source CLI, and bundled skill runtime
- Proof discipline that distinguishes runtime-created evidence from preseeded or scaffolded artifacts
- Version bump from `0.3.0` to `0.4.0`
- Test plan for the hardening work
- Manual Windows smoke validation by the maintainer on Parallels at epic closeout

### Out of Scope

- Full epic-level orchestrator redesign
- Automatic implementation config generation
- README rewrite beyond any minimal updates required for changed CLI behavior
- Removal of primitive CLI or SDK operations
- Story lead access to the epic file
- Story lead access to the tech design
- Story lead access to git status, git diff, or workspace-diff summaries by default
- Normal-path summarization or compaction of story-run result artifacts
- A `read-context` story-lead action for normal story-run history
- Separate model-based error router
- Default provider fallback when `story_lead_provider` is missing
- Hidden backward-compatibility support for the removed `story_lead` alias
- CI requirement to run real provider integration tests on every default pull request

### Assumptions

| ID | Assumption | Status | Owner | Notes |
|----|------------|--------|-------|-------|
| A1 | `story-orchestrate` is the primary path the implementation skill should teach | Validated | Maintainer | Primitive operations remain available for reference, recovery, and lower-level use |
| A2 | Story-lead planner calls can be one-turn calls | Validated | Maintainer | One planner turn returns one bounded action; the runtime executes it and asks again |
| A3 | Durable story-run context replaces provider conversation memory for the story lead | Validated | Maintainer | All prior story-lead self-notes and all result artifacts are included |
| A4 | Codex `gpt-5.5` is the recommended story-lead provider for this pass | Validated | Maintainer | Configuration remains explicit rather than defaulted |
| A5 | Provider context limits may still exist | Validated | Implementation lead | If full durable context exceeds a hard provider limit, the run should fail loudly rather than silently summarize |
| A6 | Windows validation can include maintainer-run manual smoke testing | Validated | Maintainer | Automated coverage should cover portable behavior where feasible |
| A7 | The implementation log from EPIC 3 is valid evidence for hardening scope | Validated | Maintainer | Repeated or high-impact incidents are included; one-off anomalies are not automatically promoted |
| A8 | Story files and the test plan are the story lead's requirements source | Validated | Maintainer | The story lead does not read the epic or tech design; published stories and test plan must be sufficient for story-local acceptance |

---

## Flows & Requirements

### 1. Story-Orchestrate Default Process

The implementation process presents `story-orchestrate` as the normal way to run a story. The lower-level operations remain visible as building blocks and recovery tools, but a fresh implementation agent should not infer that the happy path is manually chaining `story-implement`, self-review, `story-verify`, and quick-fix commands.

1. Maintainer or implementation agent reads the implementation skill.
2. Skill directs normal story work through `story-orchestrate`.
3. Runtime accepts one story and drives child operations through the story lead.
4. Runtime returns a story-lead scoped result and evidence.
5. Implementation lead reviews the result, completes acceptance tasks, and moves to the next story.

#### Acceptance Criteria

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

### 2. Stateless Story-Lead Planner

The story lead planner does not carry provider conversation memory between turns. Each planner turn receives the durable story-run record and returns one bounded action. The runtime records the action, executes child work, stores result artifacts, and asks the story lead again with the updated durable record.

The story lead can leave notes for later planner turns. These notes are part of the durable story-run record. Later planner turns receive all prior notes, not only the latest note.

#### Acceptance Criteria

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

### 3. Story-Orchestrate State and Terminal Results

The story-orchestrate loop is a strict story-level state machine from the caller's perspective. State names, action names, and terminal results must be understandable in logs, snapshots, CLI output, and failure messages. The caller should not need to understand internal provider machinery to know what happened or what to do next.

#### Acceptance Criteria

**AC-3.1:** Story-orchestrate exposes a clear state-machine diagram and state vocabulary in developer-facing documentation.

- **TC-3.1a: State diagram exists**
  - Given: A maintainer reads the story-orchestrate developer documentation
  - When: The maintainer looks for the story run lifecycle
  - Then: A state-machine diagram shows the allowed normal and terminal paths
- **TC-3.1b: State names are defined**
  - Given: A state name appears in CLI output, snapshots, or logs
  - When: The maintainer reads the state vocabulary
  - Then: The state name has a plain description and caller implication

**AC-3.2:** Story-lead actions are bounded to the allowed state-machine actions.

- **TC-3.2a: Valid action accepted**
  - Given: The story lead returns an allowed action for the current state
  - When: The runtime validates the action
  - Then: The action is accepted and executed
- **TC-3.2b: Invalid action rejected**
  - Given: The story lead returns an action that is not allowed for the current state
  - When: The runtime validates the action
  - Then: The runtime rejects the action with a structured error that identifies the current state and invalid action

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

**AC-3.7:** Story-orchestrate handles child operation failure without losing the story-run record.

- **TC-3.7a: Child failure recorded**
  - Given: A child operation fails
  - When: The runtime records the result
  - Then: The story-run record includes the failure envelope and the next story-lead planner turn receives it
- **TC-3.7b: Runtime crash leaves recovery artifacts**
  - Given: The runtime crashes after a child operation returns but before the next planner turn completes
  - When: The caller inspects the story-run artifacts
  - Then: The latest completed child operation result is recoverable

**AC-3.8:** State and action names in errors are caller-readable.

- **TC-3.8a: Error names are understandable**
  - Given: A state or action validation error occurs
  - When: The error is shown to a caller
  - Then: The error uses the same documented state and action names shown in the state-machine vocabulary

### 4. Provider Configuration, Timeouts, and Liveness

`story-orchestrate` must fail early when the story-lead provider is missing or misnamed. It must not silently choose a default provider. Long-running provider calls must distinguish process startup, provider silence, operation liveness, and whole-run budget.

#### Acceptance Criteria

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

### 5. Evidence, Artifacts, and Test Integrity

Story-orchestrate depends on durable evidence. The runtime must not produce empty artifacts, accept preseeded proof as if it came from the current run, or let integration tests pass when integration prerequisites are absent.

#### Acceptance Criteria

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

**AC-5.6:** Raw Bun test runner usage is not presented as an accepted verification path.

- **TC-5.6a: Targeted tests use Vitest command**
  - Given: A maintainer reads test guidance
  - When: The maintainer looks for targeted test commands
  - Then: The guidance uses `bun run test -- --run <files>` or the repository-approved Vitest command, not raw `bun test`
- **TC-5.6b: Raw Bun warning present**
  - Given: A maintainer reads verification guidance
  - When: Raw Bun runner risks are described
  - Then: The guidance says raw `bun test` bypasses repo Vitest configuration and should not be used

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

**AC-5.8:** Terminal progress markers are available for long-running operations.

- **TC-5.8a: Active progress marker**
  - Given: A long-running provider-backed operation is active
  - When: The caller reads status output
  - Then: The output includes a current progress marker or latest event
- **TC-5.8b: Terminal marker**
  - Given: A long-running operation completes
  - When: The caller reads status or final output
  - Then: The output includes a terminal marker and final artifact reference

**AC-5.9:** The test plan maps each AC in this epic to at least one test or manual verification item.

- **TC-5.9a: Complete test mapping**
  - Given: The test plan for this epic
  - When: A reviewer checks AC-to-test traceability
  - Then: Every AC in this epic maps to an automated test, manual verification item, or documented maintainer-run check

### 6. Windows Compatibility and Release 0.4.0

The hardening release includes the Windows blockers documented from the Windows setup branch. The release should support basic CLI operation on Windows and provide a manual validation path using the maintainer's Windows environment in Parallels.

#### Acceptance Criteria

**AC-6.1:** Build asset path resolution works on Windows paths.

- **TC-6.1a: Windows file URL conversion**
  - Given: The build asset sync step runs on Windows
  - When: It resolves paths from module URLs
  - Then: It uses Windows-safe file URL conversion and does not produce doubled-drive paths

**AC-6.2:** Provider CLI lookup handles Windows shim executables.

- **TC-6.2a: Windows provider shim found**
  - Given: Provider CLIs are installed as Windows shims such as `.cmd` or `.bat`
  - When: Preflight or provider dispatch looks up the provider executable
  - Then: The runtime can find and launch the shim
- **TC-6.2b: POSIX lookup remains working**
  - Given: Provider CLIs are installed on macOS or Linux
  - When: Preflight or provider dispatch looks up the provider executable
  - Then: Existing POSIX lookup behavior still works

**AC-6.3:** Provider subprocess environment preserves Windows-required variables.

- **TC-6.3a: Windows env vars preserved**
  - Given: A provider subprocess launches on Windows
  - When: The runtime filters environment variables
  - Then: Windows-required variables such as user profile, app data, shell, path extension, and temp-directory variables remain available
- **TC-6.3b: Env filtering policy documented**
  - Given: A maintainer reads provider environment guidance
  - When: Environment filtering is described
  - Then: The guidance explains what is preserved and why

**AC-6.4:** Atomic writes tolerate transient Windows rename failures.

- **TC-6.4a: Rename retry on transient lock**
  - Given: Windows temporarily rejects an atomic rename because a file is busy
  - When: The runtime writes an artifact
  - Then: The write retries with backoff before failing
- **TC-6.4b: Non-transient failure still fails**
  - Given: A write fails because of a real permission or path error
  - When: The runtime retries if applicable
  - Then: The runtime reports failure rather than hiding the error

**AC-6.5:** Codex provider invocation documents and supports the required sandbox policy.

- **TC-6.5a: Codex sandbox policy configurable**
  - Given: A Codex provider operation needs filesystem changes on Windows
  - When: The provider command is assembled
  - Then: The configured sandbox or approval policy required for unattended implementation is applied
- **TC-6.5b: Sandbox guidance present**
  - Given: A maintainer reads Windows or provider setup guidance
  - When: Codex setup is described
  - Then: The guidance identifies the sandbox policy required for basic implementation operations

**AC-6.6:** Codex resume structured-output drift is handled.

- **TC-6.6a: Resume schema guidance**
  - Given: A Codex resume operation is invoked
  - When: The provider cannot receive the same structured-output schema flag as the initial call
  - Then: The runtime uses a documented strategy to preserve result contract expectations
- **TC-6.6b: Drift failure is clear**
  - Given: A resumed Codex operation returns a payload that does not satisfy the expected result contract
  - When: The runtime validates the result
  - Then: The error identifies schema drift or invalid provider output clearly

**AC-6.7:** Maintainer-run Windows smoke validation is part of epic closeout.

- **TC-6.7a: Windows smoke checklist exists**
  - Given: The epic is ready for closeout
  - When: The maintainer prepares Windows validation
  - Then: A checklist covers install/build, help output, preflight, a basic provider-backed operation, and a story-orchestrate smoke where feasible
- **TC-6.7b: Parallels result recorded**
  - Given: The maintainer runs Windows smoke validation in Parallels
  - When: Validation completes
  - Then: The result is recorded in the implementation log or closeout artifact

**AC-6.8:** The release version is bumped to `0.4.0`.

- **TC-6.8a: Package version updated**
  - Given: The epic implementation is complete
  - When: Version files are inspected
  - Then: The package version is `0.4.0`
- **TC-6.8b: Runtime reports 0.4.0**
  - Given: The built CLI reports its version
  - When: The caller invokes the version command or inspects runtime identity
  - Then: The reported version is `0.4.0`

---

## Data Contracts

### Verification Gate Policy

| Gate | Command / Trigger | Integration Behavior | Required For |
|------|-------------------|----------------------|--------------|
| Development gate | `npm run green-verify` | Does not run the integration suite unless the command composition is changed later | Ongoing implementation checks before story closeout |
| Story completion gate | `npm run verify-all` | Runs the integration suite; missing integration prerequisites fail the command | Story acceptance before receipt and commit |
| Explicit integration gate | `npm run test:integration` or Vitest integration project | Runs the integration suite; missing provider binaries, auth, or required environment fail the tests | Targeted integration diagnosis and release evidence |
| Default PR gate | Repository CI configuration | May run `verify` or another default gate that does not invoke real-provider integration | Pull-request feedback where provider credentials are unavailable |
| Maintainer release gate | Maintainer-run closeout checklist | Includes `verify-all`, provider evidence where available, and Windows smoke validation | Epic and release closeout |

Integration tests may be excluded by choosing a command that does not run the integration suite. Once the integration suite is invoked, it does not skip internally or substitute partial integration fallbacks.

### Story-Orchestrate Configuration Requirements

| Setting | Required | Description |
|---------|----------|-------------|
| `story_lead_provider` | yes | Provider used for story-lead planner turns |
| Story-lead planner timeout | yes in resolved runtime settings | Maximum duration for one story-lead planner call |
| Story-orchestrate whole-run timeout | yes in resolved runtime settings | Maximum wall-clock duration for one `story-orchestrate run` or `resume` invocation |

The legacy `story_lead` field is not accepted as an alias.

Exact timeout field names belong in the implementation pass. The behavior required by this epic is that the planner timeout and whole-run timeout are distinct and visible in configuration or resolved runtime settings.

### Story-Lead Planner Context

| Item | Included | Description |
|------|----------|-------------|
| Active story file | yes | Full content of the story being implemented |
| Test plan | yes | Full current test plan |
| Current snapshot | yes | Current story-run state |
| Event history | yes | Full story-run event history |
| Child operation result artifacts | yes | Full prior implement, continue, self-review, verify, quick-fix, and final-package artifacts |
| Caller input artifacts | yes | Full caller-supplied story-run inputs |
| Prior story-lead self-notes | yes | All prior self-notes from story-lead actions |
| Seeded self-note instructions | first turn | Example and instruction for leaving future-turn notes |
| Epic | no | Excluded by default |
| Tech design | no | Excluded by default |
| Git status or diff | no | Excluded by default |
| Raw provider stream logs | no | Excluded by default |

### Story-Lead Action Envelope

| Element | Required | Description |
|---------|----------|-------------|
| Action | yes | One allowed story-lead action for the current state |
| Rationale | yes | Reason the story lead chose the action |
| Action inputs | action-dependent | Inputs needed to execute the action |
| Self-note | no | Durable note for future story-lead planner turns |

Exact action field names, action names, and action-specific input shapes belong in the test plan or implementation pass, but every action must be valid for the current documented state.

### Initial Story-Orchestrate State Model

This table defines the required state-machine shape. Exact enum names may be adjusted during implementation, but the runtime must preserve these caller-visible meanings and allowed movements.

| State Meaning | Allowed Next Movement | Terminal |
|---------------|-----------------------|----------|
| Run initialized | Assemble planner context or fail before work starts | no |
| Awaiting story-lead action | Execute one valid story-lead action, reject invalid action, or fail on planner error | no |
| Running child operation | Record child result, mark interrupted, or fail on non-recoverable runtime error | no |
| Recording result | Advance to next planner turn, write final package, or fail if required artifact write fails | no |
| Awaiting caller ruling | Resume with caller ruling or remain terminal until caller responds | yes |
| Accepted | Remain terminal; implementation lead reviews and completes external acceptance steps | yes |
| Blocked | Remain terminal until blocker is resolved and run is reopened or replaced | yes |
| Failed | Remain terminal until caller diagnoses and reopens or starts a new run | yes |
| Interrupted | Resume, abandon, or start a new run with prior artifacts visible | yes |

Story-lead actions are valid only when the current state can accept them. A planner action that would skip required artifact recording, bypass verification evidence, or move from one terminal state to another without caller input is invalid.

### Story-Orchestrate Terminal Results

| Result | Description | Caller Implication |
|--------|-------------|--------------------|
| `accepted` | Story lead considers the story complete at story-lead scope | Implementation lead reviews evidence, completes receipt, runs gates, commits, and advances |
| `needs-ruling` | Story lead needs caller decision before continuing | Caller answers the ruling request or reopens with guidance |
| `blocked` | Missing prerequisite or external blocker prevents progress | Caller resolves blocker or defers story |
| `failed` | Runtime or story lead reached non-recoverable failure | Caller diagnoses failure before retry |
| `interrupted` | Run stopped before completion | Caller resumes, abandons, or starts a new run with awareness of prior artifacts |

### Runtime Identity

| Field | Required | Description |
|-------|----------|-------------|
| Version | yes | Package/runtime version |
| Invocation source | yes | One of `local-source`, `global-package`, `bundled-skill`, or `unknown` |
| Executable or entry path | when available | Path or entrypoint used to launch the runtime |

---

## Dependencies

Technical dependencies:

- Current `story-orchestrate` implementation from EPIC 3
- Provider adapter behavior for Codex and Claude Code
- Existing run config and provider config loading
- Existing integration test harness
- Windows blockers documented below from the Windows setup branch

### Windows Blocker List

The Windows compatibility flow covers these known blockers from the Windows setup branch:

| Blocker | Required Outcome |
|---------|------------------|
| Build asset sync resolves module URL paths incorrectly on Windows | Build path resolution uses Windows-safe file URL conversion |
| Provider probes and dispatch cannot find npm shim executables | Provider lookup finds `.cmd` and `.bat` shims as well as POSIX executables |
| Environment filtering strips Windows-required variables | Provider subprocesses receive required Windows user, app data, shell, path extension, and temp variables |
| Atomic rename can fail transiently on Windows | Atomic writes retry transient busy/lock failures before reporting failure |
| Codex provider sandbox policy blocks unattended implementation operations | Codex provider invocation supports and documents the required sandbox policy |
| Codex resume structured-output behavior can drift from initial-call schema enforcement | Resume behavior preserves result contract expectations or fails with clear schema-drift errors |

Process dependencies:

- Maintainer agreement that `story-orchestrate` is the default implementation path
- Maintainer-run Windows smoke validation near closeout
- Manual dogfooding with the CLI on actual story work as the primary usability check

---

## Non-Functional Requirements

### Reliability

- Story-lead planner continuity must come from durable story-run artifacts, not hidden provider conversation state.
- Required artifacts must be durable before dependent state advances.
- Integration tests must fail when their integration prerequisites are absent.

### Observability

- Story-run status must identify the current state, latest event, latest child operation, terminal result when present, runtime identity, and relevant artifact paths.
- Provider liveness output must distinguish startup, active silence, progress, stall, and completion.

### Cross-Platform

- Basic CLI build, help, preflight, provider lookup, artifact writes, and smoke operation behavior must work on macOS and Windows.

### Compatibility

- Existing primitive CLI and SDK operations remain available.
- The removed `story_lead` alias is intentionally not preserved.

---

## Execution Questions

Questions for the implementation lead to address during test planning or implementation:

1. Which exact enum names and action labels should implement the initial story-orchestrate state model while keeping logs and errors caller-readable?
2. What provider-specific liveness thresholds distinguish startup failure, active silence, and true stall for Claude Code, Codex, and other provider-backed operations?
3. What is the cleanest runtime identity signal for local source CLI, global published CLI, and bundled skill runtime?
4. What is the safest Windows executable lookup strategy for provider CLIs without regressing POSIX behavior?
5. What exact error code and diagnostic fields should represent full-context overflow while preserving the fail-loud behavior required by AC-2.10?
6. Which Windows smoke steps can be automated locally, and which remain maintainer-run in Parallels?

---

## Recommended Story Breakdown

### Story 0: Foundation, State Vocabulary, and Test Plan

**Delivers:** A shared state-machine vocabulary, AC-to-test mapping, required config decisions, and baseline docs needed before runtime changes.
**Prerequisite:** None
**ACs covered:**

- AC-3.1 (state diagram and vocabulary)
- AC-5.9 (complete test mapping)
- Execution Questions 1-6 captured for execution

### Story 1: Story-Orchestrate Becomes the Default Process

**Delivers:** Skill and CLI guidance direct normal story work through `story-orchestrate`, while primitives remain documented as lower-level operations.
**Prerequisite:** Story 0
**ACs covered:**

- AC-1.1 through AC-1.5
- AC-5.6

### Story 2: Stateless Story-Lead Planner Context

**Delivers:** Story-lead planner turns stop using persisted provider conversation state and receive the full durable story-run record plus all prior self-notes.
**Prerequisite:** Story 0
**ACs covered:**

- AC-2.1 through AC-2.11
- AC-3.2
- AC-3.7

### Story 3: Story-Orchestrate State, Resume, Reopen, and Terminal Results

**Delivers:** Clear caller-facing status, terminal result behavior, recovery by run id or story id, and reopened-run history preservation.
**Prerequisite:** Story 2
**ACs covered:**

- AC-3.3 through AC-3.8
- AC-5.8

### Story 4: Provider Config and Timeout Boundaries

**Delivers:** Required `story_lead_provider`, alias removal, Codex `gpt-5.5` guidance, dedicated planner timeout, and whole-run timeout.
**Prerequisite:** Story 2
**ACs covered:**

- AC-4.1 through AC-4.5

### Story 5: Provider Liveness, Verifier Accounting, and Stale Process Handling

**Delivers:** Claude Code `-p` liveness fix, provider liveness status, multi-lane verifier accounting, and stale process cleanup or abandonment handling.
**Prerequisite:** Story 4
**ACs covered:**

- AC-4.6 through AC-4.9

### Story 6: Artifact and Evidence Integrity

**Delivers:** Non-empty durable artifacts, artifact-before-state advancement, and current-run evidence provenance.
**Prerequisite:** Story 3
**ACs covered:**

- AC-5.1 through AC-5.3

### Story 7: Verification Gates, Integration Tests, and Runtime Identity

**Delivers:** No integration skips/fallbacks, `verify-all` integration gate behavior, approved targeted test commands, runtime identity output, and terminal progress markers.
**Prerequisite:** Stories 5-6
**ACs covered:**

- AC-5.4 through AC-5.9

### Story 8: Windows Compatibility and 0.4.0 Release Prep

**Delivers:** Windows path, executable lookup, environment, atomic write, Codex sandbox, Codex resume schema-drift handling, manual Windows smoke checklist, and version bump.
**Prerequisite:** Stories 1-7
**ACs covered:**

- AC-6.1 through AC-6.8

---

## Validation Checklist

- [ ] User Profile has all four fields and Feature Overview
- [ ] Scope boundaries are explicit
- [ ] Every AC has at least one TC
- [ ] TCs cover happy paths, errors, recovery, and cross-platform edge cases
- [ ] Data contracts describe only user-facing runtime/config/artifact boundaries
- [ ] Story breakdown covers all ACs
- [ ] Test plan maps every AC to automated or maintainer-run verification
- [ ] `story-orchestrate` is the documented normal path
- [ ] Primitive operations remain available but de-emphasized
- [ ] Integration tests fail rather than skip or fallback
- [ ] Windows smoke validation is recorded before closeout
- [ ] Version `0.4.0` is reported by the built CLI
