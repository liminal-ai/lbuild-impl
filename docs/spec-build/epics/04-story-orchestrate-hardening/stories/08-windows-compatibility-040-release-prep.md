# Story 8: Windows Compatibility and 0.4.0 Release Prep

### Summary
<!-- Jira: Summary field -->

Address Windows path, shim, environment, atomic write, Codex sandbox, Codex resume schema drift, smoke validation, and `0.4.0` release version requirements.

### Description
<!-- Jira: Description field -->

**Primary User:** Liminal Spec maintainer or implementation lead running `lbuild-impl` against a spec pack
**Context:** Story implementation currently depends on a mix of primitive commands, skill guidance, provider-backed child operations, and runtime artifacts. EPIC 3 introduced `story-orchestrate`, but the default process, provider configuration, timeout behavior, artifact guarantees, and cross-platform reliability still need hardening.
**Mental Model:** "I want the normal implementation path to be `story-orchestrate`: one story goes in, the runtime drives bounded child operations, the story lead sees the complete durable story-run record on each planner turn, and I get clear evidence about whether the story is accepted, blocked, failed, interrupted, or needs a ruling."
**Key Constraint:** This epic refines and hardens the existing runtime. It does not replace the whole implementation pipeline, remove primitive commands, or create a full epic-level autonomous orchestrator.

**Objective:** Prepare the hardened runtime for basic Windows operation and release as version `0.4.0`.

**In Scope:**
- Windows-safe build asset path resolution
- Windows provider shim lookup with POSIX behavior preserved
- Windows-required provider subprocess environment variables
- Atomic rename retry for transient Windows locks
- Codex sandbox policy configuration and guidance
- Codex resume structured-output drift handling
- Maintainer-run Windows smoke checklist and result recording
- Package and runtime version bump to `0.4.0`

**Out of Scope:**
- Full Windows CI with real provider credentials
- Epic-level orchestrator redesign

**Dependencies:** Stories 1-7

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

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

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story applies the known Windows blocker list and prepares the `0.4.0` release. The implementation should prefer portable primitives over platform string hacks: `fileURLToPath` for module URLs, PATHEXT-aware executable resolution for provider CLIs, explicit Windows env preservation, and bounded retry/backoff for transient rename locks.

Codex-specific work has two parts: sandbox policy must be configurable/documented for unattended implementation, and resume must preserve structured result expectations or fail clearly on schema drift.

#### Implementation Targets

| Area | Files |
|------|-------|
| Build asset paths | `scripts/sync-impl-cli-assets.ts` |
| Provider executable lookup | `src/core/provider-checks.ts`, `tests/unit/core/provider-executable-resolution.test.ts` |
| Provider adapters | `src/core/provider-adapters/shared.ts`, `src/core/provider-adapters/codex.ts`, `tests/unit/core/provider-adapter.test.ts` |
| Windows env | `src/infra/env-allowlist.ts`, `tests/unit/infra/env-allowlist.test.ts` |
| Atomic writes | `src/infra/fs-atomic.ts`, `tests/unit/infra/fs-atomic.test.ts` |
| Release version | `package.json`, `VERSION`, `tests/package/release/version-0-4.test.ts` |
| Manual evidence | `docs/spec-build/epics/04-story-orchestrate-hardening/windows-smoke-checklist.md` |

#### Design References

- [tech-design.md §Flow 7](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:355), lines 355-366
- [tech-design.md §Runtime Identity Interface](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:617), lines 617-625
- [tech-design.md §Work Breakdown Chunk 8](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:774), lines 774-796
- [tech-design.md §Open Questions](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/tech-design.md:798), lines 798-804
- [test-plan.md §Anti-Shim Integration Coverage](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:27), lines 27-41
- [test-plan.md §TC Mapping](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:177), lines 177-191
- [test-plan.md §Manual Windows Smoke Checklist](/Users/leemoore/code/lspec-core/docs/spec-build/epics/04-story-orchestrate-hardening/test-plan.md:209), lines 209-220

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-6.1a | `tests/unit/scripts/sync-impl-cli-assets.test.ts` | Windows file URL conversion avoids doubled-drive paths |
| TC-6.2a, TC-6.2b | `tests/unit/core/provider-executable-resolution.test.ts` | Windows `.cmd`/`.bat` shims and POSIX executables resolve |
| TC-6.3a | `tests/unit/infra/env-allowlist.test.ts` | Windows-required env vars are preserved |
| TC-6.3b, TC-6.5b | `tests/package/skills/ls-impl-story-cycle.test.ts` | env filtering and Codex sandbox guidance are documented |
| TC-6.4a, TC-6.4b | `tests/unit/infra/fs-atomic.test.ts` | transient rename failures retry; non-transient errors still fail |
| TC-6.5a, TC-6.6a, TC-6.6b | `tests/unit/core/provider-adapter.test.ts` | Codex sandbox policy and resume schema-drift behavior are enforced |
| TC-6.7a | `docs/spec-build/epics/04-story-orchestrate-hardening/windows-smoke-checklist.md` | Windows smoke checklist exists |
| TC-6.7b | implementation log closeout | Parallels result is recorded |
| TC-6.8a | `tests/package/release/version-0-4.test.ts` | package and version files report `0.4.0` |
| TC-6.8b | `tests/unit/core/runtime-identity.test.ts` or CLI package test | built CLI reports `0.4.0` |

#### Non-TC Decided Tests

None.

#### Anti-Shim Requirements

- Windows executable lookup tests must use PATH/PATHEXT-shaped fixtures, not POSIX-only command names.
- Codex resume schema drift must be rejected by the real parser/result contract, not ignored by permissive fixture parsing.
- Windows smoke is closeout evidence; do not convert it into a fake automated proof of Parallels execution.

#### Verification

- Targeted: `bun run test -- --run tests/unit/scripts/sync-impl-cli-assets.test.ts tests/unit/core/provider-executable-resolution.test.ts tests/unit/infra/env-allowlist.test.ts tests/unit/infra/fs-atomic.test.ts tests/unit/core/provider-adapter.test.ts tests/package/release/version-0-4.test.ts`
- Story gate: `npm run green-verify`
- Story completion gate: `npm run verify-all`
- Manual closeout: maintainer records Windows smoke result when Parallels validation is performed.

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Windows path conversion avoids doubled-drive paths
- [ ] Provider lookup finds `.cmd` and `.bat` shims and preserves POSIX lookup
- [ ] Windows-required environment variables are preserved and documented
- [ ] Atomic writes retry transient busy or lock rename failures
- [ ] Codex sandbox policy is configurable and documented for Windows implementation operations
- [ ] Codex resume schema-drift behavior preserves or clearly rejects result contracts
- [ ] Windows smoke checklist exists and Parallels result is recorded
- [ ] Package and built CLI report `0.4.0`
- [ ] `story-verify` returns `pass`
- [ ] `npm run green-verify` passes
- [ ] `npm run verify-all` passes
- [ ] Receipt is complete
- [ ] Story commit is landed
