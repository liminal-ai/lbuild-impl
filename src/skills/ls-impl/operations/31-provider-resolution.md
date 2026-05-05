# Provider Resolution

This file teaches the default-resolution algorithm you use to author `impl-run.config.json` during setup. The algorithm is deterministic so two orchestrators facing the same local environment produce the same configuration.

## The primary harness

Claude Code is the primary harness for every run. It is always available because you run inside it. This value is fixed:

```json
{ "primary_harness": "claude-code" }
```

## Secondary harness probe

Check secondary harness availability in this order and stop at the first available:

1. Codex CLI — `codex --version`
2. Neither

The result selects which defaults table applies below. Record a degraded-diversity condition in `team-impl-log.md` when neither is available.

For normal story work, `story-orchestrate` is the happy path and it requires an explicit `story_lead_provider` entry in `impl-run.config.json`. The recommended current story-lead setup is Codex `gpt-5.5`: each fresh planner turn should produce exactly one bounded action, then exit so the runtime can persist durable state before the next call.

## Role defaults

Each role gets a `secondary_harness`, `model`, and `reasoning_effort`. The epic verifier rows (`epic_verifier_1`, `epic_verifier_2`) correspond to entries in the `epic_verifiers` array with labels `epic-verifier-1` and `epic-verifier-2`; all other rows are top-level config keys.

`secondary_harness: "none"` means the role runs on the built-in Claude-backed provider path. That is a provider choice, not a statement about which caller harness is reading the CLI output.

### Codex available

| Role | secondary_harness | model | reasoning_effort |
|------|---|---|---|
| `story_lead_provider` | `codex` | `gpt-5.5` | `high` |
| `story_implementor` | `codex` | `gpt-5.4` | `high` |
| `quick_fixer` | `codex` | `gpt-5.4` | `high` |
| `story_verifier` | `codex` | `gpt-5.4` | `xhigh` |
| `epic_verifier_1` | `codex` | `gpt-5.4` | `xhigh` |
| `epic_verifier_2` | `none` | `claude-sonnet` | `high` |
| `epic_synthesizer` | `codex` | `gpt-5.4` | `xhigh` |

### Neither available

All roles fall back to the primary harness. Record the degraded-diversity condition.

| Role | secondary_harness | model | reasoning_effort |
|------|---|---|---|
| `story_lead_provider` | `none` | `claude-sonnet` | `high` |
| `story_implementor` | `none` | `claude-sonnet` | `high` |
| `quick_fixer` | `none` | `claude-sonnet` | `high` |
| `story_verifier` | `none` | `claude-sonnet` | `xhigh` |
| `epic_verifier_1` | `none` | `claude-sonnet` | `xhigh` |
| `epic_verifier_2` | `none` | `claude-sonnet` | `high` |
| `epic_synthesizer` | `none` | `claude-sonnet` | `xhigh` |

## Self-review passes

Defaults to 3. Do not change unless the user asks.

```json
{ "self_review": { "passes": 3 } }
```

## Full file shape

```json
{
  "version": 1,
  "primary_harness": "claude-code",
  "story_lead_provider": { "secondary_harness": "...", "model": "...", "reasoning_effort": "..." },
  "story_implementor": { "secondary_harness": "...", "model": "...", "reasoning_effort": "..." },
  "quick_fixer": { "secondary_harness": "...", "model": "...", "reasoning_effort": "..." },
  "story_verifier": { "secondary_harness": "...", "model": "...", "reasoning_effort": "..." },
  "self_review": { "passes": 3 },
  "timeouts": {
    "provider_startup_timeout_ms": 300000,
    "story_lead_planner_ms": 600000,
    "story_orchestrate_ms": 7200000,
    "story_implementor_silence_timeout_ms": 600000,
    "story_self_review_silence_timeout_ms": 480000,
    "story_verifier_silence_timeout_ms": 360000,
    "quick_fixer_silence_timeout_ms": 300000,
    "epic_cleanup_silence_timeout_ms": 480000,
    "epic_verifier_silence_timeout_ms": 600000,
    "epic_synthesizer_silence_timeout_ms": 600000
  },
  "epic_verifiers": [
    { "label": "epic-verifier-1", "secondary_harness": "...", "model": "...", "reasoning_effort": "..." },
    { "label": "epic-verifier-2", "secondary_harness": "...", "model": "...", "reasoning_effort": "..." }
  ],
  "epic_synthesizer": { "secondary_harness": "...", "model": "...", "reasoning_effort": "..." }
}
```

Write this file at the spec-pack root with the appropriate table's values filled in. `preflight` will validate the contents. Keep `story_lead_provider` explicit for `story-orchestrate`; that role is required for the composed story path and should not rely on an implied default provider. Use `story_lead_planner_ms` for one planner turn and `story_orchestrate_ms` for the whole `run` or `resume` invocation so timeout failures identify the budget that expired.

## Windows and Codex notes

Provider subprocesses keep the normal narrow allowlist, but Windows needs a few extra OS variables so provider CLIs can find their user profiles, shell shims, and temp directories. Expect `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `COMSPEC`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `TEMP`, and `TMP` to stay available when the runtime launches provider children.

Codex provider runs default to full local execution access so implementors and verifiers can run normal project gates, including scripts that bind localhost or otherwise need more than read-only review permissions.

To override that default before running `story-orchestrate` or the lower-level story commands, set:

```bash
LBUILD_IMPL_CODEX_SANDBOX_MODE=danger-full-access
LBUILD_IMPL_CODEX_APPROVAL_POLICY=never
```

`danger-full-access` is the current default because implementation and verification both need to execute the configured project gates. `read-only` will block normal story work. `workspace-write` may still block tests that bind localhost or need broader process permissions.

Codex resume does not accept `--output-schema`, so resumed turns rely on the same strict runtime parser instead. If the resumed payload drifts away from the required result contract, the runtime reports that as Codex resume schema drift rather than silently accepting malformed output.

## Where defaults are recorded

After `preflight` returns `ready`, the resolved config, provider and harness availability matrix, active role defaults, and any degraded-diversity condition go into `team-impl-log.md` as part of setup step 5.
