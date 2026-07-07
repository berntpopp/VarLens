/**
 * F-path hardening (Codex-high finding): batch-import:checkDuplicates and
 * batch-import:start now gate on isStrictlyEnrolledPath, which only accepts
 * paths explicitly enrolled via addAllowedImportPath this session. A file
 * extracted from a dialog-enrolled ZIP was never itself picked via a
 * dialog, so extractZip must explicitly enroll each extracted file — this
 * is the "ZIP extract -> review -> start" continuity the strict gate
 * depends on.
 *
 * This lives in its own file (rather than batch-import-logic.test.ts) so
 * extractZip's real ZipExtractor/TempDirectoryManager path is exercised
 * without interacting with that file's ImportWorkerClient mock, which
 * relies on a lazy dynamic import specifically to avoid eager module
 * evaluation ordering issues with its hoisted vi.mock factory.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractZip, cleanupZipTemp } from '../../../../src/main/ipc/handlers/batch-import-logic'
import {
  __resetAllowlistForTests,
  isStrictlyEnrolledPath
} from '../../../../src/main/security/import-path-allowlist'

describe('extractZip — enrolls extracted files for the strict path-authority gate', () => {
  let sourceDir: string

  beforeEach(() => {
    __resetAllowlistForTests()
    sourceDir = mkdtempSync(join(tmpdir(), 'varlens-zip-src-'))
  })

  afterEach(() => {
    cleanupZipTemp()
    rmSync(sourceDir, { recursive: true, force: true })
  })

  it('enrolls each extracted file so the subsequent strict-gated call accepts it', async () => {
    const zipPath = join(sourceDir, 'batch.zip')
    const zip = new AdmZip()
    zip.addFile('case1.json', Buffer.from('{"case":"1"}'))
    zip.addFile('case2.json.gz', Buffer.from('not-really-gzipped-but-fine-for-this-test'))
    zip.writeZip(zipPath)

    // Nothing extracted yet is enrolled (the temp dir doesn't even exist).
    const result = await extractZip(zipPath)

    expect(result.errors).toEqual([])
    expect(result.files.length).toBe(2)
    for (const extractedFile of result.files) {
      expect(isStrictlyEnrolledPath(extractedFile)).toBe(true)
    }
  })
})
