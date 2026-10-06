/**
 * Unit tests for useVariantColumnMeta composable.
 *
 * Covers:
 * - Cache key generation (single-case, cohort with sort, empty)
 * - IPC-on-miss / cache-on-hit for both getColumnMeta and ensureTypesPresent
 * - Inflight deduplication for concurrent identical requests
 * - invalidate(scope) — clears a single scope
 * - invalidateAll() — clears everything
 * - Browser dev-mode guard (window.api undefined → throws)
 *
 * Module-scoped caches are cleared via `invalidateAll()` in beforeEach to
 * isolate tests from each other.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useVariantColumnMeta, cacheKeyFor } from '@renderer/composables/useVariantColumnMeta'
import type { ColumnFilterMeta } from '../../../src/shared/types/column-filters'
import { installCapabilities } from '../helpers/capabilities'

// The capability store fails closed: install a desktop document.
beforeEach(() => installCapabilities())

function makeColumnMeta(overrides: Partial<ColumnFilterMeta> = {}): ColumnFilterMeta {
  return {
    key: 'sv.support',
    dataType: 'numeric',
    distinctCount: 42,
    min: 1,
    max: 100,
    ...overrides
  }
}

/**
 * Install a mock window.api with columnMeta/typesPresent methods on the
 * variants namespace. Returns the vi.fn spies for assertions.
 */
function installMockApi(
  opts: {
    columnMeta?: (...args: unknown[]) => Promise<ColumnFilterMeta>
    typesPresent?: (...args: unknown[]) => Promise<string[]>
  } = {}
): {
  columnMetaFn: ReturnType<typeof vi.fn>
  typesPresentFn: ReturnType<typeof vi.fn>
} {
  const mockApi = createMockApi()
  const columnMetaFn = vi.fn(opts.columnMeta ?? (async () => makeColumnMeta()))
  const typesPresentFn = vi.fn(opts.typesPresent ?? (async () => ['snv', 'sv']))

  // Extend the mock variants namespace with the Task 8 IPC methods. The
  // base mock-api doesn't know about these (it predates Task 8), so we
  // cast to attach them.
  ;(
    mockApi.variants as unknown as {
      columnMeta: typeof columnMetaFn
      typesPresent: typeof typesPresentFn
    }
  ).columnMeta = columnMetaFn
  ;(
    mockApi.variants as unknown as {
      columnMeta: typeof columnMetaFn
      typesPresent: typeof typesPresentFn
    }
  ).typesPresent = typesPresentFn

  window.api = mockApi as unknown as Window['api']

  return { columnMetaFn, typesPresentFn }
}

