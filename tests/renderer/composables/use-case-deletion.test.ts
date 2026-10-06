/**
 * Case deletion must evict the deleted case from every per-case renderer cache
 * (metadata, comments, metrics) — issue #443.
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

import { computed } from 'vue'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useCaseDeletion } from '@renderer/composables/useCaseDeletion'
import { useCaseMetadata } from '@renderer/composables/useCaseMetadata'
import { useCaseComments } from '@renderer/composables/useCaseComments'
import { useCaseMetrics } from '@renderer/composables/useCaseMetrics'
import { PER_CASE_CACHE_LIMIT } from '@renderer/composables/per-case-cache'
import type {
  CaseComment,
  CaseMetricWithDefinition,
  FullCaseMetadata
} from '../../../src/shared/types/api'

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

function comment(caseId: number, id = caseId * 10): CaseComment {
  return {
    id,
    case_id: caseId,
    category: 'Clinical Note',
    content: `comment ${id}`,
    created_at: 1_700_000_000_000,
    updated_at: null
  } as CaseComment
}

function metric(caseId: number): CaseMetricWithDefinition {
  return {
    id: caseId * 100,
    case_id: caseId,
    metric_id: 7,
    name: 'Coverage',
    value_type: 'numeric',
    unit: 'x',
    metric_category: 'QC'
  } as CaseMetricWithDefinition
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

describe('case deletion evicts per-case caches (#443)', () => {
  let app: { unmount: () => void } | undefined

  function setup() {
    const [result, appInstance] = withSetup(() => ({
      deletion: useCaseDeletion(),
      metadata: useCaseMetadata(),
      comments: useCaseComments(),
      metrics: useCaseMetrics()
    }))
    app = appInstance
    return result
  }

  /** Populate all three caches for a case through the public load paths. */
  async function warm(ctx: ReturnType<typeof setup>, caseId: number): Promise<void> {
    await Promise.all([
      ctx.metadata.loadMetadata(caseId),
      ctx.comments.loadComments(caseId),
      ctx.metrics.loadMetrics(caseId)
    ])
  }

  function expectCached(ctx: ReturnType<typeof setup>, caseId: number, cached: boolean): void {
    expect(ctx.metadata.getMetadata(caseId) !== undefined).toBe(cached)
    expect(ctx.comments.getComments(caseId).length > 0).toBe(cached)
    expect(ctx.metrics.getMetrics(caseId).length > 0).toBe(cached)
  }

  beforeEach(() => {
    window.api = createMockApi()
    vi.clearAllMocks()
    window.api.caseMetadata.getFullMetadata = vi.fn().mockResolvedValue(fullMetadata())
    window.api.caseComments.list = vi.fn((id: number) => Promise.resolve([comment(id)]))
    window.api.caseMetrics.listForCase = vi.fn((id: number) => Promise.resolve([metric(id)]))
  })

  afterEach(() => {
    if (app) app.unmount()
    app = undefined
    useCaseMetadata().clearCache()
  })

  describe('single delete', () => {
    it('evicts metadata, comments and metrics once the delete succeeds', async () => {
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

      pending.resolve()
      await request
      expectCached(ctx, 1, false)
    })

    it('rejects on a resolved SerializableError and reloads instead of trusting the cache', async () => {
      window.api.cases.delete = vi.fn().mockResolvedValue(fakeSerializableError)
      const ctx = setup()
      await warm(ctx, 1)

      await expect(ctx.deletion.deleteCase(1)).rejects.toMatchObject({ code: 'DB_ERROR' })

      // The rolled-back case has no trusted entries left ...
      expectCached(ctx, 1, false)
      expect(ctx.metadata.isLoading(1)).toBe(false)
      expect(ctx.comments.isLoading(1)).toBe(false)
      expect(ctx.metrics.isLoading(1)).toBe(false)

      // ... so the next read goes back to the database.
      window.api.caseComments.list = vi.fn().mockResolvedValue([comment(1, 11), comment(1, 12)])
      await warm(ctx, 1)
      expect(window.api.caseMetadata.getFullMetadata).toHaveBeenCalledTimes(2)
      expect(ctx.comments.getComments(1).map((c) => c.id)).toEqual([11, 12])
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
      const comments = deferred<CaseComment[]>()
      const metrics = deferred<CaseMetricWithDefinition[]>()
      const metadata = deferred<FullCaseMetadata>()
      window.api.caseComments.list = vi.fn().mockReturnValue(comments.promise)
      window.api.caseMetrics.listForCase = vi.fn().mockReturnValue(metrics.promise)
      window.api.caseMetadata.getFullMetadata = vi.fn().mockReturnValue(metadata.promise)
      const ctx = setup()

      const loads = warm(ctx, 1)
      await ctx.deletion.deleteCase(1)
      comments.resolve([comment(1)])
      metrics.resolve([metric(1)])
      metadata.resolve(fullMetadata())
      await loads

      expectCached(ctx, 1, false)
      expect(ctx.comments.isLoading(1)).toBe(false)
      expect(ctx.metrics.isLoading(1)).toBe(false)
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
    it('evicts every case but keeps the global catalogs', async () => {
      window.api.cases.deleteAll = vi.fn().mockResolvedValue(2)
      window.api.caseMetrics.listDefinitions = vi
        .fn()
        .mockResolvedValue([{ id: 7, name: 'Coverage', category: 'QC' }])
      window.api.caseMetadata.listCohorts = vi
        .fn()
        .mockResolvedValue([{ id: 4, name: 'Trio', description: null, created_at: 1 }])
      const ctx = setup()
      await warm(ctx, 1)
      await warm(ctx, 2)
      await Promise.all([ctx.metrics.loadDefinitions(), ctx.metadata.loadCohortGroups()])

      await expect(ctx.deletion.deleteAllCases()).resolves.toBe(2)

      expectCached(ctx, 1, false)
      expectCached(ctx, 2, false)
      // Cohort groups and metric definitions are not per-case and survive.
      expect(ctx.metrics.definitionsCache.value).toHaveLength(1)
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

  describe('bounded comment/metric caches', () => {
    it('keeps at most PER_CASE_CACHE_LIMIT cases, evicting the least recently used', async () => {
      const ctx = setup()
      for (let id = 1; id <= PER_CASE_CACHE_LIMIT + 1; id++) {
        await Promise.all([ctx.comments.loadComments(id), ctx.metrics.loadMetrics(id)])
      }

      expect(ctx.comments.getComments(1)).toEqual([])
      expect(ctx.metrics.getMetrics(1)).toEqual([])
      expect(ctx.comments.getComments(2)).toHaveLength(1)
      expect(ctx.metrics.getMetrics(PER_CASE_CACHE_LIMIT + 1)).toHaveLength(1)
    })

    it('stays reactive: computed readers see creates, edits, removals and eviction', async () => {
      window.api.caseComments.create = vi.fn().mockResolvedValue(comment(1, 99))
      window.api.caseComments.update = vi
        .fn()
        .mockResolvedValue({ ...comment(1, 99), content: 'edited' })
      const ctx = setup()
      const contents = computed(() => ctx.comments.getComments(1).map((c) => c.content))
      const metricCount = computed(() => ctx.metrics.getMetrics(1).length)
      expect(contents.value).toEqual([])

      await warm(ctx, 1)
      expect(contents.value).toEqual(['comment 10'])
      expect(metricCount.value).toBe(1)

      await ctx.comments.createComment(1, 'Clinical Note', 'new')
      expect(contents.value).toEqual(['comment 99', 'comment 10'])

      await ctx.comments.updateComment(1, 99, 'edited')
      expect(contents.value).toEqual(['edited', 'comment 10'])

      await ctx.comments.deleteComment(1, 99)
      expect(contents.value).toEqual(['comment 10'])

      await ctx.metrics.deleteMetric(1, 7)
      expect(metricCount.value).toBe(0)

      await ctx.deletion.deleteCase(1)
      expect(contents.value).toEqual([])
    })
  })
})
