# Release Runbook

This runbook covers maintainer-owned release work for `lbuild-impl`: configure npm, keep release markers in sync, produce fresh gorilla evidence, rehearse the publish workflow, tag the live release, and verify the published artifact.

## Current release baseline

Current package: `lbuild-impl@0.3.0`

Release infrastructure:

- Node 24.
- Blacksmith runner label `blacksmith-2vcpu-ubuntu-2404` for CI, gorilla evidence, and integration gates.
- GitHub-hosted `ubuntu-latest` for the final npm publish job.
- Public unscoped npm package `lbuild-impl`.
- Live publish uses `npm publish --access public --provenance`.
- npm provenance requires the final publish job to run on a GitHub-hosted runner; Blacksmith remains the runner for the expensive gates.
- Manual publish workflow runs are rehearsal-only and cannot publish live.

Recent known-good runs:

- Publish workflow for `v0.3.0`: `25197337957`
- Blacksmith `default-ci` gate: `73880814695`
- Blacksmith `gorilla-evidence` gate: `73880814701`
- Blacksmith `integration` gate: `73880962070`
- GitHub-hosted provenance publish job: `73881155110`

## npm token configuration

1. Create or refresh an npm automation token with publish rights for `lbuild-impl`.
2. Add the token to the GitHub repository as the `NPM_TOKEN` Actions secret.
3. Confirm the release workflow also has the provider secrets used by the real-harness job:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `GH_TOKEN`
4. If the token was rotated, rerun `npm whoami` locally before the next tag so the live workflow is not the first auth check.

## Package access setup

`lbuild-impl` publishes as an unscoped public package.

Before releasing:

1. Confirm the maintainer account has publish access to the `lbuild-impl` package on npm.
2. Confirm the package remains public.
3. Confirm `npm view lbuild-impl version` returns the latest expected published version.
4. Keep `package.json`, `CHANGELOG.md`, and `VERSION` aligned to the same semantic version before tagging.

## Pre-tag gorilla evidence procedure

The publish workflow validates gorilla evidence but does not generate it. The maintainer must commit fresh evidence before tagging.

1. Reset the fixture: `npx tsx gorilla/reset.ts`
2. Build the package: `npm run build`
3. Follow `gorilla/prompt.md` and write evidence into `gorilla/evidence/<YYYY-MM-DD>/`.
4. Use the fixture's `*-smoke` configs for release evidence. Non-smoke configs are intentionally allowed to run longer implementation-grade provider work.
5. Keep the canonical filename format: `<provider>-<scenario>.md`
6. The default release gate requires this four-report matrix:
   - `claude-code-smoke.md`
   - `codex-resume.md`
   - `copilot-structured-output.md`
   - `codex-stall.md`
7. If a release intentionally uses a smaller or different matrix, pass `--matrix <comma-separated reports>` to `scripts/check-release-evidence.ts` and document the explicit matrix in the release notes before tagging.
8. For a clean report, record `- Unexpected behaviors observed: none` in the `## Divergences` section.
9. If the gorilla run finds issues, fix them before tagging instead of committing unresolved release evidence.
10. Commit the fresh evidence directory before creating the release tag.

The publish workflow accepts evidence directories dated within the last 7 days by default. Use the workflow-dispatch `release_window_days` input only when you intentionally need a wider pre-tag window.

## First publish rehearsal

Run one rehearsal before every live publish for a version.

1. Update `package.json`, `CHANGELOG.md`, and `VERSION` to the target version.
2. Run `npm run green-verify`.
3. Run `npm run verify-all`. If provider credentials, binaries, or required environment are missing locally, treat that as a real release-blocking gate failure rather than a skip condition.
4. Run `npm run pack-and-install-smoke`.
5. Push the release branch or commit SHA you want to rehearse so GitHub Actions can check it out.
6. Optionally create a local-only `v<version>` tag for shell checks. The workflow does not need the tag to exist on GitHub during rehearsal.
7. Start the `Publish` workflow manually with `workflow_dispatch`.
8. Set `tag` to `v<version>`.
9. Set `ref` to the GitHub-visible release branch, SHA, or ref from step 5.
10. Leave `dry_run` enabled.
11. Confirm the workflow completes `default-ci`, `integration`, `gorilla-evidence`, and `publish`.

Manual `workflow_dispatch` runs validate the requested tag string, check out `ref`, verify the release markers against `tag`, and then run dry-run package validation. If the package version does not yet exist on npm, the final publish step runs `npm publish --access public --provenance --dry-run`. If the package version already exists on npm, the workflow runs `npm pack --dry-run --json` instead so rehearsals remain possible after an earlier publish.

## Tag and publish

1. Reconfirm the release candidate commit contains:
   - the version bump in `package.json`
   - the matching top changelog entry in `CHANGELOG.md`
   - the matching value in `VERSION`
   - the fresh gorilla evidence directory committed to `gorilla/evidence/`
2. Create and push the release tag: `git tag v<version>` then `git push origin v<version>`
3. Watch the `Publish` workflow for the tagged commit.
4. Confirm `default-ci`, `integration`, `gorilla-evidence`, and `publish` all complete.
5. If any gate fails, fix the issue on a new commit, regenerate evidence if needed, and create a new tag for the corrected version instead of rerunning an old broken tag.