describe('useVariantColumnMeta', () => {
  let app: { unmount: () => void }
  const originalWindowApi = window.api

  beforeEach(() => {
    // Clear module-scoped caches between tests
    const meta = useVariantColumnMeta()
    meta.invalidateAll()
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (app) app.unmount()
    if (originalWindowApi) {
      window.api = originalWindowApi
    }
  })

  describe('cacheKeyFor', () => {
    it('generates key for single-case scope', () => {
      expect(cacheKeyFor({ caseId: 7 })).toBe('case:7')
    })

    it('generates sorted key for cohort scope', () => {
      expect(cacheKeyFor({ caseIds: [3, 1, 2] })).toBe('cases:1,2,3')
    })

    it('collides identical cohort scopes regardless of input order', () => {
      expect(cacheKeyFor({ caseIds: [5, 9, 1] })).toBe(cacheKeyFor({ caseIds: [1, 9, 5] }))
    })

    it('returns empty sentinel for empty scope', () => {
      expect(cacheKeyFor({})).toBe('empty')
      expect(cacheKeyFor({ caseIds: [] })).toBe('empty')
    })
  })

  describe('getColumnMeta', () => {
    it('fetches from IPC on cache miss', async () => {
      const meta = makeColumnMeta({ key: 'cnv.copy_number', min: 0, max: 10 })
      const { columnMetaFn } = installMockApi({ columnMeta: async () => meta })

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      const fetched = await result.getColumnMeta({ caseId: 1 }, 'cnv.copy_number')

      expect(fetched).toEqual(meta)
      expect(columnMetaFn).toHaveBeenCalledWith({
        caseId: 1,
        caseIds: undefined,
        columnKey: 'cnv.copy_number'
      })
      expect(columnMetaFn).toHaveBeenCalledTimes(1)
    })

    it('returns cached value on second call (no extra IPC)', async () => {
      const { columnMetaFn } = installMockApi()

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      await result.getColumnMeta({ caseId: 1 }, 'sv.support')
      await result.getColumnMeta({ caseId: 1 }, 'sv.support')

      expect(columnMetaFn).toHaveBeenCalledTimes(1)
    })

    it('caches different columns independently', async () => {
      const { columnMetaFn } = installMockApi()

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      await result.getColumnMeta({ caseId: 1 }, 'sv.support')
      await result.getColumnMeta({ caseId: 1 }, 'sv.vaf')

      expect(columnMetaFn).toHaveBeenCalledTimes(2)
    })

    it('caches different scopes independently', async () => {
      const { columnMetaFn } = installMockApi()

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      await result.getColumnMeta({ caseId: 1 }, 'sv.support')
      await result.getColumnMeta({ caseId: 2 }, 'sv.support')

      expect(columnMetaFn).toHaveBeenCalledTimes(2)
    })

    it('deduplicates concurrent inflight requests', async () => {
      // Use a manually-controlled promise so both calls see the same inflight
      let resolve: (m: ColumnFilterMeta) => void = () => {}
      const deferred = new Promise<ColumnFilterMeta>((r) => {
        resolve = r
      })
      const { columnMetaFn } = installMockApi({ columnMeta: () => deferred })

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      const p1 = result.getColumnMeta({ caseId: 1 }, 'sv.support')
      const p2 = result.getColumnMeta({ caseId: 1 }, 'sv.support')

      // Both calls share the same inflight promise — only one IPC call
      expect(columnMetaFn).toHaveBeenCalledTimes(1)

      const meta = makeColumnMeta()
      resolve(meta)

      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toEqual(meta)
      expect(r2).toEqual(meta)
      expect(columnMetaFn).toHaveBeenCalledTimes(1)
    })

    it('throws when window.api is unavailable', async () => {
      // @ts-expect-error - Testing undefined case
      delete window.api

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      await expect(result.getColumnMeta({ caseId: 1 }, 'sv.support')).rejects.toThrow(
        /window\.api not available/
      )
    })

    it('forwards cohort scope as caseIds', async () => {
      const { columnMetaFn } = installMockApi()

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      await result.getColumnMeta({ caseIds: [1, 2, 3] }, 'sv.support')

      expect(columnMetaFn).toHaveBeenCalledWith({
        caseId: undefined,
        caseIds: [1, 2, 3],
        columnKey: 'sv.support'
      })
    })
  })

  describe('ensureTypesPresent', () => {
    it('fetches from IPC on cache miss and returns a Set', async () => {
      const { typesPresentFn } = installMockApi({
        typesPresent: async () => ['snv', 'sv', 'cnv']
      })

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      const types = await result.ensureTypesPresent({ caseId: 1 })

      expect(types).toBeInstanceOf(Set)
      expect(types.size).toBe(3)
      expect(types.has('snv')).toBe(true)
      expect(types.has('sv')).toBe(true)
      expect(types.has('cnv')).toBe(true)
      expect(typesPresentFn).toHaveBeenCalledTimes(1)
    })

    it('returns cached Set on second call', async () => {
      const { typesPresentFn } = installMockApi()

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      const first = await result.ensureTypesPresent({ caseId: 1 })
      const second = await result.ensureTypesPresent({ caseId: 1 })

      // Only one IPC call — second call hit the cache. Note: Vue's ref
      // wraps the Set in a reactive proxy on write, so `second` may be a
      // different instance than `first`; we verify cache hit via call count
      // and content equality rather than identity.
      expect(typesPresentFn).toHaveBeenCalledTimes(1)
      expect([...second]).toEqual([...first])
    })

    it('deduplicates concurrent inflight requests', async () => {
      let resolve: (t: string[]) => void = () => {}
      const deferred = new Promise<string[]>((r) => {
        resolve = r
      })
      const { typesPresentFn } = installMockApi({ typesPresent: () => deferred })

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      const p1 = result.ensureTypesPresent({ caseId: 1 })
      const p2 = result.ensureTypesPresent({ caseId: 1 })

      expect(typesPresentFn).toHaveBeenCalledTimes(1)

      resolve(['snv'])

      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toBe(r2)
      expect(typesPresentFn).toHaveBeenCalledTimes(1)
    })

    it('throws when window.api is unavailable', async () => {
      // @ts-expect-error - Testing undefined case
      delete window.api

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      await expect(result.ensureTypesPresent({ caseId: 1 })).rejects.toThrow(
        /window\.api not available/
      )
    })
  })

  describe('invalidate', () => {
    it('clears cache for a single scope, leaves others intact', async () => {
      const { columnMetaFn } = installMockApi()

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      await result.getColumnMeta({ caseId: 1 }, 'sv.support')
      await result.getColumnMeta({ caseId: 2 }, 'sv.support')
      expect(columnMetaFn).toHaveBeenCalledTimes(2)

      result.invalidate({ caseId: 1 })

      // caseId:1 re-fetches
      await result.getColumnMeta({ caseId: 1 }, 'sv.support')
      expect(columnMetaFn).toHaveBeenCalledTimes(3)

      // caseId:2 still cached
      await result.getColumnMeta({ caseId: 2 }, 'sv.support')
      expect(columnMetaFn).toHaveBeenCalledTimes(3)
    })

    it('clears both column meta and types present for the scope', async () => {
      const { columnMetaFn, typesPresentFn } = installMockApi()

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      await result.getColumnMeta({ caseId: 1 }, 'sv.support')
      await result.ensureTypesPresent({ caseId: 1 })
      expect(columnMetaFn).toHaveBeenCalledTimes(1)
      expect(typesPresentFn).toHaveBeenCalledTimes(1)

      result.invalidate({ caseId: 1 })

      await result.getColumnMeta({ caseId: 1 }, 'sv.support')
      await result.ensureTypesPresent({ caseId: 1 })
      expect(columnMetaFn).toHaveBeenCalledTimes(2)
      expect(typesPresentFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('invalidateAll', () => {
    it('clears every scope', async () => {
      const { columnMetaFn } = installMockApi()

      const [result, appInstance] = withSetup(() => useVariantColumnMeta())
      app = appInstance

      await result.getColumnMeta({ caseId: 1 }, 'sv.support')
      await result.getColumnMeta({ caseId: 2 }, 'sv.support')
      await result.getColumnMeta({ caseIds: [3, 4] }, 'sv.support')
      expect(columnMetaFn).toHaveBeenCalledTimes(3)

      result.invalidateAll()

      // All three scopes re-fetch
      await result.getColumnMeta({ caseId: 1 }, 'sv.support')
      await result.getColumnMeta({ caseId: 2 }, 'sv.support')
      await result.getColumnMeta({ caseIds: [3, 4] }, 'sv.support')
      expect(columnMetaFn).toHaveBeenCalledTimes(6)
    })
  })
})
