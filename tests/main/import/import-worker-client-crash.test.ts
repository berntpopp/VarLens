// @vitest-environment node
/**
 * ImportWorkerClient behaviour when the worker thread dies (issue #445):
 * heap limits on the Worker, typed out-of-memory failures, and the recovery
 * run that discards the case the dead worker left half-written.
 */
import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkerMessage } from '../../../src/shared/types/import-worker'

const spawned = vi.hoisted(() => ({ workers: [] as unknown[] }))

vi.mock('worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class MockWorker extends Emitter {
    posted: unknown[] = []
    terminated = false
    constructor(
      readonly path: string,
      readonly options: unknown
    ) {
      super()
      spawned.workers.push(this)
    }
    postMessage(message: unknown): void {
      this.posted.push(message)
    }
    terminate(): Promise<void> {
      this.terminated = true
      return Promise.resolve()
    }
  }
  return { Worker: MockWorker }
})

vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: { error: () => {}, warn: () => {}, info: () => {} }
}))

import { ImportWorkerClient } from '../../../src/main/workers/import-worker-client'
import {
  IMPORT_WORKER_HEAP_CEILING_MB,
  IMPORT_WORKER_HEAP_FLOOR_MB
} from '../../../src/main/workers/import-worker-limits'
import { ErrorCode } from '../../../src/shared/types/errors'

interface MockWorker extends EventEmitter {
  posted: Array<Record<string, unknown>>
  terminated: boolean
  options: { resourceLimits?: { maxOldGenerationSizeMb?: number } }
}

const worker = (index: number): MockWorker => spawned.workers[index] as MockWorker

function outOfMemory(): Error {
  return Object.assign(new Error('Worker terminated due to reaching memory limit'), {
    code: 'ERR_WORKER_OUT_OF_MEMORY'
  })
}

const COMPLETE: WorkerMessage = {
  type: 'complete',
  results: { succeeded: 0, failed: 0, skipped: 0, cancelled: false, details: [] }
}

describe('ImportWorkerClient worker crashes', () => {
  let client: ImportWorkerClient
  let onError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    spawned.workers.length = 0
    client = new ImportWorkerClient()
    onError = vi.fn()
    client.start({
      files: [],
      dbPath: '/test.db',
      encryptionKey: 'k',
      throttleMs: 100,
      onProgress: () => {},
      onFileComplete: () => {},
      onComplete: () => {},
      onError
    })
  })

  it('starts the worker with a heap limit sized inside the floor and ceiling', () => {
    const limit = worker(0).options.resourceLimits?.maxOldGenerationSizeMb
    expect(limit).toBeGreaterThanOrEqual(IMPORT_WORKER_HEAP_FLOOR_MB)
    expect(limit).toBeLessThanOrEqual(IMPORT_WORKER_HEAP_CEILING_MB)
  })

  it('reports an out-of-memory crash as a typed RESOURCE_LIMIT failure', () => {
    worker(0).emit('error', outOfMemory())

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({
      type: 'error',
      fileIndex: -1,
      phase: 'worker',
      errorCode: ErrorCode.RESOURCE_LIMIT
    })
    expect(spawned.workers).toHaveLength(1)
    expect(client.isRunning).toBe(false)
  })

  it('leaves any other crash unclassified', () => {
    worker(0).emit('error', new Error('segfault'))

    expect(onError.mock.calls[0][0]).toMatchObject({ fileIndex: -1, error: 'segfault' })
    expect(onError.mock.calls[0][0]).not.toHaveProperty('errorCode')
  })

  it('discards the partial case in a recovery run before reporting the failure', () => {
    worker(0).emit('message', { type: 'case-started', fileIndex: 0, caseId: 42 })
    worker(0).emit('error', outOfMemory())

    // Recovery is running: nothing reported yet, and the client is still busy.
    expect(onError).not.toHaveBeenCalled()
    expect(spawned.workers).toHaveLength(2)
    expect(worker(1).posted[0]).toEqual({
      type: 'start',
      files: [],
      dbPath: '/test.db',
      encryptionKey: 'k',
      throttleMs: 100,
      discardCaseIds: [42]
    })
    // The dead worker's exit arrives late and must not release the slot.
    worker(0).emit('exit', 1)
    expect(client.isRunning).toBe(true)
    expect(() =>
      client.start({
        files: [],
        dbPath: '/other.db',
        throttleMs: 100,
        onProgress: () => {},
        onFileComplete: () => {},
        onComplete: () => {},
        onError: () => {}
      })
    ).toThrow('already running')

    worker(1).emit('message', COMPLETE)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ errorCode: ErrorCode.RESOURCE_LIMIT })
    expect(worker(1).terminated).toBe(true)
    expect(client.isRunning).toBe(false)
  })

  it.each([
    ['the file completed', { type: 'file-complete', fileIndex: 0, result: {} }],
    ['the worker already failed and cleaned up the file', { type: 'error', fileIndex: 0 }]
  ])('does not run recovery when %s before the crash', (_label, settled) => {
    worker(0).emit('message', { type: 'case-started', fileIndex: 0, caseId: 42 })
    worker(0).emit('message', settled)
    onError.mockClear()
    worker(0).emit('error', outOfMemory())

    expect(spawned.workers).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('still reports the import failure, once, when the recovery run itself dies', () => {
    worker(0).emit('message', { type: 'case-started', fileIndex: 0, caseId: 42 })
    worker(0).emit('error', outOfMemory())
    worker(1).emit('error', new Error('recovery crashed'))
    worker(1).emit('exit', 1)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ errorCode: ErrorCode.RESOURCE_LIMIT })
    expect(client.isRunning).toBe(false)
  })
})
