# Epic 5 Notes: Story-Orchestrate Observability

## Context

These notes capture observations from live testing of `story-orchestrate` after the Epic 03 and Epic 04 changes landed. The focus here is not the full story-runtime feature set, but the operator experience of understanding what the story orchestrator is doing, why it is doing it, and how a calling agent can safely intervene when things are not going as desired.

## Observations

- The current system is artifact-rich but operator-hostile. The information exists, but the calling agent often has to assemble the story from multiple files and command surfaces.
- The most useful operational questions are simple: what is running, why is it running, what is it waiting on, and what should happen next. Today those answers are spread across `story-orchestrate status`, story-run snapshot JSON, event history, child runtime status files, and raw stdout/stderr logs.
- A per-story `story-orchestrate validate` checkpoint materially improved the operator flow. It reduced startup ambiguity and gave impl-lead a clean place to confirm readiness before paying for provider-backed story work.
- The child operation runtime progress surface is substantially more informative than the parent story-orchestrate status surface.
- Heartbeats are directionally helpful, but they are not yet a coherent live control surface for the calling agent.
- The event log is durable and useful for reconstruction, but it is not yet curated for fast operator understanding.
- The main failure mode is not obviously "too much context." In live use, the planner generally had enough evidence to choose the next bounded action. The bigger problem was that current truth, stale history, and prose audit commentary were blended together without enough deterministic structure.

## Issues Seen In Practice

- A planner failure initially surfaced only `Reading additional input from stdin...`, which looked like a provider-startup problem even though it was not the real cause.
- The actual root cause was hidden in planner stdout, and the story-lead planner was not writing its own stdout/stderr stream logs at all.
- The parent `story-orchestrate status` view can surface a stale prior interrupted final package while the story run is actively moving again. This makes current truth harder to read.
- `latestEvent` can be technically correct but not operationally useful. A self-note may be the latest event even when the real operator question is about the current child command or most recent failure.
- It was too easy for a caller to miss the boundary between story-level state and child-operation state. The child `status.json` may show useful live progress while the parent status appears comparatively static.
- Failure routing did not consistently surface the layer that failed in the most legible way. We had to inspect artifacts to determine whether the problem belonged to planner schema handling, verifier routing, or a child runtime envelope.
- Baseline terminology is currently confusing in live use. Validate artifacts reported one baseline number while accepted story packages later reported a different baseline pair. If those are intentionally different metrics, they need distinct labels in both docs and envelopes.
- Terminal `blocked` is semantically muddy when story-local evidence is green but outer impl-lead acceptance work is still pending. In live story flow, that looked too similar to an actual story blocker even when verifier outcome was `pass` and the remaining work was "run the outer gate / complete acceptance."

## Testing And Confidence Problems

- Existing "smoke" coverage gave more confidence than it should have.
- Fake-provider package tests verified argument wiring and artifact shapes, but they did not prove that the real provider would accept the structured-output schema for the story-lead planner.
- The original real-provider story-lead smoke tolerated interruption and seeded primitive artifacts, so it did not prove the beginning of the true empty-story happy path.
- A real Codex planner schema incompatibility made it through because the test suite did not require a live `story-orchestrate run` to select and execute the first bounded action from a clean story-run start.
- In practice, that means we had a "smoke test" label attached to coverage that was not actually smoke coverage for the documented happy path.

## What A Smoother Calling-Agent Experience Likely Needs

- One top-level observability surface that answers the operator questions directly before forcing any drilldown.
- A layered presentation model:
  - `agent` view for quick routing and confidence
  - `detail` view for recent decisions and active child state
  - `debug` view for exact paths, raw logs, and provider diagnostics
- Inline child-runtime rollup inside parent `story-orchestrate status` whenever a bounded child operation is active.
- A deterministic foreground layer for "current truth" that is additive, not subtractive. The planner and caller should get a compact index first, but the full underlying record should remain present behind it.
- A concise synthesized headline, for example:
  - `Running story-verify initial pass after implementor completed successfully`
  - `Running quick-fix for two verifier findings`
  - `Blocked on caller ruling about scope ambiguity`
- A clear distinction between:
  - current run state
  - prior terminal package state
  - active child operation state
- Derived event slots rather than only one `latestEvent`, such as:
  - latest decision event
  - latest progress event
  - latest failure event
- Failure summaries that always include:
  - failing layer
  - failure code
  - plain-English cause
  - safe recovery point
  - recommended caller action

## Context-Shaping Principles

- Add structure before removing anything. The first pass should make the current truth legible without shrinking the raw grounding.
- Relevance should be decided by deterministic code rules, not by asking the model to guess what no longer matters.
- The full story file, test plan, current snapshot, caller inputs, event history, and prior result artifacts should remain available unless there is an explicit and auditable supersession rule.
- Superseded failures and older artifacts should be demoted to background context only when a later artifact or ledger entry explicitly supersedes them.
- Approval-significant state should never live only in prose if the runtime expects the planner or final-package assembler to treat it as blocking.

## Foreground Structure Candidates

- `live_case_index`
  Latest child outcome, current phase, open findings, fixed findings, gate status, unresolved approvals, and the artifact references that establish each fact.
- `finding_ledger`
  Structured opened/fixed/confirmed relationships so the planner does not have to infer supersession from prose across multiple verifier artifacts.
- `gate_ledger`
  Current story-gate and epic-gate truth with evidence references and latest confirmation source.
