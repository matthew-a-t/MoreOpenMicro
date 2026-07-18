# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Fork of [stephenleo/OpenMicro](https://github.com/stephenleo/OpenMicro) (this fork: [matthew-a-t/MoreOpenMicro](https://github.com/matthew-a-t/MoreOpenMicro)) — an open-source replica of Work Louder's Codex Micro that uses a consumer gamepad as a physical controller for AI agent CLIs (Claude Code, Codex CLI). This fork exists to update, tailor, and opinionate OpenMicro for personal + company use at **outputease**. Upstream conventions still apply unless overridden here.

Fork direction (differs from upstream):

- **Platforms: Windows and Linux.** Upstream is macOS-first; outputease runs Windows and Linux, so macOS-only paths are candidates for porting or clean degradation. Known macOS-only pieces: the `codex-app` harness (drives the Codex desktop app via `osascript`/`codex://` deep links), the spawn-helper chmod in `scripts/postinstall.mjs` (POSIX-only by design — explicit win32 no-op), and the `ioreg` troubleshooting tip in the README. CI runs the verify gate on ubuntu, macos, and windows.
- **Primary controller: 8BitDo Ultimate 2 Wireless for PC** — supported via the `8bitdo` driver (`2dc8:6012`, fixture `2dc8-6012-usb.json`), DInput mode only. On Windows, XInput mode (`2dc8:310b`) is an unreadable HID stub (`&IG_` path — xusb22.sys never services HID input reports), so `createDriver` skips `&IG_` stubs rather than claim a silently dead pad, and `openmicro doctor` prints the mode hint: hold B while powering on; the mode resets on every power-off. Input-only like every non-DualSense pad. The home button emits nothing in DInput mode (dongle-consumed), so `touchpad` has no source on this pad — the L4/R4 back paddles DO emit distinct codes (byte 8 `0x20`/`0x04`), are first-class `ButtonId`s (`l4`/`r4`), and `r4` ships bound to the session-focus cycle to cover the missing `touchpad`.

TypeScript, ESM, Node >= 22 (native deps: `node-hid`, `node-pty`). Runtime deps are exactly four packages (`dualsense-ts`, `node-hid`, `node-pty`, `zod`) — no new dependencies without discussion.

## Commands

```sh
npm run dev            # run from source: tsx src/cli.ts [claude|codex|codex-app] [...agent args]
npm run build          # tsc -p tsconfig.build.json → dist/
npm test               # vitest run (all tests)
npx vitest run test/router.test.ts    # single test file
npx vitest run -t "name"              # single test by name
npm run verify         # typecheck + lint + format:check + test — the CI gate, must be green before pushing
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run format         # prettier --write .
npm run gen:controllers  # regenerate CONTROLLERS.md from test/fixtures/controllers/
```

`openmicro doctor` (or `npm run dev -- doctor`) is the standalone hardware diagnostic; it writes `<vid>-<pid>-<transport>.json` reports that go unedited into `test/fixtures/controllers/` and are replayed by CI as driver regression tests.

## Architecture

`openmicro [claude|codex] [...args]` wraps an agent CLI in a pty and drives it with a game controller. Everything hangs off two pipelines plus a host/client topology:

**Host/client singleton.** The first instance to bind port 48762 (`src/ports.ts` — all port/path constants live there) becomes the HOST: it owns the controller (`src/controller/hid-manager.ts`), aggregates agent state across sessions, and forwards keystrokes to whichever session has focus. Later instances run as CLIENTS (`src/client.ts`): they register with the host and receive forwarded keystrokes over SSE. Agent lifecycle hooks POST to `http://127.0.0.1:48762/om-hook/<event>`; `src/server.ts` (HostServer) trusts only hooks carrying the `x-openmicro-instance-id` header exported into the wrapped agent's env.

