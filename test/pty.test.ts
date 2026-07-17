import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fixSpawnHelperPermissions, resolveWindowsCommand, spawnAgentProcess } from '../src/pty.js'

const EXEC_BITS = 0o111

let tmp: string
let extraDirs: string[] = []

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  for (const dir of extraDirs) fs.rmSync(dir, { recursive: true, force: true })
  extraDirs = []
})

/** A temp dir on a fake PATH, pre-populated with the given (empty) files. */
function makePathDir(files: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmicro-pty-path-'))
  for (const file of files) fs.writeFileSync(path.join(dir, file), '')
  extraDirs.push(dir)
  return dir
}

function makePrebuilds(entries: Record<string, string[]>): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openmicro-pty-'))
  for (const [dir, files] of Object.entries(entries)) {
    fs.mkdirSync(path.join(tmp, dir), { recursive: true })
    for (const file of files) {
      fs.writeFileSync(path.join(tmp, dir, file), '')
      fs.chmodSync(path.join(tmp, dir, file), 0o644)
    }
  }
  return tmp
}

describe.skipIf(process.platform === 'win32')('fixSpawnHelperPermissions', () => {
  it('makes spawn-helper executable in every prebuild dir', () => {
    const dir = makePrebuilds({
      'darwin-arm64': ['spawn-helper'],
      'darwin-x64': ['spawn-helper'],
    })
    fixSpawnHelperPermissions(dir)
    for (const arch of ['darwin-arm64', 'darwin-x64']) {
      const mode = fs.statSync(path.join(dir, arch, 'spawn-helper')).mode
      expect(mode & EXEC_BITS).not.toBe(0)
    }
  })

  it('skips prebuild dirs without a spawn-helper and still fixes the rest', () => {
    const dir = makePrebuilds({
      'linux-x64': ['pty.node'],
      'darwin-arm64': ['spawn-helper'],
    })
    fixSpawnHelperPermissions(dir)
    const mode = fs.statSync(path.join(dir, 'darwin-arm64', 'spawn-helper')).mode
    expect(mode & EXEC_BITS).not.toBe(0)
  })

  it('is a no-op when the prebuilds dir is missing', () => {
    expect(() => fixSpawnHelperPermissions('/nonexistent/prebuilds')).not.toThrow()
  })
})