- `approval_ledger`
  Only explicitly typed ruling/approval-needed items should count as unresolved approvals.
- `delta_since_last_turn`
  What materially changed since the previous planner turn.
- `artifact_map`
  Which artifacts are active, background, historical, or superseded.

## Possible Prompt Segmentation

- Use structured tags or equivalent sections to separate context classes without thinning them:
  - `<story_requirements>`
  - `<test_plan>`
  - `<live_case_index>`
  - `<current_snapshot>`
  - `<active_artifacts>`
  - `<background_artifacts>`
  - `<event_history>`
- The purpose of those tags is organization and prioritization, not aggressive summarization.

## Brief Outline For A More Coherent Integrated Observability System

1. Treat `story-orchestrate status` as the primary operator surface.

2. Add a synthesized operator summary to the status result with fields such as:
   `headline`, `why`, `waitingOn`, `health`, `nextIfSuccess`, `nextIfFailure`, `debugPaths`.

3. Inline the active child runtime snapshot into the parent story status whenever `lifecycleState` is `running_child_operation`.

4. Add a deterministic "current truth" layer for planner turns and caller status reads:
   latest child outcome, open findings, fixed findings, gate state, unresolved approvals, and artifact references.

5. Keep the raw underlying record in view:
   story file, test plan, current snapshot, full event history, prior result artifacts, caller inputs, and self-notes.

6. Stop presenting an old interrupted final package as if it were current truth when a run has resumed. Keep it visible as prior context, but not as the primary story state.

7. Add a watch-oriented surface for the calling agent, either a `watch` command or a `--follow` mode, that continuously renders the current summary plus drilldown hints.

8. Standardize the drilldown path:
   parent status -> active child runtime -> raw logs -> artifact payload.

9. Expand real-provider integration coverage so the observability contract itself is tested, not only the core orchestration logic.

## Near-Term Candidate Improvements

- Make planner stream logs first-class for every story-lead turn.
- Add `activeChildRuntime` and `latestFailureEvent` to the story-orchestrate status contract.
- Add a status rendering mode optimized for calling agents rather than for raw contract completeness.
- Distinguish outer-acceptance-pending from true story blockage in the top-level story-orchestrate surface so impl-lead can tell "waiting on me" apart from "the runtime is blocked."
- Rename or split baseline fields so pre-story readiness baseline, current cumulative baseline, and after-story accepted baseline are not presented as one ambiguous metric family.
- Add a deterministic "live case index" and findings/gates/approvals ledgers without removing the existing raw artifacts from planner context.
- Add a real-provider integration smoke that requires:
  - empty story-run start
  - planner action selection
  - first bounded child operation execution
  - legible parent status while that child operation is active

## Longer-Term Idea To Revisit

- Consider a broader move from raw JSON presentation toward deterministic YAML presentation in operator-facing and planner-facing artifacts where the payloads are currently rigid JSON objects.
- The reason to consider that shift is readability, not loss of structure. YAML can remain deterministic and structured enough for both models and humans while being easier to scan than large JSON blocks.
- If pursued later, this should be done selectively and with clear boundaries:
  - preserve exact machine-readable sources internally
  - convert presentation layers deterministically
  - avoid freehand prose rewrites that discard field-level grounding
- Work through a coherent provider permissions policy. Live testing showed verifier-run project gates can need more than read/write filesystem access, including localhost bind permissions. The immediate default is `danger-full-access` for Codex provider runs, but the long-term design should make role permissions, gate execution needs, caller trust boundaries, and preflight visibility explicit instead of relying on hidden provider defaults.

## Scope Notes For Next Epic Planning

- Remove Copilot support completely. This should be a hard deletion, not a compatibility-preserving deprecation path. Remove the provider, config support, docs, tests, and any fallback or alias behavior.
- Claude Code hardening should start with parity, not workflow expansion. First prove that the current validate/run/resume/status flow and the current primitive story operations all work cleanly with Claude Code using real fixtures and real provider-path tests.
- Keep Epic 5 narrow if needed:
  - story-orchestrate observability and operator legibility
  - Claude Code parity and fixture/test hardening
  - Copilot removal
- Treat expanded workflow profiles as a likely next-epic candidate rather than forcing them into Epic 5 if scope gets too wide.

## Likely Epic 6 Candidate: Orchestration Profiles

- Add configurable implementation profiles rather than one fixed story-orchestrate approach for every model/provider mix.
- Baseline split:
  - `standard implementation` — single implementation pass; recommended for stronger coding/verification models
  - `detailed implementation` — more granular staged flow; likely the better default for Claude-only workflows
- The likely detailed implementation shape is:
  1. structure pass
  2. green pass
  3. holistic story pass
  4. verification
- The holistic story pass matters because breaking work only into skeleton plus tests can cause non-test-shaped requirements to fall out of the implementation.

## Likely Epic 6 Candidate: Verification Profiles

- Add configurable verification profiles rather than treating every story the same.
- Baseline split:
  - `standard verification` — current verifier approach
  - `enhanced verification` — more thorough path for Claude-only or otherwise lower-rigor workflows
- The enhanced verification path may include multiple distinct verification jobs rather than one generic review pass:
  - story-scope verification
  - changed-surface / regression verification
  - holistic omission pass
  - explicit gate-truth verification
- Keep this model-agnostic in the product surface even if Claude Code is the main initial reason to add it.
