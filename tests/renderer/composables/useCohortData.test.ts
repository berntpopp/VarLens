/**
 * Unit tests for useCohortData composable
 *
 * Tests IPC-dependent data loading logic with mocked window.api.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reactive, isReactive } from 'vue'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useCohortData } from '@renderer/composables/useCohortData'
import type { CohortVariant, CohortSummary } from '../../../../../src/shared/types/cohort'
import { logService } from '../../../src/renderer/src/services/LogService'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    critical: vi.fn()
  }
}))

describe('useCohortData', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    window.api = createMockApi()
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  it('initializes with empty state', () => {
    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    expect(result.variants.value).toEqual([])
    expect(result.totalCount.value).toBe(0)
    expect(result.isLoading.value).toBe(false)
    expect(result.error.value).toBeNull()
    expect(result.summary.value).toBeNull()
  })

  it('fetches variants and updates state', async () => {
    const mockVariants: CohortVariant[] = [
      {
        chr: 'chr1',
        pos: 12345,
        ref: 'A',
        alt: 'G',
        variant_key: 'chr1-12345-A-G',
        gene_symbol: 'BRCA1',
        consequence: 'missense_variant',
        impact: 'MODERATE',
        carrier_count: 1,
        total_cases: 10
      }
    ]
    window.api.cohort.getVariants = vi.fn().mockResolvedValue({
      data: mockVariants,
      total_count: 1
    })

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.fetchVariants({ limit: 50, sort_order: 'desc' })

    expect(result.variants.value).toEqual(mockVariants)
    expect(result.totalCount.value).toBe(1)
    expect(result.isLoading.value).toBe(false)
    expect(result.error.value).toBeNull()
    expect(window.api.cohort.getVariants).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, sort_order: 'desc' })
    )
  })

  it('sets isLoading during fetch', async () => {
    // Use a promise we can control to verify loading state
    let resolvePromise: (value: unknown) => void
    const promise = new Promise((resolve) => {
      resolvePromise = resolve
    })
    window.api.cohort.getVariants = vi.fn().mockReturnValue(promise)

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    const fetchPromise = result.fetchVariants({ limit: 50, sort_order: 'desc' })

    // Should be loading before promise resolves
    expect(result.isLoading.value).toBe(true)

    // Resolve the promise
    resolvePromise!({ data: [], total_count: 0 })
    await fetchPromise

    // Should no longer be loading
    expect(result.isLoading.value).toBe(false)
  })

  it('handles fetch errors', async () => {
    const mockError = new Error('Network error')
    window.api.cohort.getVariants = vi.fn().mockRejectedValue(mockError)

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.fetchVariants({ limit: 50, sort_order: 'desc' })

    expect(result.error.value).toBeTruthy()
    expect(result.error.value?.message).toBe('Network error')
    expect(result.variants.value).toEqual([])
    expect(result.totalCount.value).toBe(0)
    expect(result.isLoading.value).toBe(false)
  })

  it('clears error on successful fetch after error', async () => {
    // First call fails
    window.api.cohort.getVariants = vi.fn().mockRejectedValue(new Error('Error'))

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.fetchVariants({ limit: 50, sort_order: 'desc' })
    expect(result.error.value).toBeTruthy()

    // Second call succeeds
    window.api.cohort.getVariants = vi.fn().mockResolvedValue({
      data: [],
      total_count: 0
    })

    await result.fetchVariants({ limit: 50, sort_order: 'desc' })
    expect(result.error.value).toBeNull()
  })

  it('fetches summary successfully', async () => {
    const mockSummary: CohortSummary = {
      total_cases: 10,
      total_variants: 100,
      unique_variants: 0,
      avg_variants_per_case: 0,
      genes_with_variants: 0,
      starred_variants: 0,
      acmg_counts: {
        pathogenic: 0,
        likely_pathogenic: 0,
        vus: 0,
        likely_benign: 0,
        benign: 0
      }
    }
    window.api.cohort.getSummary = vi.fn().mockResolvedValue(mockSummary)

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.fetchSummary()

    expect(result.summary.value).toEqual(mockSummary)
    expect(window.api.cohort.getSummary).toHaveBeenCalledOnce()
  })

  it('handles summary fetch errors gracefully', async () => {
    window.api.cohort.getSummary = vi.fn().mockRejectedValue(new Error('Summary error'))

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.fetchSummary()

    expect(result.summary.value).toBeNull()
    expect(logService.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load cohort summary:'),
      'cohort'
    )
  })

  it('reset clears all state', () => {
    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    // Set some state
    result.variants.value = [
      {
        chr: 'chr1',
        pos: 12345,
        ref: 'A',
        alt: 'G',
        variant_key: 'chr1-12345-A-G',
        gene_symbol: 'BRCA1',
        consequence: 'missense_variant',
        impact: 'MODERATE',
        carrier_count: 1,
        total_cases: 10
      }
    ]
    result.totalCount.value = 1
    result.error.value = new Error('Test error')
    result.summary.value = { total_cases: 10, total_variants: 100 }

    // Reset
    result.reset()

    // Verify all state cleared
    expect(result.variants.value).toEqual([])
    expect(result.totalCount.value).toBe(0)
    expect(result.error.value).toBeNull()
    expect(result.summary.value).toBeNull()
  })

  it('passes filter params to IPC call', async () => {
    window.api.cohort.getVariants = vi.fn().mockResolvedValue({
      data: [],
      total_count: 0
    })

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.fetchVariants({
      limit: 50,
      sort_order: 'desc',
      sort_by: 'pos',
      search_term: 'BRCA',
      gene_symbol: 'BRCA1',
      consequences: ['HIGH'],
      funcs: ['missense_variant'],
      clinvars: ['pathogenic'],
      gnomad_af_max: 0.01,
      cadd_min: 20,
      max_internal_af: 0.5,
      carrier_count_min: 2
    })

    expect(window.api.cohort.getVariants).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        sort_order: 'desc',
        sort_by: 'pos',
        search_term: 'BRCA',
        gene_symbol: 'BRCA1',
        consequences: ['HIGH'],
        funcs: ['missense_variant'],
        clinvars: ['pathogenic'],
        gnomad_af_max: 0.01,
        cadd_min: 20,
        max_internal_af: 0.5,
        carrier_count_min: 2
      })
    )
  })

  it('handles window.api unavailable gracefully', async () => {
    // @ts-expect-error - Testing undefined case
    delete window.api

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.fetchVariants({ limit: 50, sort_order: 'desc' })

    expect(logService.warn).toHaveBeenCalledWith(
      'API not available - running outside Electron',
      'cohort'
    )
    expect(result.variants.value).toEqual([])
    expect(result.totalCount.value).toBe(0)
  })
})

describe('IPC safety — buildIpcParams strips reactive proxies', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    window.api = createMockApi()
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  it('passes plain arrays to cohort.getVariants (no reactive proxies)', async () => {
    let capturedParams: unknown = null
    window.api.cohort.getVariants = vi.fn().mockImplementation((params: unknown) => {
      capturedParams = params
      return Promise.resolve({ data: [], total_count: 0 })
    })

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.fetchVariants({
      offset: 0,
      limit: 10,
      sort_order: 'asc',
      consequences: reactive(['missense_variant', 'nonsense']),
      funcs: reactive(['exonic']),
      clinvars: reactive(['pathogenic']),
      acmg_classifications: reactive(['Pathogenic']),
      column_filters: reactive({ chr: { operator: '=', value: 'chr1' } })
    })
    await flushPromises()

    expect(capturedParams).not.toBeNull()
    const p = capturedParams as Record<string, unknown>

    // All array/object fields must be plain
    if (p.consequences) expect(isReactive(p.consequences)).toBe(false)
    if (p.funcs) expect(isReactive(p.funcs)).toBe(false)
    if (p.clinvars) expect(isReactive(p.clinvars)).toBe(false)
    if (p.acmg_classifications) expect(isReactive(p.acmg_classifications)).toBe(false)
    if (p.column_filters) expect(isReactive(p.column_filters)).toBe(false)

    // Must serialize cleanly
    expect(() => JSON.parse(JSON.stringify(capturedParams))).not.toThrow()
  })
})
