# Windows Bug Log

Consolidated log of Windows-specific defects discovered while standing up `lbuild-impl` on a Windows host. Submitted for repo-owner review. Each entry is self-contained: symptom, environment, repro, root cause, suggested fix, status.

**Reporter environment (applies to all entries unless noted):**

| Component | Value |
|---|---|
| OS | Windows 10 Pro 10.0.19045 |
| Shell tested | Git Bash (MSYS2) and PowerShell — same failure mode in both |
| Node | v24.14.0 (via fnm) |
| npm | 11.9.0 |
| `lbuild-impl` | v0.4.0 (source-linked dev install at `C:\github\lbuild-impl`) |

## v0.4.0 retest status (in progress)

The v0.3.0 entries below are the original report submitted upstream. After v0.4.0 was released by the repo owner, we are re-running the same end-to-end flow on Windows and updating each entry with one of:

- **Fixed in v0.4.0** — owner's fix verified; entry preserved as historical record.
- **Still reproduces in v0.4.0** — owner's fix incomplete or not addressed; updated repro/diff captured under a `### v0.4.0 retest` subsection.
- **Regressed differently in v0.4.0** — fix caused a different Windows failure; new failure documented under the same BUG-WIN id.
- **Did not reproduce in v0.4.0 + patches** — defect did not surface under the retest workload; entry preserved with the observation rather than declared fixed (we don't have enough coverage to claim universal absence).

New issues uncovered against v0.4.0 are filed as `BUG-WIN-007+`.

### Milestone — first clean Windows end-to-end run (2026-05-07)

With v0.4.0 + the local BUG-WIN-008 / BUG-WIN-009 / BUG-WIN-010 patches applied, `lbuild-impl story-orchestrate run --spec-pack-root C:/github/crumb/docs/epics/f0 --story-id 00-foundation --heartbeat --json` completed cleanly on Windows 10 Pro 10.0.19045 in 44m40s. Five planner turns, three child-op completions, real codex execution (5 distinct sessions), real `pnpm`/`git` mutations under `danger-full-access` sandbox, terminal `outcome: needs-ruling` (a legitimate story-level pause on spec-deviation rulings — not a runtime defect). No EPERM, EBUSY, EACCES, ENOENT, EFTYPE, EPIPE, ENAMETOOLONG, sandbox/denial, rename, or PROVIDER_OUTPUT_INVALID across any stream or event log. This is the first observed full-cycle Windows orchestration since the bug log was opened against v0.3.0.

| ID | v0.3.0 status | v0.4.0 retest |
|---|---|---|
| BUG-WIN-001 | Local patch | **Fixed in v0.4.0** — `npm run build` completes cleanly on Windows; no doubled drive letter |
| BUG-WIN-002 | Local patch | **Partially fixed in v0.4.0** — Windows shim handling added (`buildWindowsCommandShimInvocation`), but candidate-ordering bug in `resolveProviderExecutable` reproduces the same `PROVIDER_UNAVAILABLE` surface symptom for any npm-installed codex. See BUG-WIN-008 |
| BUG-WIN-003 | Local patch | **Resolved by removal in v0.4.0** — copilot provider was removed entirely (commit `e63fd35`); `secondary_harness` enum no longer accepts `"copilot"` so the failure mode is no longer reachable |
| BUG-WIN-004 | Local patch | **Did not reproduce in v0.4.0 + 008/009/010 patches.** Observed 2026-05-07: `story-lead`/progress writers exercised ≥8× over 44m40s on Windows 10 Pro (5 planner turns + 3 child-op completions), all rename-replace writes coherent; final `001-current.json` and `001-events.jsonl` (20 events) parse cleanly. The v0.3.0 80%-reliable EPERM signature did not surface for this workload. May still fire under denser bursts or larger artifact volumes — leaving open pending heavier reproduction. |
| BUG-WIN-005 | Local patch | **Did not reproduce in v0.4.0 + 008/009/010 patches.** Observed 2026-05-07: codex implementor added a Prettier dep (`package.json` + `pnpm-lock.yaml` mutated), ran `npm run lint`, `npm run lint:no-direct-kb`, `npm run check-env`, `npm run verify`, and the focused integration test — all green. No sandbox/denial messages in any stream. Sandbox now defaults to `danger-full-access` per `provider-adapters/codex.ts:DEFAULT_CODEX_SANDBOX_MODE` which removes the v0.3.0 surface; leaving open in case a configuration that requests `workspace-write` mode reproduces it. |
| BUG-WIN-006 | Local patch | _Still pending retest — the 2026-05-07 run drove all 5 planner turns as fresh codex sessions (no `story-orchestrate resume` cycle), so the resume payload path is not yet exercised on Windows. To close: run `story-orchestrate resume` after a Ctrl-C interrupt or after providing rulings to the current `needs-ruling` terminal._ |

New v0.4.0 entries:

| ID | Stage | Summary |
|---|---|---|
| BUG-WIN-007 | `npm run build` | `sync-impl-cli-assets` embeds prompt assets with CRLF on Windows, dirtying tracked generated source after every build and shipping CRLF prompts to providers |
| BUG-WIN-008 | `preflight` (probe) | `resolveProviderExecutable` returns the extension-less POSIX shim ahead of the `.cmd` shim on Windows; Windows can't execute a `#!/bin/sh` file via `execFile`, so codex appears `unavailable` even when `codex --version` works fine in any shell. _Patched locally 2026-05-07: candidate loop now tries PATHEXT extensions before the bare name._ |
| BUG-WIN-009 | `preflight` (probe) | `buildWindowsCommandShimInvocation` produces args that survive the existing unit test but get mangled by Node's default Windows quote-escaping at `child_process.execFile` time, leaving cmd.exe with literal `\"path\\codex.cmd\"` it cannot resolve. _Patched locally 2026-05-07: cmd-native `""` quote escape + outer wrap + `windowsVerbatimArguments: true`. Combined with BUG-WIN-008 patch, `preflight` now returns `outcome:"ready"` with codex `available:true, tier:binary-present, version:codex-cli 0.128.0`._ |
| BUG-WIN-010 | `story-orchestrate run` (codex spawn) | Codex adapter passes the planner prompt as a positional argv argument (`codex exec … <prompt>`); on Windows the 81 KB story-00 planner prompt exceeds CreateProcessW's ~32,767-char command-line limit, so `child_process.spawn` rejects synchronously with `ENAMETOOLONG` before codex starts. POSIX `ARG_MAX` is large enough to mask this. _Patched locally 2026-05-07: codex adapter now passes `-` (stdin sentinel) as the prompt arg and pipes `request.prompt` to `child.stdin`; `runProviderCommand` accepts `stdin?: string` and writes it EPIPE-safely after spawn. Also wired `windowsVerbatimArguments: true` for the cmd-shim path here (was missing — latent issue surfaced by BUG-WIN-009's wrap pattern)._ |
| BUG-WIN-011 | `story-orchestrate run` (durable state) | When the codex child spawn fails before any lifecycle event is emitted, the orchestrator surfaces the error in the response envelope but does not transition the durable story-run lifecycle to a terminal state (`failed`/`errored`). `story-lead/001-current.json` is left at `status:running, lifecycleState:awaiting_story_lead_action` indefinitely; a subsequent `story-orchestrate resume` would treat the run as still alive. |

## End-to-end acceptance scenario

With all six patches applied locally, the following user prompt — which previously could not progress past `npm run build` on this Windows host — runs end-to-end:

> I want you to build the stories for epic `C:\github\crumb\docs\epics\f1`, make sure to specify the `--story-gate` and `--epic-gate` CLI flags to default to `npm run lint` if no tests have been written yet.

The orchestrator translates that into the standard `lbuild-impl` flow:

```sh
lbuild-impl inspect   --spec-pack-root C:/github/crumb/docs/epics/f1 --json
lbuild-impl preflight --spec-pack-root C:/github/crumb/docs/epics/f1 \
                      --story-gate "npm run lint" \
                      --epic-gate  "npm run lint" \
                      --json
# then: story-implement / story-continue / story-verify / quick-fix / epic-verify / epic-synthesize
```

How the patches map to the failure modes uncovered along that flow:

| Stage | Blocker without patch | Patch |
|---|---|---|
| `npm run build` | doubled drive letter ENOENT | BUG-WIN-001 |
| `preflight` (probe) | `PROVIDER_UNAVAILABLE` for `codex`/`copilot` shims | BUG-WIN-002 |
| `preflight` (probe) | `copilot --version` hangs to timeout | BUG-WIN-003 |
| `story-implement` (long run) | `EPERM: rename` crashes runtime-progress writer | BUG-WIN-004 |
| `story-implement` (codex) | sandbox blocks `pnpm add` and `git rm` of tracked files | BUG-WIN-005 |
| `story-continue` (codex) | `PROVIDER_OUTPUT_INVALID` on resume-path payloads | BUG-WIN-006 |

A regression in any one of these re-blocks the same prompt at the corresponding stage. BUG-WIN-001 through BUG-WIN-003 are required to even reach a green `preflight`; BUG-WIN-004 through BUG-WIN-006 are required for codex-driven multi-turn implementation to complete without losing work.

---

## BUG-WIN-001 — `npm run build` fails with doubled drive letter on Windows

**Severity:** Blocker — stops the very first `npm run build` after `npm ci`.
**Status (v0.3.0):** Fixed locally in this working tree (not yet upstreamed). Awaiting repo-owner review.
**Status (v0.4.0):** ✅ **Fixed upstream.** Verified on 2026-05-07 via `npm run build` on Windows 10 Pro 10.0.19045 — `scripts/sync-impl-cli-assets.ts` now resolves the project root correctly and the build completes through `tsup` without ENOENT.
**Affected:** Any Windows host running `npm run build`.

### Symptom

```text
$ npm run build

> lbuild-impl@0.3.0 build
> tsx scripts/sync-impl-cli-assets.ts && tsup && node scripts/ensure-bin-shebang.mjs

node:internal/fs/promises:953
  const result = await PromisePrototypeThen(
                 ^

Error: ENOENT: no such file or directory, scandir 'C:\C:\github\lbuild-impl\src\prompts\base'
    at async readdir (node:internal/fs/promises:953:18)
    ...
```

Note the doubled `C:\C:\` in the path.

### Reproduction

```sh
git clone https://github.com/liminal-ai/lbuild-impl.git
cd lbuild-impl
npm ci
npm run build   # fails immediately, before tsup runs
```

### Root cause

`scripts/sync-impl-cli-assets.ts:4` derived the project root with:

```ts
const ROOT = new URL("..", import.meta.url).pathname;
```

On Windows, `URL.pathname` for a `file://` URL yields a leading-slash form like `/C:/github/lbuild-impl/`. `path.join(ROOT, "src", "prompts", "base")` then treats the leading `/C:` as a relative segment and Node prepends the current working directory's drive (`C:\`), producing `C:\C:\github\lbuild-impl\src\prompts\base`. That directory doesn't exist, so `readdir` throws `ENOENT`.

