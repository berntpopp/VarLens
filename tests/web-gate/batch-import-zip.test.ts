/**
 * Web ZIP batch import (P-08, PR-W9a): the empirical `zip-probe.cjs`
 * scenario as a test. Upload → inspect → extract through the dispatcher
 * overrides, for a plain and an encrypted archive.
 *
 * Before: the web client derived "encrypted" from
 * `testZipPassword(ref, '')`, which is `{ success: false }` for an archive
 * WITHOUT encrypted entries, so every plain ZIP was reported as
 * password-protected. `batch-import:inspectZip` uses the same `inspectZip`
 * as desktop `selectZip`.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { buildDispatcher } from '../../src/web/server/dispatcher'
import { stageExistingFileUpload } from '../../src/web/server/routes/upload-staging'
import { writeEncryptedZip, writePlainZip } from '../utils/zip-fixtures'
import { makeDeps } from './helpers/dispatcher-adapters'

const USER_ID = 7
const request = { session: { user: { id: USER_ID, username: 'analyst', role: 'user' } } }

let tempDir: string
const previous = { nodeEnv: process.env.NODE_ENV, keyDir: process.env.VARLENS_RECOVERY_KEY_DIR }

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-zip-'))
  process.env.NODE_ENV = 'production'
  process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
})

afterEach(async () => {
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previous.nodeEnv
  if (previous.keyDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
  else process.env.VARLENS_RECOVERY_KEY_DIR = previous.keyDir
  await rm(tempDir, { recursive: true, force: true })
})

async function stageZip(name: string, write: (path: string) => void): Promise<string> {
  const sourcePath = join(tempDir, name)
  write(sourcePath)
  const upload = await stageExistingFileUpload({ userId: USER_ID, originalName: name, sourcePath })
  return upload.ref
}

async function invoke(method: string, args: unknown[]) {
  const { deps, reply } = makeDeps()
  const { overrides } = buildDispatcher(deps)
  const result = await overrides[`batch-import:${method}`].handle(
    args,
    request as never,
    reply as never,
    deps
  )
  return { result, reply }
}

describe('web ZIP batch import', () => {
  test('a plain ZIP is not password-protected and extracts its cases', async () => {
    const ref = await stageZip('plain.zip', (path) =>
      writePlainZip(path, { 'HG001.json': '{"variants":[]}', 'notes.txt': 'skip me' })
    )

    const inspected = await invoke('inspectZip', [ref])
    expect(inspected.result).toEqual({ isEncrypted: false })

    const extracted = await invoke('extractZip', [ref, ''])
    const body = extracted.result as { files: string[]; errors: string[] }
    expect(body.errors).toEqual([])
    expect(body.files).toHaveLength(1)
    expect(body.files[0]).toMatch(/^web-upload:.*HG001\.json$/)
  })

  test('an encrypted ZIP is reported as protected and opens with the right password', async () => {
    const ref = await stageZip('secret.zip', (path) =>
      writeEncryptedZip(path, 'HG002.json', '{"variants":[]}', 'hunter2')
    )

    expect((await invoke('inspectZip', [ref])).result).toEqual({ isEncrypted: true })
    expect((await invoke('testZipPassword', [ref, 'wrong'])).result).toEqual({ success: false })
    expect((await invoke('testZipPassword', [ref, 'hunter2'])).result).toEqual({ success: true })

    const extracted = (await invoke('extractZip', [ref, 'hunter2'])).result as { files: string[] }
    expect(extracted.files).toHaveLength(1)
  })

  test('inspectZip only accepts the caller’s own upload refs', async () => {
    const bad = await invoke('inspectZip', ['/etc/passwd'])
    expect(bad.reply.code).toHaveBeenCalledWith(400)

    const missing = await invoke('inspectZip', ['web-upload:nope/x.zip'])
    expect(missing.reply.code).toHaveBeenCalledWith(404)
  })
})
