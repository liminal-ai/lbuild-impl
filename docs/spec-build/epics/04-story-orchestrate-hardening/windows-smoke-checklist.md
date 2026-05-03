# Windows Smoke Checklist

Use this checklist when closing Epic 04 / Story 8 in a Windows environment such as Parallels. This is maintainer-run evidence, not a default CI gate.

## Environment record

- Date:
- Maintainer:
- Windows version:
- Shell:
- Node version:
- `lbuild-impl` version:
- Provider CLIs available:

## Checklist

1. Install dependencies and build the local CLI.
   - Run `npm install`
   - Run `npm run build`
   - Record pass/fail plus any install or path issues.
2. Confirm root help works.
   - Run `node dist/bin/lbuild-impl.js --help`
   - Record whether help renders normally.
3. Confirm package version output is `0.4.0`.
   - Run `node dist/bin/lbuild-impl.js --version`
   - Record the exact version string.
4. Run `preflight` against a fixture or real spec pack.
   - Record the spec-pack path and outcome.
5. Validate provider shim lookup.
   - Run the relevant provider `--version` checks from the same shell.
   - Record whether `.cmd` / `.bat` shim installs were found through `PATH` and `PATHEXT`.
6. Validate one provider-backed operation if credentials are available.
   - Prefer `story-implement`, `quick-fix`, or `story-orchestrate run` against a safe fixture.
   - Record provider, command, and outcome.
7. Confirm `story-orchestrate` help and status surfaces.
   - Run `node dist/bin/lbuild-impl.js story-orchestrate --help`
   - If feasible, run `story-orchestrate status` against the same fixture pack.
8. Record Codex sandbox policy if Codex was used.
   - Note the `LBUILD_IMPL_CODEX_SANDBOX_MODE` and `LBUILD_IMPL_CODEX_APPROVAL_POLICY` values used for the run.
9. Record final result in the implementation log or release closeout artifact.
   - Include pass/fail, blockers, environment details, and whether Parallels validation covered provider-backed execution.

## Result summary

- Outcome:
- Blockers:
- Follow-up required:
- Recorded in implementation log:
