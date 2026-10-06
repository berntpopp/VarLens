import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const SCRATCH_ENV = 'VARLENS_CI_SCRATCH_DIR'
const HOST = createHash('sha256').update(hostname()).digest('hex').slice(0, 8)
const OWNED = /^varlens-ci-[a-z]+-([0-9a-f]{8})-(\d+)-[A-Za-z0-9]{6}$/

/**
 * Root for multi-gigabyte disposable files (scanner databases, image exports).
 * os.tmpdir() is commonly tmpfs: its pages are charged to the caller's memory
 * cgroup, so a memory-bounded preflight fails there with "disk quota exceeded".
 */
export function scratchRoot(env = process.env) {
  const explicit = env[SCRATCH_ENV]
  if (!explicit) return join(homedir(), '.cache', 'varlens-ci', 'scratch')
  if (!isAbsolute(explicit)) throw new Error(`${SCRATCH_ENV} must be an absolute path`)
  return resolve(explicit)
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

/** A killed run cannot clean up; reclaim only this host's entries whose owner is gone. */
function reclaimAbandoned(root) {
  for (const name of readdirSync(root)) {
    const [, host, pid] = name.match(OWNED) ?? []
    if (host !== HOST || alive(Number(pid))) continue
    rmSync(join(root, name), { recursive: true, force: true })
  }
}

/** Private directory owned by this process; `close` is idempotent. */
export function createScratch(kind, { env = process.env } = {}) {
  if (!/^[a-z]+$/.test(kind)) throw new Error('Scratch kind must be lowercase letters')
  const root = scratchRoot(env)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  reclaimAbandoned(root)
  const directory = mkdtempSync(join(root, `varlens-ci-${kind}-${HOST}-${process.pid}-`))
  return { directory, close: () => rm(directory, { recursive: true, force: true }) }
}
