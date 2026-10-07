// Payload identity: proves the app a Windows installer lays down is the app
// build.yml built, file for file, with signatures as the only difference.
//
// The release re-wraps the installers around a signed copy of the promoted
// app directory, so "release ships build.yml's bytes" can no longer be checked
// with one checksum per installer. It is checked here instead: every file is
// compared by sha256, and every executable by a digest that ignores exactly
// what Authenticode is allowed to change (see pe-signature.mjs).
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { inspectPe, signatureStrippedDigest } from './pe-signature.mjs'

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

function listFiles(dir) {
  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.push(full)
    }
  }
  walk(dir)
  return files.sort()
}

async function fileIdentity(path) {
  if (path.toLowerCase().endsWith('.exe') && inspectPe(path).isPe) {
    return `image:${signatureStrippedDigest(path)}`
  }
  return `sha256:${await sha256File(path)}`
}

/** Maps every file under `dir` (posix path relative to it) to its identity digest. */
export async function snapshotTree(dir) {
  const snapshot = new Map()
  for (const path of listFiles(dir)) {
    snapshot.set(relative(dir, path).split(sep).join('/'), await fileIdentity(path))
  }
  return snapshot
}

/**
 * Compares a candidate tree against a reference snapshot. Returns a list of
 * human-readable differences — empty means identical. `allowedExtra` names
 * files the candidate may add (the NSIS elevate helper).
 */
export async function comparePayload(reference, candidateDir, { allowedExtra = [] } = {}) {
  const candidate = await snapshotTree(candidateDir)
  const differences = []
  for (const [path, identity] of reference) {
    if (!candidate.has(path)) differences.push(`missing: ${path}`)
    else if (candidate.get(path) !== identity) differences.push(`changed: ${path}`)
  }
  for (const path of candidate.keys()) {
    if (!reference.has(path) && !allowedExtra.includes(path)) {
      differences.push(`unexpected: ${path}`)
    }
  }
  return differences
}
