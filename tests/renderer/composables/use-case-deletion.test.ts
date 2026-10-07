/**
 * Case deletion must evict the deleted case from the metadata cache (issue
 * #443) and invalidate the query cache, which holds the case's comments and
 * metrics (their own tests cover the refetch).
 *
 * Eviction happens when the delete IPC *settles*, never optimistically:
 *   - success: the case is gone, so no cache may still hold its id;
 *   - failure: the case is rolled back into the list, and its entries are
 *     dropped so the next read reloads them instead of trusting pre-delete
 *     state.
 *
 * Regression note: nothing here can resurrect comments on a *re-imported*
 * case, because case ids are never reused — SQLite `cases.id INTEGER PRIMARY
 * KEY AUTOINCREMENT`, Postgres `BIGSERIAL`. If `cases.id` ever loses
 * AUTOINCREMENT (SQLite then recycles the highest rowid), a missed eviction
 * stops being cache hygiene and becomes a data-integrity bug: these tests are
 * the guard for that.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useCaseDeletion } from '@renderer/composables/useCaseDeletion'
import { useCaseMetadata } from '@renderer/composables/useCaseMetadata'
import { invalidateServerData } from '../../../src/renderer/src/queries/invalidation'
import type { FullCaseMetadata } from '../../../src/shared/types/api'

vi.mock('../../../src/renderer/src/queries/invalidation', () => ({
  invalidateServerData: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    critical: vi.fn()
  }
}))

const fakeSerializableError = {
  code: 'DB_ERROR',
  message: 'database is locked',
  userMessage: 'The database is busy'
}

function fullMetadata(): FullCaseMetadata {
  return {
    metadata: null,
    cohorts: [],
    hpoTerms: [],
    comments: [],
    metrics: [],
    dataInfo: null,
    externalIds: []
  } as unknown as FullCaseMetadata
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('case deletion evicts the metadata cache (#443)', () => {
  let app: { unmount: () => void } | undefined

  function setup() {
    const [result, appInstance] = withSetup(() => ({
      deletion: useCaseDeletion(),
      metadata: useCaseMetadata()
    }))
    app = appInstance
    return result
  }

  /** Populate the cache for a case through the public load path. */
  function warm(ctx: ReturnType<typeof setup>, caseId: number): Promise<void> {
    return ctx.metadata.loadMetadata(caseId)
  }

  function expectCached(ctx: ReturnType<typeof setup>, caseId: number, cached: boolean): void {
    expect(ctx.metadata.getMetadata(caseId) !== undefined).toBe(cached)
  }

  beforeEach(() => {
    window.api = createMockApi()
    vi.clearAllMocks()
    window.api.caseMetadata.getFullMetadata = vi.fn().mockResolvedValue(fullMetadata())
  })

  afterEach(() => {
    if (app) app.unmount()
    app = undefined
    useCaseMetadata().clearCache()
  })

  describe('single delete', () => {
    it('evicts the metadata once the delete succeeds', async () => {
      const ctx = setup()
      await warm(ctx, 1)
      await warm(ctx, 2)
      expectCached(ctx, 1, true)

      await ctx.deletion.deleteCase(1)

      expect(window.api.cases.delete).toHaveBeenCalledWith(1)
      expectCached(ctx, 1, false)
      // Unrelated cases keep their entries.
      expectCached(ctx, 2, true)
    })

    it('does not evict optimistically — only after the IPC settles', async () => {
      const pending = deferred<void>()
      window.api.cases.delete = vi.fn().mockReturnValue(pending.promise)
      const ctx = setup()
      await warm(ctx, 1)

      const request = ctx.deletion.deleteCase(1)
      await flushPromises()
      expectCached(ctx, 1, true)
      // The list drops the row before the delete runs; a refetch now would
      // read the case back and keep it until the next invalidation.
      expect(invalidateServerData).not.toHaveBeenCalled()

      pending.resolve()
      await request
      expectCached(ctx, 1, false)
      expect(invalidateServerData).toHaveBeenCalledExactlyOnceWith('data-changed')
    })

    it('rejects on a resolved SerializableError and reloads instead of trusting the cache', async () => {
      window.api.cases.delete = vi.fn().mockResolvedValue(fakeSerializableError)
      const ctx = setup()
      await warm(ctx, 1)

      await expect(ctx.deletion.deleteCase(1)).rejects.toMatchObject({ code: 'DB_ERROR' })
      // A failed delete may have run partially, so the query cache refetches too.
      expect(invalidateServerData).toHaveBeenCalledExactlyOnceWith('data-changed')

      // The rolled-back case has no trusted entries left ...
      expectCached(ctx, 1, false)
      expect(ctx.metadata.isLoading(1)).toBe(false)

      // ... so the next read goes back to the database.
      await warm(ctx, 1)
      expect(window.api.caseMetadata.getFullMetadata).toHaveBeenCalledTimes(2)
      expectCached(ctx, 1, true)
    })

    it('evicts when the delete IPC rejects outright', async () => {
      window.api.cases.delete = vi.fn().mockRejectedValue(new Error('worker crashed'))
      const ctx = setup()
      await warm(ctx, 1)

      await expect(ctx.deletion.deleteCase(1)).rejects.toThrow('worker crashed')
      expectCached(ctx, 1, false)
    })

    it('drops a load that was in flight when the case was deleted', async () => {
      const metadata = deferred<FullCaseMetadata>()
      window.api.caseMetadata.getFullMetadata = vi.fn().mockReturnValue(metadata.promise)
      const ctx = setup()

      const loads = warm(ctx, 1)
      await ctx.deletion.deleteCase(1)
      metadata.resolve(fullMetadata())
      await loads

      expectCached(ctx, 1, false)
      expect(ctx.metadata.isLoading(1)).toBe(false)
    })
  })

  describe('batch delete', () => {
    it('evicts every deleted id and returns the deleted count', async () => {
      window.api.cases.deleteBatch = vi.fn().mockResolvedValue(2)
      const ctx = setup()
      await warm(ctx, 1)
      await warm(ctx, 2)
      await warm(ctx, 3)

      await expect(ctx.deletion.deleteCases([1, 2])).resolves.toBe(2)
      expect(invalidateServerData).toHaveBeenCalledExactlyOnceWith('data-changed')

      expect(window.api.cases.deleteBatch).toHaveBeenCalledWith([1, 2])
      expectCached(ctx, 1, false)
      expectCached(ctx, 2, false)
      expectCached(ctx, 3, true)
    })

    it('evicts every requested id when the batch fails', async () => {
      window.api.cases.deleteBatch = vi.fn().mockResolvedValue(fakeSerializableError)
      const ctx = setup()
      await warm(ctx, 1)
      await warm(ctx, 2)

      await expect(ctx.deletion.deleteCases([1, 2])).rejects.toMatchObject({ code: 'DB_ERROR' })

      expectCached(ctx, 1, false)
      expectCached(ctx, 2, false)
    })
  })

  describe('delete all', () => {
    it('evicts every case but keeps the cohort groups', async () => {
      window.api.cases.deleteAll = vi.fn().mockResolvedValue(2)
      window.api.caseMetadata.listCohorts = vi
        .fn()
        .mockResolvedValue([{ id: 4, name: 'Trio', description: null, created_at: 1 }])
      const ctx = setup()
      await warm(ctx, 1)
      await warm(ctx, 2)
      await ctx.metadata.loadCohortGroups()

      await expect(ctx.deletion.deleteAllCases()).resolves.toBe(2)
      expect(invalidateServerData).toHaveBeenCalledExactlyOnceWith('data-changed')

      expectCached(ctx, 1, false)
      expectCached(ctx, 2, false)
      // Cohort groups are not per-case and survive.
      expect(ctx.metadata.cohortGroupsCache.value).toHaveLength(1)
    })

    it('evicts every case when delete-all fails part-way', async () => {
      window.api.cases.deleteAll = vi.fn().mockResolvedValue(fakeSerializableError)
      const ctx = setup()
      await warm(ctx, 1)

      await expect(ctx.deletion.deleteAllCases()).rejects.toMatchObject({ code: 'DB_ERROR' })
      expectCached(ctx, 1, false)
    })
  })
})
