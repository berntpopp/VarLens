/**
 * App start with a 'provisional' case in the database: an import was
 * interrupted (app killed, power loss). Nobody can see that case, yet its
 * rows are on disk and its name is taken. Opening the database discards it
 * through a file-less import session, before the usual startup summary
 * rebuild decides whether it still has anything to do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ImportWorkerCallbacks } from '../../../../src/main/workers/import-worker-client'
import type { WorkerMessage } from '../../../../src/shared/types/import-worker'

vi.mock('../../../../src/main/workers/import-worker-client', () => ({
  ImportWorkerClient: class {}
}))
vi.mock('../../../../src/main/ipc/handlers/cohort-logic', () => ({
  spawnRebuildWorker: vi.fn(),
  triggerStartupRebuildIfNeeded: vi.fn()
}))

type Complete = Extract<WorkerMessage, { type: 'complete' }>
const COMPLETE: Complete = {
  type: 'complete',
  results: { succeeded: 0, failed: 0, skipped: 0, cancelled: false, details: [] }
}

interface DbState {
  interrupted: boolean
  needsRebuild: boolean
}

function makeDb(state: DbState) {
  return {
    cohort: { invalidateColumnMetaCache: vi.fn() },
    hasInterruptedImports: () => state.interrupted,
    needsStartupRebuild: () => state.needsRebuild,
    getPath: () => '/data/test.db',
    getEncryptionKey: () => 'secret'
  }
}

describe('interrupted imports at app start', () => {
  let logic: typeof import('../../../../src/main/ipc/handlers/import-interrupted-recovery')
  let importLogic: typeof import('../../../../src/main/ipc/handlers/import-logic')

  beforeEach(async () => {
    logic = await import('../../../../src/main/ipc/handlers/import-interrupted-recovery')
    importLogic = await import('../../../../src/main/ipc/handlers/import-logic')
  })

  describe('recoverInterruptedImports', () => {
    function fakeClient(): {
      start: ReturnType<typeof vi.fn>
      callbacks: () => ImportWorkerCallbacks
    } {
      const start = vi.fn()
      return { start, callbacks: () => start.mock.calls[0][0] as ImportWorkerCallbacks }
    }

    it('runs a file-less import session on the database and resolves when it completes', async () => {
      const client = fakeClient()
      const done = logic.recoverInterruptedImports(
        makeDb({ interrupted: true, needsRebuild: false }) as never,
        { createWorkerClient: () => client }
      )
      await Promise.resolve()

      expect(client.callbacks()).toMatchObject({
        files: [],
        dbPath: '/data/test.db',
        encryptionKey: 'secret'
      })
      client.callbacks().onComplete(COMPLETE)
      await expect(done).resolves.toBeUndefined()
    })

    it('holds the import slot, so no import starts on the half-recovered database', async () => {
      const client = fakeClient()
      const done = logic.recoverInterruptedImports(
        makeDb({ interrupted: true, needsRebuild: false }) as never,
        { createWorkerClient: () => client }
      )
      await Promise.resolve()

      await expect(
        importLogic.withActiveImportOperation(
          () => undefined,
          async () => 'imported'
        )
      ).rejects.toThrow(/already in progress/)

      client.callbacks().onComplete(COMPLETE)
      await done
      await expect(
        importLogic.withActiveImportOperation(
          () => undefined,
          async () => 'imported'
        )
      ).resolves.toBe('imported')
    })

    it('rejects when the recovery session fails', async () => {
      const client = fakeClient()
      const done = logic.recoverInterruptedImports(
        makeDb({ interrupted: true, needsRebuild: false }) as never,
        { createWorkerClient: () => client }
      )
      await Promise.resolve()

      client
        .callbacks()
        .onError({ type: 'error', fileIndex: -1, error: 'disk full', phase: 'fatal' })
      await expect(done).rejects.toThrow(/disk full/)
    })
  })

  describe('recoverInterruptedImportsAtStartup', () => {
    const events = (): {
      log: string[]
      callbacks: Parameters<typeof logic.recoverInterruptedImportsAtStartup>[1]
    } => {
      const log: string[] = []
      return {
        log,
        callbacks: {
          onSummaryStale: () => log.push('stale'),
          onSummaryFresh: () => log.push('fresh')
        }
      }
    }

    it('goes straight to the startup rebuild check when nothing was interrupted', async () => {
      const recover = vi.fn()
      const triggerRebuild = vi.fn()
      const { log, callbacks } = events()
      const db = makeDb({ interrupted: false, needsRebuild: true })

      await logic.recoverInterruptedImportsAtStartup(db as never, callbacks, {
        recover,
        triggerRebuild
      })

      expect(recover).not.toHaveBeenCalled()
      expect(triggerRebuild).toHaveBeenCalledWith(db, callbacks)
      expect(log).toEqual([])
    })

    it('discards the interrupted import and skips the rebuild the session already did', async () => {
      const state = { interrupted: true, needsRebuild: true }
      const db = makeDb(state)
      const recover = vi.fn(async () => {
        state.interrupted = false
        state.needsRebuild = false // the session rebuilt and cleared its marker
      })
      const triggerRebuild = vi.fn()
      const { log, callbacks } = events()

      await logic.recoverInterruptedImportsAtStartup(db as never, callbacks, {
        recover,
        triggerRebuild
      })

      expect(recover).toHaveBeenCalledWith(db)
      expect(triggerRebuild).not.toHaveBeenCalled()
      // The summary was not trustworthy while the recovery ran.
      expect(log).toEqual(['stale', 'fresh'])
      expect(db.cohort.invalidateColumnMetaCache).toHaveBeenCalled()
    })

    it('says nothing about the cohort when the summary was current all along', async () => {
      const state = { interrupted: true, needsRebuild: false }
      const recover = vi.fn(async () => {
        state.interrupted = false
      })
      const triggerRebuild = vi.fn()
      const { log, callbacks } = events()

      await logic.recoverInterruptedImportsAtStartup(makeDb(state) as never, callbacks, {
        recover,
        triggerRebuild
      })

      expect(triggerRebuild).not.toHaveBeenCalled()
      expect(log).toEqual([])
    })

    it('still runs the startup rebuild when the recovery fails', async () => {
      const state = { interrupted: true, needsRebuild: true }
      const db = makeDb(state)
      const recover = vi.fn(async () => {
        throw new Error('worker crashed')
      })
      const triggerRebuild = vi.fn()
      const { log, callbacks } = events()

      await logic.recoverInterruptedImportsAtStartup(db as never, callbacks, {
        recover,
        triggerRebuild
      })

      expect(triggerRebuild).toHaveBeenCalledWith(db, callbacks)
      expect(log).toEqual(['stale'])
    })
  })
})
