/**
 * Batch import logic smoke tests — verifies module exports are intact after extraction.
 *
 * Also covers the failure-classification fix for finding C8 / Codex F-05: a
 * genuine DB/fs/archive failure must throw (so wrapHandler structures it),
 * not be reshaped into a value that looks like a legitimate benign outcome
 * ("no duplicates", "wrong password", "empty extraction").
 */

import { describe, it, expect, vi } from 'vitest'
import AdmZip from 'adm-zip'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as logic from '../../../src/main/ipc/handlers/batch-import-logic'
import type { DatabaseService } from '../../../src/main/database/DatabaseService'

describe('batch-import-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.checkDuplicateFiles).toBe('function')
    expect(typeof logic.startBatchImport).toBe('function')
    expect(typeof logic.cancelBatchImport).toBe('function')
    expect(typeof logic.testZipPassword).toBe('function')
    expect(typeof logic.extractZip).toBe('function')
    expect(typeof logic.cleanupZipTemp).toBe('function')
  })
})

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'varlens-batch-import-logic-test-'))
}

describe('checkDuplicateFiles', () => {
  it('throws on a DB lookup failure instead of returning a false "no duplicates" result', () => {
    const brokenDb = {
      cases: {
        getExistingCaseNames: () => {
          throw new Error('database is locked')
        }
      }
    } as unknown as DatabaseService

    expect(() => logic.checkDuplicateFiles(() => brokenDb, ['/data/a.json'])).toThrow(
      'database is locked'
    )
  })

  it('preserves the legitimate outcome: a real DB lookup with no duplicates returns an empty result', () => {
    const workingDb = {
      cases: {
        getExistingCaseNames: () => new Set<string>()
      }
    } as unknown as DatabaseService

    const result = logic.checkDuplicateFiles(() => workingDb, ['/data/a.json'])

    expect(result).toEqual({
      files: [{ filePath: '/data/a.json', fileName: 'a.json', caseName: 'a', isDuplicate: false }],
      duplicateCount: 0
    })
  })
})

describe('testZipPassword', () => {
  it('throws on a corrupt/unreadable archive instead of reporting it as "wrong password"', () => {
    const dir = makeTempDir()
    const garbagePath = join(dir, 'garbage.zip')
    writeFileSync(garbagePath, Buffer.from('not a zip file at all'))

    expect(() => logic.testZipPassword(garbagePath, 'anypassword')).toThrow()
  })

  it('returns false when a readable archive has no encrypted entries', () => {
    const dir = makeTempDir()
    const validPath = join(dir, 'valid.zip')
    const zip = new AdmZip()
    zip.addFile('case.json', Buffer.from('{}'))
    zip.writeZip(validPath)

    const result = logic.testZipPassword(validPath, 'irrelevant')

    expect(result).toEqual({ success: false })
  })
})

