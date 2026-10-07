import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportWorkerCallbacks } from '../../../../src/main/workers/import-worker-client'
import type { WorkerMessage } from '../../../../src/shared/types/import-worker'

// ---------------------------------------------------------------------------
// Gate 12 coverage for D3 wire site (iii):
//   startBatchImport (batch-import-logic) routes the worker run through the
//   shared module-singleton JobRunner under the `import_batch` kind. These
//   tests assert the four invariants the wiring must preserve:
//     (a) return payload (BatchImportResult) unchanged
//     (b) single-flight conflict message preserved ("A batch import is already
//         in progress") — surfaced through the existing catch-to-failure path
//     (c) cancellation routed through workerClient.cancel() (posts
//         {type:'cancel'} to the worker, NOT terminate())
//     (d) onProgress mapping + onComplete emissions unchanged; the cohort is
//         no longer flagged stale for the batch (the worker keeps the summary
//         exact per file) and every imported/skipped/failed file is announced
//
// The real ImportWorkerClient spawns a worker thread; it is mocked here so the
// JobRunner wiring is exercised without touching worker_threads.
// ---------------------------------------------------------------------------

// A controllable fake ImportWorkerClient. `start` captures the callbacks so the
// test can drive worker -> main messages; `cancel` is a spy and `isRunning`
// tracks the worker lifecycle the way the real client does.
class FakeImportWorkerClient {
  static instances: FakeImportWorkerClient[] = []
  captured: ImportWorkerCallbacks | null = null
  cancel = vi.fn()
  private running = false

  constructor() {
    FakeImportWorkerClient.instances.push(this)
  }

  get isRunning(): boolean {
    return this.running
  }

  start(callbacks: ImportWorkerCallbacks): void {
    this.captured = callbacks
    this.running = true
  }

  emit(msg: WorkerMessage): void {
    if (!this.captured) throw new Error('worker not started')
    switch (msg.type) {
      case 'progress':
        this.captured.onProgress(msg)
        break
      case 'file-complete':
        this.captured.onFileComplete(msg)
        break
      case 'complete':
        this.running = false
        this.captured.onComplete(msg)
        break
      case 'error':
        this.captured.onError(msg)
        if (msg.fileIndex === -1) this.running = false
        break
    }
  }
}

vi.mock('../../../../src/main/workers/import-worker-client', () => ({
  ImportWorkerClient: FakeImportWorkerClient
}))

// The summary rebuild worker (only used when the summary is stale at the end).
const spawnRebuildWorker = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/main/ipc/handlers/cohort-logic', () => ({ spawnRebuildWorker }))

// Imported after the mock is registered.
let startBatchImport: typeof import('../../../../src/main/ipc/handlers/batch-import-logic').startBatchImport
let jobRunner: typeof import('../../../../src/main/services/jobs/runner').jobRunner

beforeEach(async () => {
  spawnRebuildWorker.mockReset()
  FakeImportWorkerClient.instances = []
  startBatchImport = (await import('../../../../src/main/ipc/handlers/batch-import-logic'))
    .startBatchImport
  jobRunner = (await import('../../../../src/main/services/jobs/runner')).jobRunner
})

afterEach(() => {
  vi.clearAllMocks()
})

/**
 * Minimal DatabaseService stub covering the methods batch-import-logic touches:
 * checkDuplicates -> cases.getExistingCaseNames, getPath/getEncryptionKey, and
 * the onComplete frequency-update path (cases.getCaseByName, variants.updateFrequencies).
 */
function makeDb(overrides?: { existingNames?: Set<string>; summaryStale?: () => boolean }) {
  return {
    cohort: { invalidateColumnMetaCache: vi.fn() },
    cohortSummary: {
      getStatus: vi.fn(() => ({
        is_stale: overrides?.summaryStale?.() ?? false,
        last_rebuilt_at: 0
      }))
    },
    needsStartupRebuild: vi.fn(() => false),
    getPath: () => '/tmp/test.db',
    getEncryptionKey: () => undefined,
    cases: {
      getExistingCaseNames: vi.fn(() => overrides?.existingNames ?? new Set<string>()),
      getCaseByName: vi.fn((name: string) => ({ id: 1, name }))
    },
    variants: {
      updateFrequencies: vi.fn()
    }
  } as never
}

