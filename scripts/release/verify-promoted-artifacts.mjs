// Verifies one platform's promoted artifact set before it is published as a
// signed release. This is the gate between "a set of downloaded binaries"
// and "what users install" — every check here is the difference between
// shipping the right installer and shipping a plausible-looking wrong one.
// Prefer failing loudly: an ambiguous or incomplete input must throw, never
// pass by omission.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { expectedArtifacts } from './artifact-manifest.mjs'

// The only two files in a promoted-artifact directory that are not
// themselves shipped artifacts. Anything else on disk is unexpected.
const NON_ARTIFACT_FILES = new Set(['provenance.json', 'SHA256SUMS'])

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// Tolerates real sha256sum/shasum output: one-or-more whitespace between the
// hex digest and the filename (canonical `sha256sum` emits exactly two
// spaces for text mode), and an optional leading `*` binary-mode marker on
// the filename. A later task generates this file with `shasum -a 256` on
// Linux, macOS and Windows-Git-Bash runners, so the parser has to accept
// whatever those actually produce, not just the two-space case.
function parseChecksums(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(trimmed)
    if (!match) throw new Error(`malformed SHA256SUMS line: ${trimmed}`)
    map.set(match[2], match[1].toLowerCase())
  }
  return map
}

function readProvenance(dir) {
  const provenancePath = join(dir, 'provenance.json')
  if (!existsSync(provenancePath)) {
    throw new Error(`missing provenance.json in ${dir} — the artifact set is not promotable`)
  }
  return JSON.parse(readFileSync(provenancePath, 'utf8'))
}

function assertProvenanceMatches(provenance, { version, sha }) {
  if (provenance.sha !== sha) {
    throw new Error(
      `provenance sha mismatch: artifact was built from ${String(provenance.sha)}, releasing ${sha}`
    )
  }
  if (provenance.version !== version) {
    throw new Error(
      `provenance version mismatch: artifact declares ${String(provenance.version)}, releasing ${version}`
    )
  }
}

function readChecksums(dir) {
  const sumsPath = join(dir, 'SHA256SUMS')
  if (!existsSync(sumsPath)) throw new Error(`missing SHA256SUMS in ${dir}`)
  return parseChecksums(readFileSync(sumsPath, 'utf8'))
}

// Enforces an EXACT set, not a superset check. Both enumerations below are
// required, not redundant: Task 6's upload step re-globs the promoted
// directory by extension rather than reading SHA256SUMS, so a planted file
// that is present on disk but never entered into SHA256SUMS would still ship
// — checking SHA256SUMS alone cannot see it. Conversely, a phantom entry
// added to SHA256SUMS for a file that was never written to disk doesn't get
// uploaded by the glob, but it does mean SHA256SUMS no longer accurately
// describes what shipped, which is its entire purpose — checking the
// directory alone cannot see that either.

// Every file physically present (other than the two metadata files) must be
// one this platform/version is actually expecting.
function assertNoUnexpectedFilesOnDisk(dir, expectedSet) {
  for (const name of readdirSync(dir)) {
    if (NON_ARTIFACT_FILES.has(name)) continue
    if (!expectedSet.has(name)) {
      throw new Error(`unexpected file in promoted artifact set: ${name}`)
    }
  }
}

// Every checksum entry must name an expected artifact — an entry for a file
// this platform/version was never supposed to produce is unexpected even if
// no such file exists on disk right now.
function assertNoUnexpectedChecksumEntries(sums, expectedSet) {
  for (const name of sums.keys()) {
    if (!expectedSet.has(name)) {
      throw new Error(`unexpected entry in SHA256SUMS: ${name}`)
    }
  }
}

function assertArtifactMatchesChecksum(dir, name, sums) {
  const path = join(dir, name)
  if (!existsSync(path)) throw new Error(`missing expected artifact: ${name}`)
  const recorded = sums.get(name)
  if (!recorded) throw new Error(`${name} is present but not listed in SHA256SUMS`)
  const actual = sha256File(path)
  if (actual !== recorded) {
    throw new Error(`checksum mismatch for ${name}: expected ${recorded}, got ${actual}`)
  }
}

export function verifyPromotedArtifacts({ dir, platform, version, sha }) {
  const provenance = readProvenance(dir)
  assertProvenanceMatches(provenance, { version, sha })

  const sums = readChecksums(dir)
  const expected = expectedArtifacts(platform, version)
  const expectedSet = new Set(expected)

  assertNoUnexpectedFilesOnDisk(dir, expectedSet)
  assertNoUnexpectedChecksumEntries(sums, expectedSet)

  for (const name of expected) {
    assertArtifactMatchesChecksum(dir, name, sums)
  }

  return { ok: true }
}

// CLI: node verify-promoted-artifacts.mjs <dir> <platform> <version> <sha>
function main() {
  const [dir, platform, version, sha] = process.argv.slice(2)
  try {
    verifyPromotedArtifacts({ dir, platform, version, sha })
    process.stdout.write(`promoted artifacts verified: ${platform} ${version} @ ${sha}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`::error::${message}\n`)
    process.exit(1)
  }
}

if (process.argv[1] === import.meta.filename) main()
