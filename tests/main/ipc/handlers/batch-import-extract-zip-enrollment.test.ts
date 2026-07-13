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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractZip, cleanupZipTemp } from '../../../../src/main/ipc/handlers/batch-import-logic'
import { ZipExtractor } from '../../../../src/main/import/ZipExtractor'
import {
  __resetAllowlistForTests,
  addAllowedImportPath,
  isStrictlyEnrolledPath,
  removeAllowedImportPath
} from '../../../../src/main/security/import-path-allowlist'

describe('extractZip — enrolls extracted files for the strict path-authority gate', () => {
  let sourceDir: string
  const extractionIds = new Set<string>()

  beforeEach(() => {
    __resetAllowlistForTests()
    extractionIds.clear()
    sourceDir = mkdtempSync(join(tmpdir(), 'varlens-zip-src-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const extractionId of extractionIds) cleanupZipTemp(extractionId)
    extractionIds.clear()
    rmSync(sourceDir, { recursive: true, force: true })
  })

  it('enrolls each extracted file so the subsequent strict-gated call accepts it', async () => {
    const zipPath = join(sourceDir, 'batch.zip')
    const zip = new AdmZip()
    zip.addFile('case1.json', Buffer.from('{"case":"1"}'))
    zip.addFile('case2.json.gz', Buffer.from('not-really-gzipped-but-fine-for-this-test'))
    zip.writeZip(zipPath)

    // Nothing extracted yet is enrolled (the temp dir doesn't even exist).
    // The desktop IPC handler passes addAllowedImportPath here after it has
    // validated the ZIP path against the strict dialog-enrolled allowlist.
    const result = await extractZip(
      zipPath,
      undefined,
      addAllowedImportPath,
      removeAllowedImportPath
    )
    extractionIds.add(result.extractionId)

    expect(result.errors).toEqual([])
    expect(result.files.length).toBe(2)
    for (const extractedFile of result.files) {
      expect(isStrictlyEnrolledPath(extractedFile)).toBe(true)
    }

    cleanupZipTemp(result.extractionId)
    for (const extractedFile of result.files) {
      expect(isStrictlyEnrolledPath(extractedFile)).toBe(false)
    }
  })

  it('keeps concurrent extraction ownership isolated during targeted cleanup', async () => {
    const createZip = (name: string, caseName: string): string => {
      const zipPath = join(sourceDir, name)
      const zip = new AdmZip()
      zip.addFile(`${caseName}.json`, Buffer.from(`{"case":"${caseName}"}`))
      zip.writeZip(zipPath)
      return zipPath
    }

    const [first, second] = await Promise.all(
      [createZip('first.zip', 'first'), createZip('second.zip', 'second')].map((zipPath) =>
        extractZip(zipPath, undefined, addAllowedImportPath, removeAllowedImportPath)
      )
    )
    extractionIds.add(first.extractionId)
    extractionIds.add(second.extractionId)

    expect(first.extractionId).not.toBe(second.extractionId)
    expect(first.files).toHaveLength(1)
    expect(second.files).toHaveLength(1)
    expect(isStrictlyEnrolledPath(first.files[0])).toBe(true)
    expect(isStrictlyEnrolledPath(second.files[0])).toBe(true)

    cleanupZipTemp(first.extractionId)

    expect(isStrictlyEnrolledPath(first.files[0])).toBe(false)
    expect(isStrictlyEnrolledPath(second.files[0])).toBe(true)

    // A stale cleanup capability is idempotent and cannot revoke another
    // extraction's enrollment.
    cleanupZipTemp(first.extractionId)
    expect(isStrictlyEnrolledPath(second.files[0])).toBe(true)
  })

  it('does not let cleanup of a completed extraction disturb another extraction in flight', async () => {
    const firstZip = join(sourceDir, 'first.zip')
    const secondZip = join(sourceDir, 'second.zip')
    for (const [zipPath, caseName] of [
      [firstZip, 'first'],
      [secondZip, 'second']
    ] as const) {
      const zip = new AdmZip()
      zip.addFile(`${caseName}.json`, Buffer.from(`{"case":"${caseName}"}`))
      zip.writeZip(zipPath)
    }

    const originalExtract = ZipExtractor.prototype.extract
    let releaseSecond!: () => void
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    let markSecondStarted!: () => void
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve
    })
    vi.spyOn(ZipExtractor.prototype, 'extract').mockImplementation(
      async function (zipPath, targetDir, password) {
        if (zipPath === secondZip) {
          markSecondStarted()
          await secondGate
        }
        return originalExtract.call(this, zipPath, targetDir, password)
      }
    )

    const first = await extractZip(
      firstZip,
      undefined,
      addAllowedImportPath,
      removeAllowedImportPath
    )
    extractionIds.add(first.extractionId)
    const secondPromise = extractZip(
      secondZip,
      undefined,
      addAllowedImportPath,
      removeAllowedImportPath
    )
    await secondStarted

    cleanupZipTemp(first.extractionId)
    expect(isStrictlyEnrolledPath(first.files[0])).toBe(false)

    releaseSecond()
    const second = await secondPromise
    extractionIds.add(second.extractionId)
    expect(second.errors).toEqual([])
    expect(second.files).toHaveLength(1)
    expect(isStrictlyEnrolledPath(second.files[0])).toBe(true)
  })
})
