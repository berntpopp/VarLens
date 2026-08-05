#!/usr/bin/env node
// Asserts the installed native binary is the artifact built for <target>.
// Replaces `@electron/rebuild -f` as the wrong-ABI safeguard.
// Usage: node scripts/native/assert-native-abi.mjs <node|electron>
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
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

// For the node target we can go further and prove it actually loads here.
// (An electron-ABI binary cannot be loaded by this process, by definition.)
if (target === 'node') {
  try {
    createRequire(import.meta.url)(MODULE_BINARY)
  } catch (error) {
    fail(`binary matched the manifest but failed to load: ${error.message}`)
  }
}

// For the electron target, the sha256 comparison above only proves the binary
// matches its own manifest — which is exactly what a poisoned cache entry
// would also show (see rebuild-native.mjs). Independently detect the ABI of
// the file on disk so this cannot pass on a manifest describing the wrong
// artifact.
if (target === 'electron') {
  const detectedAbi = detectBinaryAbi(MODULE_BINARY)
  if (detectedAbi !== abiFor('electron')) {
    fail(
      `installed binary reports ABI ${detectedAbi} on independent detection, ` +
        `but the manifest claims ABI ${manifest.abi}. The cache is poisoned — ` +
        `re-run \`npm run rebuild:electron\`.`
    )
  }
}

process.stdout.write(`assert-native-abi: OK ${target} ABI ${manifest.abi}\n`)
