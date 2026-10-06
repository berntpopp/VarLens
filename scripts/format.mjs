// Keep the formatter cache across npm ci, and invalidate it for plugin/config
// changes that Prettier's own per-file cache does not identify.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const prettierPackage = require.resolve('prettier/package.json')

export function formatCacheLocation(cwd = process.cwd()) {
  const hash = createHash('sha256').update(process.versions.node)
  hash.update(readFileSync(prettierPackage))
  const configs = new Set(['package.json', 'package-lock.json', '.prettierignore', '.editorconfig'])
  for (const name of readdirSync(cwd)) {
    if (name.startsWith('.prettierrc') || name.startsWith('prettier.config.')) configs.add(name)
  }
  for (const name of [...configs].sort()) {
    hash.update(name).update('\0')
    const path = join(cwd, name)
    if (existsSync(path)) hash.update(readFileSync(path))
    hash.update('\0')
  }
  return join(cwd, '.cache', 'prettier', `${hash.digest('hex')}.cache`)
}

function main() {
  const location = formatCacheLocation()
  mkdirSync(dirname(location), { recursive: true })
  const result = spawnSync(
    process.execPath,
    [
      join(dirname(prettierPackage), 'bin', 'prettier.cjs'),
      '--cache',
      '--cache-strategy',
      'content',
      '--cache-location',
      location,
      ...process.argv.slice(2)
    ],
    { stdio: 'inherit' }
  )
  if (result.error) process.stderr.write(`${result.error.message}\n`)
  process.exitCode = result.status ?? 1
}

if (process.argv[1] === import.meta.filename) main()
