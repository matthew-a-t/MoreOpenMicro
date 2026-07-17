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
