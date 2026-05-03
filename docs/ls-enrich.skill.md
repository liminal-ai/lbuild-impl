---
name: ls-enrich
description: Enrich already-sharded implementation stories with story-scoped technical guidance after an epic/spec, tech design, and test plan exist. Use this whenever the user wants stories prepared for implementation handoff, asks to add technical design context to stories, mentions "tech enrichment", "technical enrichment", "story enrichment", or wants each story to include relevant architecture notes, implementation targets, tests, and exact references back to source design docs. This skill applies across APIs, UIs, CLIs, libraries, services, data pipelines, and infrastructure work.
---

# LS Enrich

Use this skill after stories have already been published or sharded from an epic and the user wants each story to carry enough technical context for implementers without copying the full tech design into every story.

The output is an enriched story set: each story keeps its original product/acceptance content, and gains a concise technical section that points to the exact source design and test-plan sections an implementer should read in detail.

## Purpose

Technical enrichment sits between story sharding and implementation.

It should:

- make each story independently implementable enough for an agent or engineer to start safely;
- preserve the tech design as the canonical detailed source;
- avoid turning stories into duplicate mini tech designs;
- map story-owned tests without breaking coverage ownership;
- call out implementation boundaries, anti-shim requirements, and dependency relationships.

It should not:

- rewrite the epic, ACs, or test conditions unless the user explicitly asks;
- move acceptance criteria between stories;
- claim test cases owned by another story;
- add broad architecture not relevant to that story;
- invent code structure when the tech design or codebase already provides one.

## Inputs

Ask for or infer these inputs:

- Epic or feature spec: product behavior, flows, ACs, and story breakdown.
- Tech design: architecture, interfaces, data contracts, files/modules, sequence details, migration notes, risks.
- Test plan: TC ownership, test files, integration strategy, non-TC decided tests, verification gates.
- Story files: one file per implementation story.
- Optional current-state docs or codebase context when the tech design references existing implementation.

If any input is missing, continue when the remaining artifacts are enough, but mark uncertain guidance as inferred. Do not fabricate precise file paths, test names, or line ranges.

## Reading Workflow

Read source artifacts deliberately before editing.

1. Read the governing epic/spec first.
2. Reflect on story boundaries, AC ownership, and any implementation risk areas.
3. Read the tech design.
4. Reflect on the architecture chunks, file/module ownership, and story-to-design mapping.
5. Read the test plan.
6. Reflect on TC ownership, non-TC tests, integration gates, mocks, and anti-shim constraints.
7. Read every target story before modifying any story.
8. Use numbered line views of source docs before writing references.

For large files, read in chunks of about 500 lines and briefly reflect after each chunk. Reflection should identify what the chunk changes about the enrichment plan, not merely summarize the text.

## Enrichment Shape

Add or replace a `### Technical Design` section in each story. Keep it concise and story-scoped.

Use this default structure:

```markdown
### Technical Design

#### Architecture Context

[One to three short paragraphs explaining this story's role in the design.]

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| [Area] | `[path]`, `[path]` |

#### Design References

- [tech-design.md §Section](/absolute/path/to/tech-design.md:123), lines 123-145
- [test-plan.md §Section](/absolute/path/to/test-plan.md:67), lines 67-82

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-x.ya | `[test/path]` | [story-owned check] |

#### Non-TC Decided Tests

- `[test/path]`: [test intent]

#### Technical Notes

- [Optional story-specific implementation guidance.]

#### Anti-Shim Requirements

- [Optional warnings that prevent fake or superficial implementation.]

#### Verification

- Targeted: `[command]`
- Story gate: `[command]`
- Epic gate: `[command]`

#### Spec Deviations

None.
```

Omit optional subsections only when they are genuinely empty. Prefer `None.` over leaving ambiguity in `Non-TC Decided Tests` and `Spec Deviations`.

## Section Guidance

### Architecture Context

Explain how the story fits into the design in implementer language.

Good context names the design role:

- API: endpoint boundary, request/response contract, auth behavior, idempotency, persistence path.
- UI: user workflow, component state, loading/error states, accessibility, data dependencies.
- CLI: command contract, config resolution, process lifecycle, stdout/stderr behavior, exit codes.
- Library: public API surface, internal module boundary, compatibility constraints, error model.
- Service/infrastructure: lifecycle, deployment boundary, retries/timeouts, observability, failure modes.

Keep this section scoped to the story. If the implementer needs broader context, link to the source design.

### Implementation Targets

List likely files, modules, packages, commands, schemas, components, or tests touched by the story.

Prefer existing paths from the tech design or repository. When paths are inferred, say so:

```markdown
| API handler | `src/routes/orders.ts` (inferred from current route layout) |
```

Do not use the implementation target table to pull another story's ownership into this story. Cross-story dependencies belong in prose notes, not as owned targets.

### Design References

Every enriched story should point back to exact source sections with line ranges.

Reference only sections relevant to that story:

- architecture/flow sections;
- interface or schema definitions;
- state machine or lifecycle rules;
- provider/process details;
- UI component/state design;
- migration/backward compatibility notes;
- story-specific work breakdown;
- test-plan mapping and integration strategy.

Use clickable links when editing local Markdown:

```markdown
- [tech-design.md §Runtime Contract](/abs/path/tech-design.md:210), lines 210-244
```

Line ranges are required because implementers and future agents need to jump directly to the deeper design.

### Test Mapping

Map only story-owned tests.

This section must not break coverage ownership rules. If the original published stories assign each AC/TC to exactly one story, preserve that assignment.

Rules:

