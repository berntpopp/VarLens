/**
 * A batch import whose worker stops keeping the cohort summary current must
 * say so while the batch still runs: an open cohort view refreshes after
 * every file and would otherwise show the first files' carriers over a
 * denominator that counts every case, with no banner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ImportWorkerCallbacks } from '../../../../src/main/workers/import-worker-client'
import type { WorkerMessage } from '../../../../src/shared/types/import-worker'

class FakeImportWorkerClient {
  static last: FakeImportWorkerClient | null = null
  callbacks: ImportWorkerCallbacks | null = null
  cancel = vi.fn()

  constructor() {
    FakeImportWorkerClient.last = this
  }

  start(callbacks: ImportWorkerCallbacks): void {
    this.callbacks = callbacks
  }
}

vi.mock('../../../../src/main/workers/import-worker-client', () => ({
  ImportWorkerClient: FakeImportWorkerClient
}))

const spawnRebuildWorker = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/main/ipc/handlers/cohort-logic', () => ({ spawnRebuildWorker }))

type Complete = Extract<WorkerMessage, { type: 'complete' }>
const COMPLETE: Complete = {
  type: 'complete',
  results: {
    succeeded: 1,
    failed: 0,
    skipped: 0,
    cancelled: false,
    details: [{ filePath: '/data/a.json', fileName: 'a.json', caseName: 'a', status: 'success' }]
  }
}

function makeDb(state: { stale: boolean }) {
  return {
    cohort: { invalidateColumnMetaCache: vi.fn() },
    cohortSummary: { getStatus: () => ({ is_stale: state.stale, last_rebuilt_at: 0 }) },
    needsStartupRebuild: () => false,
    getPath: () => '/data/test.db',
    getEncryptionKey: () => undefined,
    cases: { getExistingCaseNames: () => new Set<string>() }
  } as never
}

describe('batch import: cohort staleness while the batch runs', () => {
  let startBatchImport: typeof import('../../../../src/main/ipc/handlers/batch-import-logic').startBatchImport

  beforeEach(async () => {
    spawnRebuildWorker.mockReset()
    FakeImportWorkerClient.last = null
    startBatchImport = (await import('../../../../src/main/ipc/handlers/batch-import-logic'))
      .startBatchImport
  })

  async function start(
    state: { stale: boolean },
    events: string[]
  ): Promise<{ worker: ImportWorkerCallbacks; done: Promise<unknown> }> {
    const done = startBatchImport(() => makeDb(state), ['/data/a.json'], 'skip', undefined, {
      onCohortStale: (d) => events.push(d.phase ? `stale:${d.phase}` : `stale:${d.is_stale}`),
      onComplete: () => events.push('complete')
    })
    await new Promise((r) => queueMicrotask(r as () => void))
    const worker = FakeImportWorkerClient.last?.callbacks
    if (!worker) throw new Error('worker not started')
    return { worker, done }
  }

  it('flags the cohort stale as soon as the worker says so, and current once its rebuild settled', async () => {
    const state = { stale: false }
    const events: string[] = []
    const { worker, done } = await start(state, events)

    state.stale = true
    worker.onSummaryStale?.()
    expect(events).toEqual(['stale:true'])

    // The worker's own end-of-session rebuild succeeded.
    state.stale = false
    worker.onComplete(COMPLETE)
    await done

    expect(events).toEqual(['stale:true', 'stale:false', 'complete'])
    expect(spawnRebuildWorker).not.toHaveBeenCalled()
  })

  it('repairs a summary the worker left stale without announcing it twice', async () => {
    const state = { stale: false }
    const events: string[] = []
    spawnRebuildWorker.mockImplementation(async () => {
      state.stale = false
    })
    const { worker, done } = await start(state, events)

    state.stale = true
    worker.onSummaryStale?.()
    worker.onSummaryStale?.()
    worker.onComplete(COMPLETE)
    await done

    expect(spawnRebuildWorker).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['stale:true', 'stale:false', 'complete'])
  })

  it('keeps the cohort flagged when the summary is still stale and cannot be repaired', async () => {
    const state = { stale: false }
    const events: string[] = []
    spawnRebuildWorker.mockRejectedValue(new Error('rebuild boom'))
    const { worker, done } = await start(state, events)

    state.stale = true
    worker.onSummaryStale?.()
    worker.onComplete(COMPLETE)
    await done

    expect(events).toEqual(['stale:true', 'complete'])
  })

  it('clears the flag after a worker that announced staleness died and the repair ran', async () => {
    const state = { stale: false }
    const events: string[] = []
    spawnRebuildWorker.mockImplementation(async () => {
      state.stale = false
    })
    const { worker, done } = await start(state, events)

    state.stale = true
    worker.onSummaryStale?.()
    worker.onError({ type: 'error', fileIndex: -1, error: 'worker boom', phase: 'worker' })
    await done

    expect(events).toEqual(['stale:true', 'stale:false'])
  })
})
