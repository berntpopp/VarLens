/**
 * Unit tests for useCarriers composable
 *
 * Tests lazy carrier loading with cache behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useCarriers, _resetCarriersForTesting } from '@renderer/composables/useCarriers'
import type { CohortVariant, CohortCarrier } from '../../../../../src/shared/types/cohort'
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

const mockVariant: CohortVariant = {
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

describe('useCarriers', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    // Reset singleton state to ensure test isolation
    _resetCarriersForTesting()
    window.api = createMockApi()
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  it('initializes with empty state', () => {
    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    expect(result.expandedRows.value).toEqual([])
    expect(result.carrierMap.value.size).toBe(0)
  })

  it('hasCarriers returns false for unknown variant', () => {
    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    expect(result.hasCarriers('chr1-12345-A-G')).toBe(false)
  })

  it('hasCarriers returns true after carrier loaded', async () => {
    const mockCarriers: CohortCarrier[] = [
      {
        case_name: 'Patient A',
        gt_num: '0/1'
      }
    ]
    window.api.cohort.getCarriers = vi.fn().mockResolvedValue(mockCarriers)

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    const mockVariant: CohortVariant = {
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

    await result.loadCarriers(mockVariant)

    expect(result.hasCarriers('chr1-12345-A-G')).toBe(true)
  })

  it('getCarriers returns undefined for unknown variant', () => {
    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    expect(result.getCarriers('chr1-12345-A-G')).toBeUndefined()
  })

  it('getCarriers returns cached carriers after load', async () => {
    const mockCarriers: CohortCarrier[] = [
      {
        case_name: 'Patient A',
        gt_num: '0/1'
      },
      {
        case_name: 'Patient B',
        gt_num: '1/1'
      }
    ]
    window.api.cohort.getCarriers = vi.fn().mockResolvedValue(mockCarriers)

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    const mockVariant: CohortVariant = {
      chr: 'chr1',
      pos: 12345,
      ref: 'A',
      alt: 'G',
      variant_key: 'chr1-12345-A-G',
      gene_symbol: 'BRCA1',
      consequence: 'missense_variant',
      impact: 'MODERATE',
      carrier_count: 2,
      total_cases: 10
    }

    await result.loadCarriers(mockVariant)

    expect(result.getCarriers('chr1-12345-A-G')).toEqual(mockCarriers)
  })

  it('loads carriers and calls IPC with correct params', async () => {
    const mockCarriers: CohortCarrier[] = [
      {
        case_name: 'Patient A',
        gt_num: '0/1'
      }
    ]
    window.api.cohort.getCarriers = vi.fn().mockResolvedValue(mockCarriers)

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    const mockVariant: CohortVariant = {
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

    await result.loadCarriers(mockVariant)

    expect(window.api.cohort.getCarriers).toHaveBeenCalledWith('chr1', 12345, 'A', 'G')
    expect(window.api.cohort.getCarriers).toHaveBeenCalledOnce()
  })

  it('caches loaded carriers to avoid duplicate IPC calls', async () => {
    const mockCarriers: CohortCarrier[] = [
      {
        case_name: 'Patient A',
        gt_num: '0/1'
      }
    ]
    window.api.cohort.getCarriers = vi.fn().mockResolvedValue(mockCarriers)

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    const mockVariant: CohortVariant = {
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

    // First call
    await result.loadCarriers(mockVariant)
    expect(window.api.cohort.getCarriers).toHaveBeenCalledTimes(1)

    // Second call should use cache (no IPC call)
    await result.loadCarriers(mockVariant)
    expect(window.api.cohort.getCarriers).toHaveBeenCalledTimes(1)

    // Verify data is cached
    expect(result.hasCarriers('chr1-12345-A-G')).toBe(true)
    expect(result.getCarriers('chr1-12345-A-G')).toEqual(mockCarriers)
  })

  it('different variant triggers new IPC call', async () => {
    const mockCarriers1: CohortCarrier[] = [{ case_name: 'Patient A', gt_num: '0/1' }]
    const mockCarriers2: CohortCarrier[] = [{ case_name: 'Patient B', gt_num: '1/1' }]

    window.api.cohort.getCarriers = vi
      .fn()
      .mockResolvedValueOnce(mockCarriers1)
      .mockResolvedValueOnce(mockCarriers2)

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    const mockVariant1: CohortVariant = {
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

    const mockVariant2: CohortVariant = {
      chr: 'chr2',
      pos: 67890,
      ref: 'C',
      alt: 'T',
      variant_key: 'chr2-67890-C-T',
      gene_symbol: 'BRCA2',
      consequence: 'missense_variant',
      impact: 'MODERATE',
      carrier_count: 1,
      total_cases: 10
    }

    // Load first variant
    await result.loadCarriers(mockVariant1)
    expect(window.api.cohort.getCarriers).toHaveBeenCalledTimes(1)
    expect(result.getCarriers('chr1-12345-A-G')).toEqual(mockCarriers1)

    // Load second variant (different) triggers new IPC call
    await result.loadCarriers(mockVariant2)
    expect(window.api.cohort.getCarriers).toHaveBeenCalledTimes(2)
    expect(result.getCarriers('chr2-67890-C-T')).toEqual(mockCarriers2)

    // Both cached
    expect(result.hasCarriers('chr1-12345-A-G')).toBe(true)
    expect(result.hasCarriers('chr2-67890-C-T')).toBe(true)
  })

  it('does not cache a failed load and lets a later load retry', async () => {
    const carriers: CohortCarrier[] = [{ case_id: 1, case_name: 'Case A', gt_num: '0/1' }]
    const getCarriers = vi
      .fn()
      .mockRejectedValueOnce(new Error('IPC error'))
      .mockResolvedValueOnce(carriers)
    window.api.cohort.getCarriers = getCarriers

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    await result.loadCarriers(mockVariant)

    expect(logService.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load carriers:'),
      'carriers'
    )
    // A failure is not "no carriers": nothing is cached, and the key is flagged.
    expect(result.hasCarriers(mockVariant.variant_key)).toBe(false)
    expect(result.getCarriers(mockVariant.variant_key)).toBeUndefined()
    expect(result.hasCarrierError(mockVariant.variant_key)).toBe(true)

    await result.loadCarriers(mockVariant)

    expect(getCarriers).toHaveBeenCalledTimes(2)
    expect(result.getCarriers(mockVariant.variant_key)).toEqual(carriers)
    expect(result.hasCarrierError(mockVariant.variant_key)).toBe(false)
  })

  it('joins concurrent loads for the same variant', async () => {
    const getCarriers = vi.fn().mockResolvedValue([])
    window.api.cohort.getCarriers = getCarriers

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    await Promise.all([result.loadCarriers(mockVariant), result.loadCarriers(mockVariant)])

    expect(getCarriers).toHaveBeenCalledTimes(1)
  })

  it('drops a response that settles after the cache was cleared', async () => {
    let settle!: (carriers: CohortCarrier[]) => void
    window.api.cohort.getCarriers = vi.fn().mockReturnValue(
      new Promise<CohortCarrier[]>((resolve) => {
        settle = resolve
      })
    )

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    const pending = result.loadCarriers(mockVariant)
    result.clearCache()
    settle([{ case_id: 9, case_name: 'Deleted case', gt_num: '1/1' }])
    await pending

    expect(result.hasCarriers(mockVariant.variant_key)).toBe(false)
  })

  it('reloadExpanded refetches carriers for the expanded rows only', async () => {
    const other: CohortVariant = { ...mockVariant, pos: 999, variant_key: 'chr1-999-A-G' }
    const stale: CohortCarrier[] = [{ case_id: 1, case_name: 'Deleted case', gt_num: '0/1' }]
    const fresh: CohortCarrier[] = [{ case_id: 2, case_name: 'Case B', gt_num: '1/1' }]
    const getCarriers = vi.fn().mockResolvedValue(fresh)
    window.api.cohort.getCarriers = getCarriers

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance
    result.carrierMap.value.set(mockVariant.variant_key, stale)
    result.carrierMap.value.set(other.variant_key, stale)
    result.expandedRows.value = [mockVariant.variant_key]

    await result.reloadExpanded([mockVariant, other])

    expect(getCarriers).toHaveBeenCalledTimes(1)
    expect(result.getCarriers(mockVariant.variant_key)).toEqual(fresh)
    // Collapsed rows are dropped and load again when next expanded.
    expect(result.hasCarriers(other.variant_key)).toBe(false)
    expect(result.expandedRows.value).toEqual([mockVariant.variant_key])
  })

  it('clearCache clears carrier map but keeps expandedRows', () => {
    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    // Set some state
    result.expandedRows.value = ['chr1-12345-A-G', 'chr2-67890-C-T']
    result.carrierMap.value.set('chr1-12345-A-G', [{ case_name: 'Patient A', gt_num: '0/1' }])

    result.clearCache()

    // Cache cleared
    expect(result.carrierMap.value.size).toBe(0)
    expect(result.hasCarriers('chr1-12345-A-G')).toBe(false)

    // expandedRows preserved
    expect(result.expandedRows.value).toEqual(['chr1-12345-A-G', 'chr2-67890-C-T'])
  })

  it('reset clears both expandedRows and cache', () => {
    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    // Set some state
    result.expandedRows.value = ['chr1-12345-A-G', 'chr2-67890-C-T']
    result.carrierMap.value.set('chr1-12345-A-G', [{ case_name: 'Patient A', gt_num: '0/1' }])

    result.reset()

    // Both cleared
    expect(result.expandedRows.value).toEqual([])
    expect(result.carrierMap.value.size).toBe(0)
  })

  it('handles window.api unavailable gracefully', async () => {
    // @ts-expect-error - Testing undefined case
    delete window.api

    const [result, appInstance] = withSetup(() => useCarriers())
    app = appInstance

    const mockVariant: CohortVariant = {
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

    await result.loadCarriers(mockVariant)

    // No cache entry added
    expect(result.hasCarriers('chr1-12345-A-G')).toBe(false)
  })
})
