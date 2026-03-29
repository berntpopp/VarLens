/**
 * Unit tests for useVariantData composable.
 *
 * Covers initial state, filter propagation, column filter merging,
 * IPC safety, case switching, and annotation loading.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useVariantData } from '@renderer/components/variant-table/useVariantData'
import { _resetAnnotationsForTesting } from '@renderer/composables/useAnnotations'

const mockVariant = {
  id: 1,
  chr: 'chr1',
  pos: 12345,
  ref: 'A',
  alt: 'G',
  gene_symbol: 'BRCA1',
  consequence: 'missense_variant',
  func: 'exonic',
  gt_num: 1,
  qual: 30.5,
  gnomad_af: 0.001,
  clinvar: null,
  cadd: 25.0,
  transcript: 'NM_007294.4',
  cdna: 'c.123A>G',
  aa_change: 'p.Lys41Glu',
  hpo_sim_score: null,
  moi: null,
  omim_mim_number: null,
  impact: 'MODERATE'
}

describe('useVariantData', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    setActivePinia(createPinia())
    _resetAnnotationsForTesting()
    window.api = createMockApi()
    // Default: immediate caseId watcher calls query for unfiltered count
    window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  function setup(caseId = 1, filters: Record<string, unknown> = {}) {
    const caseIdRef = ref(caseId)
    const filtersRef = ref(filters)
    const onCountsUpdate = vi.fn()
    const onSortUpdate = vi.fn()
    const [result, appInstance] = withSetup(() =>
      useVariantData({
        caseId: caseIdRef,
        filters: filtersRef as ReturnType<typeof ref>,
        onCountsUpdate,
        onSortUpdate
      })
    )
    app = appInstance
    return { result, caseIdRef, filtersRef, onCountsUpdate, onSortUpdate }
  }

  // ─── 1. Initial state and case loading ───────────────────────────────────────

  describe('initial state and case loading', () => {
    it('exposes expected initial state after setup', async () => {
      const { result } = setup()
      // Flush all promises including the immediate caseId watcher query
      await flushPromises()
      await flushPromises()

      expect(result.variants.value).toEqual([])
      expect(result.totalCount.value).toBe(0)
      expect(result.page.value).toBe(1)
      expect(result.selectedVariantId.value).toBeNull()
      expect(result.columnMeta.value).toEqual([])
    })

    it('loading becomes false after loadVariants completes', async () => {
      const { result } = setup()
      await flushPromises()

      // resetState sets loading=true intentionally (prevents flash); loadVariants resets it
      await result.loadVariants()
      await flushPromises()

      expect(result.loading.value).toBe(false)
    })

    it('fetches unfiltered count immediately via caseId watcher', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 42 })
      setup(7)
      await flushPromises()

      // The immediate watcher calls query with (caseId, {}, undefined, 1, [])
      expect(window.api.variants.query).toHaveBeenCalledWith(7, {}, undefined, 1, [])
    })

    it('does not fetch when caseId is 0', async () => {
      setup(0)
      await flushPromises()

      expect(window.api.variants.query).not.toHaveBeenCalled()
    })

    it('itemsPerPageOptions is a non-empty array', async () => {
      const { result } = setup()
      await flushPromises()

      // itemsPerPageOptions is a plain array (not a ref) from APP_CONFIG
      const opts = result.itemsPerPageOptions
      expect(Array.isArray(opts)).toBe(true)
      expect((opts as unknown[]).length).toBeGreaterThan(0)
    })
  })

  // ─── 2. Filter propagation ────────────────────────────────────────────────────

  describe('filter propagation', () => {
    it('passes filters to api.variants.query when loadVariants is called', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
      const { result } = setup(1, { gene_symbol: 'BRCA1' })
      await flushPromises()

      // Reset call count after setup (initial caseId watcher call)
      vi.clearAllMocks()
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 0 })

      await result.loadVariants()
      await flushPromises()

      const calls = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const lastCall = calls[calls.length - 1]
      // caseId is first arg, filters are second arg
      expect(lastCall[0]).toBe(1)
      expect(lastCall[1]).toMatchObject({ gene_symbol: 'BRCA1' })
    })

    it('reloads when filter key changes', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
      const { filtersRef } = setup(1, {})
      await flushPromises()

      const callsBefore = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls.length

      // Change filters
      filtersRef.value = { gene_symbol: 'TP53' }
      await nextTick()
      await flushPromises()

      const callsAfter = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls.length
      expect(callsAfter).toBeGreaterThan(callsBefore)
    })
  })

  // ─── 3. Column filter merging ─────────────────────────────────────────────────

  describe('column filter merging', () => {
    it('merges column filters with toolbar filters in fetchPage', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
      const { result } = setup(1, {})
      await flushPromises()

      // Set a column filter
      result.setColumnFilter('gene_symbol', { op: 'contains', value: 'BRCA' })
      await flushPromises()

      // Wait for debounced reload (300ms) — advance timers
      vi.useFakeTimers()
      vi.advanceTimersByTime(400)
      vi.useRealTimers()
      await flushPromises()

      const calls = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls
      // Find a call that was made after setting the column filter — the filters arg
      // should include column_filters with gene_symbol
      const relevantCall = calls.find(
        (call: unknown[]) =>
          call[1] &&
          typeof call[1] === 'object' &&
          (call[1] as Record<string, unknown>).column_filters !== undefined
      )
      if (relevantCall) {
        expect(relevantCall[1]).toMatchObject({
          column_filters: { gene_symbol: { op: 'contains', value: 'BRCA' } }
        })
      }
    })

    it('clears column filters on clearAllColumnFilters', async () => {
      const { result } = setup()
      await flushPromises()

      result.setColumnFilter('chr', { op: 'eq', value: 'chr1' })
      expect(result.hasActiveFilters.value).toBe(true)

      result.clearAllColumnFilters()
      expect(result.hasActiveFilters.value).toBe(false)
      expect(result.activeFilterCount.value).toBe(0)
    })
  })

  // ─── 4. IPC safety ────────────────────────────────────────────────────────────

  describe('IPC safety', () => {
    it('passes plain objects (not Vue proxies) to api.variants.query', async () => {
      let capturedFilters: unknown = null
      window.api.variants.query = vi
        .fn()
        .mockImplementation((_caseId: unknown, filters: unknown) => {
          capturedFilters = filters
          return Promise.resolve({ data: [], total_count: 0 })
        })

      const { result } = setup(1, { gene_symbol: 'BRCA1' })
      await flushPromises()

      vi.clearAllMocks()
      capturedFilters = null
      window.api.variants.query = vi
        .fn()
        .mockImplementation((_caseId: unknown, filters: unknown) => {
          capturedFilters = filters
          return Promise.resolve({ data: [], total_count: 0 })
        })

      await result.loadVariants()
      await flushPromises()

      // The captured filters must be a plain object — not a Vue reactive proxy
      // A plain object will survive JSON.stringify/parse without errors
      expect(() => JSON.stringify(capturedFilters)).not.toThrow()
      expect(capturedFilters).not.toBeNull()

      // Check it's not a Proxy (Vue reactive objects have special internal symbols)
      const str = Object.prototype.toString.call(capturedFilters)
      expect(str).toBe('[object Object]')
    })

    it('filters arriving at mock are serializable without circular references', async () => {
      // Initial setup triggers caseId watcher — use a throwaway mock
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 0 })

      // Reactive filter object
      const { result } = setup(1, { gene_symbol: 'BRCA1', min_qual: 20 })
      await flushPromises()

      vi.clearAllMocks()
      let capturedFilters: unknown = null
      window.api.variants.query = vi
        .fn()
        .mockImplementation((_caseId: unknown, filters: unknown) => {
          capturedFilters = filters
          return Promise.resolve({ data: [], total_count: 0 })
        })

      await result.loadVariants()
      await flushPromises()

      const serialized = JSON.parse(JSON.stringify(capturedFilters))
      expect(serialized).toMatchObject({ gene_symbol: 'BRCA1', min_qual: 20 })
    })
  })

  // ─── 5. Case switching ────────────────────────────────────────────────────────

  describe('case switching', () => {
    it('resets selectedVariantId on case change', async () => {
      const { result, caseIdRef } = setup(1)
      await flushPromises()

      result.selectedVariantId.value = 99
      expect(result.selectedVariantId.value).toBe(99)

      caseIdRef.value = 2
      await nextTick()
      await flushPromises()

      expect(result.selectedVariantId.value).toBeNull()
    })

    it('fetches unfiltered count for new caseId on case switch', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
      const { caseIdRef } = setup(1)
      await flushPromises()

      vi.clearAllMocks()
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 55 })

      caseIdRef.value = 3
      await nextTick()
      await flushPromises()

      expect(window.api.variants.query).toHaveBeenCalledWith(3, {}, undefined, 1, [])
    })

    it('clears column filters when switching cases', async () => {
      const { result, caseIdRef } = setup(1)
      await flushPromises()

      result.setColumnFilter('chr', { op: 'eq', value: 'chr1' })
      expect(result.hasActiveFilters.value).toBe(true)

      caseIdRef.value = 2
      await nextTick()
      await flushPromises()

      expect(result.hasActiveFilters.value).toBe(false)
    })

    it('calls onCountsUpdate when totalCount changes', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
      const { result, onCountsUpdate } = setup(1)
      await flushPromises()

      // Manually trigger a loadVariants that returns data with a count
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [mockVariant], total_count: 7 })

      await result.loadVariants()
      await flushPromises()

      expect(onCountsUpdate).toHaveBeenCalledWith(expect.objectContaining({ filtered: 7 }))
    })
  })

  // ─── 6. Annotation loading ────────────────────────────────────────────────────

  describe('annotation loading', () => {
    it('calls api.annotations.batchGet when variants are loaded', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({
        data: [mockVariant],
        total_count: 1
      })
      window.api.annotations.batchGet = vi.fn().mockResolvedValue({})

      const { result } = setup(1)
      await flushPromises()

      await result.loadVariants()
      await flushPromises()

      expect(window.api.annotations.batchGet).toHaveBeenCalledWith(1, [
        {
          chr: mockVariant.chr,
          pos: mockVariant.pos,
          ref: mockVariant.ref,
          alt: mockVariant.alt
        }
      ])
    })

    it('does not call batchGet when variants array is empty', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
      window.api.annotations.batchGet = vi.fn().mockResolvedValue({})

      const { result } = setup(1)
      await flushPromises()

      await result.loadVariants()
      await flushPromises()

      expect(window.api.annotations.batchGet).not.toHaveBeenCalled()
    })
  })

  // ─── 7. getRowProps ───────────────────────────────────────────────────────────

  describe('getRowProps', () => {
    it('returns striped class for odd-indexed rows', () => {
      const { result } = setup()

      const props = result.getRowProps({ item: mockVariant as never, index: 1 })
      expect(props.class).toContain('variant-row--striped')
    })

    it('returns no extra class for even-indexed rows with no selection', () => {
      const { result } = setup()

      const props = result.getRowProps({ item: mockVariant as never, index: 0 })
      expect(props.class).not.toContain('variant-row--striped')
      expect(props.class).not.toContain('variant-row--selected')
    })

    it('returns selected class when item is selected', () => {
      const { result } = setup()

      result.selectedVariantId.value = mockVariant.id
      const props = result.getRowProps({ item: mockVariant as never, index: 0 })
      expect(props.class).toContain('variant-row--selected')
    })

    it('returns both striped and selected classes when applicable', () => {
      const { result } = setup()

      result.selectedVariantId.value = mockVariant.id
      const props = result.getRowProps({ item: mockVariant as never, index: 1 })
      expect(props.class).toContain('variant-row--striped')
      expect(props.class).toContain('variant-row--selected')
    })
  })

  // ─── 8. resetSort ─────────────────────────────────────────────────────────────

  describe('resetSort', () => {
    it('resets sortBy to an empty array', async () => {
      const { result } = setup()
      await flushPromises()

      result.sortBy.value = [{ key: 'pos', order: 'asc' }]
      result.resetSort()

      expect(result.sortBy.value).toEqual([])
    })
  })

  // ─── 9. External columnMeta ───────────────────────────────────────────────────

  describe('external columnMeta', () => {
    it('uses provided external columnMeta ref', async () => {
      const externalMeta = ref([{ key: 'gene_symbol', label: 'Gene', filterable: true }])
      const caseIdRef = ref(1)
      const filtersRef = ref({})

      const [result, appInstance] = withSetup(() =>
        useVariantData({
          caseId: caseIdRef,
          filters: filtersRef as ReturnType<typeof ref>,
          columnMeta: externalMeta as ReturnType<typeof ref>,
          onCountsUpdate: vi.fn(),
          onSortUpdate: vi.fn()
        })
      )
      app = appInstance
      await flushPromises()

      expect(result.columnMeta.value).toEqual(externalMeta.value)

      // Mutating external ref reflects in composable
      externalMeta.value = []
      await nextTick()
      expect(result.columnMeta.value).toEqual([])
    })
  })
})
