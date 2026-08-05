#!/usr/bin/env node
// Restores the target-ABI binary from .cache/native, or compiles once and caches it.
// Usage: node scripts/native/rebuild-native.mjs <node|electron>
//
// Deliberately does NOT pass `-f` to @electron/rebuild. `-f` disables both the
// "already built" skip (rebuild.js:131) and the module-state cache
// (rebuild.js:56-59, which warns "force take precedence and the cache will not
// be used"). Correctness comes from assert-native-abi.mjs and the on-disk ABI
// verification below instead.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'

import {
  MODULE_BINARY,
  MODULE_NAME,
  abiFor,
  detectBinaryAbi,
  restore,
  store
} from './native-abi.mjs'

const target = process.argv[2]
if (target !== 'node' && target !== 'electron') {
  process.stderr.write('usage: rebuild-native.mjs <node|electron>\n')
  process.exit(2)
}

if (restore(target)) {
  process.stdout.write(`native: restored ${target} ABI ${abiFor(target)} from .cache/native\n`)
  process.exit(0)
}

// node-gyp compiles single-threaded by default; the measured Electron rebuild
// ran at 98% CPU on a 32-core host. Cap the fan-out so this stays bounded —
// the June 2026 incident was caused by unbounded parallelism.
const jobs = process.env.VARLENS_NATIVE_JOBS || String(Math.min(8, availableParallelism()))

if (target === 'electron') {
  // @electron/rebuild's own "already built" skip (rebuild.js:131) trusts a
  // `.forge-meta` file it wrote on a *previous* @electron/rebuild run — it
  // has no way to know that our `rebuild:node` path (plain `npm rebuild`)
  // may since have overwritten the binary with the Node ABI without
  // touching that file. Reaching this line already means our own restore()
  // found no fresh cache entry, so a real compile is required regardless of
  // what that stale bookkeeping claims. Clear it so @electron/rebuild can't
  // silently no-op; the ABI check after the compile is the actual guardrail
  // either way, but a real compile is cheaper to reason about than relying
  // on that check to fire.
  const forgeMeta = join(dirname(MODULE_BINARY), '.forge-meta')
  if (existsSync(forgeMeta)) rmSync(forgeMeta)
}

const command =
  target === 'electron'
    ? ['npx', ['@electron/rebuild', '-w', MODULE_NAME, '--jobs', jobs]]
    : ['npm', ['rebuild', MODULE_NAME]]

process.stdout.write(
  `native: compiling ${target} ABI ${abiFor(target)} (jobs=${jobs}) — no cache entry\n`
)

const result = spawnSync(command[0], command[1], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
if (result.status !== 0) process.exit(result.status ?? 1)

// Verify the binary that just came out of the compile step is really the
// target ABI before trusting it. `@electron/rebuild` (without `-f`) may
// decide the module is already built and skip the compile entirely; if that
// happens while the tree is on the *other* ABI, storing this binary would
// poison the cache — the manifest would describe the wrong artifact, and
// later manifest-only checks (including assert-native-abi.mjs) would pass
// against a binary that is actually wrong. Detecting the ABI independently
// of the manifest closes that hole.
const expectedAbi = abiFor(target)
const detectedAbi = detectBinaryAbi(MODULE_BINARY)
if (detectedAbi !== expectedAbi) {
  process.stderr.write(
    `native: FAIL — expected ${target} ABI ${expectedAbi} on disk after rebuild, ` +
      `but detected ABI ${detectedAbi}. The rebuild step likely skipped compiling ` +
      `(module already "built" for the other ABI). Refusing to cache this binary.\n`
  )
  process.exit(1)
}

const manifest = store(target)
process.stdout.write(
  `native: cached ${target} ABI ${manifest.abi} (sha ${manifest.sha256.slice(0, 12)})\n`
)
