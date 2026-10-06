import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOST_KEY = 'VARLENS_VITEST_HOST_TMPDIR'
const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000

function newestChange(directory) {
  let newest = statSync(directory).mtimeMs
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory())
      newest = Math.max(newest, statSync(join(directory, entry.name)).mtimeMs)
  }
  return newest
}

/** Vitest removes its copies on close; a killed run cannot. Files (coverage locks) are kept. */
function reclaimAbandoned(directory, now) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const run = join(directory, entry.name)
    try {
      if (now - newestChange(run) > ABANDONED_AFTER_MS)
        rmSync(run, { recursive: true, force: true })
    } catch {
      /* A concurrent run closed and removed it. */
    }
  }
}

/**
 * Vitest's forks pool hands transformed modules to its workers as files in
 * `os.tmpdir()/<random id>/<environment>/<sha1>`; there is no option for that
 * location. Anything that prunes the host temporary directory (another run's
 * cleanup, an agent wiping a shared TMPDIR) then fails live workers with ENOENT.
 * Point only the runner process at an ignored per-worktree directory and hand
 * `workerEnv` to `test.env`, so test code keeps the host temporary directory.
 */
export function isolateTransformTemp(
  root,
  { env = process.env, platform = process.platform, hostTemp = tmpdir, now = Date.now() } = {}
) {
  // Windows resolves os.tmpdir() from TEMP/TMP, which child tools also read.
  if (platform === 'win32' || !existsSync(join(root, 'node_modules'))) return { workerEnv: {} }
  const host = env[HOST_KEY] ?? env.TMPDIR ?? hostTemp()
  const directory = join(root, 'node_modules', '.vite-temp', 'vitest')
  mkdirSync(directory, { recursive: true })
  reclaimAbandoned(directory, now)
  env[HOST_KEY] = host
  env.TMPDIR = directory
  return { directory, workerEnv: { TMPDIR: host } }
}
