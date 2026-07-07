/**
 * Batch import logic smoke tests — verifies module exports are intact after extraction.
 *
 * Also covers the failure-classification fix for finding C8 / Codex F-05: a
 * genuine DB/fs/archive failure must throw (so wrapHandler structures it),
 * not be reshaped into a value that looks like a legitimate benign outcome
 * ("no duplicates", "wrong password", "empty extraction").
 */

import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtempSync, writeFileSync } from 'fs'
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

  it('preserves the legitimate outcome: a real password check on a valid archive returns a structured result', () => {
    const dir = makeTempDir()
    const validPath = join(dir, 'valid.zip')
    const zip = new AdmZip()
    zip.addFile('case.json', Buffer.from('{}'))
    zip.writeZip(validPath)

    const result = logic.testZipPassword(validPath, 'irrelevant')

    expect(result).toEqual({ success: true })
  })
})

describe('extractZip', () => {
  it('throws on a corrupt/unreadable archive instead of returning a fake-success zero-file result', async () => {
    const dir = makeTempDir()
    const garbagePath = join(dir, 'garbage.zip')
    writeFileSync(garbagePath, Buffer.from('not a zip file at all'))

    await expect(logic.extractZip(garbagePath)).rejects.toThrow()
  })

  it('preserves the legitimate outcome: an archive with no importable files resolves to an empty result', async () => {
    const dir = makeTempDir()
    const validPath = join(dir, 'no-importable-files.zip')
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('not a variant file'))
    zip.writeZip(validPath)

    const result = await logic.extractZip(validPath)

    expect(result).toEqual({ files: [], errors: [] })
  })
})
