# Story Sharding Coverage

## Integration Path Trace

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Default story execution | Agent reads skill and runs one story through `story-orchestrate` with local CLI guidance and caller acceptance boundary. | Story 1 | TC-1.1a, TC-1.3a, TC-1.5a |
| Planner turn assembly | Runtime starts a story-lead turn from story-local requirements, test plan, snapshot, events, artifacts, caller inputs, and prior self-notes. | Story 2 | TC-2.2a, TC-2.3a, TC-2.4a, TC-2.5a, TC-2.8a |
| Action validation and child failure capture | Runtime validates one bounded action, executes child work, and records child failures into the durable story-run record. | Story 2 | TC-3.2a, TC-3.7a |
| Status, resume, and terminal recovery | Caller inspects status, resumes from durable artifacts, and interprets terminal results from caller-readable state names. | Story 3 | TC-3.3a, TC-3.4a, TC-3.5a, TC-3.8a |
| Provider configuration and timeout budget | Runtime requires configured story lead and applies separate planner-turn and whole-run timeout budgets. | Story 4 | TC-4.1a, TC-4.4a, TC-4.5a |
| Provider liveness and stale-process handling | Runtime reports provider liveness without confusing quiet work for failure and isolates interrupted-run process output. | Story 5 | TC-4.6a, TC-4.7a, TC-4.9b |
| Artifact evidence durability | Runtime writes durable child artifacts before state advancement and separates current-run evidence from preexisting files. | Story 6 | TC-5.2a, TC-5.3a |
| Verification and runtime identity closeout | Story completion requires `verify-all`, integration tests do not skip internally, and runtime output identifies invocation source and version. | Story 7 | TC-5.4a, TC-5.5a, TC-5.7a |
| Windows and release closeout | Release preparation validates Windows smoke evidence and version `0.4.0` reporting. | Story 8 | TC-6.7b, TC-6.8b |

## Coverage Gate