describe('spawnAgentProcess', () => {
  // These three tests exercise env-var plumbing only, so they pin a non-win32
  // platform to opt out of the PATHEXT resolution covered by the
  // `resolveWindowsCommand` and win32-specific `spawnAgentProcess` suites
  // below. Without this, they'd depend on whatever happens to be on this
  // machine's real PATH when run on a Windows host.
  it('spawns the selected harness and adds the wrapper id to the inherited environment', () => {
    let call: { command: string; args: string[]; env: Record<string, string> } | undefined
    const spawn = ((command: string, args: string[], options: { env: Record<string, string> }) => {
      call = { command, args, env: options.env }
      return {}
    }) as Parameters<typeof spawnAgentProcess>[0]

    spawnAgentProcess(spawn, 'codex', ['--model', 'gpt-5.4'], 'wrapper-123', 'linux')

    expect(call).toMatchObject({
      command: 'codex',
      args: ['--model', 'gpt-5.4'],
      env: { OPENMICRO_INSTANCE_ID: 'wrapper-123' },
    })
    expect(call!.env.PATH).toBe(process.env.PATH)
  })

  it('hides HERDR_ENV from the agent so herdr hooks inside it cannot claim the pane', () => {
    const previous = { HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID }
    process.env.HERDR_ENV = '1'
    process.env.HERDR_PANE_ID = 'w1:p1'
    let env: Record<string, string> | undefined
    const spawn = ((
      _command: string,
      _args: string[],
      options: { env: Record<string, string> },
    ) => {
      env = options.env
      return {}
    }) as Parameters<typeof spawnAgentProcess>[0]

    try {
      spawnAgentProcess(spawn, 'claude', [], 'wrapper-123', 'linux')
      expect(env!.HERDR_ENV).toBeUndefined()
      expect(env!.HERDR_PANE_ID).toBe('w1:p1')
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('leaves the inherited environment unchanged when no wrapper id is requested', () => {
    const previous = process.env.OPENMICRO_INSTANCE_ID
    process.env.OPENMICRO_INSTANCE_ID = 'existing-value'
    let env: Record<string, string> | undefined
    const spawn = ((
      _command: string,
      _args: string[],
      options: { env: Record<string, string> },
    ) => {
      env = options.env
      return {}
    }) as Parameters<typeof spawnAgentProcess>[0]

    try {
      spawnAgentProcess(spawn, 'claude', [], undefined, 'linux')
      expect(env!.OPENMICRO_INSTANCE_ID).toBe('existing-value')
    } finally {
      if (previous === undefined) delete process.env.OPENMICRO_INSTANCE_ID
      else process.env.OPENMICRO_INSTANCE_ID = previous
    }
  })

  it('resolves an extensionless command to its absolute path on win32', () => {
    const dir = makePathDir(['claude.exe'])
    const previousPath = process.env.PATH
    const previousPathext = process.env.PATHEXT
    let call: { command: string; args: string[] } | undefined
    const spawn = ((command: string, args: string[], _options: { env: Record<string, string> }) => {
      call = { command, args }
      return {}
    }) as Parameters<typeof spawnAgentProcess>[0]

    process.env.PATH = dir
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD'
    try {
      spawnAgentProcess(spawn, 'claude', ['-p', 'hi'], undefined, 'win32')
      expect(call).toEqual({ command: path.join(dir, 'claude.exe'), args: ['-p', 'hi'] })
    } finally {
      process.env.PATH = previousPath
      if (previousPathext === undefined) delete process.env.PATHEXT
      else process.env.PATHEXT = previousPathext
    }
  })

  it('spawns exactly as today on non-win32, even when a matching file sits on PATH', () => {
    const dir = makePathDir(['claude.exe'])
    const previousPath = process.env.PATH
    const previousPathext = process.env.PATHEXT
    let call: { command: string; args: string[] } | undefined
    const spawn = ((command: string, args: string[], _options: { env: Record<string, string> }) => {
      call = { command, args }
      return {}
    }) as Parameters<typeof spawnAgentProcess>[0]

    process.env.PATH = dir
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD'
    try {
      spawnAgentProcess(spawn, 'claude', ['-p', 'hi'], undefined, 'linux')
      expect(call).toEqual({ command: 'claude', args: ['-p', 'hi'] })
    } finally {
      process.env.PATH = previousPath
      if (previousPathext === undefined) delete process.env.PATHEXT
      else process.env.PATHEXT = previousPathext
    }
  })
})

describe('resolveWindowsCommand', () => {
  it('leaves the command untouched on non-win32 platforms', () => {
    const dir = makePathDir(['claude.exe'])
    const result = resolveWindowsCommand('claude', ['-p', 'hi'], 'linux', { PATH: dir })
    expect(result).toEqual({ command: 'claude', args: ['-p', 'hi'] })
  })

  it('leaves a command that already has an extension untouched', () => {
    const dir = makePathDir(['claude.exe'])
    const result = resolveWindowsCommand('claude.exe', [], 'win32', {
      PATH: dir,
      PATHEXT: '.EXE',
    })
    expect(result).toEqual({ command: 'claude.exe', args: [] })
  })

  it('leaves a command containing a path separator untouched', () => {
    const dir = makePathDir(['claude.exe'])
    const result = resolveWindowsCommand('bin/claude', [], 'win32', {
      PATH: dir,
      PATHEXT: '.EXE',
    })
    expect(result).toEqual({ command: 'bin/claude', args: [] })
  })

  it('resolves an extensionless command to its absolute .exe path on PATH', () => {
    const dir = makePathDir(['claude.exe'])
    const result = resolveWindowsCommand('claude', ['-p', 'hi'], 'win32', {
      PATH: dir,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    })
    expect(result).toEqual({ command: path.join(dir, 'claude.exe'), args: ['-p', 'hi'] })
  })

  it('resolves a .cmd match by routing through cmd.exe /c (npm shim case)', () => {
    const dir = makePathDir(['codex.cmd'])
    const result = resolveWindowsCommand('codex', ['--model', 'gpt-5.4'], 'win32', {
      PATH: dir,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    })
    expect(result).toEqual({
      command: 'cmd.exe',
      args: ['/c', path.join(dir, 'codex.cmd'), '--model', 'gpt-5.4'],
    })
  })

  it('resolves a .bat match by routing through cmd.exe /c', () => {
    const dir = makePathDir(['tool.bat'])
    const result = resolveWindowsCommand('tool', [], 'win32', { PATH: dir, PATHEXT: '.BAT' })
    expect(result).toEqual({ command: 'cmd.exe', args: ['/c', path.join(dir, 'tool.bat')] })
  })

  it('leaves the command unchanged when nothing matches on PATH', () => {
    const dir = makePathDir(['unrelated.txt'])
    const result = resolveWindowsCommand('claude', [], 'win32', { PATH: dir, PATHEXT: '.EXE' })
    expect(result).toEqual({ command: 'claude', args: [] })
  })

  it('searches PATH directories in order and finds a later match', () => {
    const dirA = makePathDir(['other.exe'])
    const dirB = makePathDir(['claude.exe'])
    const result = resolveWindowsCommand('claude', [], 'win32', {
      PATH: `${dirA};${dirB}`,
      PATHEXT: '.EXE',
    })
    expect(result).toEqual({ command: path.join(dirB, 'claude.exe'), args: [] })
  })

  it('respects PATHEXT order, preferring an earlier extension over a later one', () => {
    const dir = makePathDir(['tool.cmd', 'tool.exe'])
    const result = resolveWindowsCommand('tool', [], 'win32', {
      PATH: dir,
      PATHEXT: '.CMD;.EXE',
    })
    expect(result).toEqual({ command: 'cmd.exe', args: ['/c', path.join(dir, 'tool.cmd')] })
  })

  it('falls back to the default PATHEXT order when PATHEXT is unset', () => {
    const dir = makePathDir(['claude.exe'])
    const result = resolveWindowsCommand('claude', [], 'win32', { PATH: dir })
    expect(result).toEqual({ command: path.join(dir, 'claude.exe'), args: [] })
  })

  it('looks up PATH and PATHEXT case-insensitively (real Windows shells vary the casing)', () => {
    // Node's process.env access is case-insensitive on win32, but a plain
    // object copy (as spawnAgentProcess makes) is not, and real Windows
    // shells disagree on casing: PowerShell exposes lowercase `path`, cmd.exe
    // exposes `Path`, Git Bash exposes `PATH`. Verified on this machine.
    const dir = makePathDir(['claude.exe'])
    const result = resolveWindowsCommand('claude', [], 'win32', { path: dir, Pathext: '.EXE' })
    expect(result).toEqual({ command: path.join(dir, 'claude.exe'), args: [] })
  })
})
