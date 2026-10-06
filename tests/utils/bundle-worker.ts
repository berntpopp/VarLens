/**
 * Bundle a TypeScript worker entry into a runnable CommonJS file for tests.
 *
 * Production workers are bundled by electron-vite; Vitest runs the sources
 * directly and cannot spawn a `.ts` file as a worker thread. Tests that need
 * the *real* worker (real SQLite connection, real message protocol) bundle it
 * with esbuild (Vite's own bundler dependency) into `tests/.cache/` so that
 * `require('better-sqlite3-multiple-ciphers')` resolves from the project's
 * node_modules.
 */
import { mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const OUT_DIR = resolve(process.cwd(), 'tests/.cache/bundled-workers')
const built = new Map<string, string>()

export async function bundleWorker(entry: string): Promise<string> {
  const absoluteEntry = resolve(process.cwd(), entry)
  const cached = built.get(absoluteEntry)
  if (cached !== undefined) return cached

  const { build } = (await import('esbuild')) as typeof import('esbuild')
  mkdirSync(OUT_DIR, { recursive: true })
  const outfile = join(OUT_DIR, `${basename(entry, '.ts')}-${process.pid}.cjs`)
  await build({
    entryPoints: [absoluteEntry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
    // Dependencies resolve from the project's node_modules at runtime.
    packages: 'external'
  })
  built.set(absoluteEntry, outfile)
  return outfile
}
