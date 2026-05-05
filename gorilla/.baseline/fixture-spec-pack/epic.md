# Epic: Animal Summary Fixture

## Summary
Keep the tiny animal summary codebase readable, verifiable, and easy to mutate during real package runs.

## Objective
Give the gorilla pack a realistic spec pack with enough structure to exercise every `@lspec/core` operation without dragging release verification into a long-running sample app.

## Flows

### Flow 1: Stabilize the target codebase
- AC-1.1: The target codebase exposes a formatter module, a summary module, and sample data for at least three animals.
- AC-1.2: Story-level verification runs through `npm --prefix ./target-codebase run green-verify`.
- AC-1.3: Epic-level verification runs through `npm --prefix ./target-codebase run verify-all`.

### Flow 2: Keep provider prompts grounded
- AC-2.1: The fixture stories point at concrete files under `target-codebase/`.
- AC-2.2: Seed verifier reports and a seed cleanup batch exist so `epic-synthesize` and `epic-cleanup` can run without waiting for a prior gorilla session.
- AC-2.3: Alternate run-configs exist for Claude Code, Codex, and a forced-stall scenario.

### Flow 3: Produce release evidence
- AC-3.1: The gorilla operator can record smoke, resume, structured-output, and stall evidence for the package.
- AC-3.2: The fixture is small enough to reset from source and rerun repeatedly.
- AC-3.3: The target codebase README explains the verification scripts the gorilla operator is expected to invoke.

## Story Breakdown
- Story 0: Foundation and gate wiring
- Story 1: Structured output and report shaping
- Story 2: Release evidence polish
