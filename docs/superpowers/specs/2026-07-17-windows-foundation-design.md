# Windows Foundation — Design

**Date:** 2026-07-17
**Status:** Approved
**Milestone:** First milestone of the MoreOpenMicro fork. Prove the repo builds, tests, and runs on Windows, and add Windows to CI.

## Goal

MoreOpenMicro targets Windows and Linux as primary platforms (upstream OpenMicro is macOS-first). Nothing else in the fork's direction — the 8BitDo Pro 2 Ultimate driver in particular — can be verified until the toolchain and runtime work on Windows. This milestone establishes that foundation.

## Scope

**In scope:**

- `npm install` succeeds on Windows (native deps: `node-hid`, `node-pty`).
- `npm run verify` (typecheck + lint + format:check + test) green locally on Windows.
- Runtime smoke test of the agent-side pipeline on Windows (see "Done means").
- `windows-latest` added to the CI matrix in `.github/workflows/ci.yml`, green alongside ubuntu and macos.
- CLAUDE.md updated to drop the "no Windows job yet" caveat once the job lands.

**Out of scope:**

- 8BitDo Pro 2 Ultimate driver or fixture (next milestone; standard flow via `openmicro doctor` → capture → parser → fixture).
- Porting the `codex-app` GUI harness to Windows. Clean degradation only, and only if the smoke test reveals a crash on non-macOS.
- Hands-on Linux verification (the existing ubuntu CI job covers Linux at the build/test level).
- Controller-input testing on a physical pad (no supported pad in scope for this milestone).
- Upstream sync strategy, releases, npm publishing setup.

## Approach

Local-first incremental (chosen over CI-first and audit-first): fix from real failures on the local Windows box, where the feedback loop is fast, and add the CI job last so it lands nearly green. A light read-only audit for POSIX assumptions (paths, `/tmp`, `HOME` vs `USERPROFILE`, chmod, signals, `osascript`) is reconnaissance only — actual failures drive fixes, not the audit.

## Workflow

1. Commit the pending CLAUDE.md + CONTRIBUTING.md fork-direction edits as a standalone docs commit first (unrelated to code work).
2. Branch `feat/windows-foundation` from `main`; all milestone work rides that branch; PR to fork `main`.
3. No version bump / release on this PR — infra milestone, and the fork's npm trusted publishing is not yet configured.
4. `npm run verify` green before every push, per repo convention.

## Execution steps

1. **Install.** `npm install` on Node v22.21.1. Expect prebuilt binaries for `node-hid` and `node-pty`; if a source build triggers, Visual Studio Build Tools are required — either way, document the Windows setup reality in CONTRIBUTING.md.
2. **Verify.** `npm run verify`. Anticipated Windows breakage classes: path-separator assumptions in tests, CRLF vs. prettier/eslint expectations, `/tmp` usage, `HOME` vs `USERPROFILE` for `~/.openmicro` and `~/.claude` paths. Fixes are minimal, driven only by observed failures, with tests where feasible.
3. **Runtime smoke.**
   - `npm run dev -- doctor` with no controller attached must degrade sanely (report "no devices", not crash).
   - `npm run dev -- claude` wrapping the real Claude Code CLI: host binds port 48762, hooks merge idempotently into `~/.claude/settings.json`, hook POSTs arrive at `/om-hook/<event>` and drive the session FSM. Note: this touches the real settings file on this box; the hook command is a curl that no-ops when openmicro isn't running, so risk is low. Suspect areas: ConPTY behavior through `node-pty`, and quoting of the curl hook command on Windows.
   - If the agent-side flow is hard to observe end-to-end, a hook POST can be simulated with curl to verify the server → FSM path in isolation.
4. **CI.** Add `windows-latest` to the matrix; push; confirm all three OS jobs green.
5. **Docs.** Update the CLAUDE.md CI caveat; fold any setup findings into CONTRIBUTING.md.

## Bug handling

Every failure gets classified before fixing:

- **Environment/setup issue** → document in CONTRIBUTING.md, don't patch code.
- **Product bug** → root-cause with the systematic-debugging skill, minimal fix in `src/`, regression test where feasible.
- **macOS-only behavior** → clean degradation on Windows/Linux with the gap documented; never faked with guessed equivalents (mirrors the `resolveAction` null convention).

## Done means

- `npm run verify` green locally on Windows.
- CI green on ubuntu, macos, and windows.
- Smoke checklist recorded with observed output in the PR description: doctor degrades sanely, host binds 48762, hook POST round-trip classified into agent state.
- CLAUDE.md and CONTRIBUTING.md reflect the post-milestone reality.
