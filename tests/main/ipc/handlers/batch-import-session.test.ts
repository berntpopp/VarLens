import { describe, expect, it, vi } from 'vitest'

import {
  buildDuplicateReport,
  runSessionBatchImport,
  type SessionBatchFile
} from '../../../../src/main/ipc/handlers/batch-import-session'
import type { StorageSession } from '../../../../src/main/storage/session'
import type { BatchFileComplete } from '../../../../src/shared/types/api'

/**
 * Shared batch-import loop (PR-W9a; used by web and desktop-on-Postgres).
 */
function fakeSession(existing: Array<{ id: number; name: string }>) {
  const cases = [...existing]
  const events: string[] = []
  const writeExecute = vi.fn(async (task: { params: [number, { id: number; name: string }?] }) => {
    const [caseId, successor] = task.params
    events.push(`delete:${caseId}`)
    cases.splice(
      cases.findIndex((c) => c.id === caseId),
      1
    )
    const renamed = cases.find((c) => c.id === successor?.id)
    if (renamed && successor) renamed.name = successor.name
  })
  let nextCaseId = 100
  const importSingleFile = vi.fn(async (params: { caseName: string }) => {
    events.push(`import:${params.caseName}`)
    if (params.caseName.startsWith('broken')) throw new Error('parse failure in broken.json')
    cases.push({ id: nextCaseId, name: params.caseName })
    return { caseId: nextCaseId++, variantCount: 3, skipped: 0, errors: [], elapsed: 1 }
  })
  const session = {
    capabilities: { backend: 'postgres' },
    listCases: vi.fn(async () => cases.map((c) => ({ ...c }))),
    getWriteExecutor: () => ({ execute: writeExecute }),
    getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() })
  } as unknown as StorageSession
  return { session, writeExecute, importSingleFile, cases, events }
}

function file(name: string): SessionBatchFile {
  return { inputPath: `ref:${name}`, storedPath: `/stage/${name}`, fileName: name }
}

