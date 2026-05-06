# Story 2: Release Evidence Polish

## Summary
Leave the fixture in a state that makes release evidence quick to inspect and easy to diff after resets.

## Scope
- Keep seeded review reports readable.
- Keep the cleanup batch actionable.
- Preserve enough context in the README for a maintainer to understand the fixture without opening every file first.

## Acceptance Criteria
- `epic-reverify` can run against the seeded review reports.
- `epic-fix` can run against the seeded fix batch.
- The target codebase README still explains the verification scripts and sample modules.
