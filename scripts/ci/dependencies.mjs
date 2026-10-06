import { createHash } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, readdirSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { hashValue, readReceipt, writeReceipt, digestPaths } from './receipt.mjs'

// Native build output changes deliberately between the serialized Node/Electron
// lanes. Its bytes are checked by assert-native-abi, independently of this tree.
const excluded = (path) =>
  /(^|\/)(\.cache|\.vite|\.vitest|\.vite-temp)(\/|$)/.test(path) ||
  /^better-sqlite3-multiple-ciphers\/(build|\.forge-meta)(\/|$)/.test(path)
export async function installedFingerprint(cwd, cacheFile) {
  const root = join(cwd, 'node_modules')
  if (!existsSync(root)) throw new Error('node_modules is missing')
  if (lstatSync(root).isSymbolicLink())
    throw new Error('Preflight needs an independent worktree node_modules, not a shared symlink')
  const cached = readReceipt(cacheFile)?.files ?? {}
  const files = {}
  const entries = []
  async function visit(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name
      if (excluded(relative)) continue
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (stat.isDirectory()) {
        await visit(path, relative)
        continue
      }
      if (stat.isSymbolicLink()) {
        entries.push([relative, 'link', readlinkSync(path)])
        continue
      }
      const stamp = [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino, stat.mode]
      let digest = cached[relative]?.digest
      if (hashValue(cached[relative]?.stamp) !== hashValue(stamp)) {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(path)) hash.update(chunk)
        digest = hash.digest('hex')
      }
      files[relative] = { stamp, digest }
      entries.push([relative, stat.mode & 0o777, digest])
    }
  }
  await visit(root)
  if (entries.length === 0) throw new Error('Installed dependency tree is empty')
  writeReceipt(cacheFile, { files })
  return hashValue(entries)
}
export async function ensureDependencies({ cwd, stateDir, env, execute, clean = false }) {
  const expected = {
    inputs: await digestPaths(cwd, [
      'package.json',
      'package-lock.json',
      '.nvmrc',
      'scripts/native/rebuild-native.mjs'
    ]),
    node: process.version,
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    npm: (await execute('npm', ['--version'], { cwd, env, quiet: true })).stdout.trim()
  }
  const marker = join(stateDir, 'installed.json')
  const cache = join(stateDir, 'dependency-digests.json')
  const prior = readReceipt(marker)
  let fingerprint
  if (!clean && hashValue(prior?.expected) === hashValue(expected)) {
    try {
      fingerprint = await installedFingerprint(cwd, cache)
    } catch {
      /* A damaged install must be rebuilt. */
    }
    if (fingerprint === prior?.fingerprint) return fingerprint
  }
  await execute('npm', ['ci'], { cwd, env: { ...env, VARLENS_NATIVE_RUNTIME: 'node' } })
  fingerprint = await installedFingerprint(cwd, cache)
  writeReceipt(marker, { expected, fingerprint })
  return fingerprint
}
