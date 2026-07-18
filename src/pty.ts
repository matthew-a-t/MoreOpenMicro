// Spawns the selected agent under a pty and passes its TUI through untouched: user
// keyboard → pty, pty output → stdout, window resizes forwarded. Controller
// keystrokes are just extra writes into the same pty.

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as pty from 'node-pty'
import { logger } from './logger.js'

// node-pty's npm tarball ships spawn-helper without the exec bit, and the
// package.json postinstall chmod can't reach it when npm hoists node-pty out
// of our own node_modules (npx, install-as-dependency). Fix it here, where
// require() tells us where node-pty actually resolved to. Best effort: the
// postinstall still covers root-owned global installs this can't write to.
export function fixSpawnHelperPermissions(prebuildsDir?: string): void {
  // Windows: no exec bits, and node-pty's win32 prebuilds (ConPTY) ship no
  // spawn-helper — nothing to fix.
  if (process.platform === 'win32') return

  try {
    const dir =
      prebuildsDir ??
      path.join(
        path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')),
        'prebuilds',
      )
    for (const entry of fs.readdirSync(dir)) {
      const helper = path.join(dir, entry, 'spawn-helper')
      if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
    }
  } catch {
    // no prebuilds (built from source) or no write permission — if the exec
    // bit is genuinely missing, pty.spawn will surface the failure.
  }
}

type PtySpawner = typeof pty.spawn

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/** Case-insensitive env lookup: real Windows shells disagree on PATH/PATHEXT
 * casing (PowerShell: `path`, cmd.exe: `Path`, Git Bash: `PATH`), and a plain
 * object copy of process.env — unlike process.env itself — doesn't normalize
 * that for us. */
function getEnvVar(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? env[key] : undefined
}

/** Split a Windows PATH value the way the OS does: `;` separates entries
 * except inside double quotes, and the quotes themselves are not part of the
 * directory name (installers commonly write `"C:\Program Files\..."`). */
function splitWindowsPath(value: string): string[] {
  const entries: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ';' && !inQuotes) {
      entries.push(current)
      current = ''
    } else current += ch
  }
  entries.push(current)
  return entries.filter(Boolean)
}

/** node-pty's Windows ConPTY `startProcess` does no PATHEXT-style extension
 * resolution: it looks for the literal filename given and throws `File not
 * found` if it doesn't exist verbatim (verified: bare `claude` fails, only
 * `claude.exe` exists on PATH). This resolves an extensionless command the
 * same way `cmd.exe`/PATHEXT would, so harnesses can keep hardcoding bare
 * names like `command: 'claude'`.
 *
 * Left unresolved (returned as-is): non-win32 platforms, commands that
 * already carry an extension, and commands containing a path separator.
 * `.exe`/`.com` matches spawn directly; `.cmd`/`.bat` matches (the common npm
 * shim case) route through `cmd.exe /c` since ConPTY/CreateProcess cannot
 * start a batch file directly. No match: the original command is returned
 * unchanged, so node-pty produces its own (accurate) error. */
export function resolveWindowsCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): { command: string; args: string[] } {
  if (platform !== 'win32') return { command, args }
  if (/[\\/]/.test(command) || path.extname(command) !== '') return { command, args }

  const dirs = splitWindowsPath(getEnvVar(env, 'PATH') ?? '')
  const exts = (getEnvVar(env, 'PATHEXT') ?? DEFAULT_PATHEXT).split(';').filter(Boolean)

  for (const dir of dirs) {
    for (const ext of exts) {
      // Lowercase: PATHEXT conventionally lists uppercase extensions, but
      // real binaries are almost always named in lowercase on disk (NTFS
      // lookups are case-insensitive either way, so this only affects which
      // casing the resolved path — and thus cmd.exe's argv — ends up with).
      const lower = ext.toLowerCase()
      const candidate = path.join(dir, command + lower)
      if (!fs.existsSync(candidate)) continue
      if (lower === '.exe' || lower === '.com') return { command: candidate, args }
      if (lower === '.bat' || lower === '.cmd') {
        return { command: 'cmd.exe', args: ['/c', candidate, ...args] }
      }
      // Some other PATHEXT extension (.vbs, .js, .py, ...) — not directly
      // launchable by ConPTY either; keep searching.
    }
  }
  return { command, args }
}

export function spawnAgentProcess(
  spawnPty: PtySpawner,
  command: string,
  args: string[],
  wrapperId: string | undefined,
  platform: NodeJS.Platform = process.platform,
): pty.IPty {
  const env = { ...process.env } as Record<string, string>
  // herdr's own agent integration hooks (e.g. ~/.claude/hooks/herdr-agent-state.sh)
  // gate on HERDR_ENV=1. If the wrapped agent runs them, it claims the herdr
  // pane's session as herdr:<agent>, and herdr then silently drops every
  // report from any other source — including openmicro's state reports
  // (session-owner conflict; herdr can't verify "openmicro" as a takeover
  // agent). Hide HERDR_ENV from the child so only openmicro reports for the
  // pane. HERDR_PANE_ID stays: openmicro's hook curls echo it back to us.
  delete env.HERDR_ENV
  if (wrapperId) env.OPENMICRO_INSTANCE_ID = wrapperId
  const resolved = resolveWindowsCommand(command, args, platform, env)
  return spawnPty(resolved.command, resolved.args, {
    name: process.env.TERM ?? 'xterm-256color',
    cols: process.stdout.columns,
    rows: process.stdout.rows,
    cwd: process.cwd(),
    env,
  })
}

export class AgentPty {
  private proc: pty.IPty
  private focusReporting = false

  constructor(
    command: string,
    args: string[],
    wrapperId: string | undefined,
    onExit: (code: number) => void,
    onFocusChange?: (focused: boolean) => void,
  ) {
    fixSpawnHelperPermissions()
    this.proc = spawnAgentProcess(pty.spawn, command, args, wrapperId)

    this.proc.onData((data) => process.stdout.write(data))
    this.proc.onExit(({ exitCode }) => onExit(exitCode))

    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    // Terminal focus reporting (mode 1004): the terminal sends ESC[I / ESC[O
    // on window/pane focus changes. We observe them here and still pass them
    // through to the wrapped agent, which understands the same events.
    if (onFocusChange && process.stdout.isTTY) {
      process.stdout.write('\x1b[?1004h')
      this.focusReporting = true
    }
    process.stdin.on('data', (data: Buffer) => {
      const bytes = data.toString('utf8')
      if (onFocusChange) {
        // ponytail: per-chunk match — an event split across reads is missed;
        // buffer across chunks if that ever shows up in practice.
        if (bytes.includes('\x1b[I')) onFocusChange(true)
        else if (bytes.includes('\x1b[O')) onFocusChange(false)
      }
      this.proc.write(bytes)
    })

    process.stdout.on('resize', () => {
      try {
        this.proc.resize(process.stdout.columns, process.stdout.rows)
      } catch (err) {
        logger.warn('pty resize failed', err)
      }
    })
  }

  write(data: string): void {
    this.proc.write(data)
  }

  dispose(): void {
    if (this.focusReporting) process.stdout.write('\x1b[?1004l')
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
    try {
      this.proc.kill()
    } catch {
      // already dead
    }
  }
}
