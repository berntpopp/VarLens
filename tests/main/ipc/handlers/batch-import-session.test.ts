import { describe, expect, it, vi } from 'vitest'

import {
  buildDuplicateReport,
  runSessionBatchImport,
  type SessionBatchFile
} from '../../../../src/main/ipc/handlers/batch-import-session'
import type { StorageSession } from '../../../../src/main/storage/session'

/**
 * Shared batch-import loop (PR-W9a; used by web and desktop-on-Postgres).
 */
function fakeSession(existing: Array<{ id: number; name: string }>) {
  const writeExecute = vi.fn(async () => undefined)
  const importSingleFile = vi.fn(async (params: { caseName: string }) => {
    if (params.caseName === 'broken') throw new Error('parse failure in broken.json')
    return { caseId: 100, variantCount: 3, skipped: 0, errors: [], elapsed: 1 }
  })
  const session = {
    capabilities: { backend: 'postgres' },
    listCases: vi.fn(async () => existing),
    getWriteExecutor: () => ({ execute: writeExecute }),
    getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() })
  } as unknown as StorageSession
  return { session, writeExecute, importSingleFile }
}

function file(name: string): SessionBatchFile {
  return { inputPath: `ref:${name}`, storedPath: `/stage/${name}`, fileName: name }
}

describe('runSessionBatchImport', () => {
  it('skips duplicates, imports new cases and reports failures per file', async () => {
    const { session, importSingleFile } = fakeSession([{ id: 1, name: 'HG001' }])
    const stale: boolean[] = []
    const result = await runSessionBatchImport({
      files: [file('HG001.json'), file('HG002.json'), file('broken.json')],
      duplicateStrategy: 'skip',
      session,
      callbacks: { onCohortStale: (d) => stale.push(d.is_stale) },
      signal: new AbortController().signal
    })

    expect(result).toMatchObject({ succeeded: 1, failed: 1, skipped: 1, cancelled: false })
    expect(result.details.map((d) => [d.caseName, d.status])).toEqual([
      ['HG001', 'skipped'],
      ['HG002', 'success'],
      ['broken', 'failed']
    ])
    expect(result.details[0].filePath).toBe('ref:HG001.json')
    expect(importSingleFile).toHaveBeenCalledTimes(2)
    expect(stale).toEqual([true, false])
  })

  it('overwrite deletes the existing case before importing it again', async () => {
    const { session, writeExecute } = fakeSession([{ id: 5, name: 'HG001' }])
    const result = await runSessionBatchImport({
      files: [file('HG001.json')],
      duplicateStrategy: 'overwrite',
      session,
      callbacks: {},
      signal: new AbortController().signal
    })
    expect(writeExecute).toHaveBeenCalledWith({ type: 'cases:delete', params: [5] })
    expect(result.succeeded).toBe(1)
  })

  it('stops at the next file once cancelled', async () => {
    const { session } = fakeSession([])
    const controller = new AbortController()
    controller.abort()
    const result = await runSessionBatchImport({
      files: [file('HG001.json')],
      duplicateStrategy: 'skip',
      session,
      callbacks: {},
      signal: controller.signal
    })
    expect(result).toMatchObject({ succeeded: 0, cancelled: true })
  })
})

describe('buildDuplicateReport', () => {
  it('applies the strip text before matching', () => {
    expect(
      buildDuplicateReport(
        [{ filePath: '/a/HG001_final.json.gz', fileName: 'HG001_final.json.gz' }],
        new Set(['HG001']),
        '_final'
      )
    ).toEqual({
      files: [
        {
          filePath: '/a/HG001_final.json.gz',
          fileName: 'HG001_final.json.gz',
          caseName: 'HG001',
          isDuplicate: true
        }
      ],
      duplicateCount: 1
    })
  })
})
