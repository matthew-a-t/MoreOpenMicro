# outputease opinionation

This fork is tailored to how [outputease](https://outputease.com) runs agent
sessions. Nothing here changes core behavior — it documents the conventions the
fork is opinionated toward, so bindings and defaults can lean on them.

## Toolkit and session workflow

outputease projects are scaffolded with
[`@outputease/toolkit`](https://www.npmjs.com/package/@outputease/toolkit)
(MIT, npm), which ships a session-workflow skill set for agent CLIs. The four
rituals that matter to controller bindings:

| Skill          | Purpose                                      |
| -------------- | -------------------------------------------- |
| `/quickstart`  | Initialize the session                       |
| `/dev-check`   | Build/lint/test validation before committing |
| `/checkpoint`  | WIP commit (no push), every 15–30 minutes    |
| `/session-end` | Close the session — commits **and pushes**   |

Skill injection from a controller is plain prompt text plus Enter — the same
mechanism the `new_chat` action uses for `/clear`.

## Codex hooks on Windows

Verified live against codex-cli 0.144.4 (2026-07-17):

- Codex's hook engine is gated behind the `plugin_hooks` feature. Without
  `plugin_hooks = true` under `[features]` in `~/.codex/config.toml` (or a
  per-run `--enable plugin_hooks`), hooks.json is loaded but nothing executes —
  no error, no warning. `hooks = true` is a different feature and does not
  enable it.
- The Windows hook runner executes no shell syntax at all: bash- and
  cmd-flavored command strings both report `Failed`, while a
  `powershell -File` command (herdr's pattern) completes. OpenMicro therefore
  installs `openmicro-hook.ps1` next to hooks.json and points a
  `commandWindows` override at it on every Codex hook entry. Inside the
  wrapper, the body must travel via stdin with BOM-less UTF-8 — PowerShell's
  native-argument passing strips JSON quotes, and `[Text.Encoding]::UTF8`
  prepends BOMs that `JSON.parse` rejects.
- Codex hook trust is definition-hash based: any change to hooks.json (including
  OpenMicro adding `commandWindows`) invalidates trust until the hooks are
  re-approved via `/hooks` inside interactive Codex. Untrusted hooks are
  skipped silently.
- `codex exec` hangs at ~0 CPU when stdin is an open pipe — close it
  (`< NUL` via cmd) when scripting headless runs.

## Recommended stick semantics

The recommended layer-1 stick layout separates conversation from lifecycle:

- **Left stick — steering (universal, any repo).** Flicks: up `what's next?`,
  right `continue`, down `approved` (affirmative reply to an agent request),
  left `eli5`. Rotation: thinking depth up/down.
- **Right stick — session lifecycle (clockwise chronology).** Flicks: left
  `/quickstart` (begin), up `/dev-check` (validate), right `/checkpoint`
  (save), down `/session-end` (close). Rotation: deliberately unbound.

Rationale: the gesture detector suppresses flicks once a rotation passes 45°,
but a rotation aborted within the 250 ms flick window can still fire a spurious
flick. Keeping rotation on the steering stick means a misfire sends a harmless
prompt; the ops stick — where `/session-end` pushes — never sees a rotation
attempt. Workflow prompts auto-submit, so every ops flick is a committed
action.

## Verified Claude Code key map

Verified live against Claude Code **2.1.212** on Windows 11 (2026-07-17).
Shortcut meanings drift between releases — re-verify on version bumps before
trusting a binding.

| Keys      | Bytes      | Claude Code 2.1.x behavior                                 |
| --------- | ---------- | ---------------------------------------------------------- |
| Enter     | `\r`       | Submit prompt / accept highlighted dialog option           |
| Esc       | `\x1b`     | Interrupt / close dialog                                   |
| Esc Esc   | `\x1b\x1b` | Rewind conversation                                        |
| Ctrl+O    | `\x0f`     | Transcript viewer (was Ctrl+R in older releases)           |
| Ctrl+R    | `\x12`     | Prompt history search (arrow keys navigate, Enter accepts) |
| Ctrl+T    | `\x14`     | Todo list toggle                                           |
| Ctrl+B    | `\x02`     | Background the running task (no-op when idle)              |
| Ctrl+U    | `\x15`     | Clear the input line                                       |
| Shift+Tab | `\x1b[Z`   | Cycle permission/plan modes                                |
| Tab       | `\t`       | Accept prompt suggestion — **not** a thinking toggle       |
| Alt+T     | `\x1bt`    | Extended-thinking toggle (Alt encodes as ESC-prefix)       |
| Space     | `\x20`     | Hold-to-dictate (requires voice dictation enabled)         |