function fileComplete(
  fileIndex: number,
  caseName: string
): Extract<WorkerMessage, { type: 'file-complete' }> {
  return {
    type: 'file-complete',
    fileIndex,
    result: {
      caseId: 10 + fileIndex,
      caseName,
      variantCount: 7,
      skipped: 0,
      skipReasons: [],
      elapsed: 1
    }
  }
}

const COMPLETE_MSG: Extract<WorkerMessage, { type: 'complete' }> = {
  type: 'complete',
  results: {
    succeeded: 2,
    failed: 0,
    skipped: 1,
    cancelled: false,
    details: [
      {
        filePath: '/data/a.json',
        fileName: 'a.json',
        caseName: 'a',
        status: 'success',
        variantCount: 100
      },
      {
        filePath: '/data/b.json',
        fileName: 'b.json',
        caseName: 'b',
        status: 'success',
        variantCount: 50
      }
    ]
  }
}

describe('startBatchImport — Sprint A D3 (iii) / Gate 12', () => {
  it('(a) return payload: returns the aggregated BatchImportResult unchanged', async () => {
    const db = makeDb()
    const promise = startBatchImport(
      () => db,
      ['/data/a.json', '/data/b.json'],
      'skip',
      undefined,
      {}
    )
    await new Promise((r) => queueMicrotask(r as () => void))
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)

    const result = await promise
    expect(result).toEqual({
      succeeded: 2,
      failed: 0,
      skipped: 1,
      cancelled: false,
      details: [
        {
          filePath: '/data/a.json',
          fileName: 'a.json',
          caseName: 'a',
          status: 'success',
          variantCount: 100
        },
        {
          filePath: '/data/b.json',
          fileName: 'b.json',
          caseName: 'b',
          status: 'success',
          variantCount: 50
        }
      ]
    })
  })

  it('(a) frequency update: no main-thread updateFrequencies (the import worker maintains frequencies)', async () => {
    const db = makeDb()
    const promise = startBatchImport(
      () => db,
      ['/data/a.json', '/data/b.json'],
      'skip',
      undefined,
      {}
    )
    await new Promise((r) => queueMicrotask(r as () => void))
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    await promise

    expect(db.variants.updateFrequencies).not.toHaveBeenCalled()
  })

  it('(b) conflict: a second concurrent batch surfaces "A batch import is already in progress"', async () => {
    const db = makeDb()
    const first = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {})
    await new Promise((r) => queueMicrotask(r as () => void))

    // Second call while the first import_batch job is still running.
    const conflict = await startBatchImport(() => db, ['/data/c.json'], 'skip', undefined, {})

    // The conflict is surfaced through the existing catch-to-failure path.
    expect(conflict.failed).toBe(1)
    expect(conflict.details[0].error).toBe('A batch import is already in progress')

    // A rejected second enqueue must not clear the first run's cancellation
    // owner. The shared runner callback must still cancel that first worker.
    const [running] = jobRunner.list({ kind: 'import_batch', status: 'running' })
    expect(running).toBeDefined()
    await jobRunner.cancel(running!.id)
    expect(FakeImportWorkerClient.instances[0].cancel).toHaveBeenCalledTimes(1)

    // Free the slot.
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    await first
  })

  it('(b) single-flight uses the import_batch kind on the shared jobRunner', async () => {
    const db = makeDb()
    const first = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {})
    await new Promise((r) => queueMicrotask(r as () => void))

    const running = jobRunner.list({ kind: 'import_batch', status: 'running' })
    expect(running.length).toBe(1)

    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    await first
  })

  it('(c) cancellation: jobRunner.cancel triggers workerClient.cancel()', async () => {
    const db = makeDb()
    const promise = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {})
    await new Promise((r) => queueMicrotask(r as () => void))

    const running = jobRunner.list({ kind: 'import_batch', status: 'running' })
    expect(running.length).toBe(1)
    await jobRunner.cancel(running[0].id)

    expect(FakeImportWorkerClient.instances[0].cancel).toHaveBeenCalledTimes(1)

    // Resolve so the slot frees.
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    await promise
  })

  it('(d) cohort: a batch whose summary stays exact never flags the cohort stale', async () => {
    const db = makeDb()
    const stale: boolean[] = []
    const promise = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {
      onCohortStale: (d) => stale.push(d.is_stale)
    })
    await new Promise((r) => queueMicrotask(r as () => void))
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    await promise

    expect(stale).toEqual([])
    expect(spawnRebuildWorker).not.toHaveBeenCalled()
  })

  it('(d) cohort: drops cached cohort metadata per imported file and at the end', async () => {
    const db = makeDb()
    const invalidate = (db as { cohort: { invalidateColumnMetaCache: ReturnType<typeof vi.fn> } })
      .cohort.invalidateColumnMetaCache
    const order: string[] = []
    invalidate.mockImplementation(() => order.push('invalidate'))
    const promise = startBatchImport(
      () => db,
      ['/data/a.json', '/data/b.json'],
      'skip',
      undefined,
      {
        onFileComplete: (d) => order.push(`file:${d.status}`),
        onComplete: () => order.push('complete')
      }
    )
    await new Promise((r) => queueMicrotask(r as () => void))
    const w = FakeImportWorkerClient.instances[0]
    w.emit(fileComplete(0, 'a'))
    w.emit({ type: 'error', fileIndex: 1, error: 'bad file', phase: 'import' })
    expect(order).toEqual(['invalidate', 'file:success', 'file:failed'])

    w.emit(COMPLETE_MSG)
    await promise
    expect(order).toEqual(['invalidate', 'file:success', 'file:failed', 'invalidate', 'complete'])
  })

  it('(d) cohort: a summary left stale by the worker is reported and rebuilt before the batch ends', async () => {
    let isStale = true
    const db = makeDb({ summaryStale: () => isStale })
    const events: string[] = []
    spawnRebuildWorker.mockImplementation(
      async (_path: string, _key: unknown, onProgress: (p: unknown) => void) => {
        onProgress({ phase: 'variants', phase_index: 1, phase_total: 2, label: 'Variants' })
        isStale = false
      }
    )
    const promise = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {
      onCohortStale: (d) => events.push(d.phase ? `stale:${d.phase}` : `stale:${d.is_stale}`),
      onComplete: () => events.push('complete')
    })
    await new Promise((r) => queueMicrotask(r as () => void))
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    const result = await promise

    expect(spawnRebuildWorker).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['stale:true', 'stale:variants', 'stale:false', 'complete'])
    expect(result.succeeded).toBe(2)
  })

  it('(d) cohort: a failed repair leaves the renderer told the summary is stale', async () => {
    const db = makeDb({ summaryStale: () => true })
    const stale: boolean[] = []
    spawnRebuildWorker.mockRejectedValue(new Error('rebuild boom'))
    const promise = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {
      onCohortStale: (d) => stale.push(d.is_stale)
    })
    await new Promise((r) => queueMicrotask(r as () => void))
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    const result = await promise

    expect(stale).toEqual([true])
    expect(result.succeeded).toBe(2)
  })

  it('(d) cohort: a worker that died mid-batch gets the summary checked and repaired', async () => {
    const db = makeDb()
    ;(db as { needsStartupRebuild: ReturnType<typeof vi.fn> }).needsStartupRebuild.mockReturnValue(
      true
    )
    spawnRebuildWorker.mockResolvedValue(undefined)
    const stale: boolean[] = []
    const promise = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {
      onCohortStale: (d) => stale.push(d.is_stale)
    })
    await new Promise((r) => queueMicrotask(r as () => void))
    FakeImportWorkerClient.instances[0].emit({
      type: 'error',
      fileIndex: -1,
      error: 'worker boom',
      phase: 'worker'
    })
    const result = await promise

    expect(result.failed).toBe(1)
    expect(stale).toEqual([true, false])
  })

  it('(d) onProgress mapping: worker progress maps to the renderer progress shape unchanged', async () => {
    const db = makeDb()
    const recorded: Array<{ phase: string; count: number; skipped: number }> = []
    const promise = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {
      onProgress: (data) => {
        const d = data as { fileProgress?: { phase: string; count: number; skipped: number } }
        if (d.fileProgress) {
          recorded.push({
            phase: d.fileProgress.phase,
            count: d.fileProgress.count,
            skipped: d.fileProgress.skipped
          })
        }
      }
    })
    await new Promise((r) => queueMicrotask(r as () => void))

    const w = FakeImportWorkerClient.instances[0]
    w.emit({
      type: 'progress',
      fileIndex: 0,
      totalFiles: 1,
      fileName: 'a.json',
      overallPercent: 10,
      phase: 'parsing',
      variantCount: 0,
      skipped: 0
    })
    w.emit({
      type: 'progress',
      fileIndex: 0,
      totalFiles: 1,
      fileName: 'a.json',
      overallPercent: 80,
      phase: 'inserting',
      variantCount: 100,
      skipped: 3
    })
    w.emit(COMPLETE_MSG)
    await promise

    expect(recorded).toEqual([
      { phase: 'parsing', count: 0, skipped: 0 },
      { phase: 'inserting', count: 100, skipped: 3 }
    ])
  })

  it('(d) onFileComplete: announces each imported file as soon as the worker reports it', async () => {
    const db = makeDb()
    const files: unknown[] = []
    const promise = startBatchImport(
      () => db,
      ['/data/a.json', '/data/b.json'],
      'skip',
      undefined,
      { onFileComplete: (data) => files.push(data) }
    )
    await new Promise((r) => queueMicrotask(r as () => void))

    const w = FakeImportWorkerClient.instances[0]
    w.emit({
      type: 'file-complete',
      fileIndex: 1,
      result: {
        caseId: 12,
        caseName: 'b',
        variantCount: 340,
        skipped: 0,
        skipReasons: [],
        elapsed: 5
      }
    })
    // Announced before the batch as a whole is done. The worker said nothing
    // about the first file before moving on, so it was a skipped duplicate.
    expect(files).toEqual([
      { index: 0, totalFiles: 2, fileName: 'a.json', caseName: 'a', status: 'skipped' },
      {
        index: 1,
        totalFiles: 2,
        fileName: 'b.json',
        caseName: 'b',
        status: 'success',
        caseId: 12,
        variantCount: 340
      }
    ])

    w.emit(COMPLETE_MSG)
    await promise
  })

  it('(d) onFileComplete: reports skipped and failed files like the session path, cancelled ones not', async () => {
    const db = makeDb()
    const files: Array<{ index: number; status: string; error?: string }> = []
    const paths = ['/data/a.json', '/data/b.json', '/data/c.json', '/data/d.json']
    const promise = startBatchImport(() => db, paths, 'skip', undefined, {
      onFileComplete: (d) =>
        files.push({ index: d.index, status: d.status, ...(d.error ? { error: d.error } : {}) })
    })
    await new Promise((r) => queueMicrotask(r as () => void))
    const w = FakeImportWorkerClient.instances[0]

    // a: duplicate, skipped silently before b; b: failed; c: imported;
    // d: duplicate skipped after the worker's last per-file message, so only
    // the final result can report it.
    w.emit({ type: 'error', fileIndex: 1, error: 'not a variant file', phase: 'import' })
    expect(files).toEqual([
      { index: 0, status: 'skipped' },
      { index: 1, status: 'failed', error: 'not a variant file' }
    ])
    w.emit(fileComplete(2, 'c'))
    const detail = (name: string, status: 'success' | 'failed' | 'skipped', error?: string) => ({
      filePath: `/data/${name}.json`,
      fileName: `${name}.json`,
      caseName: name,
      status,
      ...(error !== undefined ? { error } : {})
    })
    const results = {
      succeeded: 1,
      failed: 1,
      skipped: 2,
      cancelled: false,
      details: [
        detail('a', 'skipped', 'Duplicate case name'),
        detail('b', 'failed', 'not a variant file'),
        detail('c', 'success'),
        detail('d', 'skipped', 'Duplicate case name')
      ]
    }
    expect(files).toHaveLength(3)
    w.emit({ type: 'complete', results })
    const result = await promise

    expect(files).toEqual([
      { index: 0, status: 'skipped' },
      { index: 1, status: 'failed', error: 'not a variant file' },
      { index: 2, status: 'success' },
      { index: 3, status: 'skipped' }
    ])
    // The final result is the worker's, untouched.
    expect(result).toEqual(results)
  })

  it('(d) onFileComplete: files a cancel stopped get no event', async () => {
    const db = makeDb()
    const files: Array<{ index: number; status: string }> = []
    const promise = startBatchImport(
      () => db,
      ['/data/a.json', '/data/b.json', '/data/c.json'],
      'skip',
      undefined,
      { onFileComplete: (d) => files.push({ index: d.index, status: d.status }) }
    )
    await new Promise((r) => queueMicrotask(r as () => void))
    const w = FakeImportWorkerClient.instances[0]
    w.emit(fileComplete(0, 'a'))
    // The worker's "finalizing" progress carries an index past the last file.
    w.emit({
      type: 'progress',
      fileIndex: 3,
      totalFiles: 3,
      fileName: '',
      overallPercent: 99,
      phase: 'finalizing',
      variantCount: 0,
      skipped: 0
    })
    const cancelled = (name: string) => ({
      filePath: `/data/${name}.json`,
      fileName: `${name}.json`,
      caseName: name,
      status: 'skipped' as const,
      error: 'Cancelled by user'
    })
    w.emit({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 2,
        cancelled: true,
        details: [
          {
            filePath: '/data/a.json',
            fileName: 'a.json',
            caseName: 'a',
            status: 'success',
            variantCount: 7
          },
          cancelled('b'),
          cancelled('c')
        ]
      }
    })
    await promise

    expect(files).toEqual([{ index: 0, status: 'success' }])
  })

  it('(d) onComplete: emits the final batch result to callbacks.onComplete', async () => {
    const db = makeDb()
    let completed: unknown = null
    const promise = startBatchImport(
      () => db,
      ['/data/a.json', '/data/b.json'],
      'skip',
      undefined,
      {
        onComplete: (data) => {
          completed = data
        }
      }
    )
    await new Promise((r) => queueMicrotask(r as () => void))
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    await promise

    expect(completed).toMatchObject({ succeeded: 2, failed: 0, skipped: 1, cancelled: false })
  })

  it('(d) fatal worker error: rejection is converted to a failure BatchImportResult', async () => {
    const db = makeDb()
    const promise = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {})
    await new Promise((r) => queueMicrotask(r as () => void))

    FakeImportWorkerClient.instances[0].emit({
      type: 'error',
      fileIndex: -1,
      error: 'worker boom',
      phase: 'worker'
    })

    const result = await promise
    expect(result.failed).toBe(1)
    expect(result.details[0].error).toBe('worker boom')
  })

  it('(a) duplicate strategy: isDuplicate flag is forwarded to the worker files', async () => {
    const db = makeDb({ existingNames: new Set(['a']) })
    const promise = startBatchImport(() => db, ['/data/a.json'], 'overwrite', undefined, {})
    await new Promise((r) => queueMicrotask(r as () => void))

    const w = FakeImportWorkerClient.instances[0]
    expect(w.captured?.files).toEqual([
      { filePath: '/data/a.json', caseName: 'a', isDuplicate: true, duplicateStrategy: 'overwrite' }
    ])

    w.emit(COMPLETE_MSG)
    await promise
  })

  it('(a) start message: forwards dbPath and throttleMs to the worker', async () => {
    const db = makeDb()
    const promise = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {})
    await new Promise((r) => queueMicrotask(r as () => void))

    const w = FakeImportWorkerClient.instances[0]
    expect(w.captured?.dbPath).toBe('/tmp/test.db')
    expect(typeof w.captured?.throttleMs).toBe('number')

    w.emit(COMPLETE_MSG)
    await promise
  })

  it('(b) slot frees after completion: a subsequent batch can start', async () => {
    const db = makeDb()
    const first = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {})
    await new Promise((r) => queueMicrotask(r as () => void))
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    await first

    const second = startBatchImport(() => db, ['/data/b.json'], 'skip', undefined, {})
    await new Promise((r) => queueMicrotask(r as () => void))
    expect(FakeImportWorkerClient.instances.length).toBe(2)

    FakeImportWorkerClient.instances[1].emit(COMPLETE_MSG)
    const result = await second
    expect(result.succeeded).toBe(2)
  })
})