POSIX is unaffected because there's no drive letter — `URL.pathname` already returns a usable absolute path.

### Suggested fix

Use `fileURLToPath` from `node:url`, which converts a `file://` URL into a proper OS-native path on every platform:

```ts
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
```

Applied in this working tree at `scripts/sync-impl-cli-assets.ts:4-6`. With the patch, `npm run build` completes cleanly on the same Windows host (verified — `dist/` populated, CLI runs).

### Audit note

A repo-wide grep for `import.meta.url).pathname` returned only that one site, so no further occurrences need patching.

---

## BUG-WIN-002 — `lbuild-impl preflight` reports `PROVIDER_UNAVAILABLE` for `codex` and `copilot` because `execFile` doesn't honor `PATHEXT`

**Severity:** Blocker — prevents any Windows user from running stories with `codex` or `copilot` as the secondary harness.
**Status:** Fixed locally in this working tree (not yet upstreamed). Fix combines option 2 (`shell: true` for the static-arg probe path) and option 3 (`cross-spawn` for the prompt-arg dispatch path). Awaiting repo-owner review.
**Affected:** Any Windows host where the secondary harness is installed only as an npm-style shim (`.cmd`/`.bat`/`.ps1`) without an `.exe` sibling.
**Upstream evidence:** Detailed report in the `crumb` consumer repo: `C:\github\crumb\docs\epics\f1\lbuild-impl-preflight-blocker.md`. Captured 2026-05-01 during F1 lbuild-impl run setup.

### Symptom

`lbuild-impl preflight` returns `outcome: blocked`, error `PROVIDER_UNAVAILABLE`, with `notes: ["Unable to execute codex --version"]` (or `copilot --version`) — even though both CLIs run fine when invoked manually from the same shell.

The `claude` (primary) probe in the same envelope returns `tier: authenticated-known` with a real version string, so PATH propagation, env filtering, and the auth-status follow-up all work for an extensionless binary. Only the npm-shim secondary harnesses fail.

### Environment specifics

| Tool | Files on PATH |
|---|---|
| `codex` (codex-cli 0.120.0) | `codex` (Bash shim), `codex.cmd`, `codex.ps1` — **no `.exe`** |
| `copilot` (GitHub Copilot CLI 1.0.26) | `copilot` (Bash shim), `copilot.bat`, `copilot.ps1` — **no `.exe`** |
| `claude` (Claude Code 2.1.126) | `claude` (extensionless native binary, 254 MB) **and** `claude.exe` |

### Reproduction

```bash
cd C:\github\<any-spec-pack-consumer>

# Manual probes succeed:
codex --version           # → codex-cli 0.120.0
copilot --version         # → GitHub Copilot CLI 1.0.26.

# child_process.execSync (which routes through cmd.exe and honors PATHEXT) succeeds:
node -e "console.log(require('child_process').execSync('codex --version', {stdio:'pipe'}).toString())"

# lbuild-impl preflight fails:
lbuild-impl preflight --spec-pack-root <pack-root> --json
# → status:"blocked", outcome:"blocked", error PROVIDER_UNAVAILABLE,
#   detail: "Unable to execute codex --version"
```

### Root cause

`src/core/provider-checks.ts:28-36` (`runCommand`) calls `getExecFileImplementation()` without `shell: true`:

```ts
getExecFileImplementation()(
  params.file,        // e.g. "codex" — bare, from executableForHarness()
  params.args,        // ["--version"]
  { cwd, env: filterEnv(...), timeout, encoding: "utf8" },
  callback,
);
```

`getExecFileImplementation()` (`src/core/runtime-deps.ts:71-73`) falls through to `node:child_process.execFile`, which on Windows ultimately calls `CreateProcessW`. `CreateProcessW` only auto-appends `.exe` — it does not consult `PATHEXT`. That's deliberate (`execFile` is the "do not invoke a shell" primitive), but it's also why `codex.cmd` and `copilot.bat` are invisible to it. `claude` survives only because Anthropic ships an extensionless native binary and a `claude.exe`, both of which `CreateProcessW` accepts directly.

`executableForHarness` (`src/core/provider-checks.ts:81-94`) returns the bare command name:

```ts
case "codex":   return "codex";
case "copilot": return "copilot";
```

### Bonus finding — same pattern blocks story dispatch

The story-dispatch path uses `getSpawnImplementation()` (i.e. `child_process.spawn`) the same way — no `shell: true`, bare executable name. See `src/core/provider-adapters/shared.ts:369`:

```ts
const child = getSpawnImplementation()(params.executable, params.args, {
  cwd: params.cwd,
  env: filterEnv(process.env, params.env),
  stdio: ["pipe", "pipe", "pipe"],
});
```

…with `params.executable` originating as bare `"codex"` (`provider-adapters/codex.ts:70`) or `"copilot"` (`provider-adapters/copilot.ts:21`).

`spawn` shares `execFile`'s Windows resolution behavior. So even if the preflight gate were bypassed, `story-implement` / `story-verify` / `quick-fix` / `epic-verify` / `epic-synthesize` would all fail the same way. **A complete fix must address both call sites, not just preflight.**

### Why it cannot be worked around at the orchestration layer

- All five provider-using roles (`story_implementor`, `quick_fixer`, `story_verifier`, `epic_verifier_1`, `epic_synthesizer`) dispatch through the same primitives.
- No CLI flag exists to override the executable path (no `--codex-path` etc.).
- The only in-product alternative is degraded-diversity claude-only mode, which forfeits the multi-provider verification design.

### Local patch applied

Three surgical changes, split by call-site safety profile:

1. **Probe path (`src/core/provider-checks.ts`, static args)** — added `shell: true` to the `execFile` options. Routes through `cmd.exe` so `PATHEXT` resolves `.cmd`/`.bat` shims. Safe here because probe args are hard-coded literals (`--version`, `auth status`) with no caller input — no shell-injection surface.

2. **Dispatch path (`src/core/provider-adapters/shared.ts`, prompt args)** — replaced the default `spawn` implementation in `src/core/runtime-deps.ts` with `cross-spawn`. `cross-spawn` resolves shims via `PATHEXT` and routes through `cmd.exe` with proper arg quoting, so prompt content cannot be misinterpreted as cmd metacharacters. The AsyncLocalStorage override seam is preserved so test fakes still work. Added `cross-spawn` (+`@types/cross-spawn` as a dev dep) to `package.json`.

3. **Probe timeout (`src/core/provider-checks.ts`)** — bumped `DEFAULT_PROVIDER_CHECK_TIMEOUT_MS` from `1_000` to `10_000`. On Windows, cold-starting an npm-shim provider through cmd.exe + Node can take 4-5s for `--version` alone (timed locally: `copilot --version` = 4.5s). The 1s default is pathologically tight for any Windows shim. The bump only affects worst-case preflight latency, not steady-state operation.

`shell: true` on the probe path is safe only because its args are static; **do not** apply it to `provider-adapters/shared.ts`, where args carry prompt content — that becomes a quoting/injection footgun. Hence `cross-spawn` (which handles arg quoting correctly) on the dispatch path.

### Cleaner alternative for follow-up