- Include only TCs owned by this story.
- Use exact TC IDs, not ranges like `TC-2.2a-TC-2.6c`.
- Do not repeat TC IDs in dependency notes for other stories if simple scanners might count them.
- If another story's behavior is a dependency, mention it without the TC ID.
- If a test plan has no TC IDs, map named scenarios or checks instead.

Good:

```markdown
| TC-3.4a, TC-3.4b | `tests/package/cli/status.test.ts` | status reports active and terminal run state |

Related dependency reference: the planner story owns child-operation recoverability; this story consumes that durable result when rendering status.
```

Avoid:

```markdown
| TC-3.7b | `tests/unit/ledger.test.ts` | dependency owned by another story |
Related: Story 2 owns TC-3.7b.
```

The first form preserves implementation guidance without confusing ownership scans.

### Non-TC Decided Tests

Capture tests the tech design or test plan requires even when they are not formal acceptance TCs.

Examples:

- regression tests for backward compatibility;
- schema strictness tests;
- anti-shim tests;
- snapshot or fixture compatibility tests;
- accessibility checks;
- visual regression checks;
- CLI stdout/stderr parseability;
- library API compatibility tests.

Use `None.` when there are no non-TC tests for the story.

### Technical Notes

Use this section for narrow design guidance that does not fit the tables.

Examples:

- preserve existing public status values while adding a stricter internal lifecycle field;
- keep primitive CLI commands available while making an orchestrated command the default path;
- use real parser/serializer APIs instead of string matching;
- keep UI state in the route-level loader rather than duplicating cache state in the component;
- maintain backward compatibility with old snapshots or serialized data.

### Anti-Shim Requirements

Add this section when the story is vulnerable to superficial implementation.

Call out what proof is required:

- assert against actual serialized provider input, not a mocked helper result;
- verify full artifact content, not only paths or filenames;
- use real temporary files/processes where liveness or filesystem behavior matters;
- fail if integration prerequisites are missing instead of silently skipping;
- prove UI behavior through DOM, accessibility tree, or browser interaction, not only component function calls;
- prove API behavior through request/response boundaries, not only service-level unit calls;
- prove library compatibility through public imports, not only private module tests.

### Verification

List targeted and gate commands appropriate for the project.

Examples:

```markdown
- Targeted: `bun run test -- --run tests/unit/core/example.test.ts`
- Story gate: `npm run green-verify`
- Epic gate: `npm run verify-all`
```

Use the project's documented commands. Do not introduce raw runner commands when the repo warns against them.

## Ownership Safety

Before editing, identify the source of truth for story ownership:

- published story AC/TC sections;
- coverage file;
- test-plan mapping;
- epic story breakdown;
- Jira markers or story metadata.

After editing, verify:

- every story still has its ACs and Jira markers if they existed;
- no AC/TC has moved stories unless explicitly requested;
- no TC appears as owned by multiple stories;
- dependency references do not look like owned TC mappings;
- no enriched section contradicts story scope;
- line references point to the intended source sections.

When feedback identifies ownership drift, patch narrowly. Remove the duplicate owned mapping first, then add a prose dependency note if useful.

## Cross-Domain Examples

### API Story

Architecture context should cover endpoint ownership, auth, validation, persistence, idempotency, and error model.

Implementation targets might include:

- route/controller;
- request/response schema;
- service layer;
- repository/query;
- migration;
- API contract tests.

Anti-shim checks might require exercising the real HTTP boundary and verifying response codes, headers, and serialized error shape.

### UI Story

Architecture context should cover user flow, component boundaries, state ownership, data loading, optimistic updates, accessibility, and responsive behavior.

Implementation targets might include:

- route/page component;
- shared components;
- state hook/store;
- data client;
- CSS/theme tokens;
- component, browser, and accessibility tests.

Anti-shim checks might require keyboard navigation, screen-reader labels, loading/error states, and viewport-specific verification.

### CLI Story

Architecture context should cover command contract, config resolution, stdout/stderr, exit codes, process lifecycle, timeouts, and artifact paths.

Implementation targets might include:

- command parser;
- config schema;
- process/provider adapter;
- output formatter;
- package scripts;
- CLI package tests.

Anti-shim checks might require real subprocess behavior, parseable stdout, and no hidden success on failed child commands.

### Library Story

Architecture context should cover public API surface, module boundaries, type contracts, compatibility, error model, and performance constraints.

Implementation targets might include:

- exported entrypoint;
- internal module;
- type definitions;
- fixture compatibility;
- unit and package import tests.

Anti-shim checks might require testing public imports and serialized compatibility rather than private helper calls.

## Final Review Checklist

Run a document review before declaring the enrichment ready:

- All target stories have a `### Technical Design` section.
- Each story has relevant architecture context.
- Implementation targets are story-scoped.
- Design references include exact line ranges.
- Test Mapping uses exact IDs and only story-owned coverage.
- Cross-story dependencies are prose-only and avoid duplicate TC IDs.
- Non-TC tests are captured or explicitly `None.`.
- Anti-shim guidance exists for high-risk stories.
- Verification commands match the repo/project guidance.
- Existing ACs, TCs, Jira markers, and story metadata are preserved.
- No placeholder text remains.

If possible, run simple scans for duplicate TC IDs and range syntax. Treat scan results as review aids, not proof that the enrichment is semantically correct.

## Response Style

When finished, summarize:

- which stories were enriched;
- what sections were added;
- any ownership or scope decisions made;
- whether tests or only document checks were run;
- any known uncertainties.

Keep the final response concise. The enriched story files are the deliverable.
