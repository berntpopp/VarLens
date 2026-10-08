import { describe, expect, it, vi } from 'vitest'

import {
  BatchProgressTracker,
  groupIntoChains,
  runChains
} from '../../../../src/main/ipc/handlers/batch-import-pool'
import {
  runSessionBatchImport,
  type SessionBatchFile
} from '../../../../src/main/ipc/handlers/batch-import-session'
import { startImport } from '../../../../src/main/ipc/handlers/import-logic'
import type { StorageSession } from '../../../../src/main/storage/session'
import type { BatchFileComplete, BatchProgress } from '../../../../src/shared/types/api'

/**
 * Parallel batch import: several files load at once, each case appears as
 * soon as it is done, and the outcome matches importing them one by one.
 */
interface Pending {
  caseName: string
  resolve: () => void
  reject: (error: Error) => void
}

function parallelSession(existing: Array<{ id: number; name: string }> = []) {
  const pending: Pending[] = []
  const started: string[] = []
  const events: string[] = []
  let nextCaseId = 100
  const batch = {
    importFile: vi.fn(
      (params: { caseName: string }) =>
        new Promise<{ caseId: number; variantCount: number }>((resolve, reject) => {
          started.push(params.caseName)
          pending.push({
            caseName: params.caseName,
            resolve: () => resolve({ caseId: nextCaseId++, variantCount: 3 }),
            reject
          })
        })
    ),
    cancelAll: vi.fn(() => {
      events.push('cancelAll')
      for (const item of pending.splice(0)) item.reject(new Error('cancelled'))
    }),
    close: vi.fn(async () => {
      events.push('close')
    })
  }
  const writeExecute = vi.fn(async (task: { params: unknown[] }) => {
    events.push(`delete:${String(task.params[0])}`)
  })
  const importSingleFile = vi.fn()
  const openBatch = vi.fn(async () => batch)
  const session = {
    capabilities: { backend: 'postgres' },
    listCases: vi.fn(async () => existing),
    getWriteExecutor: () => ({ execute: writeExecute }),
    getImportExecutor: () => ({ importSingleFile, cancel: vi.fn(), openBatch })
  } as unknown as StorageSession

  /** Finish the in-flight import of `caseName`, then let the scheduler react. */
  const settle = async (caseName: string, error?: Error): Promise<void> => {
    const index = pending.findIndex((item) => item.caseName === caseName)
    if (index < 0) throw new Error(`${caseName} is not in flight (in flight: ${started.join(',')})`)
    const [item] = pending.splice(index, 1)
    if (error) item.reject(error)
    else item.resolve()
    await flush()
  }
  return {
    session,
    batch,
    openBatch,
    importSingleFile,
    writeExecute,
    pending,
    started,
    events,
    settle
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function file(name: string): SessionBatchFile {
  return { inputPath: `ref:${name}`, storedPath: `/stage/${name}`, fileName: name }
}

const names = (count: number): SessionBatchFile[] =>
  Array.from({ length: count }, (_, i) => file(`S${i + 1}.vcf.gz`))

describe('runSessionBatchImport — parallel', () => {
  it('imports up to the concurrency limit at once and refills as files finish', async () => {
    const s = parallelSession()
    const run = runSessionBatchImport({
      files: names(5),
      duplicateStrategy: 'skip',
      session: s.session,
      callbacks: {},
      signal: new AbortController().signal,
      concurrency: 3
    })
    await flush()
    expect(s.started).toEqual(['S1', 'S2', 'S3'])

    await s.settle('S2')
    expect(s.started).toEqual(['S1', 'S2', 'S3', 'S4'])
    await s.settle('S1')
    await s.settle('S3')
    await s.settle('S4')
    await s.settle('S5')

    const result = await run
    expect(result).toMatchObject({ succeeded: 5, failed: 0, skipped: 0, cancelled: false })
    expect(s.openBatch).toHaveBeenCalledTimes(1)
    expect(s.batch.close).toHaveBeenCalledTimes(1)
    expect(s.importSingleFile).not.toHaveBeenCalled()
  })

  it('lists results in file order whatever order the files finish in', async () => {
    const s = parallelSession()
    const run = runSessionBatchImport({
      files: names(3),
      duplicateStrategy: 'skip',
      session: s.session,
      callbacks: {},
      signal: new AbortController().signal,
      concurrency: 3
    })
    await flush()
    await s.settle('S3')
    await s.settle('S1', new Error('truncated gzip'))
    await s.settle('S2')

    const result = await run
    expect(result.details.map((d) => [d.caseName, d.status])).toEqual([
      ['S1', 'failed'],
      ['S2', 'success'],
      ['S3', 'success']
    ])
    expect(result.details[0].error).toContain('truncated gzip')
    expect(result).toMatchObject({ succeeded: 2, failed: 1 })
  })

  it('reports each file the moment it is done, with the new case id', async () => {
    const s = parallelSession()
    const done: BatchFileComplete[] = []
    const progress: BatchProgress[] = []
    const run = runSessionBatchImport({
      files: names(2),
      duplicateStrategy: 'skip',
      session: s.session,
      callbacks: { onFileComplete: (e) => done.push(e), onProgress: (p) => progress.push(p) },
      signal: new AbortController().signal,
      concurrency: 2
    })
    await flush()
    expect(progress.at(-1)).toMatchObject({ overallPercent: 0, completedFiles: 0 })
    expect(progress.at(-1)?.inFlight?.map((f) => f.fileName)).toEqual(['S1.vcf.gz', 'S2.vcf.gz'])

    await s.settle('S2')
    expect(done).toEqual([
      {
        index: 1,
        totalFiles: 2,
        fileName: 'S2.vcf.gz',
        caseName: 'S2',
        status: 'success',
        caseId: 100,
        variantCount: 3
      }
    ])
    expect(progress.at(-1)).toMatchObject({ overallPercent: 50, completedFiles: 1 })

    await s.settle('S1')
    await run
    expect(done.map((e) => e.caseName)).toEqual(['S2', 'S1'])
    expect(progress.at(-1)).toMatchObject({ overallPercent: 100, completedFiles: 2, inFlight: [] })
  })

  it('imports files that map to the same case one after another, like a sequential batch', async () => {
    const s = parallelSession()
    const run = runSessionBatchImport({
      files: [file('DUP.vcf.gz'), file('OTHER.vcf.gz'), file('DUP.vcf')],
      duplicateStrategy: 'skip',
      session: s.session,
      callbacks: {},
      signal: new AbortController().signal,
      concurrency: 3
    })
    await flush()
    // The second DUP waits for the first; it does not race it.
    expect(s.started).toEqual(['DUP', 'OTHER'])
    await s.settle('DUP')
    await s.settle('OTHER')

    const result = await run
    expect(result.details.map((d) => [d.fileName, d.status])).toEqual([
      ['DUP.vcf.gz', 'success'],
      ['OTHER.vcf.gz', 'success'],
      ['DUP.vcf', 'skipped']
    ])
    expect(s.started).toEqual(['DUP', 'OTHER'])
  })

  it('overwrite deletes the existing case only after its replacement is imported (#493)', async () => {
    const s = parallelSession([{ id: 5, name: 'S1' }])
    const run = runSessionBatchImport({
      files: names(2),
      duplicateStrategy: 'overwrite',
      session: s.session,
      callbacks: {},
      signal: new AbortController().signal,
      concurrency: 2
    })
    await flush()
    expect(s.events).toEqual([])
    expect(s.started).toEqual(['S1 (replacing #5)', 'S2'])
    await s.settle('S1 (replacing #5)')
    expect(s.events).toEqual(['delete:5'])
    expect(s.writeExecute).toHaveBeenCalledWith({
      type: 'cases:delete',
      params: [5, { id: 100, name: 'S1' }]
    })
    await s.settle('S2')
    expect((await run).succeeded).toBe(2)
  })

  it('cancel stops every file in flight, starts nothing new and always closes the batch', async () => {
    const s = parallelSession()
    const controller = new AbortController()
    const run = runSessionBatchImport({
      files: names(6),
      duplicateStrategy: 'skip',
      session: s.session,
      callbacks: {},
      signal: controller.signal,
      concurrency: 2
    })
    await flush()
    await s.settle('S1')
    expect(s.started).toEqual(['S1', 'S2', 'S3'])

    // What the job runner does on cancel: abort, then call the registered cancel.
    controller.abort()
    s.batch.cancelAll()

    const result = await run
    expect(result).toMatchObject({ succeeded: 1, failed: 0, cancelled: true })
    expect(result.details.map((d) => d.caseName)).toEqual(['S1'])
    expect(s.started).toEqual(['S1', 'S2', 'S3'])
    expect(s.events.at(-1)).toBe('close')
  })

  it('holds the import operation for the whole batch so a second import is refused', async () => {
    const s = parallelSession()
    const run = runSessionBatchImport({
      files: names(2),
      duplicateStrategy: 'skip',
      session: s.session,
      callbacks: {},
      signal: new AbortController().signal,
      concurrency: 2
    })
    await flush()

    await expect(
      startImport('/stage/other.vcf', 'other', undefined, () => s.session, {})
    ).rejects.toThrow(/already in progress/)

    await s.settle('S1')
    await s.settle('S2')
    await run
  })

  it('falls back to one file at a time at concurrency 1 or without batch support', async () => {
    const s = parallelSession()
    const sequential = vi.fn(async () => ({
      caseId: 1,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 1
    }))
    s.importSingleFile.mockImplementation(sequential)
    const result = await runSessionBatchImport({
      files: names(3),
      duplicateStrategy: 'skip',
      session: s.session,
      callbacks: {},
      signal: new AbortController().signal,
      concurrency: 1
    })
    expect(result.succeeded).toBe(3)
    expect(s.openBatch).not.toHaveBeenCalled()
    expect(sequential).toHaveBeenCalledTimes(3)
  })
})

describe('groupIntoChains', () => {
  it('keeps same-name files together in file order and orders chains by first file', () => {
    expect(groupIntoChains(['a', 'b', 'a', 'c', 'b'])).toEqual([[0, 2], [1, 4], [3]])
  })
})

describe('runChains', () => {
  it('never runs more items at once than the limit', async () => {
    let running = 0
    let peak = 0
    await runChains(
      Array.from({ length: 20 }, (_, i) => [i]),
      4,
      async () => {
        peak = Math.max(peak, ++running)
        await new Promise((done) => setTimeout(done, 1))
        running--
      },
      () => false
    )
    expect(peak).toBe(4)
  })
})

describe('BatchProgressTracker', () => {
  it('counts finished files only, so the last file does not read 100% while it runs', () => {
    const updates: BatchProgress[] = []
    const tracker = new BatchProgressTracker(['only.vcf.gz'], (p) => updates.push(p))
    tracker.start(0)
    tracker.update(0, { count: 500, elapsed: 10, skipped: 0, phase: 'inserting' })
    expect(updates.at(-1)).toMatchObject({ overallPercent: 0, currentFileName: 'only.vcf.gz' })
    expect(updates.at(-1)?.fileProgress?.count).toBe(500)
    tracker.finish(0)
    expect(updates.at(-1)).toMatchObject({ overallPercent: 100, completedFiles: 1 })
  })
})