## Post-publish verification

After the live publish completes:

1. Run `npm view lbuild-impl version dist-tags --json` and confirm the registry version and `latest` tag match the pushed tag.
2. In a fresh temp directory outside this repo, create a minimal spec-pack fixture inside a git repository.
3. Run `npx --yes lbuild-impl@<version> inspect --spec-pack-root ./fixture --json`.
4. Confirm the command returns an `inspect` envelope with `status: ok` and `outcome: ready`.
5. Confirm the persisted artifact path named in the envelope exists on disk.
6. Install globally with `npm install -g lbuild-impl@<version>`.
7. Run the global `lbuild-impl --version`, `lbuild-impl --help`, and `lbuild-impl inspect --spec-pack-root ./fixture --json` smoke checks.
8. In a fresh temp package, import the SDK with `import { version, inspect } from "lbuild-impl/sdk"` and confirm the version and function surface.
9. Record the successful `npx`, global install, and SDK import smoke results in release notes or a maintainer log for traceability.

Run `npx` smoke checks from a neutral temp directory, not from inside this repository. A package can confuse `npx` when the current working tree has the same package name but no local `.bin` entry.

### v0.3.0 post-publish smoke evidence

Recorded on 2026-05-01 after the provenance-backed public npm publish:

- Live publish workflow succeeded in GitHub Actions run `25197337957`.
- `npm view lbuild-impl version` returned `0.3.0`, and `npm view lbuild-impl dist-tags --json` returned `latest: "0.3.0"`.
- `npx --yes lbuild-impl@0.3.0 --version`, `--help`, `skill ls-impl`, and `skill ls-impl onboarding/01-orientation.md 1` worked from a neutral temp directory.
- `npx --yes lbuild-impl@0.3.0 inspect --spec-pack-root ./fixture --json` returned a successful `inspect` envelope against a minimal git-backed fixture.
- The `inspect` envelope's persisted artifact path existed on disk.
- `npm install -g lbuild-impl@0.3.0` installed a working global `lbuild-impl` binary.
- Global `--version`, `--help`, `skill ls-impl`, `inspect --json`, and artifact existence checks passed.
- A fresh temp SDK import confirmed `version === "0.3.0"`, SDK `inspect()` returned a ready envelope, and SDK `loadSkill()` / `readSkillChunk()` returned the CLI-delivered skill content.

### v0.2.3 post-publish smoke evidence

Recorded on 2026-04-30 after the provenance-backed public npm publish:

- Live publish workflow succeeded in GitHub Actions run `25170738326`.
- `npm view lbuild-impl version` returned `0.2.3`, and `npm view lbuild-impl dist-tags --json` returned `latest: "0.2.3"`.
- The publish log confirmed npm signed the provenance statement and published it to the Sigstore transparency log.
- `npx --yes lbuild-impl@0.2.3 --version`, `--help`, and the no-args help screen worked from a neutral temp directory.
- `npx --yes lbuild-impl@0.2.3 inspect --spec-pack-root ./fixture --json` returned a successful `inspect` envelope against a minimal git-backed fixture.
- The `inspect` envelope's persisted artifact path existed on disk.
- `npm install -g lbuild-impl@0.2.3` installed a working global `lbuild-impl` binary.
- Global `--version`, `--help`, no-args help, `inspect --json`, artifact existence, and unknown-flag rejection checks passed.
- A fresh temp SDK import confirmed `version === "0.2.3"` and SDK `inspect()` returned a ready envelope from `lbuild-impl/sdk`.

### v0.2.0 post-publish smoke evidence

Recorded on 2026-04-29 after the public npm publish:

- Live publish workflow succeeded in GitHub Actions run `25139094562`.
- `npm view lbuild-impl@0.2.0` showed `0.2.0` as the current published package.
- `npx --yes lbuild-impl@0.2.0 --version` and `--help` worked from a neutral temp directory.
- `npx --yes lbuild-impl@0.2.0 inspect --spec-pack-root ./fixture --json` returned a successful `inspect` envelope against a minimal git-backed fixture.
- The `inspect` envelope's persisted artifact path existed on disk.
- `npm install -g lbuild-impl@0.2.0` installed a working global `lbuild-impl` binary.
- Global `--version`, `--help`, `inspect --json`, artifact existence, and unknown-flag rejection checks passed.
- A fresh temp SDK import confirmed `version === "0.2.0"` and `inspect` is exported as a function from `lbuild-impl/sdk`.

### v0.1.0 historical smoke evidence

Recorded on 2026-04-29 after the first public npm publish:

- `npm view lbuild-impl version dist-tags --json` returned `version: "0.1.0"` and `latest: "0.1.0"`.
- `npx --yes lbuild-impl@0.1.0 inspect --spec-pack-root ./fixture --json` was run in a fresh temp directory against a minimal fixture pack initialized as a git repository.
- Result: exit code 0; envelope `command: "inspect"`, `version: 1`, `status: "ok"`, `outcome: "ready"`; the envelope included a persisted `result-envelope` artifact path under the temp fixture.
- A prior smoke attempt without `git init` returned a blocked envelope because the spec-pack root was not inside a git repo; the successful smoke above used the expected fixture setup.