**Input pipeline (controller → agent).** HID drivers (`src/controller/*-driver.ts`, pure parse functions behind the `ControllerHAL` interface in `hal.ts`) emit logical `ControllerEvent`s → `LayerRouter` (`src/router.ts`) maps event + current layer to an `Action` (also detects stick flick/rotation gestures; L1 is a fixed layer-switch modifier; every layer switch opens a 750 ms guard window that swallows in-flight presses) → `dispatchAction` (`src/dispatch.ts`, pure, effects injected via `DispatchDeps`) → the harness's `resolveAction` turns the Action into pty bytes → written to the focused session's pty. Only d-pad arrows auto-repeat while held (`KeyRepeater` in `src/keymap.ts`).

**State pipeline (agent → feedback).** Hook POSTs are classified into an `AgentState` by the owning harness's `stateForHookEvent`, fed into the per-session FSM in `src/state.ts` (SessionTracker; `complete` decays to `idle` after 8 s), and the aggregate drives focus stealing and DualSense feedback (`src/feedback.ts`: lightbar = focused session state color, player LEDs = occupied slots).

**The harness contract (`src/harness/types.ts`) is the only place agent-specific knowledge lives.** Core modules never import the `'claude'`/`'codex'` literals. A new harness is one file implementing `Harness` plus a registry entry in `src/harness/index.ts` — the core never changes. `resolveAction` returning `null` means the harness has no verified equivalent; that is a documented gap, never faked with guessed keystrokes. Every binding must be verified against the real CLI. GUI harnesses (`usesPty: false`, e.g. `codex-app`) drive a desktop app instead: resolved bytes go to `harness.execute()` rather than a pty.

**Herdr integration (`src/herdr.ts`)** is best-effort and a no-op outside herdr: sessions report state to herdr panes, L2 cycles workspaces, touchpad cycles a space's agents, and a 1 s focus poll follows mouse-driven pane changes. The "foreign pane" guard drops input when herdr focus sits on a pane hosting no openmicro session.

**Config** lives at `~/.openmicro/config.json` (zod-validated in `src/layers.ts`): six layers of bindings, layer colors, workflow prompt texts. Invalid config stops startup without overwriting the file.

## Non-obvious constraints

- **Vibesense coexistence:** vibesense's hook installer purges any hook command containing the bare substring `/hook/`. OpenMicro therefore posts to `/om-hook/` and identifies its own entries by the full marker `127.0.0.1:48762/om-hook/`. Never rename the hook path to anything containing `/hook/`.
- Hook installation (`src/hooks-install.ts`) is idempotent merge/purge with atomic writes into `~/.claude/settings.json` and `~/.codex/hooks.json`; the hook command is a curl that no-ops when openmicro isn't running, so hooks never need uninstalling.
- New controller drivers are pure parse functions + a captured fixture — study `xbox-driver.ts` and its tests for the pattern. Hardware-behavior changes (lightbar, gestures, HID) should state in the PR what was verified on a physical pad vs. only in tests.
- Harness PRs need pure `stateForHookEvent`/`resolveAction` unit tests and must note which actions return `null`.
- ESM throughout: relative imports use `.js` suffixes even in `.ts` source.

## Releases

- **Release inside the parent PR** (this fork's convention, also documented in CONTRIBUTING.md): when a fix/feature PR is going to ship as a release, push the version bump (`npm version X.Y.Z --no-git-tag-version`) and CHANGELOG entry as a commit on that same PR — do not open a separate release PR. After the parent PR merges, tag `vX.Y.Z` on main and push the tag; the release workflow (`publish.yml`) runs verify and creates the GitHub Release from the CHANGELOG section. **No npm publish** — the `openmicro` npm name and its trusted-publishing binding belong to upstream; installs come from git/source.
- The CHANGELOG entry moves the `Unreleased` section under a new `[X.Y.Z] - YYYY-MM-DD` heading — the workflow uses that section as the GitHub release notes.
- Verification gate before any release commit: `npm run verify` (typecheck + lint + format:check + test).
