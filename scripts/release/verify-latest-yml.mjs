// Asserts that a latest*.yml (electron-builder's auto-update metadata) actually
// describes the files sitting next to it. The signing step rewrites sha512/size
// with four PowerShell `-replace` regexes and verifies nothing; if a filename
// ever stops matching, those calls silently no-op and the release ships
// auto-update metadata describing the *unsigned* binaries — every user's
// auto-update then fails checksum verification. This is the check that closes
// that gap. Prefer failing loudly: an ambiguous or incomplete input must throw,
// never pass by omission.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

function sha512Base64(path) {
  return createHash('sha512').update(readFileSync(path)).digest('base64')
}

// Reads the `files:` array entries out of a latest*.yml. electron-builder
// emits a fixed two-space indented list of `- url:` / `sha512:` / `size:`
// triples (plus, on Linux AppImage entries, an extra `blockMapSize:` line —
// deliberately ignored below: it's indented, so it neither matches one of
// the three known keys nor looks like the non-indented top-level key that
// ends the array). A narrow line reader is used instead of a YAML dependency
// because the file shape is fixed and electron-builder-generated.
export function parseFileEntries(yml) {
  const entries = []
  let current = null
  for (const raw of yml.split('\n')) {
    const urlMatch = /^\s*-\s*url:\s*(.+?)\s*$/.exec(raw)
    if (urlMatch) {
      if (current) entries.push(current)
      current = { url: urlMatch[1], sha512: null, size: null }
      continue
    }
    if (!current) continue
    const shaMatch = /^\s+sha512:\s*(.+?)\s*$/.exec(raw)
    if (shaMatch) {
      current.sha512 = shaMatch[1]
      continue
    }
    const sizeMatch = /^\s+size:\s*(\d+)\s*$/.exec(raw)
    if (sizeMatch) {
      current.size = Number.parseInt(sizeMatch[1], 10)
      continue
    }
    // A non-indented key (path:, sha512:, releaseDate:, ...) ends the files array.
    if (/^\S/.test(raw)) {
      entries.push(current)
      current = null
    }
  }
  if (current) entries.push(current)
  return entries
}

function assertFileMatchesEntry(dir, entry) {
  const path = join(dir, entry.url)
  if (!existsSync(path)) {
    throw new Error(`${entry.url} is referenced by latest.yml but not found in ${dir}`)
  }
  const actualSize = statSync(path).size
  if (entry.size !== actualSize) {
    throw new Error(`size mismatch for ${entry.url}: yml says ${entry.size}, file is ${actualSize}`)
  }
  const actualSha = sha512Base64(path)
  if (entry.sha512 !== actualSha) {
    throw new Error(
      `sha512 mismatch for ${entry.url} — the metadata does not describe the file on disk`
    )
  }
}

export function verifyLatestYml({ ymlPath, dir }) {
  const yml = readFileSync(ymlPath, 'utf8')
  const entries = parseFileEntries(yml)
  if (entries.length === 0) {
    throw new Error(`${ymlPath} lists no files — refusing to treat that as verified`)
  }

  const checked = []
  for (const entry of entries) {
    assertFileMatchesEntry(dir, entry)
    checked.push(entry.url)
  }
  return { ok: true, checked }
}

// CLI: node verify-latest-yml.mjs <ymlPath> <dir>
function main() {
  const [ymlPath, dir] = process.argv.slice(2)
  try {
    const { checked } = verifyLatestYml({ ymlPath, dir })
    process.stdout.write(`latest.yml verified against ${checked.length} file(s)\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`::error::${message}\n`)
    process.exit(1)
  }
}

if (process.argv[1] === import.meta.filename) main()
