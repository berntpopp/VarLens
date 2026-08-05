#!/usr/bin/env node
// Restores the target-ABI binary from .cache/native, or compiles once and caches it.
// Usage: node scripts/native/rebuild-native.mjs <node|electron>
//
// Deliberately does NOT pass `-f` to @electron/rebuild. `-f` disables both the
// "already built" skip (rebuild.js:131) and the module-state cache
// (rebuild.js:56-59, which warns "force take precedence and the cache will not
// be used"). Correctness comes from detectBinaryAbi() instead: every restore
// and every compile is verified against the binary that is actually on disk,
// never trusted from a manifest or from @electron/rebuild's own bookkeeping.
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
  purge,
  restore,
  restoreDecision,
  store
} from './native-abi.mjs'

// Every caller below needs the same two outcomes: a known ABI (possibly the
// wrong one) or "could not tell". "Could not tell" must never be treated as
// a mismatch — on a platform/toolchain where detection itself doesn't work,
// treating that as failure would break `npm ci` for an otherwise-correct
// binary (see the undetermined branches below).
export function detectOrUndetermined(binaryPath) {
  try {
    return { abi: detectBinaryAbi(binaryPath), undetermined: false }
  } catch (error) {
    return { abi: null, undetermined: true, error }
  }
}

// node-gyp compiles single-threaded by default; the measured Electron rebuild
// ran at 98% CPU on a 32-core host. Cap the fan-out so this stays bounded —
// the June 2026 incident was caused by unbounded parallelism. The override is
// validated and clamped to 1-8: on Windows it lands on a shell command line
// (`shell: true` below), so anything that isn't a bare integer is ignored in
// favor of the computed default rather than passed through.
export function clampedJobOverride(raw, fallback) {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback
  return Math.min(8, Math.max(1, Number.parseInt(raw.trim(), 10)))
}

function compile(target, jobs) {
  return target === 'electron'
    ? spawnSync('npx', ['@electron/rebuild', '-w', MODULE_NAME, '--jobs', jobs], {
        stdio: 'inherit',
        shell: process.platform === 'win32'
      })
    : spawnSync('npm', ['rebuild', MODULE_NAME], {
        stdio: 'inherit',
        shell: process.platform === 'win32'
      })
}

// The whole restore-or-compile-and-cache decision, factored out of `main()`
// so a test can drive it without the process exiting under it. Returns the
// process exit code the CLI should use rather than calling `process.exit`
// itself.
export function rebuildNative(target) {
  const expectedAbi = abiFor(target)

  if (restore(target)) {
    const detected = detectOrUndetermined(MODULE_BINARY)
    if (restoreDecision(detected, expectedAbi) === 'restore') {
      process.stdout.write(`native: restored ${target} ABI ${expectedAbi} from .cache/native\n`)
      return 0
    }
    // restore() already confirmed the cached binary matches its own manifest
    // and sha256 — that only proves internal self-consistency, which is
    // exactly what both a poisoned entry (wrong ABI, self-consistent manifest)
    // and a corrupt one (truncated binary, self-consistent manifest) also
    // have. Self-heal rather than trust: a recompile is always one step away
    // here, so purging and falling through costs one compile. Trusting either
    // one would instead wedge node_modules with a broken binary while
    // `npm ci` and every future run keeps reporting success — this is
    // deliberately asymmetric with the compile path below, where "could not
    // determine" must NOT purge or fail (see item H).
    const reason = detected.undetermined
      ? `could not verify it (${detected.error.message})`
      : `it is actually ABI ${detected.abi}`
    process.stderr.write(
      `native: cache entry for ${target} ABI ${expectedAbi} is unusable — ${reason}. Purging it ` +
        'and recompiling.\n'
    )
    purge(target)
  }

  const jobs = String(
    clampedJobOverride(process.env.VARLENS_NATIVE_JOBS, Math.min(8, availableParallelism()))
  )

  process.stdout.write(
    `native: compiling ${target} ABI ${expectedAbi} (jobs=${jobs}) — no cache entry\n`
  )

  let result = compile(target, jobs)
  if (result.status !== 0) return result.status ?? 1

  let detected = detectOrUndetermined(MODULE_BINARY)

  // @electron/rebuild's own "already built" skip (module-rebuilder.js's
  // `alreadyBuiltByRebuild`/`metaPath` — an undocumented internal of
  // @electron/rebuild@4.2.0, may move in a future version) is keyed on a
  // `.forge-meta` file it wrote on a *previous* @electron/rebuild run. That
  // file is invisible to the `node` target's plain `npm rebuild` path, which
  // overwrites the binary with the Node ABI without touching it — so a stale
  // `.forge-meta` left over from an earlier electron build can make
  // @electron/rebuild believe electron ABI X is already built when the binary
  // on disk is actually the Node ABI, and it silently no-ops the compile.
  //
  // Retry exactly once after clearing it, rather than clearing it
  // unconditionally up front: the common case (the metadata IS accurate, e.g.
  // right after a fresh `npm ci`) should still take @electron/rebuild's own
  // fast, correct skip path instead of always paying for a real compile.
  if (target === 'electron' && !detected.undetermined && detected.abi !== expectedAbi) {
    process.stderr.write(
      `native: compile produced ABI ${detected.abi}, expected ${expectedAbi} — @electron/rebuild ` +
        'likely skipped via a stale .forge-meta. Clearing it and retrying once.\n'
    )
    rmSync(join(dirname(MODULE_BINARY), '.forge-meta'), { force: true })
    result = compile(target, jobs)
    if (result.status !== 0) return result.status ?? 1
    detected = detectOrUndetermined(MODULE_BINARY)
  }

  if (detected.undetermined) {
    // A compile that exits 0 without producing a binary at all also lands
    // here — detectBinaryAbi() on a missing file throws "could not
    // determine", indistinguishable from the deliberate "can't verify on
    // this platform" case below. Unlike that case, a missing binary must
    // never report success: `npm ci` would otherwise finish green with no
    // `.node` on disk. Mirrors the same check in assert-native-abi.mjs.
    if (!existsSync(MODULE_BINARY)) {
      process.stderr.write(
        `native: FAIL — compile for ${target} ABI ${expectedAbi} exited 0 but ${MODULE_BINARY} ` +
          'does not exist. Refusing to report success with no binary on disk.\n'
      )
      return 1
    }
    process.stderr.write(
      `native: could not verify the ${target} ABI ${expectedAbi} binary after compiling ` +
        `(${detected.error.message}). Caching is disabled for this run — continuing without an ` +
        'ABI-verified cache entry.\n'
    )
    return 0
  }

  if (detected.abi !== expectedAbi) {
    process.stderr.write(
      `native: FAIL — expected ${target} ABI ${expectedAbi} on disk after rebuild, but detected ` +
        `ABI ${detected.abi}. Refusing to cache this binary.\n`
    )
    return 1
  }

  const manifest = store(target)
  process.stdout.write(
    `native: cached ${target} ABI ${manifest.abi} (sha ${manifest.sha256.slice(0, 12)})\n`
  )
  return 0
}

function main() {
  const target = process.argv[2]
  if (target !== 'node' && target !== 'electron') {
    process.stderr.write('usage: rebuild-native.mjs <node|electron>\n')
    process.exit(2)
  }
  process.exit(rebuildNative(target))
}

if (process.argv[1] === import.meta.filename) main()