describe('extractZip', () => {
  it('throws on a corrupt/unreadable archive instead of returning a fake-success zero-file result', async () => {
    const dir = makeTempDir()
    const garbagePath = join(dir, 'garbage.zip')
    writeFileSync(garbagePath, Buffer.from('not a zip file at all'))

    await expect(logic.extractZip(garbagePath)).rejects.toThrow()
  })

  it('throws when every candidate entry fails to extract (0 files, N errors) instead of returning a silent no-op success', async () => {
    // Every importable-looking entry is rejected as a path-traversal attempt,
    // so ZipExtractor.extract resolves with { extractedFiles: [], errors: [...] }
    // -- zero files but non-empty errors. A caller reading only `.files` (see
    // ImportWizard.vue's extractAndAdvance) would otherwise see this as an
    // empty-but-successful extraction and silently no-op.
    const dir = makeTempDir()
    const traversalPath = join(dir, 'all-entries-rejected.zip')
    const zip = new AdmZip()
    zip.addFile('placeholder.json', Buffer.from('{}'))
    const entry = zip.getEntries()[0]
    entry.entryName = '../evil.json'
    zip.writeZip(traversalPath)

    await expect(logic.extractZip(traversalPath)).rejects.toThrow(/1 candidate entry/)
  })

  it('fails the archive when any candidate entry fails instead of silently importing a partial set', async () => {
    const dir = makeTempDir()
    const partialPath = join(dir, 'partial.zip')
    const zip = new AdmZip()
    zip.addFile('good.json', Buffer.from('{}'))
    zip.addFile('placeholder.json', Buffer.from('{}'))
    zip.getEntries()[1].entryName = '../evil.json'
    zip.writeZip(partialPath)

    await expect(logic.extractZip(partialPath)).rejects.toThrow(/candidate entry/)
  })

  it('removes its temporary directory after rejecting a partial extraction', async () => {
    const before = readdirSync(tmpdir())
      .filter((name) => name.startsWith('varlens-zip-'))
      .sort()
    const dir = makeTempDir()
    const partialPath = join(dir, 'partial-cleanup.zip')
    const zip = new AdmZip()
    zip.addFile('good.json', Buffer.from('{}'))
    zip.addFile('placeholder.json', Buffer.from('{}'))
    zip.getEntries()[1].entryName = '../evil.json'
    zip.writeZip(partialPath)

    await expect(logic.extractZip(partialPath)).rejects.toThrow(/candidate entry/)

    const after = readdirSync(tmpdir())
      .filter((name) => name.startsWith('varlens-zip-'))
      .sort()
    expect(after).toEqual(before)
  })

  it('preserves the legitimate outcome: an archive with no importable files resolves to an empty result', async () => {
    const dir = makeTempDir()
    const validPath = join(dir, 'no-importable-files.zip')
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('not a variant file'))
    zip.writeZip(validPath)

    const result = await logic.extractZip(validPath)

    expect(result).toMatchObject({ files: [], errors: [] })
    expect(result.extractionId).toMatch(/^[0-9a-f-]{36}$/i)
    logic.cleanupZipTemp(result.extractionId)
  })

  it('keeps extraction directories independent and scopes cleanup authority', async () => {
    const dir = makeTempDir()
    const firstPath = join(dir, 'first.zip')
    const secondPath = join(dir, 'second.zip')
    const first = new AdmZip()
    first.addFile('first.json', Buffer.from('{}'))
    first.writeZip(firstPath)
    const second = new AdmZip()
    second.addFile('second.json', Buffer.from('{}'))
    second.writeZip(secondPath)
    const enroll = vi.fn()
    const revoke = vi.fn()

    const firstResult = await logic.extractZip(firstPath, undefined, enroll, revoke)
    const secondResult = await logic.extractZip(secondPath, undefined, enroll, revoke)
    const firstExtractedPath = firstResult.files[0]
    const secondExtractedPath = secondResult.files[0]

    expect(existsSync(firstExtractedPath)).toBe(true)
    expect(existsSync(secondExtractedPath)).toBe(true)

    logic.cleanupZipTemp(firstResult.extractionId)
    expect(existsSync(firstExtractedPath)).toBe(false)
    expect(existsSync(secondExtractedPath)).toBe(true)
    expect(revoke).toHaveBeenCalledWith(firstExtractedPath)
    expect(revoke).not.toHaveBeenCalledWith(secondExtractedPath)

    logic.cleanupZipTemp(secondResult.extractionId)
    expect(existsSync(secondExtractedPath)).toBe(false)
    expect(revoke).toHaveBeenCalledWith(secondExtractedPath)
  })

  it('bounds active extraction directories when callers omit cleanup', async () => {
    const dir = makeTempDir()
    const archivePath = join(dir, 'bounded.zip')
    const zip = new AdmZip()
    zip.addFile('case.json', Buffer.from('{}'))
    zip.writeZip(archivePath)
    const activeExtractions = []

    try {
      for (let index = 0; index < 4; index++) {
        activeExtractions.push(await logic.extractZip(archivePath))
      }

      await expect(logic.extractZip(archivePath)).rejects.toThrow(/Too many active ZIP extractions/)
    } finally {
      for (const extraction of activeExtractions) {
        logic.cleanupZipTemp(extraction.extractionId)
      }
    }
  })
})
