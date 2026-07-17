# Contributing to MoreOpenMicro

This is [outputease's](https://github.com/matthew-a-t/MoreOpenMicro) fork of [OpenMicro](https://github.com/stephenleo/OpenMicro), the open Codex Micro replica. The fork tailors OpenMicro for outputease's environment: **Windows and Linux as the primary platforms** (upstream is macOS-first) and the **8BitDo Pro 2 Ultimate** as the primary controller. Contributions that push in either of those directions are especially welcome. There are three ways in, from zero-code to core.

## 1. Test your controller (no code required)

The most valuable contribution: run the hardware diagnostic and submit the result.

```bash
npm i -g openmicro
openmicro doctor
```

It writes a report named by your controller's identity (e.g. `054c-0ce6-usb.json`). Open a PR adding that file to `test/fixtures/controllers/` — unedited — then run `npm run gen:controllers` so the README table includes your pad. CI replays your captured button presses through the parsers on every future build.

- If a fixture with the same filename already exists, your controller is already covered: your PR shows as an update to it. Newer full-pass reports are accepted; otherwise we'll close with thanks.
- If no driver recognized your pad, the doctor's capture-only output is exactly what a new driver needs — submit it anyway and note the model. This is the current state of the 8BitDo Pro 2 Ultimate: it has no dedicated driver or fixture yet, so doctor reports for it (in any of its mode-switch positions — different modes present as different devices) are the highest-value controller contribution to this fork.
- Reports from Windows and Linux matter here even where upstream only tested macOS — note your OS alongside the report.
- Prefer not to PR? Paste the JSON into the [controller report issue](../../issues/new?template=controller-report.yml).

The full driver-authoring playbook (capture, decode, certify) lives in [CONTROLLERS.md](CONTROLLERS.md).

## 2. Add a harness (one file)

OpenMicro drives any agent CLI through the `Harness` interface — see "Add another harness" in the README. A new harness is one file implementing `Harness` plus a registry entry; the core never needs to change. PRs should include the harness's `stateForHookEvent`/`resolveAction` unit tests (pure, no I/O) and note which actions return `null` (unsupported is fine — faked keybindings are not: verify every binding against the real CLI and cite the doc or help output).

Note for this fork: GUI harnesses that shell out to macOS-only tooling (like `codex-app`'s `osascript`) should either gain a Windows/Linux path or degrade cleanly on those platforms.

## 3. Core changes

```bash
git clone https://github.com/matthew-a-t/MoreOpenMicro && cd MoreOpenMicro
npm install        # Node >= 22; native deps: node-hid, node-pty
# Windows: prebuilt binaries cover both node-hid and node-pty — no Visual Studio Build Tools needed
npm run verify     # typecheck + lint + format:check + tests — must be green
```

- Branch from `main`, keep PRs small and focused, and make `npm run verify` pass before pushing — CI runs the same gate on ubuntu, macos, and windows.
- Windows/Linux portability fixes are in scope even when they touch upstream-"stable" code: macOS-only assumptions (POSIX-only npm scripts, `osascript`, macOS HID quirks) are bugs from this fork's perspective, not conventions to preserve.
- New controller drivers are pure parse functions (`src/controller/*-driver.ts`) + a fixture; study `xbox-driver.ts` and its tests for the pattern.
- Hardware-behavior changes (lightbar, gestures, HID) should say in the PR what was verified on a physical pad vs. only in tests, and on which OS.
- No new dependencies without discussion — the runtime dep list is four packages and we like it that way.

## Releases (maintainers)

Releases ride the parent PR — no separate release PR:

1. On the fix/feature PR that will ship, push the version bump (`npm version X.Y.Z --no-git-tag-version`) and the CHANGELOG entry as a commit on that same PR. The CHANGELOG commit moves the `Unreleased` section under a new `[X.Y.Z] - YYYY-MM-DD` heading — the publish workflow uses that section as the GitHub release notes.
2. Run the verification gate before the release commit: `npm run verify`.
3. After the PR merges, tag `vX.Y.Z` on `main` and push the tag; the publish workflow handles npm publishing and the GitHub release.

## License

MIT. By contributing you agree your contributions are licensed under it.
