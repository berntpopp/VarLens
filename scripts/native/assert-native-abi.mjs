#!/usr/bin/env node
// Asserts the installed native binary is the artifact built for <target>.
// Replaces `@electron/rebuild -f` as the wrong-ABI safeguard.
// Usage: node scripts/native/assert-native-abi.mjs <node|electron>
import { existsSync } from 'node:fs'
import process from 'node:process'

import {
  MODULE_BINARY,
  abiFor,
  detectBinaryAbi,
  manifestIsFresh,
  readManifest,
  sha256
} from './native-abi.mjs'

const target = process.argv[2]

if (target !== 'node' && target !== 'electron') {
  process.stderr.write('usage: assert-native-abi.mjs <node|electron>\n')
  process.exit(2)
}

const fail = (message) => {
  process.stderr.write(`assert-native-abi: FAIL (${target}): ${message}\n`)
  process.exit(1)
}

if (!existsSync(MODULE_BINARY)) fail(`${MODULE_BINARY} does not exist`)

const manifest = readManifest(target)
if (!manifestIsFresh(target, manifest)) {
  fail(
    `no fresh cache manifest for ABI ${abiFor(target)}. ` +
      `Run \`npm run rebuild:${target === 'node' ? 'node' : 'electron'}\` first.`
  )
}

if (sha256(MODULE_BINARY) !== manifest.sha256) {
  fail(
    `installed binary does not match the ${target} artifact (ABI ${manifest.abi}). ` +
      'The tree is on the wrong ABI — this would fail at runtime with NODE_MODULE_VERSION.'
  )
}

// The sha256 comparison above only proves the binary matches its own cache
// manifest — which is exactly what a poisoned cache entry also shows (see
// rebuild-native.mjs). Independently detect the ABI of the file on disk so
// this cannot pass on a manifest describing the wrong artifact. Unlike a
// bare `require()`, detectBinaryAbi() probes in a disposable child process,
// so a truncated/corrupt binary fails this assertion cleanly instead of
// crashing it with an uncatchable signal.
//
// Detection failing outright ("could not determine") is not the same as a
// definite mismatch, but this script's whole job is to be certain — unlike
// rebuild-native.mjs, which degrades gracefully so a platform where
// detection doesn't work can't break `npm ci`, an assertion that can't
// verify anything must fail loudly rather than pass by default.
let detectedAbi
try {
  detectedAbi = detectBinaryAbi(MODULE_BINARY)
} catch (error) {
  fail(`could not determine the on-disk binary's real ABI: ${error.message}`)
}

if (detectedAbi !== abiFor(target)) {
  fail(
    `installed binary reports ABI ${detectedAbi} on independent detection, but the manifest ` +
      `claims ABI ${manifest.abi}. The cache is poisoned — re-run \`npm run rebuild:${target}\`.`
  )
}

process.stdout.write(`assert-native-abi: OK ${target} ABI ${manifest.abi}\n`)
