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
//     (d) onProgress mapping + onCohortStale + onComplete emissions unchanged
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

// Imported after the mock is registered.
let startBatchImport: typeof import('../../../../src/main/ipc/handlers/batch-import-logic').startBatchImport
let jobRunner: typeof import('../../../../src/main/services/jobs/runner').jobRunner

beforeEach(async () => {
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
function makeDb(overrides?: { existingNames?: Set<string> }) {
  return {
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

  it('(a) frequency update: updateFrequencies is called per successful imported case', async () => {
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

    expect(db.variants.updateFrequencies).toHaveBeenCalledTimes(2)
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

  it('(d) onCohortStale: emits is_stale:true at start and is_stale:false on completion', async () => {
    const db = makeDb()
    const stale: boolean[] = []
    const promise = startBatchImport(() => db, ['/data/a.json'], 'skip', undefined, {
      onCohortStale: (d) => stale.push(d.is_stale)
    })
    await new Promise((r) => queueMicrotask(r as () => void))
    FakeImportWorkerClient.instances[0].emit(COMPLETE_MSG)
    await promise

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
