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
import { SUMMARY_STALE_POLL_MS } from '@renderer/composables/useSummaryFreshness'
import type { CohortVariant } from '../../../../../src/shared/types/cohort'

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

  it('queryPage returns the page from the IPC call', async () => {
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

    await expect(result.queryPage({ limit: 50, sort_order: 'desc' })).resolves.toEqual({
      data: mockVariants,
      total_count: 1
    })
    expect(window.api.cohort.getVariants).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, sort_order: 'desc' })
    )
  })

  it('passes the previous page cursor only for the directly following page', async () => {
    window.api.cohort.getVariants = vi
      .fn()
      .mockResolvedValueOnce({ data: [], total_count: 100, next_cursor: 'c1' })
      .mockResolvedValue({ data: [], total_count: 100 })
    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.queryPage({ limit: 10, sort_order: 'desc' })
    await result.queryPage({ limit: 10, offset: 10, sort_order: 'desc' })
    await result.queryPage({ limit: 10, offset: 20, sort_order: 'desc' })
    await result.queryPage({ limit: 10, offset: 10, sort_order: 'desc', gene_symbol: 'X' })

    const calls = vi.mocked(window.api.cohort.getVariants).mock.calls.map((c) => c[0])
    expect(calls[0]).not.toHaveProperty('cursor')
    expect(calls[1]).toMatchObject({ offset: 10, cursor: 'c1' })
    expect(calls[2]).not.toHaveProperty('cursor')
    // Different filter scope → no cursor reuse.
    expect(calls[3]).not.toHaveProperty('cursor')
  })

  it('reuses the page cursor when only the _count_needed hint differs between pages', async () => {
    window.api.cohort.getVariants = vi
      .fn()
      .mockResolvedValueOnce({ data: [], total_count: 100, next_cursor: 'c1' })
      .mockResolvedValue({ data: [], total_count: 100 })
    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.queryPage({ limit: 10, sort_order: 'desc', _count_needed: true })
    await result.queryPage({ limit: 10, offset: 10, sort_order: 'desc', _count_needed: false })

    const calls = vi.mocked(window.api.cohort.getVariants).mock.calls.map((c) => c[0])
    expect(calls[1]).toMatchObject({ offset: 10, cursor: 'c1', _count_needed: false })
  })

  it('queryPage pages by cursor without touching the reactive state', async () => {
    window.api.cohort.getVariants = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ variant_key: 'a' }], total_count: 100, next_cursor: 'c1' })
      .mockResolvedValue({ data: [{ variant_key: 'b' }], total_count: 100 })
    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    const first = await result.queryPage({ limit: 10, sort_order: 'desc', _count_needed: true })
    const second = await result.queryPage({
      limit: 10,
      offset: 10,
      sort_order: 'desc',
      _count_needed: false
    })

    const calls = vi.mocked(window.api.cohort.getVariants).mock.calls.map((c) => c[0])
    expect(calls[0]).not.toHaveProperty('cursor')
    expect(calls[1]).toMatchObject({ offset: 10, cursor: 'c1', _count_needed: false })
    expect(first).toEqual({ data: [{ variant_key: 'a' }], total_count: 100 })
    expect(second).toEqual({ data: [{ variant_key: 'b' }], total_count: 100 })
  })

  it('reset forgets the cursors of the previous database', async () => {
    window.api.cohort.getVariants = vi
      .fn()
      .mockResolvedValue({ data: [], total_count: 100, next_cursor: 'c1' })
    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.queryPage({ limit: 10, sort_order: 'desc' })
    result.reset()
    await result.queryPage({ limit: 10, offset: 10, sort_order: 'desc' })

    const calls = vi.mocked(window.api.cohort.getVariants).mock.calls.map((c) => c[0])
    expect(calls[1]).not.toHaveProperty('cursor')
  })

  it('queryPage rejects with the IPC error for the caller to show', async () => {
    window.api.cohort.getVariants = vi.fn().mockRejectedValue(new Error('Network error'))

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await expect(result.queryPage({ limit: 50, sort_order: 'desc' })).rejects.toThrow(
      'Network error'
    )
  })

  it('passes filter params to IPC call', async () => {
    window.api.cohort.getVariants = vi.fn().mockResolvedValue({
      data: [],
      total_count: 0
    })

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.queryPage({
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
      carrier_count_min: 2,
      carrier_count_max: 3
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
        carrier_count_min: 2,
        carrier_count_max: 3
      })
    )
  })

  it('preserves _count_needed: false in buildIpcParams', () => {
    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    const ipcParams = result.buildIpcParams({
      limit: 25,
      sort_order: 'asc',
      _count_needed: false
    })

    expect(ipcParams._count_needed).toBe(false)
  })

  it('queryPage returns an empty page when window.api is unavailable', async () => {
    // @ts-expect-error - Testing undefined case
    delete window.api

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await expect(result.queryPage({ limit: 50, sort_order: 'desc' })).resolves.toEqual({
      data: [],
      total_count: 0
    })
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

    await result.queryPage({
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

  describe('activation gating', () => {
    it('starts active by default', () => {
      const [result, appInstance] = withSetup(() => useCohortData())
      app = appInstance

      expect(result.isActive.value).toBe(true)
    })

    it('deactivate sets isActive to false', () => {
      const [result, appInstance] = withSetup(() => useCohortData())
      app = appInstance

      result.deactivate()
      expect(result.isActive.value).toBe(false)
    })

    it('activate restores isActive to true', () => {
      const [result, appInstance] = withSetup(() => useCohortData())
      app = appInstance

      result.deactivate()
      expect(result.isActive.value).toBe(false)

      result.activate()
      expect(result.isActive.value).toBe(true)
    })

    it('deactivate unregisters summary listener', () => {
      const mockOff = vi.fn()
      window.api.cohort.onSummaryRebuilt = vi.fn().mockReturnValue(mockOff)

      const [result, appInstance] = withSetup(() => useCohortData())
      app = appInstance

      // Listener was registered on init
      expect(window.api.cohort.onSummaryRebuilt).toHaveBeenCalledTimes(1)

      // Deactivate should call the cleanup function
      result.deactivate()
      expect(mockOff).toHaveBeenCalledTimes(1)
    })

    it('activate re-registers summary listener after deactivation', () => {
      const mockOff = vi.fn()
      window.api.cohort.onSummaryRebuilt = vi.fn().mockReturnValue(mockOff)

      const [result, appInstance] = withSetup(() => useCohortData())
      app = appInstance

      expect(window.api.cohort.onSummaryRebuilt).toHaveBeenCalledTimes(1)

      result.deactivate()
      result.activate()

      // Should have been called again on re-activation
      expect(window.api.cohort.onSummaryRebuilt).toHaveBeenCalledTimes(2)
    })

    it('activate clears a stale notice whose rebuild ended while deactivated', async () => {
      window.api.cohort.getSummaryStatus = vi.fn().mockResolvedValue({ is_stale: true })
      const [result, appInstance] = withSetup(() => useCohortData())
      app = appInstance
      await flushPromises()
      expect(result.summaryStale.value).toBe(true)

      // The rebuild ends while the tab is hidden: no listener, no poll.
      result.deactivate()
      window.api.cohort.getSummaryStatus = vi.fn().mockResolvedValue({ is_stale: false })
      result.activate()
      await flushPromises()

      expect(result.summaryStale.value).toBe(false)
    })

    it('activate resumes polling when the summary is still stale', async () => {
      vi.useFakeTimers()
      try {
        window.api.cohort.getSummaryStatus = vi.fn().mockResolvedValue({ is_stale: true })
        const [result, appInstance] = withSetup(() => useCohortData())
        app = appInstance
        await vi.advanceTimersByTimeAsync(0)

        result.deactivate()
        result.activate()
        await vi.advanceTimersByTimeAsync(0)
        window.api.cohort.getSummaryStatus = vi.fn().mockResolvedValue({ is_stale: false })
        await vi.advanceTimersByTimeAsync(SUMMARY_STALE_POLL_MS)

        expect(result.summaryStale.value).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
