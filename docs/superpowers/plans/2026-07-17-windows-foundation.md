# Windows Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MoreOpenMicro build, test, and run on Windows, and add `windows-latest` to CI.

**Architecture:** Local-first incremental port. Known Windows breaks (POSIX-only postinstall, CRLF vs prettier, `HOME` vs `USERPROFILE` in tests, exec-bit assertions) get targeted fixes with tests; runtime smoke (`doctor`, wrapped `claude`, hook round-trip) surfaces the unknowns; the CI job lands last, when local is already green. Spec: `docs/superpowers/specs/2026-07-17-windows-foundation-design.md`.

**Tech Stack:** TypeScript ESM, Node >= 22, vitest, node-hid + node-pty (native), prettier/eslint, GitHub Actions.

## Global Constraints

- Node >= 22 (`engines` in package.json). Local box: v22.21.1, npm 10.9.4.
- Runtime deps are exactly `dualsense-ts`, `node-hid`, `node-pty`, `zod` — add nothing.
- The hook path is `/om-hook/` and its marker `127.0.0.1:48762/om-hook/`. Never introduce a hook command whose path contains the bare substring `/hook/` (vibesense's installer purges those entries).
- ESM throughout: relative imports use `.js` suffixes even in `.ts` source.
- Code style: prettier `.prettierrc` = no semicolons, single quotes, printWidth 100, trailing commas. Match it.
- Conventional commit subjects (`fix:`, `feat:`, `docs:`, `ci:`, `test:`) as in `git log`.
- `npm run verify` (typecheck + lint + format:check + test) must be green before every push.
- No version bump / release on this PR.
- macOS-only behavior is never faked on Windows — clean degradation with the gap documented.
- Shell for all commands below is PowerShell 7 on the local Windows box unless a step says otherwise.

---

### Task 1: Commit pending fork docs and branch

The working tree has uncommitted fork-direction rewrites of `CLAUDE.md` and `CONTRIBUTING.md` (reviewed, wanted). Land them on `main` as a standalone docs commit, then branch for the milestone.

**Files:**

- Commit as-is: `CLAUDE.md`, `CONTRIBUTING.md`

- [ ] **Step 1: Confirm only the two doc files are dirty**

Run: `git status --short`
Expected: exactly `M CLAUDE.md` and `M CONTRIBUTING.md` (spec/plan files under `docs/superpowers/` are already committed). Anything else dirty: stop and ask.

- [ ] **Step 2: Commit on main**

```powershell
git add CLAUDE.md CONTRIBUTING.md
git commit -m @'
docs: reorient CLAUDE.md and CONTRIBUTING.md around the fork direction

Windows/Linux as primary platforms, 8BitDo Pro 2 Ultimate as primary
controller, release-inside-parent-PR convention.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

- [ ] **Step 3: Create the milestone branch**

Run: `git switch -c feat/windows-foundation`
Expected: `Switched to a new branch 'feat/windows-foundation'`

---

### Task 2: Cross-platform postinstall, `npm install` green

`package.json` line 39 runs `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper ../node-pty/prebuilds/*/spawn-helper 2>/dev/null || true`. npm executes scripts through cmd.exe on Windows: `chmod` and `true` don't exist and `/dev/null` isn't a path, so install is expected to fail. Replace the shell one-liner with a Node script that keeps the exact same semantics (both hoisting locations, silent best-effort) and no-ops on Windows. Runtime hoisting cases stay covered by `fixSpawnHelperPermissions` in `src/pty.ts:16`.

**Files:**

- Create: `scripts/postinstall.mjs`
- Modify: `package.json:39`

**Interfaces:**

- Produces: `npm install` succeeds on win32/darwin/linux; `scripts/postinstall.mjs` runs standalone via `node scripts/postinstall.mjs`, always exits 0.

- [ ] **Step 1: Observe the current failure (evidence first)**

Run: `npm install`
Expected: failure in the `postinstall` phase (cmd.exe error about `chmod`/path not found). Record the exact error for the PR. If it unexpectedly succeeds, continue anyway — `|| true` has no cmd.exe meaning, so the script is broken-by-luck and still gets replaced.

- [ ] **Step 2: Write the postinstall script**

Create `scripts/postinstall.mjs`:

```js
// Restore the exec bit on node-pty's spawn-helper: the npm tarball ships it
// without one. Checks both hoisting locations the old shell one-liner covered.
// Windows has no exec bit and its node-pty prebuilds have no spawn-helper, so
// this is a deliberate no-op there. Runtime installs npm hoists differently
// are covered by fixSpawnHelperPermissions in src/pty.ts.
import fs from 'node:fs'
import path from 'node:path'

if (process.platform !== 'win32') {
  for (const prebuilds of ['node_modules/node-pty/prebuilds', '../node-pty/prebuilds']) {
    let entries = []
    try {
      entries = fs.readdirSync(prebuilds)
    } catch {
      continue // this hoisting location doesn't exist here
    }
    for (const entry of entries) {
      try {
        fs.chmodSync(path.join(prebuilds, entry, 'spawn-helper'), 0o755)
      } catch {
        // no spawn-helper in this arch dir, or read-only install — best effort
      }
    }
  }
}
```

- [ ] **Step 3: Point package.json at it**

In `package.json`, replace line 39:

```json
"postinstall": "node scripts/postinstall.mjs",
```

- [ ] **Step 4: Verify install goes green**

Run: `npm install`
Expected: completes without error, `node_modules` present. Then `node scripts/postinstall.mjs; $LASTEXITCODE` → prints `0`.

- [ ] **Step 5: Commit**

```powershell
git add scripts/postinstall.mjs package.json package-lock.json
git commit -m @'
fix(install): cross-platform postinstall — cmd.exe can't run the chmod one-liner

npm runs lifecycle scripts through cmd.exe on Windows, where chmod, true,
and /dev/null don't exist, so npm install failed at postinstall. A Node
script keeps the same best-effort chmod on POSIX and no-ops on win32.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: Line-ending normalization (.gitattributes)

No `.gitattributes`; the local box has `core.autocrlf=true`, so tracked files materialize with CRLF (`git ls-files --eol` already shows `w/crlf` for package.json). Prettier's default `endOfLine: "lf"` makes `format:check` fail on CRLF working files — locally and on any `windows-latest` runner. Pin LF via attributes so checkouts are deterministic on every OS.

**Files:**

- Create: `.gitattributes`

- [ ] **Step 1: Observe the failure**

Run: `npx prettier --check .`
Expected: failures citing line endings (`Delete ␍` class). Record which files. If clean, still add `.gitattributes` — CI's checkout config differs from local and only the attribute pins it.

- [ ] **Step 2: Add .gitattributes**

Create `.gitattributes`:

```
* text=auto eol=lf
```

(`eol=lf` applies only to files git detects as text; binaries like the `.node` prebuilds in node_modules aren't tracked, and tracked fixtures are JSON.)

- [ ] **Step 3: Renormalize the index**

```powershell
git add .gitattributes
git add --renormalize .
git status --short
```

Expected: `.gitattributes` new; renormalize stages any file whose committed blob had CRLF (may be none — upstream committed LF).

- [ ] **Step 4: Rewrite the working tree with LF**

Working-tree files keep CRLF until re-checked-out. Tree must be clean apart from staged changes from Step 3 — commit them first:

```powershell
git commit -m @'
chore: pin LF line endings via .gitattributes

core.autocrlf=true checkouts produced CRLF working files, which fails
prettier --check (default endOfLine lf) on Windows boxes and runners.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
git rm -rq --cached .
git reset --hard HEAD
```

Expected: `git status` clean afterward; `git ls-files --eol package.json` now shows `w/lf`.

- [ ] **Step 5: Verify prettier is satisfied**

Run: `npx prettier --check .`
Expected: `All matched files use Prettier code style!` If real (non-EOL) formatting drift appears, run `npm run format`, inspect the diff, and commit it separately as `style: prettier`.

---

### Task 4: layers.test home-dir override works on Windows

`test/layers.test.ts:37` sets `process.env.HOME` and expects `os.homedir()` to follow. Node's `os.homedir()` reads `USERPROFILE` on Windows, `HOME` on POSIX — the test fails on Windows. Set and restore both variables. (Also fixes a latent restore bug: the current `afterEach` never deletes `HOME` when it started undefined.)

**Files:**

- Modify: `test/layers.test.ts:10-21,37-42`

- [ ] **Step 1: Run the failing test**

Run: `npx vitest run test/layers.test.ts -t "respecting a HOME override"`
Expected: FAIL on Windows — config lands under the real profile dir, `fs.existsSync(path.join(dir, '.openmicro', 'config.json'))` is false.

- [ ] **Step 2: Fix the env handling**

In `test/layers.test.ts`, replace lines 10-21:

```ts
let realHome: string | undefined
let realUserProfile: string | undefined

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmicro-config-'))
  configPath = path.join(dir, 'config.json')
  realHome = process.env.HOME
  realUserProfile = process.env.USERPROFILE
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  if (realHome !== undefined) process.env.HOME = realHome
  else delete process.env.HOME
  if (realUserProfile !== undefined) process.env.USERPROFILE = realUserProfile
  else delete process.env.USERPROFILE
})
```

And in the test at line 37, replace the single `process.env.HOME = dir` line:

```ts
it('defaults to ~/.openmicro/config.json, respecting a home-dir override', () => {
  process.env.HOME = dir // os.homedir() source on POSIX
  process.env.USERPROFILE = dir // os.homedir() source on Windows
  const config = loadConfig()
  expect(config).toEqual(DEFAULT_CONFIG)
  expect(fs.existsSync(path.join(dir, '.openmicro', 'config.json'))).toBe(true)
})
```

- [ ] **Step 3: Verify pass**

Run: `npx vitest run test/layers.test.ts`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```powershell
git add test/layers.test.ts
git commit -m @'
test(layers): home-dir override works on Windows

os.homedir() reads USERPROFILE on win32, not HOME. Set and restore both
in the override test; also restore-to-unset correctly.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: pty exec-bit handling on Windows

`test/pty.test.ts:27-53` asserts chmod puts exec bits (`mode & 0o111`) on `spawn-helper`. Windows has no exec bits (libuv derives `X` from file extension), so these assertions fail there. spawn-helper itself is a POSIX-only artifact — Windows node-pty prebuilds ship ConPTY binaries with no spawn-helper at all. Correct behavior: the fixer is meaningless on win32 → explicit early return in src, skip the exec-bit describe block on win32.

**Files:**

- Modify: `src/pty.ts:16-17`
- Modify: `test/pty.test.ts:27`

- [ ] **Step 1: Run the failing tests**

Run: `npx vitest run test/pty.test.ts`
Expected: the two exec-bit tests FAIL on Windows (`expect(mode & EXEC_BITS).not.toBe(0)` gets 0); the `spawnAgentProcess` describe passes.

- [ ] **Step 2: Guard the fixer**

In `src/pty.ts`, at the top of `fixSpawnHelperPermissions` (line 17, before the `try`):

```ts
export function fixSpawnHelperPermissions(prebuildsDir?: string): void {
  // Windows: no exec bits, and node-pty's win32 prebuilds (ConPTY) ship no
  // spawn-helper — nothing to fix.
  if (process.platform === 'win32') return
```

- [ ] **Step 3: Skip the exec-bit suite on win32**

In `test/pty.test.ts` line 27, change the describe:

```ts
describe.skipIf(process.platform === 'win32')('fixSpawnHelperPermissions', () => {
```

(The suite exercises POSIX exec-bit behavior; with the Step 2 guard the function is an intentional no-op on win32, so there is nothing to assert there.)

- [ ] **Step 4: Verify**

Run: `npx vitest run test/pty.test.ts`
Expected: `spawnAgentProcess` tests PASS, `fixSpawnHelperPermissions` suite reported skipped (on this box).

- [ ] **Step 5: Commit**

```powershell
git add src/pty.ts test/pty.test.ts
git commit -m @'
fix(pty): spawn-helper exec-bit fixer is a no-op on Windows

Windows has no exec bits and node-pty's win32 (ConPTY) prebuilds ship no
spawn-helper. Early-return in the fixer; skip the POSIX exec-bit suite
on win32.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: Full verify green locally

**Files:**

- Modify: whatever residual failures implicate (contingency — see triage rules)

- [ ] **Step 1: Run the gate**

Run: `npm run verify`
Expected: typecheck, lint, format:check, and all vitest suites green after Tasks 2-5.

- [ ] **Step 2: Triage any residual failure (contingency)**

For each remaining failure, classify per the spec before touching anything:

- **Environment/setup** (missing toolchain, machine config) → document in CONTRIBUTING.md, no code change.
- **Product bug on Windows** → use the superpowers:systematic-debugging skill; minimal fix in `src/` or `test/`; regression test where feasible; own commit with the failure output in the message body.
- **macOS-only behavior** → clean degradation (explicit platform guard + documented gap), never a faked equivalent.

Repeat `npm run verify` until green. If a failure resists root-causing, stop and report rather than patching around it.

- [ ] **Step 3: Confirm and record**

Run: `npm run verify`
Expected: exit 0. Save the tail of the output for the PR body.

---

### Task 7: Runtime smoke — doctor without a controller

**Files:**

- None expected (observation task; failures route through Task 6 Step 2 triage)

- [ ] **Step 1: Run doctor headless**

Run: `npm run dev -- doctor`
Expected: node-hid loads and enumerates (no native-module crash); with no supported pad attached, doctor reports that and exits cleanly rather than crashing. Record the exact output.

- [ ] **Step 2: Record for PR**

Add the observed output to the smoke-checklist notes. Any crash = product bug → Task 6 Step 2 triage flow.

---

### Task 8: Runtime smoke — host server, hook install, hook round-trip

Prove the agent-side pipeline on Windows: host binds 48762, hooks merge into `~/.claude/settings.json`, a hook POST classifies into agent state. Uses headless print-mode Claude so no interactive TTY is needed.

**Files:**

- None expected (observation task)

- [ ] **Step 1: Start a wrapped headless agent**

In a background shell:

Run: `npm run dev -- claude -p "reply with the single word ok"`
Expected: openmicro becomes host (first instance), spawns `claude` under ConPTY via node-pty, prints its output, exits when claude does. No node-pty spawn crash.

- [ ] **Step 2: While it runs — port bind and simulated hook**

From a second shell (quickly, or re-run Step 1 without `-p` to keep it alive):

```powershell
curl.exe -s -o - -w "%{http_code}" -X POST http://127.0.0.1:48762/om-hook/UserPromptSubmit -H "Content-Type: application/json" -d '{\"session_id\":\"smoke-session\",\"cwd\":\"F:/smoke\"}'
```

Expected: HTTP 200 — host is listening and accepts an unowned hook (server ignores unknown instance ids per `src/server.ts`).

- [ ] **Step 3: Hook installation check**

Run: `Get-Content $env:USERPROFILE\.claude\settings.json | Select-String om-hook`
Expected: seven event entries whose commands contain `127.0.0.1:48762/om-hook/`. Vibesense-coexistence marker intact.

- [ ] **Step 4: Did REAL hooks arrive? (the load-bearing observation)**

Check the host log (`Get-ChildItem $env:USERPROFILE\.openmicro` for the log file, then tail it) for hook events received during the Step 1 run (SessionStart/UserPromptSubmit/Stop from the wrapped claude).

- **Hooks arrived** → the POSIX-syntax curl command survives Claude Code's Windows hook shell. Task 9 is NOT needed — skip it and note why in the PR.
- **No hooks arrived** → Claude Code runs hook commands through cmd.exe on Windows, where `$VAR`, `'` quoting, `>/dev/null`, and `|| true` all misbehave. Proceed to Task 9.

Record which branch was taken plus evidence (log lines or their absence).

---

### Task 9: CONDITIONAL — platform-aware hook commands

Only if Task 8 Step 4 showed hooks not arriving. Generate cmd.exe-compatible hook commands on win32; POSIX commands stay byte-identical to today's.

**Files:**

- Modify: `src/hooks-install.ts:91-93,159-161`
- Test: `test/hooks-install.test.ts`

**Interfaces:**

- Consumes: `HOOK_URL` from `src/ports.js`; `installClaudeHooks(settingsPath?)` / `installCodexHooks(hooksPath?)` signatures unchanged.
- Produces: hook command strings in settings files; on win32 they use `%OPENMICRO_INSTANCE_ID%` / `%HERDR_PANE_ID%` / `>NUL 2>&1 & exit /b 0`. Marker `127.0.0.1:48762/om-hook/` present in every variant.

- [ ] **Step 1: Write the failing test**

Add to `test/hooks-install.test.ts` (uses the file's existing tmp-dir pattern; stub `process.platform` and restore):

```ts
describe('windows hook commands', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform)
  })

  it('emits cmd.exe-compatible commands on win32 with the coexistence marker intact', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const target = path.join(dir, 'settings.json')
    expect(installClaudeHooks(target)).toBe('changed')
    const settings = JSON.parse(fs.readFileSync(target, 'utf8'))
    const command = settings.hooks.Stop[0].hooks[0].command as string
    expect(command).toContain('127.0.0.1:48762/om-hook/Stop')
    expect(command).toContain('%OPENMICRO_INSTANCE_ID%')
    expect(command).toContain('>NUL 2>&1')
    expect(command).not.toContain('$OPENMICRO_INSTANCE_ID')
    expect(command).not.toContain('/dev/null')
    expect(command).not.toContain("'")
  })

  it('keeps POSIX commands unchanged on darwin/linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const target = path.join(dir, 'settings.json')
    expect(installClaudeHooks(target)).toBe('changed')
    const settings = JSON.parse(fs.readFileSync(target, 'utf8'))
    const command = settings.hooks.Stop[0].hooks[0].command as string
    expect(command).toContain('"$OPENMICRO_INSTANCE_ID"')
    expect(command).toContain('>/dev/null 2>&1 || true')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/hooks-install.test.ts -t "windows hook commands"`
Expected: FAIL — win32 test finds `$OPENMICRO_INSTANCE_ID` / `/dev/null` in the command.

- [ ] **Step 3: Implement platform split**

In `src/hooks-install.ts`, replace `hookCommand` (lines 91-93):

```ts
function hookCommand(event: string): string {
  // cmd.exe on win32 (Claude Code's Windows hook shell): %VAR% expansion, NUL
  // device, `& exit /b 0` as the always-succeed tail. An unset %VAR% stays a
  // literal `%VAR%` header value — the host ignores instance ids it didn't
  // issue, so that is harmless (server.ts handleHook).
  if (process.platform === 'win32') {
    return `curl -s --max-time 1 -X POST ${HOOK_URL}${event} -H "Content-Type: application/json" -H "${OM_HEADER}: %OPENMICRO_INSTANCE_ID%" -H "${HERDR_HEADER}: %HERDR_PANE_ID%" -d @- >NUL 2>&1 & exit /b 0`
  }
  return `curl -s --max-time 1 -X POST ${HOOK_URL}${event} -H 'Content-Type: application/json' -H "${OM_HEADER}: $OPENMICRO_INSTANCE_ID" -H "${HERDR_HEADER}: $HERDR_PANE_ID" -d @- >/dev/null 2>&1 || true`
}
```

And `codexHookCommand` (lines 159-161) — same split; the Codex hook protocol needs `{}` on stdout:

```ts
function codexHookCommand(event: string): string {
  if (process.platform === 'win32') {
    return `curl -s --max-time 1 -X POST ${HOOK_URL}${event} -H "Content-Type: application/json" -H "${OM_HEADER}: %OPENMICRO_INSTANCE_ID%" -H "${HERDR_HEADER}: %HERDR_PANE_ID%" -d @- >NUL 2>&1 & echo {}`
  }
  return `curl -s --max-time 1 -X POST ${HOOK_URL}${event} -H 'Content-Type: application/json' -H "${OM_HEADER}: $OPENMICRO_INSTANCE_ID" -H "${HERDR_HEADER}: $HERDR_PANE_ID" -d @- >/dev/null 2>&1 || true; printf '{}'`
}
```

Note in the PR: the win32 Codex variant is unit-tested but not verified against a real Windows Codex CLI (not installed here) — documented gap, mirroring the fork's degradation rule.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/hooks-install.test.ts`
Expected: all PASS, including pre-existing suites (POSIX command byte-identical, so existing assertions hold).

- [ ] **Step 5: Re-run the live smoke**

No manual cleanup needed — the next openmicro start replaces stale entries via the idempotent merge. Repeat Task 8 Steps 1 and 4.
Expected: hook events now visible in the host log during the wrapped `claude -p` run.

- [ ] **Step 6: Commit**

```powershell
git add src/hooks-install.ts test/hooks-install.test.ts
git commit -m @'
fix(hooks): cmd.exe-compatible hook commands on Windows

Claude Code runs hook commands through cmd.exe on win32, where the POSIX
curl one-liner ($VAR, single quotes, /dev/null, || true) silently does
nothing, so no agent state ever reached the host. Emit %VAR%/NUL/exit
/b 0 syntax on win32; POSIX commands are byte-identical to before. The
vibesense coexistence marker 127.0.0.1:48762/om-hook/ is unchanged in
every variant.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 10: CI — add windows-latest

**Files:**

- Modify: `.github/workflows/ci.yml:12`

- [ ] **Step 1: Extend the matrix**

In `.github/workflows/ci.yml` line 12:

```yaml
os: [ubuntu-latest, macos-latest, windows-latest]
```

- [ ] **Step 2: Verify gate, commit, push**

```powershell
npm run verify
git add .github/workflows/ci.yml
git commit -m @'
ci: run the verify gate on windows-latest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
git push -u origin feat/windows-foundation
```

Expected: verify exit 0 before push.

- [ ] **Step 3: Watch CI**

Run: `gh run watch` (or `gh run list --branch feat/windows-foundation` then `gh run watch <id>`)
Expected: all three OS jobs green. A windows-job failure not seen locally → triage per Task 6 Step 2, fix, push again.

---

### Task 11: Docs, changelog, PR

**Files:**

- Modify: `CLAUDE.md` (CI caveat + postinstall wording), `CONTRIBUTING.md` (CI wording + Windows setup notes), `CHANGELOG.md` (new Unreleased section)

- [ ] **Step 1: CLAUDE.md**

Two edits in the fork-direction paragraph:

- Replace `CI currently runs ubuntu + macos only — no Windows job yet.` with `CI runs the verify gate on ubuntu, macos, and windows.`
- Replace `the `postinstall` chmod of node-pty's spawn-helper (POSIX-only, harmless elsewhere)` with `the spawn-helper chmod in `scripts/postinstall.mjs` (POSIX-only by design — explicit win32 no-op)` — the "known macOS-only pieces" list shrinks accordingly.

- [ ] **Step 2: CONTRIBUTING.md**

- Replace `(currently on ubuntu and macos; a Windows job is a welcome addition)` with `on ubuntu, macos, and windows`.
- In section 3's install comment, add one line stating the observed Windows reality from Task 2 (prebuilds sufficed, or VS Build Tools required — whichever actually happened).

- [ ] **Step 3: CHANGELOG.md**

Insert above `## [1.0.0] - 2026-07-17`:

```markdown
## [Unreleased]

### Fixed

- Windows: `npm install` no longer fails at postinstall (the POSIX chmod one-liner is now a Node script that no-ops on win32)
- Windows: test suite green — home-dir override honors `USERPROFILE`, POSIX exec-bit suite skipped where exec bits don't exist
- Line endings pinned to LF via `.gitattributes`, so `prettier --check` passes on `core.autocrlf=true` checkouts

### Added

- CI runs the verify gate on `windows-latest` alongside ubuntu and macos
```

If Task 9 ran, add under Fixed: `- Windows: hook commands are cmd.exe-compatible, so agent state reaches the host (POSIX commands unchanged)`.

- [ ] **Step 4: Verify, commit, PR**

```powershell
npm run verify
git add CLAUDE.md CONTRIBUTING.md CHANGELOG.md
git commit -m @'
docs: record Windows support reality post-foundation milestone

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
git push
```

Then create the PR with `gh pr create` — base `main`, title `feat: Windows foundation — install, verify, runtime smoke, windows CI`. Body must include: the smoke checklist with observed output (doctor, port bind, settings.json entries, hook arrival evidence and which Task 8 branch was taken), the Task 2 install failure evidence, what was verified live on Windows vs. only by unit test (per fork convention), and end with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Expected: PR open, CI green on all three OS jobs.
