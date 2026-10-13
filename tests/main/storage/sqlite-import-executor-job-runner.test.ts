import { describe, expect, it, vi } from 'vitest'

import { SqliteImportExecutor } from '../../../src/main/storage/sqlite/SqliteImportExecutor'
import { jobRunner } from '../../../src/main/services/jobs/runner'

// ---------------------------------------------------------------------------
// Gate 12 four-dimension coverage for D3 wire site (v):
//   SqliteImportExecutor.importSingleFile is routed through the shared
//   module-singleton JobRunner (`import_single` kind), mirroring site (i)
//   (the PostgresImportExecutor single-file path). These tests assert the
//   four invariants the wiring must preserve:
//     (a) return payload unchanged (StorageImportSingleFileResult)
//     (b) single-flight conflict message preserved ('An import is already in
//         progress')
//     (c) cancellation routed through the SQLite worker's postMessage channel
//         via worker.cancel() (posts { type: 'cancel' }, NOT terminate())
//     (d) import:progress phase/count/skipped mapping is unchanged
//
// Note on (d): PR4-7 does not touch the worker callback progress-mapping path,
// so phase/count/skipped fields are demonstrably identical to pre-PR-4. The
// wall-clock `elapsed` field is non-deterministic and excluded.
// ---------------------------------------------------------------------------

function makeDb() {
  return {
    getPath: () => '/tmp/test.varlens',
    getEncryptionKey: () => undefined
  } as never
}

describe('SqliteImportExecutor.importSingleFile — Sprint A D3 (v) / Gate 12', () => {
  it('(a) return payload: returns StorageImportSingleFileResult unchanged', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: makeDb,
      createWorkerClient: () => worker as never
    })

    const promise = executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 0
    })

    // Let enqueue + start run.
    await new Promise((r) => queueMicrotask(r as () => void))

    const callbacks = start.mock.calls[0][0]
    callbacks.onFileComplete({
      type: 'file-complete',
      fileIndex: 0,
      result: { caseId: 42, caseName: 'Imported', variantCount: 300, skipped: 0, elapsed: 88 }
    })
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/input.json',
            fileName: 'input.json',
            caseName: 'Imported',
            status: 'success',
            variantCount: 300
          }
        ]
      }
    })

    await expect(promise).resolves.toStrictEqual({
      caseId: 42,
      variantCount: 300,
      skipped: 0,
      errors: [],
      elapsed: 88
    })
  })

  it('(b) conflict: second concurrent call rejects with "An import is already in progress"', async () => {
    let running = false
    const start = vi.fn(() => {
      running = true
    })
    const worker = {
      get isRunning() {
        return running
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: makeDb,
      createWorkerClient: () => worker as never
    })

    const first = executor.importSingleFile({
      filePath: '/tmp/one.json',
      caseName: 'C1',
      throttleMs: 0
    })

    await expect(
      executor.importSingleFile({ filePath: '/tmp/two.json', caseName: 'C2', throttleMs: 0 })
    ).rejects.toThrow('An import is already in progress')

    // Unblock the first import so the import_single slot frees for later tests.
    const callbacks = start.mock.calls[0][0]
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/one.json',
            fileName: 'one.json',
            caseName: 'C1',
            status: 'success',
            variantCount: 1
          }
        ]
      }
    })
    const result = await first
    expect(result.errors).toEqual([])
  })

  it('(c) cancellation: jobRunner.cancel triggers the SQLite worker.cancel() (posts {type:"cancel"})', async () => {
    let running = false
    const start = vi.fn(() => {
      running = true
    })
    const cancel = vi.fn()
    const worker = {
      get isRunning() {
        return running
      },
      start,
      cancel
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: makeDb,
      createWorkerClient: () => worker as never
    })

    const importPromise = executor.importSingleFile({
      filePath: '/tmp/z.json',
      caseName: 'CZ',
      throttleMs: 0
    })

    // Let enqueue + start run.
    await new Promise((r) => queueMicrotask(r as () => void))

    // Locate the in-flight import_single job and cancel it through the runner.
    const inFlight = jobRunner.list({ kind: 'import_single', status: 'running' })
    expect(inFlight.length).toBe(1)
    await jobRunner.cancel(inFlight[0].id)

    // The registered cancel callback routes to worker.cancel(), which posts
    // { type: 'cancel' } to the worker (NOT terminate()).
    expect(cancel).toHaveBeenCalledTimes(1)

    // Resolve so the promise settles and the slot frees.
    const callbacks = start.mock.calls[0][0]
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: true,
        details: []
      }
    })
    await importPromise
  })

  it('(d) progress mapping: phase/count/skipped emissions are unchanged from pre-PR-4', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: makeDb,
      createWorkerClient: () => worker as never
    })

    const recorded: Array<{ phase: string; count: number; skipped: number }> = []
    const promise = executor.importSingleFile({
      filePath: '/tmp/p.json',
      caseName: 'CP',
      throttleMs: 0,
      onProgress: (data) => {
        recorded.push({ phase: data.phase, count: data.count, skipped: data.skipped })
      }
    })

    // Let enqueue + start run.
    await new Promise((r) => queueMicrotask(r as () => void))

    const callbacks = start.mock.calls[0][0]
    callbacks.onProgress({ type: 'progress', fileIndex: 0, phase: 'parsing', variantCount: 0 })
    callbacks.onProgress({ type: 'progress', fileIndex: 0, phase: 'inserting', variantCount: 50 })
    callbacks.onProgress({
      type: 'progress',
      fileIndex: 0,
      phase: 'finalizing',
      variantCount: 100,
      skipped: 2
    })
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/p.json',
            fileName: 'p.json',
            caseName: 'CP',
            status: 'success',
            variantCount: 100
          }
        ]
      }
    })
    await promise

    // The worker-callback progress mapping is untouched by PR4-7: 'finalizing'
    // maps to 'inserting'; the trailing onProgress fired in onComplete reflects
    // the success branch. elapsed is wall-clock and excluded.
    expect(recorded).toEqual([
      { phase: 'parsing', count: 0, skipped: undefined },
      { phase: 'inserting', count: 50, skipped: undefined },
      { phase: 'inserting', count: 100, skipped: 2 },
      { phase: 'inserting', count: 100, skipped: 0 }
    ])
  })
})