The smaller surface patch above is the minimum change that unblocks Windows users. A cleaner long-term refactor: introduce a single Windows-aware resolver using [`which`](https://www.npmjs.com/package/which) (zero runtime deps, used by npm itself) and have `executableForHarness` flow an absolute path through both call sites. That removes both `shell: true` and the `cross-spawn` dependency, and produces a more accurate error class (distinguishing "not on PATH" from "spawn failed"). Skipped here only because it requires reshaping the `executableForHarness` API.

### Verification plan

1. `lbuild-impl preflight --spec-pack-root <pack-root> --json` returns `outcome: ready` with `secondary[0].available: true` for each of `codex` and `copilot` (test both — they expose different shim extensions, `.cmd` vs `.bat`).
2. `lbuild-impl story-implement ...` actually spawns the secondary harness and produces output (the dispatch path also works, not just the version probe).
3. Regression test under `tests/` that mocks `nodeExecFile`/`nodeSpawn` to refuse anything except `<name>.cmd` / `<name>.bat` (simulating Windows `CreateProcess` behavior) and asserts the resolver still finds the shim.

### Verification (local)

`lbuild-impl preflight --spec-pack-root C:/github/crumb/docs/epics/f1 --json` against the same Windows env now returns:

```json
{
  "secondary": [{
    "harness": "copilot",
    "available": true,
    "tier": "authenticated-known",
    "version": "GitHub Copilot CLI 1.0.26.\nRun 'copilot update' to check for updates.",
    "authStatus": "authenticated"
  }]
}
```

No `PROVIDER_UNAVAILABLE` blocker. Story dispatch path is wired through the same `cross-spawn` default, so `story-implement` etc. should now spawn the shim correctly — pending end-to-end verification.

**Note:** The probe path also depended on BUG-WIN-003 being fixed; without that, `copilot --version` still hung because the env passed to it was missing Windows-essential vars. Both must be applied together for preflight to pass on Windows.

---

## BUG-WIN-003 — env allowlist strips Windows-essential vars, causing provider probes to hang for 30s+

**Severity:** Blocker — even after BUG-WIN-002 is fixed, provider probes still time out because the spawned child cannot find its config dir, helper binaries, or even cmd.exe.
**Status:** Fixed locally in this working tree. On Windows, default-inheritance now passes the full parent env. POSIX retains the allowlist behavior.
**Affected:** Any Windows host. Particularly visible for VS Code extension-installed CLIs (e.g. `copilot` via `globalStorage`), which depend on a wide spread of Windows env vars.

### Symptom

After applying the BUG-WIN-002 patch and rerunning preflight, `copilot --version` reports `timed out` instead of producing a version string. Bumping the timeout to 30s does not help — the child is genuinely stuck. Manually running `copilot --version` in the same shell completes in ~4.5s.

### Reproduction

Run the same `--version` command twice from Node — once with the unfiltered parent env, once with the env produced by `filterEnv(process.env, {})`:

```js
const { execFile } = require('child_process');
const ALLOWLIST = new Set([
  'PATH','HOME','USER','TERM','SHELL','LANG','TMPDIR','TEMP','TMP',
  'HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY',
]);
const PREFIXES = ['LC_','CLAUDE_','CODEX_','GH_','GITHUB_','COPILOT_','ANTHROPIC_','OPENAI_'];
const filtered = {};
for (const [k, v] of Object.entries(process.env)) {
  if (ALLOWLIST.has(k) || PREFIXES.some(p => k.startsWith(p))) filtered[k] = v;
}

// (a) Unfiltered — works in 4-5s
execFile('copilot', ['--version'], { shell: true, timeout: 30000 }, (e, out) => { /* 4727ms, ok */ });

// (b) Filtered — hangs to timeout
execFile('copilot', ['--version'], { shell: true, timeout: 30000, env: filtered }, (e, out) => { /* 30048ms, "Command failed" */ });
```

Run on this Windows host: (a) elapsed `4727ms`, success. (b) elapsed `30048ms`, no output, no stderr, timed out.

### Root cause

`src/infra/env-allowlist.ts` is tuned for POSIX — its allowlist contains `PATH`, `HOME`, `USER`, `TERM`, `SHELL`, `LANG`, proxy vars — none of the Windows-side equivalents.

On Windows, npm-shim CLIs and cmd.exe itself need a wide spread of env vars to function: `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `PROGRAMDATA`, `PROGRAMFILES`, `PROGRAMFILES(X86)`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `PATHEXT`, plus VS Code-extension specific env when the CLI was installed via VS Code. The set is provider-specific, mixed-case (`ProgramFiles`, not `PROGRAMFILES`), and unstable — for example, `copilot.bat` ships under `globalStorage\github.copilot-chat\copilotCli\` and pulls in dependencies that read various combinations of these vars.

Two compounding sub-issues found while investigating:

1. **Case sensitivity.** Windows env keys are case-insensitive at lookup but stored case-preserved (e.g. `process.env` exposes `ProgramFiles`, `ProgramData`, `ProgramFiles(x86)`). `Array.includes` comparison in `isAllowedKey` is case-sensitive, so even an uppercase-only Windows allowlist would silently miss them.

2. **Whack-a-mole completeness.** Empirically, the minimum set of Windows env vars required by `copilot --version` is *strictly larger* than every plausible curated allowlist tested. After adding `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `PROGRAMDATA`, all `PROGRAMFILES*`, `COMSPEC`, `PATHEXT`, `SYSTEMROOT`, `WINDIR` etc. (with case-insensitive matching), `copilot --version` *still* hung at 30s. The hanging child does not produce stderr, so there is no way to discover which var it is missing without painful bisection per provider.

### Fix applied

`src/infra/env-allowlist.ts`: on Windows, default inheritance passes the full parent env. Explicit caller overrides (the `overrides` param of `filterEnv`) still apply unchanged — callers can still set or `delete` specific keys via the SDK contract. POSIX keeps the original allowlist behavior.

```ts
const IS_WINDOWS = process.platform === "win32";
// ...
for (const [key, value] of Object.entries(parentEnv)) {
  if (typeof value !== "string") continue;
  if (!IS_WINDOWS && !isAllowedKey(key)) continue;  // POSIX: filter; Windows: pass through
  filtered[key] = value;
}
// overrides loop unchanged
```

### Why a wider allowlist is not the right fix

The original allowlist's design intent (per the comment in the file) is to "narrow env delta" exposure. On POSIX that gives tangible safety — devcontainer secrets and exotic project env vars don't bleed into provider CLIs. On Windows the same defense produces no comparable benefit: the dropped vars are overwhelmingly system-path pointers (`SYSTEMROOT`, `COMSPEC`, `ProgramFiles`), which are user-readable, well-known, and not secret. Meanwhile the cost of dropping the wrong one is invisible (a hang, not an error), and the set varies per provider, per install method, per Windows version.

If the maintainer prefers to keep some filtering on Windows, a deny-list of secret-shaped patterns (`*_TOKEN`, `*_KEY`, `*_PASSWORD`) would carry the same security benefit without the whack-a-mole cost.

### Verification (local)

After applying the patch, `lbuild-impl preflight --spec-pack-root C:/github/crumb/docs/epics/f1 --json` reports `secondary[0].available: true` for `copilot` and emits a real version string in 7-12s wall time. See the verification section of BUG-WIN-002 for the resulting envelope.

---

## BUG-WIN-004 — `writeAtomic` rename has no retry-on-EPERM, and any Windows reader briefly holding the destination kills a long run

**Severity:** Blocker for long-running orchestrations — runtime-progress writer crashes the run on the first transient file-handle conflict.
**Status:** Fixed locally in this working tree (not yet upstreamed). Awaiting repo-owner review.
**Affected:** Any Windows host. Triggered most reliably by:
1. The codex provider itself reading `progress/<artifact>.status.json` mid-run (codex's context-exploration spawns `pwsh -Command "Get-Content -Path …"` against the very file lbuild-impl is atomically rewriting).
2. Windows Defender real-time scanning the just-closed temp file before rename (often holds the handle for >300 ms, sometimes >1 s).
3. IDE file-watchers indexing `artifacts/<story-id>/progress/`.

### Symptom

```text
file:///C:/github/lbuild-impl/dist/bin/lbuild-impl.js:2898
    throw new AtomicWriteError(
          ^

AtomicWriteError: Atomic write failed for C:\…\artifacts\00-foundation\progress\002-implementor.status.json
    at writeAtomic (…/lbuild-impl.js:2898:11)
    at async _RuntimeProgressTracker.writeStatus (…/lbuild-impl.js:3208:5)
{
  detail: "EPERM: operation not permitted, rename '…\\002-implementor.status.json.tmp.<uuid>' -> '…\\002-implementor.status.json'",
  code: 'ATOMIC_WRITE_FAILED',
  [cause]: { code: 'EPERM', syscall: 'rename', errno: -4048 }
}
```

The CLI exits non-zero, the orchestrator sees the background task as failed, and any partial work in that turn is lost.

### Reproduction

```ts
// Simulate codex-style mid-rename read on the destination
import { writeAtomic } from "@/infra/fs-atomic";
import { open } from "node:fs/promises";

// On Windows: open the destination for read in another thread/process
// timed within ~300ms of the writeAtomic call. The rename inside
// writeAtomic fails with EPERM and the call throws.
```

In practice the repro is just: run `lbuild-impl story-implement` on Windows with codex as the implementor, against any spec pack whose artifacts directory has a non-trivial number of files. Codex's context-exploration step *will* eventually `Get-Content` against `progress/<artifact>.status.json` while the runtime tracker is rewriting it; intermittently EPERM kills the run. Observed failure rate on this Windows host: ~60% of multi-minute story-implement attempts before patching.

### Root cause

`src/infra/fs-atomic.ts:writeAtomic` does a single `rename()` and throws on first failure:

```ts
await rename(tempPath, path);
await syncDirectory(directory);
} catch (error) {
  await handle?.close().catch(() => undefined);
  await rm(tempPath, { force: true }).catch(() => undefined);
  throw new AtomicWriteError(...);
}
```

POSIX `rename()` is atomic and never blocks on reader handles — Linux and macOS readers see either the old or new inode, and the syscall returns immediately. Windows `MoveFileEx`/`rename` semantics are different: any open handle (read or write) on either source or destination causes `ERROR_ACCESS_DENIED` (EPERM) or `ERROR_SHARING_VIOLATION` (EBUSY). The Node docs explicitly note this Windows-specific behavior.

The lbuild-impl runtime-progress tracker writes `<n>-<role>.status.json` very frequently during a provider call — once per lifecycle event plus at least every 30 seconds. Across a typical 15–20-minute story-implement run that's hundreds of writes. Each one is a coin-flip vs. whatever Windows process happens to have a handle open.

### Suggested fix / Local patch applied

Add a retry-on-EPERM/EBUSY loop with exponential backoff inside `writeAtomic`. Critical detail: keep `EACCES` as immediate-fail (real permission denial should not get retry-amplified — TC-4.4a's intent is preserved).

```ts
// src/infra/fs-atomic.ts
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY"]);
const RENAME_MAX_ATTEMPTS = 10;
const RENAME_BASE_DELAY_MS = 100;
const RENAME_MAX_DELAY_MS = 1000;

// inside writeAtomic, replacing `await rename(tempPath, path);`:
for (let attempt = 1; ; attempt++) {
  try {
    await rename(tempPath, path);
    break;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (
      attempt >= RENAME_MAX_ATTEMPTS ||
      !code ||
      !RENAME_RETRY_CODES.has(code)
    ) {
      throw error;
    }
    const delay = Math.min(
      RENAME_BASE_DELAY_MS * 2 ** (attempt - 1),
      RENAME_MAX_DELAY_MS,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
```

Backoff schedule: 100, 200, 400, 800, 1000, 1000, 1000, 1000, 1000 ms across 9 sleeps before attempt 10. Worst-case total ≈ 6.5 s, which comfortably exceeds typical Defender scan windows. Initial 5-attempt × 25→200 ms (≈ 375 ms) tested earlier was insufficient — Defender on this host held a fresh JSON file >500 ms multiple times.

Two new tests in `tests/unit/infra/fs-atomic.test.ts`:

- **TC-4.4c** — injects EPERM twice via `withRuntimeDeps({ fs: { rename } })`, succeeds on the third attempt; asserts `renameAttempts === 3` and the final file is correct.
- **TC-4.4d** — injects persistent EPERM, asserts `renameAttempts === 10`, asserts `AtomicWriteError` is thrown, asserts prior file content preserved. Test option `{ timeout: 10_000 }` because the full retry budget runs ~6.5 s in real time.

All 4 fs-atomic tests pass: TC-4.4a (EACCES fail-fast preserved), TC-4.4b (durability ordering), TC-4.4c (retry-then-success), TC-4.4d (max-retries-exhausted).

### Why a Windows Defender exclusion isn't the right fix at the library level

Telling Windows users to add an AV exclusion for every spec-pack's `artifacts/` directory is a poor library experience. It also doesn't help with the *other* sources of contention (codex's own `Get-Content` reads, IDE file-watchers). The retry loop is a one-time library-level fix that absorbs all of them. Users who *also* want to remove the contention at source can still add a Defender exclusion for `**/artifacts/`, but they shouldn't have to.

### Verification (local)

End-to-end: `lbuild-impl story-implement --spec-pack-root C:/github/crumb/docs/epics/f1 --story-id 00-foundation --json` ran for 21 minutes with codex actively `Get-Content`-ing the runtime status file multiple times, with no EPERM failure. Pre-patch, the same run failed within the first 2 minutes 100% of the time on this host.

### Audit note

Repo-wide grep for direct `rename(` calls confirms `writeAtomic` is the only atomic-rename site that needs the retry loop. Test fakes that mock `rename` via `withRuntimeDeps` continue to work — the retry honors the injected mock just like the real Node `rename`.

---

## BUG-WIN-005 — Codex provider adapter spawns with default `workspace-write` sandbox, blocking `pnpm add` (network) and `git rm` of tracked files

**Severity:** Blocker for any story whose spec requires installing dependencies, deleting pre-existing tracked files, or performing other operations the default codex sandbox forbids.
**Status:** Fixed locally in this working tree (not yet upstreamed). Awaiting repo-owner review.
**Affected:** Any spec pack that requires the implementor to run `pnpm add` / `npm install` / `git rm` of files outside its session-created workspace, on any platform — but most acutely felt on Windows because of how often Windows users start a new repo from a partial scaffold (e.g., the `app/` → `src/app/` restructure case below).

### Symptom

`story-implement` returns `outcome: needs-human-ruling` with the implementor's `specDeviations` listing things like:

> "Drizzle schema files are dependency-neutral metadata exports, not drizzle-orm pg-core schemas."
> "Supabase SSR and privileged database clients are configuration/boundary stubs, not live @supabase/ssr or Drizzle clients."
> "Vitest and Playwright configs are skeleton objects because the packages are unavailable; no executable test suite is installed."
> "Root app forwards remain due sandbox inability to delete app/favicon.ico, so the repo is not a pure src/app move yet."

…and `findingsSurfaced`:

> "Full Story 0 cannot be accepted yet: required packages such as zod, @supabase/ssr, drizzle, AWS SDK, sharp, Vitest, and Playwright are not linked, and offline pnpm add failed with EPERM."
> "The root app directory remains because sandbox denied deleting tracked app/favicon.ico."

The implementor produces a real, lint-clean, typecheck-clean scaffold, but the spec deviations cannot be closed without operations the sandbox forbids.

### Reproduction

```sh
lbuild-impl story-implement \
  --spec-pack-root <pack-with-pnpm-add-or-git-rm-requirements> \
  --story-id <story-that-needs-deps-installed> \
  --json
```

…against any story whose acceptance requires installing packages or deleting tracked files outside the session's freshly-created scope.

### Root cause

`src/core/provider-adapters/codex.ts` invokes codex with no `--sandbox` flag, which means codex defaults to `workspace-write` — full read access, write access only inside the spawn cwd, and no network. That's a sensible default for "edit this codebase" tasks, but lbuild-impl's implementor role legitimately needs to:

- `pnpm add` (requires network access — blocked by `workspace-write`)
- `git rm` files outside the session's created paths (blocked because workspace-write only permits writes to files codex itself created or that already-existed, with deletions sometimes case-sensitive depending on how codex tracked the path)
- Run `next build` (writes to `.next/` which can be outside the session-tracked write set on subsequent runs)

The codex CLI offers two escape hatches:

- `-s danger-full-access` — works on `codex exec` but **not** on `codex exec resume` (the resume subcommand silently drops the flag, then errors `unexpected argument '-s' found` in newer CLI versions)
- `--dangerously-bypass-approvals-and-sandbox` — works on **both** `codex exec` and `codex exec resume`

### Suggested fix / Local patch applied

`src/core/provider-adapters/codex.ts`: add `--dangerously-bypass-approvals-and-sandbox` to both the fresh `exec` arg list and the `exec resume` arg list. Use the bypass flag (not `-s`) so the same args work on both codex subcommands without divergent code paths.

```ts
// src/core/provider-adapters/codex.ts
const args = request.resumeSessionId
  ? [
      "exec",
      "resume",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-o",
      outputLastMessagePath,
      request.resumeSessionId,
      request.prompt,
    ]
  : [
      "exec",
      "--json",
      "-m",
      request.model,
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      `model_reasoning_effort=${request.reasoningEffort}`,
      ...(request.resultSchema
        ? ["--output-schema", outputSchemaPath]
        : []),
      "-o",
      outputLastMessagePath,
      request.prompt,
    ];
```

### Trust model commentary

The bypass flag does what the name says — codex now runs with whatever powers the user shell has. The orchestration is already running at the user's direction with their codex auth, against a spec pack the user authored, against a working tree the user owns. Sandbox bypass at this layer matches the trust model — there's no plausible threat that's mitigated by `workspace-write` but not by the user's own shell. If there's interest in a finer-grained alternative, the natural one is making this configurable (`impl-run.config.json` field per role: `codex_sandbox: "workspace-write" | "danger-full-access" | "bypass"`); a future-work item, not a blocker.

### Why this isn't workable at the orchestration layer

- The orchestrator can pre-install deps before each story, but that defeats the spec-pack's "implementor authors the dependency-install step as part of the story" model and produces incomplete artifacts.
- The orchestrator can manually delete files between stories, but that race-conditions against codex's own working-tree assumptions and produces confusing diffs in the receipt.
- Both workarounds cost human operator time on every story and re-introduce drift between what the spec says happened vs. what actually happened.

### Verification (local)

`lbuild-impl story-continue` on the same Story-0 session, after the patch, produced 6 → 14 test files, installed all required runtime + dev deps (47 packages added to `pnpm-lock.yaml`), deleted the `app/favicon.ico` and other root `app/*` files cleanly, and reported `npm run lint` + `npm run typecheck` pass on the in-flight tree. Pre-patch, the same session reported the spec-deviation block above and surfaced `pnpm add failed with EPERM`.

---

## BUG-WIN-006 — `codex exec resume` doesn't accept `--output-schema`, so resume-path payloads aren't shape-constrained and lbuild-impl's strict result schema rejects them

**Severity:** Blocker for any orchestration that uses `story-continue` (i.e., almost every multi-turn implementation flow).
**Status:** Fixed locally in this working tree (not yet upstreamed). Awaiting repo-owner review. **Note: this is fundamentally a codex-CLI limitation; the lbuild-impl-side fix is consumer-side tolerance.**
**Affected:** Any orchestration that calls `lbuild-impl story-continue`, `story-self-review`, or any other resume-path operation — on any platform. Surfaces more readily on Windows because Windows orchestrations tend to need more `story-continue` round-trips (each tooling/sandbox issue above adds an extra resume).

### Symptom

```text
{"command":"story-continue","status":"blocked","outcome":"blocked",
 "errors":[{
   "code":"PROVIDER_OUTPUT_INVALID",
   "message":"Provider output was invalid for codex.",
   "detail":"Provider output did not match the expected JSON payload.
     root keys: outcome, story, planSummary, changedFiles, tests, gatesRun,
     selfReview, specDeviations, recommendedNextStep;
     direct payload:
       tests.modified: Invalid input: expected array, received undefined;
       tests.removed: Invalid input: expected array, received undefined;
       unexpected key(s) at tests: expectedAfterStory;
       gatesRun[0].result: Invalid option: expected one of \"pass\"|\"fail\"|\"not-run\";
       openQuestions: Invalid input: expected array, received undefined;
       unexpected key(s) at <root>: story
     ..."
 }]}
```

The codex provider produced a structured payload — but with cosmetic field-name drift (`tests.expectedAfterStory` instead of `totalAfterStory`), missing optional-feeling-but-required arrays (`tests.modified`, `tests.removed`, `openQuestions`), and `gatesRun[].result` with descriptive strings (`"passed"`, `"ok"`) instead of the strict enum. The 17 minutes of real implementation work codex performed during this turn is lost from the orchestrator's perspective because the envelope can't be parsed.

### Reproduction

Run multi-turn `story-implement` → `story-continue` → `story-continue` against any spec pack with codex as the implementor. The first `story-implement` always succeeds (envelope passes strict validation because codex was invoked with `--output-schema`). Subsequent `story-continue` turns increasingly drift on cosmetic fields because codex on resume runs without schema enforcement.

### Root cause

Two layers compounding:

**Layer 1 — codex CLI doesn't expose `--output-schema` on `exec resume`.** `codex exec --help` shows `--output-schema <FILE>`. `codex exec resume --help` does not. On the resume path, codex produces structured output based on what it remembers from the original session's schema, but the model's adherence drifts as conversation length grows.

**Layer 2 — lbuild-impl's adapter recognises this and skips the schema write on resume:**

```ts
// src/core/provider-adapters/codex.ts
if (request.resultSchema && !request.resumeSessionId) {
  await writeFile(outputSchemaPath, ...);
}
// ...args list omits --output-schema on the resume path
```

That's correct — passing `--output-schema` to a CLI that rejects it would error. But it leaves resume-path output unconstrained.

**Layer 3 — `src/core/result-contracts.ts` is `.strict()` on every inner schema:**

```ts
const testSummarySchema = z.object({ ... }).strict();
const gateRunSchema = z.object({
  command: z.string().min(1),
  result: z.enum(["pass", "fail", "not-run"]),
}).strict();
const selfReviewSchema = z.object({ ... }).strict();
export const implementorResultSchema = z.object({ ... }).strict();
```

`.strict()` rejects unknown keys, and required arrays like `tests.modified` and `tests.removed` and `openQuestions` have no defaults. So the moment codex's resume-turn output drifts on any of these — even on cosmetic fields downstream code doesn't read — the entire envelope is rejected.

### Suggested fix / Local patch applied

Loosen the consumer-side validation specifically to absorb resume-path drift, while preserving strict validation on the fresh-exec path (where codex itself enforces shape via `--output-schema`).

```ts
// src/core/result-contracts.ts
const testSummarySchema = z
  .object({
    added: z.array(z.string().min(1)),
    modified: z.array(z.string().min(1)).optional().default([]),
    removed: z.array(z.string().min(1)).optional().default([]),
    totalAfterStory: z.number().int().optional(),
    deltaFromPriorBaseline: z.number().int().optional(),
  })
  .passthrough();

const gateRunSchema = z
  .object({
    command: z.string().min(1),
    // Permissive: codex on resume sometimes returns "passed", "ok",
    // numeric exit codes, or descriptive strings. Downstream readers
    // can still inspect for "pass"/"fail"; we don't fail validation.
    result: z.string().min(1),
  })
  .passthrough();

const selfReviewSchema = z
  .object({
    passesRun: z.number().int().min(0),
    findingsFixed: z.array(z.string()),
    findingsSurfaced: z.array(z.string()),
  })
  .passthrough();

export const implementorResultSchema = z
  .object({
    // …existing required fields unchanged…
    tests: testSummarySchema,
    gatesRun: z.array(gateRunSchema),
    selfReview: selfReviewSchema,
    openQuestions: z.array(z.string()).optional().default([]),
    specDeviations: z.array(z.string()),
    recommendedNextStep: z.string().min(1),
  })
  .passthrough()
  .superRefine(...);  // continuation invariants unchanged

export const storySelfReviewResultSchema = z
  .object({ /* …same shape… */ })
  .passthrough()
  .superRefine(...);
```

### Why this is the right shape of fix

- **Required fields stay required.** `tests.added`, `gatesRun[].command`, `selfReview.passesRun`, `selfReview.findingsFixed`, `selfReview.findingsSurfaced`, `changedFiles`, `specDeviations`, `recommendedNextStep`, `planSummary`, `outcome`, `story`, `continuation` etc. — all still required. The continuation-invariant `superRefine` (sessionId, storyId, provider matching) is unchanged.
- **Strict path stays strict at the right layer.** On fresh `exec`, codex's `--output-schema` enforces the full original shape including the `gatesRun[].result` enum and the absence of unknown keys. lbuild-impl's `.passthrough()` on the consumer side doesn't relax that — it only relaxes the *redundant* second check that fails on resume.
- **`gateRunSchema.result` becoming `z.string()` is a small downgrade in safety**, but downstream readers in `phases/20-story-cycle.md` already inspect the value as a string ("pass"/"fail"/"not-run" check), so the practical impact is zero. The truly safer alternative — inspecting result via a coercer (`z.string().transform(s => s.toLowerCase().includes("pass") ? "pass" : "fail")`) — adds complexity without changing what consumers already do.
- **`openQuestions` defaulting to `[]` is correct.** The skill's process-playbook treats an empty `openQuestions` as "no questions surfaced," and codex sometimes omits the field entirely on resume turns where it would otherwise return `[]`. Defaulting to `[]` matches the documented semantics.

### Tests not updated this session

The existing tests for `implementorResultSchema` and `storySelfReviewResultSchema` use frozen happy-path payloads that validate against both `.strict()` and `.passthrough()`. They continue to pass. New tests covering the drift cases (e.g., `tests.expectedAfterStory` extra key, `gatesRun[].result === "passed"`, missing `openQuestions`) would be valuable additions; deferred to follow-up.

### Verification (local)

After applying the patch + rebuilding, the same `story-continue` turn that previously failed with `PROVIDER_OUTPUT_INVALID` now produces `outcome: needs-human-ruling` (or `ready-for-verification`, depending on what codex actually returned that turn) with a parseable envelope. The 17 minutes of codex work during the turn is preserved as `result.changedFiles`, `result.tests`, etc. for the orchestrator to act on.

### Future-work alternative

Another approach worth considering: have lbuild-impl write the schema to a side file even on resume, then include an instruction in the resume-path prompt template ("your final structured response MUST validate against the schema at /path/to/schema.json — re-read it before emitting"). Codex 0.128.0 supports reading file paths in the prompt. This would restore strict shape without requiring codex CLI to add `--output-schema` to `exec resume`. Untested locally; the consumer-side `.passthrough()` patch is the smaller, more obvious fix that unblocks today.

---

## BUG-WIN-007 — `sync-impl-cli-assets` embeds prompt assets with CRLF on Windows, dirtying generated source and shipping CRLF prompts at runtime

**Severity:** Major — every Windows `npm run build` produces a dirty working tree against a tracked generated file, breaks any "generated artifact in sync" guard on Windows CI/dev, and ships prompts with `\r\n` line endings to provider CLIs (semantically distinct from the LF prompts shipped from POSIX builds).
**Status:** Open in v0.4.0. First observed on the v0.4.0 retest, but the same code path exists at all versions ≥0.3.0 — it was simply masked in v0.3.0 by BUG-WIN-001 stopping the build before this step ran.
**Affected:** Any Windows host running `npm run build` against a default Git for Windows clone (`core.autocrlf=true`).

### Symptom

Immediately after a clean `git clone` + `npm ci` + `npm run build` on Windows:

```text
$ git status
On branch main
Changes not staged for commit:
  modified:   src/core/embedded-assets.generated.ts

$ git diff --stat src/core/embedded-assets.generated.ts
 src/core/embedded-assets.generated.ts | 74 +++++++++++++++++------------------
 1 file changed, 37 insertions(+), 37 deletions(-)
```

Every `\n` in every embedded prompt string flips to `\r\n`:

```diff
- "epic-reverifier.md": "# Epic Reverifier Base Prompt\n\n## Confirmed Issues\n..."
+ "epic-reverifier.md": "# Epic Reverifier Base Prompt\r\n\r\n## Confirmed Issues\r\n..."
```

A subsequent `git status` after `git restore` and `npm run build` reproduces the same diff deterministically.

### Reproduction

```sh
# fresh Windows clone
git clone https://github.com/liminal-ai/lbuild-impl.git
cd lbuild-impl
git config --get core.autocrlf   # → true (Git for Windows default)
npm ci
npm run build
git status                       # embedded-assets.generated.ts shows as modified
git diff src/core/embedded-assets.generated.ts | head -5
# every \n in embedded prompts has been rewritten to \r\n
```

### Environment evidence

```text
$ ls .gitattributes
ls: cannot access '.gitattributes': No such file or directory

$ git config --get core.autocrlf
true

$ git ls-files --eol src/prompts/base/story-lead.md
i/lf    w/crlf  attr/                   src/prompts/base/story-lead.md
```

The repo has no `.gitattributes`, so on a Windows clone with the default `core.autocrlf=true` Git for Windows checks the source `.md` prompt files out as CRLF, even though the index stores them as LF.

### Root cause

`scripts/sync-impl-cli-assets.ts:24,48` reads the on-disk prompt files with `await readFile(path, "utf8")` and embeds the resulting strings verbatim into `EMBEDDED_PROMPT_ASSETS` / `EMBEDDED_SKILL_ASSETS` via `JSON.stringify(value, null, "\t")` (line 76). `readFile` does not normalize newlines, and `JSON.stringify` faithfully encodes `\r` as `\r\n`. Two downstream effects:

1. **Build noise / CI dirty-tree:** the generated file at `src/core/embedded-assets.generated.ts` is committed (was generated on a POSIX runner with LF) but every Windows build rewrites it with CRLF. Anyone running `npm run build` on Windows then sees a phantom modification of a tracked source file, and any `git diff --quiet` / "no uncommitted changes" check in CI on Windows fails.
2. **Runtime prompt drift:** the CLI ships embedded prompts that contain `\r\n` line endings to provider CLIs (`claude`, `codex`) on Windows but `\n` on POSIX. Token-count, regex-anchored, and format-sensitive provider behavior is therefore platform-dependent in a way the contract tests don't cover.

POSIX is unaffected because `core.autocrlf` only converts on Windows checkouts.

### Suggested fix

Two complementary changes; either alone resolves the build-dirty symptom, both together also harden the runtime prompt contract:

**1. Normalize line endings inside `sync-impl-cli-assets.ts`** so the script is platform-agnostic regardless of how the user's git checked the source files out:

```ts
async function readNormalized(path: string): Promise<string> {
    return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
}
```

…and use `readNormalized` everywhere the script currently calls `readFile(path, "utf8")` (`sync-impl-cli-assets.ts:24` in `readMarkdownDirectory`, and `sync-impl-cli-assets.ts:48` in `collectSkillFiles`). This guarantees every embedded prompt string the build emits is `\n`-only on every platform.

**2. Add a `.gitattributes` at repo root** so `.md` prompt sources never check out as CRLF in the first place:

```gitattributes
# Prompt + skill assets are byte-identical contract material.
src/prompts/**/*.md text eol=lf
src/skills/**/*.md  text eol=lf
# Generated asset payload must round-trip identically across platforms.
src/core/embedded-assets.generated.ts text eol=lf
```

Either patch alone fixes the dirty-tree issue. The script-side fix also future-proofs against contributors who clone without honoring `.gitattributes` (e.g. via web download).

### Why this wasn't visible in v0.3.0

In v0.3.0 the build never reached `sync-impl-cli-assets`'s write step on Windows — BUG-WIN-001's doubled-drive-letter `ENOENT` killed the script while reading inputs. v0.4.0 fixed BUG-WIN-001 (verified on this branch), which exposed the previously-shadowed CRLF embedding. So this is technically a latent v0.3.0 defect surfacing as a v0.4.0 regression-of-visibility.

### Verification

After either suggested fix, `npm run build` followed by `git status` should report a clean working tree on Windows, and the embedded prompt strings in `src/core/embedded-assets.generated.ts` should contain only `\n` (no `\r\n`) regardless of host platform.

---

## BUG-WIN-008 — `preflight` reports `codex` unavailable on Windows because `resolveProviderExecutable` prefers the extension-less POSIX shim over `codex.cmd`

**Severity:** Blocker — `preflight` returns `outcome:"blocked"` with `code:"PROVIDER_UNAVAILABLE"`, so no codex-backed command (`story-implement`, `story-continue`, `story-verify`, `quick-fix`, epic verifiers/reverifier) can run on Windows. This is the v0.4.0 reincarnation of BUG-WIN-002: the surface symptom is identical, the root cause is different.
**Status:** Open in v0.4.0. Reproduced 2026-05-07 against `lbuild-impl@0.4.0` running `preflight` on a default npm-installed codex (`codex-cli 0.128.0`).
**Affected:** Any Windows host where `codex` was installed via `npm i -g @openai/codex` (the documented installation path), since npm's global install always lays down both `codex` (POSIX shim) and `codex.cmd` (Windows shim) side-by-side in the same PATH directory.

### Symptom

```text
$ lbuild-impl preflight --spec-pack-root C:/github/crumb/docs/epics/f0 \
                        --story-gate "npm run lint" \
                        --epic-gate  "npm run lint" \
                        --json
{
  "command": "preflight",
  "status": "blocked",
  "outcome": "blocked",
  "result": {
    "providerMatrix": {
      "primary":   { "harness": "claude-code", "available": true,  "tier": "authenticated-known", "version": "2.1.132 (Claude Code)", "authStatus": "authenticated" },
      "secondary": [ { "harness": "codex",     "available": false, "tier": "unavailable",         "authStatus": "missing",          "notes": ["Unable to execute codex --version"] } ]
    },
    "blockers": ["Requested secondary harness is unavailable: codex"]
  },
  "errors": [{ "code": "PROVIDER_UNAVAILABLE", "message": "Requested secondary harness is unavailable: codex", "detail": "Unable to execute codex --version" }]
}
```

…even though running `codex --version` in any shell on the same host succeeds:

```text
$ codex --version
codex-cli 0.128.0
$ where codex
C:\Users\dsavi\AppData\Local\fnm_multishells\12584_1778174966848\codex
C:\Users\dsavi\AppData\Local\fnm_multishells\12584_1778174966848\codex.cmd
C:\Users\dsavi\AppData\Roaming\npm\codex
C:\Users\dsavi\AppData\Roaming\npm\codex.cmd
```

### Reproduction

```sh
# fresh Windows host, npm-installed codex (any recent version)
npm i -g @openai/codex
codex --version                  # works: "codex-cli 0.128.0"

# any spec pack with a v0.4.0-valid impl-run.config.json that requests codex secondary_harness:
lbuild-impl preflight --spec-pack-root <pack> --story-gate "npm run lint" --epic-gate "npm run lint" --json
# → outcome: blocked, errors[0].code = PROVIDER_UNAVAILABLE, "Unable to execute codex --version"
```

### Root cause

`src/core/provider-executable.ts:97-107` (`resolveProviderExecutable`):

```ts
for (const directory of pathEntries) {
    for (const candidate of [
        input.executable,                              // "codex"  ← tried FIRST
        ...extensions.map((extension) => `${input.executable}${extension}`),  // "codex.com", ".exe", ".bat", ".cmd"
    ]) {
        const candidatePath = join(directory, candidate);
        if (await pathExists(candidatePath)) {
            return candidatePath;
        }
    }
}
```

The candidate loop tries the bare extension-less filename **before** any PATHEXT extension. npm's global install on Windows lays down two files per bin entry — the bare POSIX shim and the `.cmd` shim — both in the same PATH directory. `pathExists` on the bare `codex` succeeds because the POSIX shim is a real file:

```text
$ file "C:\Users\dsavi\AppData\Local\fnm_multishells\<…>\codex"
POSIX shell script, ASCII text executable

$ head -2 "C:\Users\dsavi\AppData\Local\fnm_multishells\<…>\codex"
#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")
```

So `resolveProviderExecutable` returns the POSIX shim. Then `isWindowsCommandShim` (`provider-executable.ts:38-40`) — which only matches `\.(?:cmd|bat)$` — returns `false`, so `runCommand` (`provider-checks.ts:42-51`) skips the `cmd.exe /d /s /c` wrapper and tries to spawn the bare file directly via `execFile`. Windows's process loader cannot execute a `#!/bin/sh` script — there is no `.sh`-or-equivalent shebang handling — so `execFile` returns `ENOENT`. `provider-checks.ts:231` then sets `authStatus: "missing"` and `provider-checks.ts:151` produces the surface message `Unable to execute codex --version`.

POSIX is unaffected because `resolveProviderExecutable` early-returns on non-`win32` platforms (`provider-executable.ts:79-82`) and POSIX shells happily execute the shebang shim.

### Why BUG-WIN-002 looked fixed

v0.4.0 *did* introduce real Windows shim handling (`buildWindowsCommandShimInvocation`, PATH walking with PATHEXT, `cmd.exe /d /s /c` invocation). On a host where the bare extension-less file is absent — for instance a `.cmd`-only install, or a system PATH that hits `.cmd` first by virtue of layout — the new code path works correctly. The bug only manifests when both files coexist in the same directory, which is the default for any npm install. So local testing on a host without the bare shim (or with `git-bash`'s shim layout, or with a hand-installed `codex.cmd`) would show BUG-WIN-002 as resolved.

### Suggested fix

The minimal fix is to invert candidate priority on Windows: only fall back to the extension-less filename *after* exhausting PATHEXT. Replace the candidate list at `provider-executable.ts:98-101` with:

```ts
for (const candidate of [
    ...extensions.map((extension) => `${input.executable}${extension}`),  // try .com/.exe/.bat/.cmd first
    input.executable,                                                     // bare name only as a last resort
])
```

A defensive secondary improvement is to teach `isWindowsCommandShim` (or the dispatch logic in `provider-checks.ts:42-51`) to detect non-executable script files and either reject them outright or wrap them via `cmd.exe`. But the candidate-order fix alone resolves the observed regression because npm always installs `.cmd` alongside the bare shim.

A third complementary fix is to honor the actual `where`-style behavior Windows users expect: when PATHEXT contains an extension and a candidate with that extension exists in PATH, that candidate wins over a bare-name file in the same directory.

### Verification (after fix)

The candidate-order patch was applied locally on 2026-05-07 (`provider-executable.ts:97-107`):

```diff
 for (const candidate of [
-    input.executable,
-    ...extensions.map((extension) => `${input.executable}${extension}`),
+    ...extensions.map((extension) => `${input.executable}${extension}`),
+    input.executable,
 ]) {
```

After rebuild, `preflight` correctly resolves codex to `C:\Users\<…>\codex.cmd` instead of the bare POSIX shim. **However**, the run still ends in `PROVIDER_UNAVAILABLE` because of a separately-buried Windows defect in the cmd.exe wrapper itself — see BUG-WIN-009. Together, BUG-WIN-008 (resolution) and BUG-WIN-009 (invocation) form the full v0.4.0 reincarnation of v0.3.0's BUG-WIN-002.

---

## BUG-WIN-009 — `buildWindowsCommandShimInvocation` produces cmd.exe args that get mangled by Node's default Windows quote-escaping

**Severity:** Blocker — even after BUG-WIN-008 is patched, `preflight` still returns `PROVIDER_UNAVAILABLE` because cmd.exe cannot parse the wrapped invocation. Same surface symptom as BUG-WIN-002/008 from a third independent root cause.
**Status:** Open in v0.4.0. Reproduced 2026-05-07 against a locally-patched v0.4.0 build (BUG-WIN-008 fixed) on Windows 10 Pro.
**Affected:** Any Windows codex invocation routed through `runCommand → buildWindowsCommandShimInvocation`. The unit test at `tests/unit/core/provider-executable-resolution.test.ts:216-230` covers the produced *value* but does not exercise an actual spawn, so the defect is not regression-protected.

### Symptom

After BUG-WIN-008 is patched and `resolveProviderExecutable` correctly returns `C:\Users\<…>\codex.cmd`, `preflight` still fails:

```text
"providerMatrix": {
  "secondary": [
    {
      "harness": "codex",
      "available": false,
      "tier": "unavailable",
      "authStatus": "unknown",
      "notes": [
        "'\"C:\\Users\\dsavi\\AppData\\Local\\fnm_multishells\\12584_1778174966848\\codex.cmd\"' is not recognized as an internal or external command,\r\noperable program or batch file."
      ]
    }
  ]
}
```

cmd.exe is reporting that the literal string `\"C:\Users\…\codex.cmd\"` (with backslash-escaped quotes preserved) is not a recognized command. In any normal shell, the same `codex.cmd --version` runs in tens of milliseconds and exits 0.

### Reproduction

```sh
# 1. apply BUG-WIN-008 candidate-order patch
# 2. ensure codex.cmd is resolvable in PATH (npm-installed codex)
# 3. run preflight against any spec pack with codex secondary_harness
lbuild-impl preflight --spec-pack-root <pack> --story-gate "npm run lint" --epic-gate "npm run lint" --json
# → "Unable to execute …" message containing literal \" sequences in the path
```

### Root cause

`src/core/provider-executable.ts:46-63` — `buildWindowsCommandShimInvocation`:

```ts
return {
    file: input.env?.COMSPEC ?? process.env.COMSPEC ?? "cmd.exe",
    args: [
        "/d",
        "/s",
        "/c",
        [input.executable, ...input.args].map(quoteWindowsCmdArg).join(" "),
    ],
};
```

…and `quoteWindowsCmdArg`:

```ts
function quoteWindowsCmdArg(value: string): string {
    return `"${value.replaceAll('"', '\\"')}"`;
}
```

So for `codex.cmd --version` the function returns `args: ["/d", "/s", "/c", '"C:\\Tools\\codex.cmd" "--version"']`. The final element is a single string containing two quoted tokens.

`provider-checks.ts:55-79` then passes this to `child_process.execFile(file, args, options, cb)` *without* `windowsVerbatimArguments: true`. Node's Windows spawn implementation walks the args array and, because the 4th arg contains spaces and quotes, wraps it in another set of quotes and backslash-escapes the inner quotes to disambiguate. The actual command line the kernel sees becomes:

```text
cmd.exe /d /s /c "\"C:\Tools\codex.cmd\" \"--version\""
```

cmd.exe with `/s /c` then applies its rule-2 quote-stripping: strip the leading `"` and the trailing `"`, leaving:

```text
\"C:\Tools\codex.cmd\" \"--version\
```

cmd does not interpret backslash-escaped quotes — it has no `\"` escape grammar. So it tries to find an executable literally named `\"C:\Tools\codex.cmd\"` (leading backslash, trailing backslash) and fails with the observed `is not recognized as an internal or external command` error.

The unit test at `tests/unit/core/provider-executable-resolution.test.ts:227-230` only inspects the in-memory args array — it never actually spawns cmd.exe — so the defect ships with green tests.

### Suggested fix

Two options. The simpler one is preferred.

**Option A — verbatim args + cmd-correct escaping:**

Pass `windowsVerbatimArguments: true` from `runCommand` (`provider-checks.ts:53-79`) and have `buildWindowsCommandShimInvocation` produce a single command-line string whose quoting follows cmd.exe rules (not Node's MSVCRT-style rules). For paths without spaces this is just unquoted; for paths with spaces, double the inner quotes (cmd's `""` escape) or use a quote-once-strip-once trick:

```ts
function buildShimCommandLine(executable: string, args: string[]): string {
    const cmdQuote = (v: string) =>
        /[\s"&<>()@^|]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
    return [executable, ...args].map(cmdQuote).join(" ");
}

return {
    file: COMSPEC,
    args: ["/d", "/s", "/c", buildShimCommandLine(input.executable, input.args)],
    // and at the spawn site:
    // execFile(file, args, { ...opts, windowsVerbatimArguments: true }, cb)
};
```

**Option B — stop wrapping and use `shell: true`:**

Drop the manual cmd.exe wrapper entirely and pass `shell: true` to `execFile`. Trades the quoting bug for command-injection surface (every arg becomes shell-interpreted) — only acceptable if all arg values come from a strict allowlist, which is roughly true here (just `--version`, `auth status`).

### Why the existing unit test missed it

`tests/unit/core/provider-executable-resolution.test.ts:216-230` asserts the literal value of `invocation.args`, including `'"C:\\Tools\\codex.cmd" "--version"'`. That value is correct in isolation — the bug is what happens after `child_process` re-quotes it. To catch this kind of defect the unit test would need to cover the full spawn path (or a Node-level integration test that asserts the kernel-visible command line via `windowsVerbatimArguments` + a known-good fake), not the function's return value alone.

### Verification (after fix)

Option A was applied locally on 2026-05-07. Three coordinated edits:

1. `src/core/provider-executable.ts:42` — `quoteWindowsCmdArg` now uses cmd's native `""` escape:

```diff
 function quoteWindowsCmdArg(value: string): string {
-    return `"${value.replaceAll('"', '\\"')}"`;
+    return `"${value.replaceAll('"', '""')}"`;
 }
```

2. `src/core/provider-executable.ts:46-63` — `buildWindowsCommandShimInvocation` now wraps the joined inner command in outer quotes (the `cmd.exe /d /s /c "<wrapped>"` pattern that survives `/s` quote-stripping):

```diff
 export function buildWindowsCommandShimInvocation(input): { file; args } {
+    const inner = [input.executable, ...input.args]
+        .map(quoteWindowsCmdArg)
+        .join(" ");
     return {
         file: input.env?.COMSPEC ?? process.env.COMSPEC ?? "cmd.exe",
-        args: [
-            "/d", "/s", "/c",
-            [input.executable, ...input.args].map(quoteWindowsCmdArg).join(" "),
-        ],
+        args: ["/d", "/s", "/c", `"${inner}"`],
     };
 }
```

3. `src/core/provider-checks.ts:40-63` — `runCommand` now passes `windowsVerbatimArguments: true` when invoking the shim, so Node forwards the constructed command line to the kernel verbatim instead of re-escaping it MSVCRT-style:

```diff
 const platform = params.platform ?? process.platform;
-const command =
-    platform === "win32" && isWindowsCommandShim(resolvedExecutable)
-        ? buildWindowsCommandShimInvocation({ … })
-        : { file: resolvedExecutable, args: params.args };
+const useShim =
+    platform === "win32" && isWindowsCommandShim(resolvedExecutable);
+const command = useShim
+    ? buildWindowsCommandShimInvocation({ … })
+    : { file: resolvedExecutable, args: params.args };
 …
 getExecFileImplementation()(
     command.file,
     command.args,
     {
         cwd: params.cwd,
         env: filterEnv(process.env, params.env),
         timeout: params.timeoutMs,
         encoding: "utf8",
+        ...(useShim ? { windowsVerbatimArguments: true } : {}),
     },
     …
 );
```

The unit-test snapshot at `tests/unit/core/provider-executable-resolution.test.ts:227-230` was updated to match the new wrapping pattern (`'""C:\\Tools\\codex.cmd" "--version""'`).

**Verified on 2026-05-07:** with both BUG-WIN-008 and BUG-WIN-009 patches applied, `lbuild-impl preflight --spec-pack-root C:/github/crumb/docs/epics/f0 --story-gate "npm run lint" --epic-gate "npm run lint" --json` returns:

```text
status: ok  outcome: ready
blockers: []
  claude-code  available: true   tier: authenticated-known   version: 2.1.132 (Claude Code)
  codex        available: true   tier: binary-present        version: codex-cli 0.128.0
```

### Test-suite note

The companion test file `tests/unit/core/provider-executable-resolution.test.ts` has 3 test cases that fail on a real Windows host independently of this patch (verified by running them on clean main with my changes stashed: same failures). The fixtures rely on `#!/bin/sh` shebang scripts and a `cmd-emulator.js` that don't behave correctly under the native Windows process loader. They are pre-existing Windows-host-environment failures, not regressions introduced by this fix.

---

## BUG-WIN-010 — `story-orchestrate run` fails immediately with `spawn ENAMETOOLONG` because the codex adapter passes the planner prompt as a positional argv argument

**Severity:** Blocker — every story whose first planner turn produces a prompt larger than ~32 KB cannot run on Windows. Story-00 of crumb's F0 epic crosses that threshold on turn 1 (81,474-byte planner prompt), so `story-orchestrate run` self-terminates in 93 ms before codex ever starts.
**Status:** Open in v0.4.0. Reproduced 2026-05-07 against a locally-patched v0.4.0 build (BUG-WIN-008 + BUG-WIN-009 already applied) on Windows 10 Pro running through `C:\github\crumb\docs\epics\f0` story-id `00-foundation`.
**Affected:** Any Windows host running `story-orchestrate run` (or `resume`) on any spec pack whose composed planner prompt for a turn exceeds Windows's `CreateProcessW` command-line limit (32,767 characters total, including the resolved executable path, all preceding args, and any cmd.exe wrapper overhead).

### Symptom

```text
$ lbuild-impl story-orchestrate run --spec-pack-root C:/github/crumb/docs/epics/f0 \
                                    --story-id 00-foundation --heartbeat --json
[progress] story-orchestrate run phase=story-orchestrate-run status=…\story-lead\001-current.json
Oriented from existing artifacts: 001-story-validate.json, 002-story-validate.json
{
  "command": "story-orchestrate run",
  "version": 1,
  "status": "error",
  "outcome": "error",
  "errors": [{"code": "ENAMETOOLONG", "message": "spawn ENAMETOOLONG"}],
  "warnings": [],
  "artifacts": [{"kind":"result-envelope","path":"…\\003-story-orchestrate-run.json"}],
  "startedAt":  "2026-05-07T18:03:24.174Z",
  "finishedAt": "2026-05-07T18:03:24.267Z"
}
```

Wall-clock 93 ms. No stack trace emitted. No codex output captured (`streams/001-story-lead.stdout.log` and `.stderr.log` are both 0 bytes — the failure is on the parent process's `child_process.spawn` call, before any stdio handle is opened).

### Reproduction

1. Apply BUG-WIN-008 + BUG-WIN-009 patches so `preflight` returns `outcome:"ready"` for codex on Windows.
2. Wire any `impl-run.config.json` whose `story_lead_provider` is `{ secondary_harness: "codex", model: "gpt-5.5", reasoning_effort: "high" }` (the recommended setup per `src/skills/ls-impl/phases/20-story-cycle.md:84`).
3. Choose any story whose first planner turn would produce a prompt larger than ~32 KB. (Crumb's F0 story `00-foundation` produces ~81 KB on turn 1; this is typical for any story that orients across an entire epic with full tech-design + test-plan composed in.)
4. Run:

```sh
lbuild-impl story-orchestrate run --spec-pack-root <pack> --story-id <story> --heartbeat --json
```

→ envelope returns `status:"error", outcome:"error", errors:[{code:"ENAMETOOLONG", message:"spawn ENAMETOOLONG"}]` within 100 ms.

### Root cause

`src/core/provider-adapters/codex.ts:65-90` builds the codex argv by appending `request.prompt` as a trailing positional argument:

```ts
const args = request.resumeSessionId
    ? [
            ...codexGlobalArgs,
            "exec",
            "resume",
            "--json",
            "-o",
            outputLastMessagePath,
            request.resumeSessionId,
            request.prompt,                       // ← prompt as argv
        ]
    : [
            ...codexGlobalArgs,
            "exec",
            "--json",
            "-m",
            request.model,
            "-c",
            `model_reasoning_effort=${request.reasoningEffort}`,
            ...(canUseStructuredOutputSchema
                ? ["--output-schema", outputSchemaPath]
                : []),
            "-o",
            outputLastMessagePath,
            request.prompt,                       // ← prompt as argv
        ];
```

Those args are then passed to `runProviderCommand` (`src/core/provider-adapters/shared.ts:394-429`) which resolves the executable, wraps Windows `.cmd` shims via `buildWindowsCommandShimInvocation`, and finally calls `getSpawnImplementation()(command.file, command.args, …)`.

On Windows, `child_process.spawn` ultimately calls the Win32 `CreateProcessW` API, which has a hard upper bound on the combined command-line length: **32,767 characters** (the `lpCommandLine` parameter is documented at `MAX_PATH * 2` historically, raised to 32,767 in modern Windows; see Microsoft docs for `CreateProcessW`). Any prompt that — together with the resolved executable path, all preceding args, the cmd.exe wrapper (`cmd.exe /d /s /c "<inner>"`), and Windows quoting overhead — exceeds that limit fails synchronously with `ENAMETOOLONG`.

For story `00-foundation`, the planner prompt that the orchestrator wrote to disk for traceability is **81,474 bytes** (`…\story-lead\prompts\001-planner-turn-001.md`) — well above the 32,767-char ceiling, even before any wrapping overhead. The orchestrator wrote the prompt to disk *and* inlined it as argv; only the second copy reaches `CreateProcessW`, and only the second copy fails.

POSIX hosts are typically unaffected: Linux's `ARG_MAX` is usually 128 KB–2 MB, macOS is 256 KB+, so an 81 KB prompt fits comfortably.

### Side effect — durable state stranded mid-lifecycle

The synchronous spawn failure short-circuits the lifecycle writer. After this run:

- `story-lead/001-current.json` reads `status:"running", lifecycleState:"awaiting_story_lead_action", currentPhase:"story-orchestrate-run", nextIntent:"orient-from-disk"`.
- `progress/001-story-lead.status.json` mirrors the same.
- `001-events.jsonl` contains one `story-run-started` event and no `story-run-failed`/`errored` terminal record.

A subsequent `story-orchestrate resume` would see the run as still alive. Filed separately as **BUG-WIN-011**.

### Suggested fix

Three options, in order of preference:

**Option A — write prompt to a temp file, pass `--prompt-file <path>`** (or whichever file-path arg codex supports). This is the cleanest surface: the orchestrator already writes the prompt to `…\story-lead\prompts\NNN-planner-turn-NNN.md` for traceability, so a tiny adjustment lets the spawn site reuse that same path instead of inlining the prompt:

```ts
const promptFile = await writePromptFile(request); // already done elsewhere; reuse the path
const args = [
    ...codexGlobalArgs,
    "exec",
    "--json",
    "-m", request.model,
    "-c", `model_reasoning_effort=${request.reasoningEffort}`,
    ...(canUseStructuredOutputSchema ? ["--output-schema", outputSchemaPath] : []),
    "-o", outputLastMessagePath,
    "--prompt-file", promptFile,           // ← path, not contents
];
```

(Confirm `--prompt-file` flag name against codex 0.128.0; if codex does not support a prompt-file flag, use Option B.)

**Option B — pipe prompt to codex stdin.** Most CLI tools accept stdin when no positional prompt is supplied, or with an explicit `-` sentinel. This bypasses argv length limits entirely and matches POSIX behavior on Windows. Requires:

- removing `request.prompt` from the args array;
- wiring `child.stdin.write(request.prompt)` + `child.stdin.end()` in `runProviderCommand` immediately after spawn;
- testing that codex's `exec` and `exec resume` modes both honor stdin without a positional prompt.

**Option C (Windows-specific guard, defense in depth):** in `runProviderCommand`, detect when the constructed command line on Windows would exceed 32,767 chars and either fail with a structured `PROVIDER_PROMPT_TOO_LONG` error (so the orchestrator can surface a helpful blocker instead of an opaque `spawn ENAMETOOLONG`) or transparently fall back to a temp-file/stdin path. This catches edge cases where prompts grow unexpectedly large mid-run.

Option A or B alone resolves the observed regression; Option C is recommended on top of either as a safety net.

### Why this wasn't visible in v0.3.0

v0.3.0's `preflight` failed on Windows before any provider could spawn (BUG-WIN-002, BUG-WIN-003), so the prompt-as-argv path was never exercised. Fixing those preflight blockers in v0.4.0 (plus BUG-WIN-008 and BUG-WIN-009 to actually reach a green probe) exposed the previously-shadowed argv-length defect. So this is a latent v0.3.0+ bug surfacing as a v0.4.0-visibility regression — analogous to BUG-WIN-007's relationship to BUG-WIN-001.

### Verification

Option B (stdin) was applied locally on 2026-05-07. Edits:

1. `src/core/provider-adapters/codex.ts:65-90` — final positional arg is now `"-"` (codex's documented stdin sentinel) instead of the inlined prompt; the prompt is forwarded to `runProviderCommand` via a new `stdin` field.
2. `src/core/provider-adapters/shared.ts:349-415` — `runProviderCommand` accepts `stdin?: string` and, after spawn, writes it to `child.stdin` and ends the stream. The write is wrapped with an `error` handler so EPIPE on child early-exit (e.g. test fakes that don't read stdin) does not surface as an unhandled error.
3. `src/core/provider-adapters/shared.ts:425-433` — also passes `windowsVerbatimArguments: true` whenever the cmd-shim wrapper is in play (parallel to the BUG-WIN-009 fix in `provider-checks.ts`; this site was missing it, so it would have broken once the prompt-as-argv length issue stopped firing first).

Test snapshot at `tests/unit/core/provider-adapter.test.ts:631,644,928,943` updated: assertions now expect the last arg to be `"-"` instead of the literal prompt JSON.

Codex 0.128.0 contract (per `codex exec --help`):

> Initial instructions for the agent. If not provided as an argument (or if `-` is used), instructions are read from stdin.

So the patched invocation reads stdin verbatim regardless of prompt size, eliminating the CreateProcessW length cap from the picture.

Note: the prompt size itself is **not** unreasonable for the story being driven (story-00's 81 KB is `## Requirements Source` (story file) + `## TC → Test Mapping` + `## Test Architecture` + state machinery; the prompt header explicitly excludes epic.md, tech-design.md, git diff, and workspace summaries). Smaller stories produce smaller prompts. The defect was the transport, not the composition.

### Parallel issue not patched in this round

`src/core/provider-adapters/claude-code.ts:20-22` follows the same shape — the prompt is passed to `claude -p <prompt>` as a positional argument. Any host using claude-code as a secondary harness (which v0.4.0 supports for `secondary_harness:"none"` roles backed by Claude) would hit the same 32 KB ceiling on Windows. Not exercised on this run because `story_lead_provider` is wired to codex; flag for follow-up.

---

## BUG-WIN-011 — Story-run lifecycle is not transitioned to a terminal state when child spawn fails synchronously

**Severity:** Major — a `story-orchestrate run` that fails before any lifecycle event leaves durable state at `status:"running"`, so a future `story-orchestrate resume` invocation will treat the run as still alive and either retry indefinitely or behave incorrectly.
**Status:** Open in v0.4.0. Reproduced 2026-05-07 as a side effect of BUG-WIN-010 on Windows.
**Affected:** Any environment where the codex (or claude) child spawn fails before the parent receives a `provider-spawned` lifecycle event — Windows ENAMETOOLONG is the demonstrated case, but the same asymmetry would apply to ENOENT, EACCES, or any synchronous spawn rejection.

### Symptom

After BUG-WIN-010 fires:

```text
$ cat .../story-lead/001-current.json | jq '{status, lifecycleState, currentPhase, nextIntent}'
{
  "status":         "running",
  "lifecycleState": "awaiting_story_lead_action",
  "currentPhase":   "story-orchestrate-run",
  "nextIntent":     "orient-from-disk"
}

$ wc -l .../story-lead/001-events.jsonl
1 .../story-lead/001-events.jsonl

$ jq '.type' .../story-lead/001-events.jsonl
"story-run-started"
```

No `story-run-failed`, `story-run-errored`, or any terminal lifecycle record. The CLI return envelope reports `status:"error"` cleanly, but that information never makes it into the durable `story-lead/` directory.

### Root cause (likely)

The lifecycle-event writer is presumably wired into the post-spawn lifecycle stream (`provider-spawned` → `active-silent` → `provider-output` → … → `provider-exit`). When `child_process.spawn` rejects synchronously (before the `provider-spawned` event is emitted), the orchestrator's `try/catch` around the spawn returns the error envelope to the CLI but no equivalent durable terminal-state write is performed.

The asymmetry: an in-flight provider failure (post-spawn) writes a terminal lifecycle event, but a parent-side spawn rejection does not.

### Suggested fix

In whichever orchestrator entry point catches the spawn failure (likely around `provider-adapters/shared.ts:425` or one layer up in story-orchestrate-run), before returning the error envelope, persist a terminal lifecycle event with the spawn error reason. Pseudocode:

```ts
try {
    const execution = await runProviderCommand({…});
    …
} catch (spawnError) {
    await emitDurableLifecycleEvent({
        type: "story-run-failed",
        reason: "provider-spawn-error",
        errorCode: spawnError.code ?? "UNKNOWN",
        errorMessage: spawnError.message,
        timestamp: new Date().toISOString(),
    });
    await transitionStoryRunState({
        status: "error",
        lifecycleState: "errored",
    });
    throw spawnError;
}
```

This way `story-orchestrate resume` (and any external observer) sees a coherent terminal state and can act accordingly (require explicit user intervention, surface the error, refuse to resume a permanently-failed run, etc.).

### Verification

After applying the fix, repro BUG-WIN-010 once and inspect:

```sh
$ jq '.type' .../story-lead/001-events.jsonl
"story-run-started"
"story-run-failed"     # ← new terminal event

$ cat .../story-lead/001-current.json | jq '{status, lifecycleState}'
{
  "status":         "error",
  "lifecycleState": "errored"
}
```

…and `story-orchestrate resume` should then refuse with a structured "story already terminated" error rather than attempting to reorient.

---

## OBS-WIN-001 — `preflight` mutates the user's `impl-run.config.json` as a side effect

**Severity:** Observation (not a blocker, but possibly unintended).
**Status (v0.4.0):** Reproduces deterministically. Not necessarily Windows-specific.

### Observation

Running `preflight` against an epic where `verification_gates` are supplied via `--story-gate` / `--epic-gate` flags causes the runtime to write the resolved values back into the on-disk `impl-run.config.json`. Visible in the envelope:

```json
"notes": [
  "Persisted resolved verification_gates into impl-run.config.json for downstream CLI commands."
]
```

Before the run, our config had no `verification_gates` key (matched f1's shape); after the run, `verification_gates: { "story": "npm run lint", "epic": "npm run lint" }` had been added by the CLI.

### Why it's worth noting

`preflight` is documented as a read-only readiness check. Mutating a tracked configuration file as a side effect:

- surprises users running `git status` after `preflight`
- conflicts with the principle that the CLI's "what's ready?" command shouldn't change source
- creates a race when `preflight` is invoked from CI on a checked-out worktree (next CI step sees a dirty tree)

If this persistence behavior is intentional (so downstream commands can read gates without re-passing flags), the fix surface is documentation + a flag to opt out (`--no-persist-gates` or similar), or writing the resolved gates into a runtime-state file outside the tracked config. As-is on Windows this also compounds with BUG-WIN-007 — every `preflight` *also* dirties `embedded-assets.generated.ts` if the runtime is being dogfooded from this repo.

Filed as an observation rather than a bug because it may be a design choice; logging here so the v0.4.0 review can decide.

---

## OBS-WIN-002 — Envelope contract heads-up from the first clean Windows run

**Severity:** Observations (not bugs). Surfaced 2026-05-07 from the first end-to-end Windows orchestrate. Logging here so anyone wiring downstream tooling against the v0.4.0 envelope is aware. None of these would have been visible from any prior Windows run because the runtime never reached a successful terminal turn before this one.

### a) `terminalDecision: "accept"` co-located with `outcome: "needs-ruling"`

Story-lead's planner emitted `terminalDecision: "accept"` on sequence 20, but the runtime correctly downgraded the envelope to `outcome: needs-ruling` because two `riskAndDeviationReview.specDeviations[*].approvalStatus` entries were `needs-ruling` with `approvalSource: null`. The labeling is defensible, but the dual signal is subtle — a reader skimming `terminalDecision` alone would conclude the story was accepted.

### b) Acceptance checks pass while envelope parks at `needs-ruling`

`acceptanceChecks` and `verification.findings` all read `pass` / `fixed` while the run terminates at `needs-ruling`. The gate that holds the story is the spec-deviation approval status, which is independent of verifier findings. Anyone scripting against the envelope to decide "story complete?" should check `outcome` and `riskAndDeviationReview.specDeviations[*].approvalStatus` together, not `verification.outcome` alone.

### c) No `story-run-completed` / `story-run-finished` event in the suspended-terminal case

The only terminal event written to `001-events.jsonl` is `needs-ruling` (sequence 20). There is no `story-run-completed` or `story-run-finished` event. Probably intentional — the run is suspended pending rulings, not concluded — but downstream analytics that grep for a single canonical `story-run-finished` terminator will miss this branch.

### d) Five fresh codex sessions, zero session-resumes across consecutive planner turns

All five planner turns opened **fresh** codex sessions (each `story-lead-provider-started` event explicitly says "Fresh story-lead provider turn executed without planner session resume."), even when consecutive turns were 6–11 ms apart at the parent level. `storyImplementor.sessionId` and `storyVerifier.sessionId` are present in the final package but never round-tripped. If session resume is intended to be the cheaper path, something is opting out of it; if fresh-per-turn is the design, it just means the resume payload code path (and BUG-WIN-006's surface) is not exercised by a non-interrupted `run`. Closing BUG-WIN-006's retest requires an explicit `story-orchestrate resume` invocation.

---

## How this log is maintained

- Each entry has a stable ID (`BUG-WIN-NNN`) so commits and external references can pin a specific defect.
- `Status: Fixed locally` means a patch exists in this working tree but has not been upstreamed; `Status: Open` means no patch yet.
- When a bug is resolved upstream, leave the entry but flip `Status: Fixed upstream in vX.Y.Z` so the historical context survives — Windows users on older versions still hit it.
