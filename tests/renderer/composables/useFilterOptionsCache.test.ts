/**
 * Unit tests for useFilterOptionsCache composable
 *
 * Tests LRU cache behavior, API loading, invalidation,
 * parallel loading, and undefined API handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { useFilterOptionsCache } from '@renderer/composables/useFilterOptionsCache'
import type { WindowAPI, FilterOptions } from '../../../src/shared/types/api'
import { ErrorCode } from '../../../src/shared/types/errors'
import { installCapabilities } from '../helpers/capabilities'

// The capability store fails closed: install a desktop document.
beforeEach(() => installCapabilities())

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

function makeFilterOptions(overrides: Partial<FilterOptions> = {}): FilterOptions {
  return {
    consequences: ['HIGH', 'MODERATE'],
    funcs: ['missense_variant'],
    clinvars: ['Pathogenic'],
    minCadd: 0,
    maxCadd: 40,
    minGnomadAf: 0,
    maxGnomadAf: 0.01,
    columnMeta: [],
    ...overrides
  }
}

function makeMockApi(
  getFilterOptionsFn?: (...args: unknown[]) => Promise<FilterOptions>
): WindowAPI {
  return {
    variants: {
      getFilterOptions: getFilterOptionsFn ?? vi.fn().mockResolvedValue(makeFilterOptions()),
      query: vi.fn(),
      search: vi.fn(),
      geneSymbols: vi.fn()
    }
  } as unknown as WindowAPI
}

describe('useFilterOptionsCache', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with empty filter options', () => {
    const [result, appInstance] = withSetup(() => useFilterOptionsCache(undefined))
    app = appInstance

    expect(result.filterOptions.value.consequences).toEqual([])
    expect(result.filterOptions.value.funcs).toEqual([])
    expect(result.filterOptions.value.clinvars).toEqual([])
    expect(result.filterOptions.value.minCadd).toBeNull()
  })

  it('loads filter options from API on cache miss', async () => {
    const opts = makeFilterOptions()
    const getFilterOptionsFn = vi.fn().mockResolvedValue(opts)
    const api = makeMockApi(getFilterOptionsFn)

    const [result, appInstance] = withSetup(() => useFilterOptionsCache(api))
    app = appInstance

    await result.loadFilterOptions(1)

    expect(getFilterOptionsFn).toHaveBeenCalledWith(1)
    expect(result.filterOptions.value).toEqual(opts)
  })

  it('returns cached options on cache hit (skips API)', async () => {
    const getFilterOptionsFn = vi.fn().mockResolvedValue(makeFilterOptions())
    const api = makeMockApi(getFilterOptionsFn)

    const [result, appInstance] = withSetup(() => useFilterOptionsCache(api))
    app = appInstance

    await result.loadFilterOptions(1)
    expect(getFilterOptionsFn).toHaveBeenCalledTimes(1)

    // Second call should use cache
    await result.loadFilterOptions(1)
    expect(getFilterOptionsFn).toHaveBeenCalledTimes(1)
  })

  it('caches different cases separately', async () => {
    const opts1 = makeFilterOptions({ consequences: ['HIGH'] })
    const opts2 = makeFilterOptions({ consequences: ['LOW'] })
    const getFilterOptionsFn = vi.fn().mockResolvedValueOnce(opts1).mockResolvedValueOnce(opts2)
    const api = makeMockApi(getFilterOptionsFn)

    const [result, appInstance] = withSetup(() => useFilterOptionsCache(api))
    app = appInstance

    await result.loadFilterOptions(1)
    expect(result.filterOptions.value.consequences).toEqual(['HIGH'])

    await result.loadFilterOptions(2)
    expect(result.filterOptions.value.consequences).toEqual(['LOW'])

    // Go back to case 1 - should be cached
    await result.loadFilterOptions(1)
    expect(result.filterOptions.value.consequences).toEqual(['HIGH'])
    expect(getFilterOptionsFn).toHaveBeenCalledTimes(2)
  })

  it('invalidateFilterOptionsCache forces reload', async () => {
    const getFilterOptionsFn = vi.fn().mockResolvedValue(makeFilterOptions())
    const api = makeMockApi(getFilterOptionsFn)

    const [result, appInstance] = withSetup(() => useFilterOptionsCache(api))
    app = appInstance

    await result.loadFilterOptions(1)
    expect(getFilterOptionsFn).toHaveBeenCalledTimes(1)

    result.invalidateFilterOptionsCache()

    await result.loadFilterOptions(1)
    expect(getFilterOptionsFn).toHaveBeenCalledTimes(2)
  })

  it('handles undefined API gracefully (returns without error)', async () => {
    const [result, appInstance] = withSetup(() => useFilterOptionsCache(undefined))
    app = appInstance

    // Should return early without throwing
    await result.loadFilterOptions(1)

    expect(result.filterOptions.value.consequences).toEqual([])
  })

  it('handles API errors gracefully', async () => {
    const { logService } = await import('../../../src/renderer/src/services/LogService')
    const api = makeMockApi(() => Promise.reject(new Error('DB error')))

    const [result, appInstance] = withSetup(() => useFilterOptionsCache(api))
    app = appInstance

    await result.loadFilterOptions(1)

    expect(logService.error).toHaveBeenCalledWith(expect.stringContaining('DB error'), 'filters')
  })

  it('handles SerializableError filter option responses gracefully', async () => {
    const { logService } = await import('../../../src/renderer/src/services/LogService')
    const api = makeMockApi(
      async () =>
        ({
          code: ErrorCode.DB_ERROR,
          message: 'filterOptions failed',
          userMessage: 'Could not load filter options'
        }) as unknown as FilterOptions
    )

    const [result, appInstance] = withSetup(() => useFilterOptionsCache(api))
    app = appInstance

    await result.loadFilterOptions(1)

    expect(logService.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not load filter options'),
      'filters'
    )
    expect(result.filterOptions.value.consequences).toEqual([])
  })

  describe('loadFilterOptionsAndTags', () => {
    it('loads options and tags in parallel on cache miss', async () => {
      const opts = makeFilterOptions()
      const getFilterOptionsFn = vi.fn().mockResolvedValue(opts)
      const api = makeMockApi(getFilterOptionsFn)
      const loadTags = vi.fn().mockResolvedValue(undefined)

      const [result, appInstance] = withSetup(() => useFilterOptionsCache(api))
      app = appInstance

      await result.loadFilterOptionsAndTags(1, loadTags)

      expect(getFilterOptionsFn).toHaveBeenCalledWith(1)
      expect(loadTags).toHaveBeenCalled()
      expect(result.filterOptions.value).toEqual(opts)
    })

    it('only loads tags on cache hit (skips API for options)', async () => {
      const getFilterOptionsFn = vi.fn().mockResolvedValue(makeFilterOptions())
      const api = makeMockApi(getFilterOptionsFn)
      const loadTags = vi.fn().mockResolvedValue(undefined)

      const [result, appInstance] = withSetup(() => useFilterOptionsCache(api))
      app = appInstance

      // Prime the cache
      await result.loadFilterOptions(1)
      expect(getFilterOptionsFn).toHaveBeenCalledTimes(1)

      // Now loadFilterOptionsAndTags should skip the API call
      await result.loadFilterOptionsAndTags(1, loadTags)
      expect(getFilterOptionsFn).toHaveBeenCalledTimes(1) // Not called again
      expect(loadTags).toHaveBeenCalled()
    })

    it('handles undefined API in loadFilterOptionsAndTags', async () => {
      const { logService } = await import('../../../src/renderer/src/services/LogService')
      const loadTags = vi.fn().mockResolvedValue(undefined)

      const [result, appInstance] = withSetup(() => useFilterOptionsCache(undefined))
      app = appInstance

      await result.loadFilterOptionsAndTags(1, loadTags)

      expect(logService.warn).toHaveBeenCalledWith(
        expect.stringContaining('API not available'),
        'filters'
      )
      expect(loadTags).not.toHaveBeenCalled()
    })
  })
})