| AC | TC | Story |
|----|-----|-------|
| AC-1.1 | TC-1.1a, TC-1.1b | Story 1: Story-Orchestrate Becomes the Default Process |
| AC-1.2 | TC-1.2a, TC-1.2b | Story 1: Story-Orchestrate Becomes the Default Process |
| AC-1.3 | TC-1.3a, TC-1.3b | Story 1: Story-Orchestrate Becomes the Default Process |
| AC-1.4 | TC-1.4a, TC-1.4b | Story 1: Story-Orchestrate Becomes the Default Process |
| AC-1.5 | TC-1.5a, TC-1.5b | Story 1: Story-Orchestrate Becomes the Default Process |
| AC-2.1 | TC-2.1a, TC-2.1b | Story 2: Stateless Story-Lead Planner Context |
| AC-2.2 | TC-2.2a | Story 2: Stateless Story-Lead Planner Context |
| AC-2.3 | TC-2.3a | Story 2: Stateless Story-Lead Planner Context |
| AC-2.4 | TC-2.4a, TC-2.4b | Story 2: Stateless Story-Lead Planner Context |
| AC-2.5 | TC-2.5a, TC-2.5b, TC-2.5c | Story 2: Stateless Story-Lead Planner Context |
| AC-2.6 | TC-2.6a, TC-2.6b, TC-2.6c | Story 2: Stateless Story-Lead Planner Context |
| AC-2.7 | TC-2.7a, TC-2.7b | Story 2: Stateless Story-Lead Planner Context |
| AC-2.8 | TC-2.8a, TC-2.8b | Story 2: Stateless Story-Lead Planner Context |
| AC-2.9 | TC-2.9a, TC-2.9b | Story 2: Stateless Story-Lead Planner Context |
| AC-2.10 | TC-2.10a, TC-2.10b | Story 2: Stateless Story-Lead Planner Context |
| AC-2.11 | TC-2.11a, TC-2.11b | Story 2: Stateless Story-Lead Planner Context |
| AC-3.1 | TC-3.1a, TC-3.1b | Story 0: Foundation, State Vocabulary, and Test Plan |
| AC-3.2 | TC-3.2a, TC-3.2b | Story 2: Stateless Story-Lead Planner Context |
| AC-3.3 | TC-3.3a, TC-3.3b, TC-3.3c, TC-3.3d, TC-3.3e | Story 3: Story-Orchestrate State, Resume, Reopen, and Terminal Results |
| AC-3.4 | TC-3.4a, TC-3.4b | Story 3: Story-Orchestrate State, Resume, Reopen, and Terminal Results |
| AC-3.5 | TC-3.5a, TC-3.5b, TC-3.5c | Story 3: Story-Orchestrate State, Resume, Reopen, and Terminal Results |
| AC-3.6 | TC-3.6a, TC-3.6b | Story 3: Story-Orchestrate State, Resume, Reopen, and Terminal Results |
| AC-3.7 | TC-3.7a, TC-3.7b | Story 2: Stateless Story-Lead Planner Context |
| AC-3.8 | TC-3.8a | Story 3: Story-Orchestrate State, Resume, Reopen, and Terminal Results |
| AC-4.1 | TC-4.1a, TC-4.1b | Story 4: Provider Config and Timeout Boundaries |
| AC-4.2 | TC-4.2a, TC-4.2b | Story 4: Provider Config and Timeout Boundaries |
| AC-4.3 | TC-4.3a, TC-4.3b | Story 4: Provider Config and Timeout Boundaries |
| AC-4.4 | TC-4.4a, TC-4.4b | Story 4: Provider Config and Timeout Boundaries |
| AC-4.5 | TC-4.5a, TC-4.5b | Story 4: Provider Config and Timeout Boundaries |
| AC-4.6 | TC-4.6a, TC-4.6b | Story 5: Provider Liveness, Verifier Accounting, and Stale Process Handling |
| AC-4.7 | TC-4.7a, TC-4.7b | Story 5: Provider Liveness, Verifier Accounting, and Stale Process Handling |
| AC-4.8 | TC-4.8a, TC-4.8b | Story 5: Provider Liveness, Verifier Accounting, and Stale Process Handling |
| AC-4.9 | TC-4.9a, TC-4.9b | Story 5: Provider Liveness, Verifier Accounting, and Stale Process Handling |
| AC-5.1 | TC-5.1a, TC-5.1b, TC-5.1c | Story 6: Artifact and Evidence Integrity |
| AC-5.2 | TC-5.2a, TC-5.2b | Story 6: Artifact and Evidence Integrity |
| AC-5.3 | TC-5.3a, TC-5.3b | Story 6: Artifact and Evidence Integrity |
| AC-5.4 | TC-5.4a, TC-5.4b, TC-5.4c | Story 7: Verification Gates, Integration Tests, and Runtime Identity |
| AC-5.5 | TC-5.5a, TC-5.5b | Story 7: Verification Gates, Integration Tests, and Runtime Identity |
| AC-5.6 | TC-5.6a, TC-5.6b | Story 1: Story-Orchestrate Becomes the Default Process |
| AC-5.7 | TC-5.7a, TC-5.7b, TC-5.7c | Story 7: Verification Gates, Integration Tests, and Runtime Identity |
| AC-5.8 | TC-5.8a, TC-5.8b | Story 3: Story-Orchestrate State, Resume, Reopen, and Terminal Results |
| AC-5.9 | TC-5.9a | Story 0: Foundation, State Vocabulary, and Test Plan |
| AC-6.1 | TC-6.1a | Story 8: Windows Compatibility and 0.4.0 Release Prep |
| AC-6.2 | TC-6.2a, TC-6.2b | Story 8: Windows Compatibility and 0.4.0 Release Prep |
| AC-6.3 | TC-6.3a, TC-6.3b | Story 8: Windows Compatibility and 0.4.0 Release Prep |
| AC-6.4 | TC-6.4a, TC-6.4b | Story 8: Windows Compatibility and 0.4.0 Release Prep |
| AC-6.5 | TC-6.5a, TC-6.5b | Story 8: Windows Compatibility and 0.4.0 Release Prep |
| AC-6.6 | TC-6.6a, TC-6.6b | Story 8: Windows Compatibility and 0.4.0 Release Prep |
| AC-6.7 | TC-6.7a, TC-6.7b | Story 8: Windows Compatibility and 0.4.0 Release Prep |
| AC-6.8 | TC-6.8a, TC-6.8b | Story 8: Windows Compatibility and 0.4.0 Release Prep |

## Validation

- [x] Every AC from the detailed epic appears in exactly one story file.
- [x] Every TC from the detailed epic appears in exactly one story file.
- [x] Integration path trace has no unowned path segments.
- [x] Coverage gate has no orphan ACs or TCs.
- [x] Story files are numbered and named consistently.
- [x] No business epic was produced.