describe('runSessionBatchImport', () => {
  it('skips duplicates, imports new cases and reports failures per file', async () => {
    const { session, importSingleFile } = fakeSession([{ id: 1, name: 'HG001' }])
    const stale: boolean[] = []
    const completed: BatchFileComplete[] = []
    const result = await runSessionBatchImport({
      files: [file('HG001.json'), file('HG002.json'), file('broken.json')],
      duplicateStrategy: 'skip',
      session,
      callbacks: {
        onCohortStale: (d) => stale.push(d.is_stale),
        onFileComplete: (event) => completed.push(event)
      },
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
    // Each case is visible, and the cohort summary valid, as soon as its own
    // file finishes: a batch never flags the summary stale.
    expect(stale).toEqual([])
    expect(completed.map((event) => [event.index, event.caseName, event.status])).toEqual([
      [0, 'HG001', 'skipped'],
      [1, 'HG002', 'success'],
      [2, 'broken', 'failed']
    ])
    expect(completed.every((event) => event.totalFiles === 3)).toBe(true)
  })

  const overwrite = (session: StorageSession, names: string[]) =>
    runSessionBatchImport({
      files: names.map(file),
      duplicateStrategy: 'overwrite',
      session,
      callbacks: {},
      signal: new AbortController().signal
    })

  // #493: the old case goes only once its replacement is imported.
  it('overwrite imports the replacement under a temporary name, then swaps it in', async () => {
    const { session, writeExecute, cases, events } = fakeSession([{ id: 5, name: 'HG001' }])
    const result = await overwrite(session, ['HG001.json'])
    expect(events).toEqual(['import:HG001 (replacing #5)', 'delete:5'])
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'cases:delete',
      params: [5, { id: 100, name: 'HG001' }]
    })
    expect(cases).toEqual([{ id: 100, name: 'HG001' }])
    expect(result.succeeded).toBe(1)
  })

  it('overwrite first removes a replacement an interrupted overwrite left behind', async () => {
    const { session, cases, events } = fakeSession([
      { id: 5, name: 'HG001' },
      { id: 9, name: 'HG001 (replacing #5)' }
    ])
    const result = await overwrite(session, ['HG001.json'])
    expect(events).toEqual(['delete:9', 'import:HG001 (replacing #5)', 'delete:5'])
    expect(cases).toEqual([{ id: 100, name: 'HG001' }])
    expect(result.succeeded).toBe(1)
  })

  it('overwrite keeps the existing case when the replacement fails to import', async () => {
    const { session, writeExecute, cases } = fakeSession([{ id: 5, name: 'broken' }])
    const result = await overwrite(session, ['broken.json'])
    expect(result).toMatchObject({ succeeded: 0, failed: 1 })
    expect(writeExecute).not.toHaveBeenCalled()
    expect(cases).toEqual([{ id: 5, name: 'broken' }])
  })

  it('overwrite removes the replacement when the swap fails before it committed', async () => {
    const { session, writeExecute, cases } = fakeSession([{ id: 5, name: 'HG001' }])
    writeExecute.mockRejectedValueOnce(new Error('summary lock timeout'))
    const result = await overwrite(session, ['HG001.json'])
    expect(result).toMatchObject({ succeeded: 0, failed: 1 })
    expect(cases).toEqual([{ id: 5, name: 'HG001' }])
  })

  it('overwrite keeps the replacement when the swap committed but its purge failed', async () => {
    const { session, writeExecute, cases } = fakeSession([{ id: 5, name: 'HG001' }])
    const swap = writeExecute.getMockImplementation()!
    writeExecute.mockImplementationOnce(async (task) => {
      await swap(task)
      throw new Error('purge interrupted')
    })
    const result = await overwrite(session, ['HG001.json'])
    expect(result.succeeded).toBe(1)
    expect(writeExecute).toHaveBeenCalledTimes(1)
    expect(cases).toEqual([{ id: 100, name: 'HG001' }])
  })

  it('two files for one case: the last wins, and a failed one changes nothing', async () => {
    const first = fakeSession([{ id: 5, name: 'HG001' }])
    await overwrite(first.session, ['HG001.json', 'HG001.vcf'])
    expect(first.events).toEqual([
      'import:HG001 (replacing #5)',
      'delete:5',
      'import:HG001 (replacing #100)',
      'delete:100'
    ])
    expect(first.cases).toEqual([{ id: 101, name: 'HG001' }])

    const second = fakeSession([{ id: 5, name: 'broken' }])
    second.importSingleFile.mockRejectedValueOnce(new Error('truncated'))
    const result = await overwrite(second.session, ['broken.json', 'broken.vcf'])
    expect(result).toMatchObject({ failed: 2 })
    expect(second.cases).toEqual([{ id: 5, name: 'broken' }])
  })

  it('names VCF cases without the inner extension', async () => {
    const { session, importSingleFile } = fakeSession([])
    const result = await runSessionBatchImport({
      files: [file('SIM-0001.vcf.gz'), file('SIM-0002.vcf')],
      duplicateStrategy: 'skip',
      session,
      callbacks: {},
      signal: new AbortController().signal
    })
    expect(result.details.map((d) => d.caseName)).toEqual(['SIM-0001', 'SIM-0002'])
    expect(importSingleFile.mock.calls.map(([params]) => params.caseName)).toEqual([
      'SIM-0001',
      'SIM-0002'
    ])
  })

  it('skips a file whose case was imported before ".vcf" was stripped from names', async () => {
    const { session, importSingleFile } = fakeSession([{ id: 7, name: 'SIM-0001.vcf' }])
    const result = await runSessionBatchImport({
      files: [file('SIM-0001.vcf.gz')],
      duplicateStrategy: 'skip',
      session,
      callbacks: {},
      signal: new AbortController().signal
    })
    expect(result).toMatchObject({ succeeded: 0, skipped: 1 })
    expect(result.details[0]).toMatchObject({ caseName: 'SIM-0001.vcf', status: 'skipped' })
    expect(importSingleFile).not.toHaveBeenCalled()
  })

  it('overwrite replaces such a legacy-named case in place instead of adding a twin', async () => {
    const { session, writeExecute, importSingleFile, cases } = fakeSession([
      { id: 7, name: 'SIM-0001.vcf' }
    ])
    const result = await runSessionBatchImport({
      files: [file('SIM-0001.vcf.gz')],
      duplicateStrategy: 'overwrite',
      session,
      callbacks: {},
      signal: new AbortController().signal
    })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'cases:delete',
      params: [7, { id: 100, name: 'SIM-0001.vcf' }]
    })
    expect(importSingleFile.mock.calls.map(([params]) => params.caseName)).toEqual([
      'SIM-0001.vcf (replacing #7)'
    ])
    expect(cases).toEqual([{ id: 100, name: 'SIM-0001.vcf' }])
    expect(result.succeeded).toBe(1)
  })

  // A cancelled Postgres import resolves with case 0 instead of rejecting.
  it('a cancelled overwrite keeps the existing case and reports the batch cancelled', async () => {
    const { session, importSingleFile, writeExecute, cases } = fakeSession([
      { id: 7, name: 'HG001' }
    ])
    importSingleFile.mockResolvedValueOnce({
      caseId: 0,
      variantCount: 0,
      skipped: 0,
      errors: ['cancelled'],
      elapsed: 0
    })
    const result = await overwrite(session, ['HG001.json', 'HG002.json'])
    expect(writeExecute).not.toHaveBeenCalled()
    expect(cases).toEqual([{ id: 7, name: 'HG001' }])
    expect(result).toMatchObject({ succeeded: 0, failed: 0, cancelled: true, details: [] })
    expect(importSingleFile).toHaveBeenCalledTimes(1)
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

  it('detects a case imported before ".vcf" was stripped as a duplicate of the same file', () => {
    const report = buildDuplicateReport(
      [
        { filePath: '/a/X.vcf.gz', fileName: 'X.vcf.gz' },
        { filePath: '/a/Y.vcf.gz', fileName: 'Y.vcf.gz' },
        { filePath: '/a/Z.vcf', fileName: 'Z.vcf' }
      ],
      new Set(['X.vcf', 'Z'])
    )
    expect(report.duplicateCount).toBe(2)
    expect(report.files.map((f) => [f.caseName, f.isDuplicate])).toEqual([
      ['X.vcf', true],
      ['Y', false],
      ['Z', true]
    ])
  })
})
