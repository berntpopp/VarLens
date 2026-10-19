/* eslint-disable vue/one-component-per-file -- inline test components */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  useBulkTriageSelection,
  MAX_BULK_TRIAGE_SELECTION
} from '../../../src/renderer/src/composables/useBulkTriageSelection'
import {
  annotationCache,
  useAnnotations
} from '../../../src/renderer/src/composables/useAnnotations'
import { evictAnnotationCacheKeys } from '../../../src/renderer/src/composables/annotation-cache'
import { AppStateKey } from '../../../src/renderer/src/composables/useAppState'

describe('useBulkTriageSelection', () => {
  const mockCacheEntry = (id: number, extraPerCase: Record<string, unknown> = {}) => ({
    global: null,
    perCase: {
      id,
      case_id: 42,
      variant_id: id,
      is_starred: false,
      acmg_classification: null,
      acmg_evidence: null,
      acmg_override_reason: null,
      notes: null,
      created_at: 1000,
      updated_at: 1000,
      ...extraPerCase
    }
  })

  const items = ref([
    { id: 101, chr: 'chr1', pos: 1000, ref: 'A', alt: 'T' },
    { id: 102, chr: 'chr1', pos: 2000, ref: 'C', alt: 'G' },
    { id: 103, chr: 'chr2', pos: 3000, ref: 'G', alt: 'A' },
    { id: 104, chr: 'chr3', pos: 4000, ref: 'T', alt: 'C' }
  ])
  const caseId = ref<number | null>(42)
  const onTriageApplied = vi.fn()
  let pinia: ReturnType<typeof createPinia>

  const createBulk = (customOptions: Record<string, unknown> = {}) =>
    useBulkTriageSelection({
      items: () => items.value,
      getItemId: (v: { id: number }) => v.id,
      caseId,
      onTriageApplied,
      ...customOptions
    })

  beforeEach(() => {
    vi.clearAllMocks()
    pinia = createPinia()
    setActivePinia(pinia)
    caseId.value = 42
    annotationCache.value.clear()
    // @ts-expect-error Mock window.api
    window.api = {
      annotations: {
        batchUpsertPerCase: vi.fn().mockResolvedValue({ updatedCount: 2 }),
        batchGet: vi.fn().mockResolvedValue({
          success: true,
          data: {}
        })
      }
    }
  })

  it('initializes with empty selection', () => {
    const bulk = createBulk()

    expect(bulk.selectedIds.value.length).toBe(0)
    expect(bulk.selectedCount.value).toBe(0)
    expect(bulk.isAllSelected.value).toBe(false)
    expect(bulk.isSomeSelected.value).toBe(false)
  })

  it('selects and deselects single items', () => {
    const bulk = createBulk()

    bulk.toggleSelect(101)
    expect(bulk.isSelected(101)).toBe(true)
    expect(bulk.selectedCount.value).toBe(1)
    expect(bulk.isSomeSelected.value).toBe(true)
    expect(bulk.isAllSelected.value).toBe(false)

    bulk.toggleSelect(101)
    expect(bulk.isSelected(101)).toBe(false)
    expect(bulk.selectedCount.value).toBe(0)
  })

  it('supports toggleSelectAll', () => {
    const bulk = createBulk()

    bulk.toggleSelectAll(true)
    expect(bulk.selectedCount.value).toBe(4)
    expect(bulk.isAllSelected.value).toBe(true)
    expect(bulk.isSomeSelected.value).toBe(false)

    bulk.toggleSelectAll(false)
    expect(bulk.selectedCount.value).toBe(0)
    expect(bulk.isAllSelected.value).toBe(false)
  })

  it('supports Shift+Click range selection', () => {
    const bulk = createBulk()

    // Click item at index 0 (101)
    bulk.handleRowCheckboxClick(101, new MouseEvent('click', { shiftKey: false }))
    expect(bulk.selectedCount.value).toBe(1)
    expect(bulk.isSelected(101)).toBe(true)

    // Shift-click item at index 2 (103) -> selects 101, 102, 103
    bulk.handleRowCheckboxClick(103, new MouseEvent('click', { shiftKey: true }))
    expect(bulk.selectedCount.value).toBe(3)
    expect(bulk.isSelected(101)).toBe(true)
    expect(bulk.isSelected(102)).toBe(true)
    expect(bulk.isSelected(103)).toBe(true)
    expect(bulk.isSelected(104)).toBe(false)
  })

  it('auto-clears selection on caseId change', async () => {
    const bulk = createBulk()

    bulk.toggleSelect(101)
    expect(bulk.selectedCount.value).toBe(1)

    caseId.value = 99
    await vi.waitFor(() => {
      expect(bulk.selectedCount.value).toBe(0)
    })
  })

  it('dispatches applyBulkTriage with batchUpsertPerCase', async () => {
    const bulk = createBulk()

    bulk.toggleSelect(101)
    bulk.toggleSelect(102)

    await bulk.applyBulkTriage({
      starred: true
    })

    expect(window.api.annotations.batchUpsertPerCase).toHaveBeenCalledWith(42, [101, 102], {
      starred: true
    })

    expect(onTriageApplied).toHaveBeenCalledTimes(1)
    expect(bulk.selectedCount.value).toBe(0)
  })

  it('calls appState.showSnack and preserves selection on IPC error', async () => {
    const showSnackSpy = vi.fn()
    // @ts-expect-error Mock window.api with failure
    window.api.annotations.batchUpsertPerCase = vi.fn().mockResolvedValue({
      code: 'OVERRIDE_REASON_REQUIRED',
      message: 'Override reason required',
      userMessage: 'Override reason required'
    })

    let bulkInstance!: ReturnType<typeof useBulkTriageSelection>
    const TestComponent = defineComponent({
      setup() {
        bulkInstance = createBulk()
        return () => null
      }
    })

    mount(TestComponent, {
      global: {
        plugins: [pinia],
        provide: {
          [AppStateKey as symbol]: {
            showSnack: showSnackSpy
          }
        }
      }
    })

    bulkInstance.toggleSelect(101)
    bulkInstance.toggleSelect(102)
    expect(bulkInstance.selectedCount.value).toBe(2)

    const updated = await bulkInstance.applyBulkTriage({
      acmg_classification: 'Pathogenic'
    })

    expect(updated).toBe(0)
    expect(showSnackSpy).toHaveBeenCalledWith('Override reason required', 'error')
    expect(bulkInstance.selectedCount.value).toBe(2)
    expect(bulkInstance.isSelected(101)).toBe(true)
    expect(bulkInstance.isSelected(102)).toBe(true)
    expect(onTriageApplied).not.toHaveBeenCalled()
  })

  it('synchronizes native DOM checkbox .checked state on Shift+Click', () => {
    const bulk = createBulk()

    const checkbox1 = document.createElement('input')
    checkbox1.type = 'checkbox'
    checkbox1.checked = false

    // 1. Click Row 1 (101) -> selects [101]
    bulk.handleRowCheckboxClick(101, { shiftKey: false, target: checkbox1 })
    checkbox1.checked = true
    expect(bulk.selectedIds.value).toEqual([101])

    // 2. Click Row 3 (103) -> selects [101, 103]
    const checkbox3 = document.createElement('input')
    checkbox3.type = 'checkbox'
    bulk.handleRowCheckboxClick(103, { shiftKey: false, target: checkbox3 })
    checkbox3.checked = true
    expect(bulk.selectedIds.value).toEqual([101, 103])

    // 3. Shift+Click Row 1 (101).
    // Native browser click flips checkbox1.checked to false before event listener runs.
    checkbox1.checked = false
    bulk.handleRowCheckboxClick(101, { shiftKey: true, target: checkbox1 })

    // Selection now includes range [103, 102, 101] -> all 3
    expect(bulk.selectedIds.value).toEqual(expect.arrayContaining([101, 102, 103]))
    // Crucially, checkbox1.checked must be resynchronized to true!
    expect(checkbox1.checked).toBe(true)
  })

  it('evicts only selected variant cache entries on bulk triage and preserves unrelated entries', async () => {
    const testItems = ref([
      { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' },
      { id: 2, chr: '1', pos: 200, ref: 'G', alt: 'C' }
    ])

    annotationCache.value.set('1:100:A:T', mockCacheEntry(1))
    annotationCache.value.set('1:200:G:C', mockCacheEntry(2))

    const bulk = createBulk({ items: () => testItems.value })

    // Select only Variant B (id 2)
    bulk.toggleSelect(2)
    expect(bulk.selectedIds.value).toEqual([2])

    await bulk.applyBulkTriage({ starred: true })

    // Variant B was evicted from cache so fresh annotations will be fetched
    expect(annotationCache.value.has('1:200:G:C')).toBe(false)
    // Variant A was NOT selected, so its cache entry remains preserved!
    expect(annotationCache.value.has('1:100:A:T')).toBe(true)
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.id).toBe(1)
  })

  it('refreshes open selectedPanelVariant from Page 1 into annotationCache during bulk triage on Page 2 while preserving unrelated cached variants', async () => {
    const page1Items = [{ id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }]
    const page2Items = [{ id: 2, chr: '1', pos: 200, ref: 'G', alt: 'C' }]
    const currentItemsRef = ref(page1Items)

    const panelVariantRef = ref({
      id: 1,
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T'
    })

    annotationCache.value.set('1:100:A:T', mockCacheEntry(1, { starred: 0 }))
    annotationCache.value.set('1:999:C:G', mockCacheEntry(999, { starred: 0 }))

    const batchGetSpy = vi.fn().mockResolvedValue({
      '1:100:A:T': mockCacheEntry(1, { starred: 1, is_starred: true, updated_at: 2000 })
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    let bulkInstance!: ReturnType<typeof useBulkTriageSelection>
    mount(
      defineComponent({
        setup() {
          bulkInstance = createBulk({ items: () => currentItemsRef.value })
          return () => null
        }
      }),
      {
        global: {
          plugins: [pinia],
          provide: {
            [AppStateKey as symbol]: {
              selectedPanelVariant: panelVariantRef,
              showSnack: vi.fn()
            }
          }
        }
      }
    )

    // 1. Select Variant A on Page 1
    bulkInstance.toggleSelect(1)
    expect(bulkInstance.selectedIds.value).toEqual([1])

    // 2. User navigates to Page 2 (items no longer contains Variant A)
    currentItemsRef.value = page2Items

    // 3. Apply bulk triage
    await bulkInstance.applyBulkTriage({ starred: true })

    // IPC batchUpsert was called for Variant A (id 1)
    expect(window.api.annotations.batchUpsertPerCase).toHaveBeenCalledWith(42, [1], {
      starred: true
    })

    // BatchGet was called specifically for Variant A to refresh the open panel variant
    expect(batchGetSpy).toHaveBeenCalledWith(
      42,
      expect.arrayContaining([
        expect.objectContaining({
          chr: '1',
          pos: 100,
          ref: 'A',
          alt: 'T',
          variantId: 1
        })
      ]),
      null
    )

    // Variant A's entry in annotationCache is now refreshed with fresh data (starred: 1)
    expect(annotationCache.value.has('1:100:A:T')).toBe(true)
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.starred).toBe(1)

    // Unrelated cached variant 1:999:C:G was preserved and never requested
    expect(annotationCache.value.has('1:999:C:G')).toBe(true)
    expect(annotationCache.value.get('1:999:C:G')?.perCase?.id).toBe(999)
    expect(batchGetSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ chr: '1', pos: 999 })]),
      expect.anything()
    )
  })

  it('discards post-await completion work if caseId changes mid-flight during applyBulkTriage', async () => {
    let resolveUpsert!: (val: unknown) => void
    const deferredUpsert = new Promise((resolve) => {
      resolveUpsert = resolve
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(deferredUpsert)

    const bulk = createBulk()

    // 1. Select items 101 and 102 in Case 42
    bulk.toggleSelect(101)
    bulk.toggleSelect(102)
    expect(bulk.selectedIds.value).toEqual([101, 102])

    // Pre-populate cache for Case 42
    annotationCache.value.set('chr1:1000:A:T', mockCacheEntry(101))

    // 2. Start bulk triage while on Case 42
    const triagePromise = bulk.applyBulkTriage({ starred: true })
    expect(bulk.isExecuting.value).toBe(true)

    // 3. User switches to Case 99 while IPC is in flight
    caseId.value = 99
    // Wait for the caseId watch to clear selections for the old case
    await vi.waitFor(() => {
      expect(bulk.selectedIds.value.length).toBe(0)
    })

    // User selects a row in Case 99
    bulk.toggleSelect(104)
    expect(bulk.selectedIds.value).toEqual([104])

    // 4. Resolve the in-flight upsert for Case 42
    resolveUpsert({ updatedCount: 2 })
    const count = await triagePromise

    expect(count).toBe(2)
    // Post-await completion was discarded:
    // - onTriageApplied was NOT called for Case 42
    expect(onTriageApplied).not.toHaveBeenCalled()
    // - Selection of the active Case 99 was NOT cleared
    expect(bulk.selectedIds.value).toEqual([104])
    expect(bulk.isExecuting.value).toBe(false)
  })

  it('prevents older in-flight batchGet from overwriting refreshed data after cache eviction', async () => {
    let resolveFirstBatch!: (val: unknown) => void
    const firstBatchPromise = new Promise((resolve) => {
      resolveFirstBatch = resolve
    })

    const batchGetSpy = vi
      .fn()
      // First call (older in-flight, e.g. Pathogenic) is deferred
      .mockReturnValueOnce(firstBatchPromise)
      // Second call (refreshed data, e.g. Benign) resolves immediately
      .mockResolvedValueOnce({
        '1:100:A:T': mockCacheEntry(1, { acmg_classification: 'Benign' })
      })

    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const { loadAnnotationsBatch } = useAnnotations()

    // 1. Start initial fetch (Pathogenic) in the background
    const initialLoad = loadAnnotationsBatch(42, [
      { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }
    ])

    // 2. Cache is evicted (e.g. user performed a triage update or eviction)
    evictAnnotationCacheKeys(['1:100:A:T'])

    // 3. Newer fetch runs and resolves with Benign
    await loadAnnotationsBatch(42, [{ id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }])

    expect(annotationCache.value.get('1:100:A:T')?.perCase?.acmg_classification).toBe('Benign')

    // 4. Now the older in-flight fetch resolves with Pathogenic
    resolveFirstBatch({
      '1:100:A:T': mockCacheEntry(1, { acmg_classification: 'Pathogenic' })
    })
    await initialLoad

    // 5. Older in-flight response was ignored, Benign is retained!
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.acmg_classification).toBe('Benign')
  })

  it('bounds coordsById strictly to selected rows across pages and clears on deselect', async () => {
    const page1 = ref([
      { id: 101, chr: '1', pos: 100, ref: 'A', alt: 'T' },
      { id: 102, chr: '1', pos: 200, ref: 'C', alt: 'G' }
    ])

    const bulk = createBulk({ items: () => page1.value })

    // Initially nothing selected
    expect(bulk.selectedIds.value).toEqual([])

    // Select row 101
    bulk.toggleSelect(101)
    expect(bulk.isSelected(101)).toBe(true)

    // Deselect row 101 -> removed from selection and coords
    bulk.toggleSelect(101)
    expect(bulk.isSelected(101)).toBe(false)

    // Select row 102
    bulk.toggleSelect(102)

    // User navigates to page 2 without selecting page 2 rows
    page1.value = [
      { id: 103, chr: '2', pos: 300, ref: 'G', alt: 'A' },
      { id: 104, chr: '3', pos: 400, ref: 'T', alt: 'C' }
    ]

    // Apply bulk triage for selected row 102
    await bulk.applyBulkTriage({ starred: true })

    // Only row 102 was in targetSet and batchUpsertPerCase
    expect(window.api.annotations.batchUpsertPerCase).toHaveBeenCalledWith(42, [102], {
      starred: true
    })
    // After triage applied, selection is cleared
    expect(bulk.selectedCount.value).toBe(0)
  })

  it('does not wipe unselected cached variants when applyBulkTriage runs after beginAnnotationRequest with known build', async () => {
    const { beginAnnotationRequest } =
      await import('../../../src/renderer/src/composables/annotation-cache')

    // Simulate page load having established GRCh38 build for Case 42
    beginAnnotationRequest(42, 'GRCh38')

    // Pre-populate unselected variant B in annotationCache
    annotationCache.value.set('1:200:G:C', mockCacheEntry(2))

    const bulk = createBulk({
      items: () => [
        { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' },
        { id: 2, chr: '1', pos: 200, ref: 'G', alt: 'C' }
      ]
    })

    // Select ONLY variant 1
    bulk.toggleSelect(1)

    // Run applyBulkTriage
    await bulk.applyBulkTriage({ starred: true })

    // Unselected variant 2 MUST still be cached (not wiped by buildUnknown in beginAnnotationRequest)
    expect(annotationCache.value.has('1:200:G:C')).toBe(true)
    expect(annotationCache.value.get('1:200:G:C')?.perCase?.id).toBe(2)
  })

  it('invalidates and refreshes affected visible cache entries while preserving new selection on A -> B -> A round-trip', async () => {
    let resolveUpsert!: (val: unknown) => void
    const deferredUpsert = new Promise((resolve) => {
      resolveUpsert = resolve
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(deferredUpsert)

    const bulk = createBulk()

    // 1. On Case 42 (Case A), item 101 has cached Benign classification
    annotationCache.value.set(
      'chr1:1000:A:T',
      mockCacheEntry(101, { acmg_classification: 'Benign' })
    )
    bulk.toggleSelect(101)
    expect(bulk.selectedIds.value).toEqual([101])

    // 2. Start bulk triage for item 101 on Case 42 to Pathogenic
    const triagePromise = bulk.applyBulkTriage({ acmg_classification: 'Pathogenic' })
    expect(bulk.isExecuting.value).toBe(true)

    // 3. User navigates Case 42 -> Case 99 (Case B)
    caseId.value = 99
    await vi.waitFor(() => {
      expect(bulk.selectedIds.value.length).toBe(0)
    })

    // 4. User navigates back Case 99 -> Case 42 (Case A again)
    caseId.value = 42
    await vi.waitFor(() => {
      expect(bulk.selectedIds.value.length).toBe(0)
    })

    // Simulate item 101 having Benign in cache before write finishes
    annotationCache.value.set(
      'chr1:1000:A:T',
      mockCacheEntry(101, { acmg_classification: 'Benign' })
    )

    // User selects item 103 in the new session of Case 42
    bulk.toggleSelect(103)
    expect(bulk.selectedIds.value).toEqual([103])

    // Configure batchGet mock to return committed Pathogenic data for item 101
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = vi.fn().mockResolvedValue({
      'chr1:1000:A:T': mockCacheEntry(101, { acmg_classification: 'Pathogenic' })
    })

    // 5. In-flight upsert from initial Case 42 resolves
    resolveUpsert({ updatedCount: 1 })
    const count = await triagePromise

    expect(count).toBe(1)
    // 6. Because toValue(caseId) === 42, affected visible row 101 was refreshed to Pathogenic!
    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.acmg_classification).toBe(
      'Pathogenic'
    )
    // 7. Selection [103] is preserved, and onTriageApplied is called because case 42 is active
    expect(onTriageApplied).toHaveBeenCalledTimes(1)
    expect(bulk.selectedIds.value).toEqual([103])
    expect(bulk.isExecuting.value).toBe(false)
  })

  it('does not clear newly modified selection when in-flight bulk triage resolves and refreshes panel and table', async () => {
    let resolveUpsert!: (val: unknown) => void
    const deferredUpsert = new Promise((resolve) => {
      resolveUpsert = resolve
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(deferredUpsert)

    // Open panel variant on an off-page row (id 999)
    const panelVariantRef = ref({
      id: 999,
      case_id: 42,
      chr: 'chr1',
      pos: 9990,
      ref: 'A',
      alt: 'T'
    })

    const batchGetSpy = vi.fn().mockResolvedValue({
      'chr1:9990:A:T': mockCacheEntry(999, { starred: 1 })
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    let bulkInstance!: ReturnType<typeof useBulkTriageSelection>
    mount(
      defineComponent({
        setup() {
          bulkInstance = createBulk()
          return () => null
        }
      }),
      {
        global: {
          plugins: [pinia],
          provide: {
            [AppStateKey as symbol]: {
              selectedPanelVariant: panelVariantRef,
              showSnack: vi.fn()
            }
          }
        }
      }
    )

    bulkInstance.toggleSelect(101)
    expect(bulkInstance.selectedIds.value).toEqual([101])

    const triagePromise = bulkInstance.applyBulkTriage({ starred: true })
    expect(bulkInstance.isExecuting.value).toBe(true)

    // User modifies selection mid-flight
    bulkInstance.toggleSelect(102)
    expect(bulkInstance.selectedIds.value).toEqual([101, 102])

    resolveUpsert({ updatedCount: 1 })
    const count = await triagePromise

    expect(count).toBe(1)
    // Selection was preserved because selectionRev bumped!
    expect(bulkInstance.selectedIds.value).toEqual([101, 102])
    // Table and panel refreshes still ran:
    expect(onTriageApplied).toHaveBeenCalledTimes(1)
    expect(batchGetSpy).toHaveBeenCalled()
    expect(annotationCache.value.has('chr1:9990:A:T')).toBe(true)
    expect(bulkInstance.isExecuting.value).toBe(false)
  })

  it('does not touch cache or trigger batchGet if component unmounts and case switches to Case 2 while write is in flight', async () => {
    let resolveUpsert!: (val: unknown) => void
    const deferredUpsert = new Promise((resolve) => {
      resolveUpsert = resolve
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(deferredUpsert)
    const batchGetSpy = vi.fn().mockResolvedValue({})
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const { beginAnnotationRequest } =
      await import('../../../src/renderer/src/composables/annotation-cache')

    let bulkInstance!: ReturnType<typeof useBulkTriageSelection>
    const wrapper = mount(
      defineComponent({
        setup() {
          bulkInstance = createBulk()
          return () => null
        }
      }),
      { global: { plugins: [pinia] } }
    )

    // Select row 101 on Case 42
    bulkInstance.toggleSelect(101)
    const triagePromise = bulkInstance.applyBulkTriage({ starred: true })

    // Component unmounts (e.g. user navigates away)
    wrapper.unmount()

    // Case 2 establishes its cache
    beginAnnotationRequest(2, 'GRCh38')
    annotationCache.value.set('chr2:5000:C:T', mockCacheEntry(501, { case_id: 2 }))

    // Resolve old write for Case 42
    resolveUpsert({ updatedCount: 1 })
    const count = await triagePromise

    expect(count).toBe(1)
    // Case 2 cache was NOT cleared or touched
    expect(annotationCache.value.has('chr2:5000:C:T')).toBe(true)
    // No batchGet was triggered for Case 1
    expect(batchGetSpy).not.toHaveBeenCalled()
    expect(onTriageApplied).not.toHaveBeenCalled()
  })

  it('enforces MAX_BULK_TRIAGE_SELECTION cap of 1,000 with warning snack', () => {
    const showSnackSpy = vi.fn()
    const largeItems = Array.from({ length: 1005 }, (_, i) => ({
      id: i + 1,
      chr: 'chr1',
      pos: 1000 + i,
      ref: 'A',
      alt: 'T'
    }))

    let bulkInstance!: ReturnType<typeof useBulkTriageSelection>
    const TestComponent = defineComponent({
      setup() {
        bulkInstance = useBulkTriageSelection({
          items: () => largeItems,
          getItemId: (v) => v.id,
          caseId,
          onTriageApplied
        })
        return () => null
      }
    })

    mount(TestComponent, {
      global: {
        plugins: [pinia],
        provide: {
          [AppStateKey as symbol]: {
            showSnack: showSnackSpy
          }
        }
      }
    })

    // 1. toggleSelectAll(true) on 1005 items caps at 1000
    bulkInstance.toggleSelectAll(true)
    expect(bulkInstance.selectedCount.value).toBe(MAX_BULK_TRIAGE_SELECTION)
    expect(showSnackSpy).toHaveBeenCalledWith(
      'Maximum bulk selection of 1,000 variants reached.',
      'warning'
    )

    // 2. toggleSelect on an unselected item when at cap does not increase selection
    showSnackSpy.mockClear()
    bulkInstance.toggleSelect(1005)
    expect(bulkInstance.selectedCount.value).toBe(MAX_BULK_TRIAGE_SELECTION)
    expect(bulkInstance.isSelected(1005)).toBe(false)
    expect(showSnackSpy).toHaveBeenCalledWith(
      'Maximum bulk selection of 1,000 variants reached.',
      'warning'
    )

    // 3. Range selection (Shift+Click) respects 1000 cap
    bulkInstance.clearSelection()
    expect(bulkInstance.selectedCount.value).toBe(0)
    for (let i = 1; i <= 995; i++) {
      bulkInstance.toggleSelect(i)
    }
    expect(bulkInstance.selectedCount.value).toBe(995)

    showSnackSpy.mockClear()
    // Shift+Click row 1005 (range 995..1005 has 11 items, would exceed cap)
    bulkInstance.handleRowCheckboxClick(1005, new MouseEvent('click', { shiftKey: true }))
    expect(bulkInstance.selectedCount.value).toBe(1000)
    expect(showSnackSpy).toHaveBeenCalledWith(
      'Maximum bulk selection of 1,000 variants reached.',
      'warning'
    )
  })

  it('drops older in-flight batchGet read even after clearAnnotationCache runs before it resolves', async () => {
    let resolveFirstBatch!: (val: unknown) => void
    const firstBatchPromise = new Promise((resolve) => {
      resolveFirstBatch = resolve
    })

    const batchGetSpy = vi
      .fn()
      // First call (older in-flight, e.g. Pathogenic) is deferred
      .mockReturnValueOnce(firstBatchPromise)
      // Second call (after round-trip, e.g. Benign) resolves immediately
      .mockResolvedValueOnce({
        '1:100:A:T': mockCacheEntry(1, { acmg_classification: 'Benign' })
      })

    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const { useAnnotations } = await import('../../../src/renderer/src/composables/useAnnotations')
    const { clearAnnotationCache } =
      await import('../../../src/renderer/src/composables/annotation-cache')
    const { loadAnnotationsBatch } = useAnnotations()

    // 1. Initial fetch (Pathogenic) starts at evictionEpoch = 0, startVer = 0
    const initialLoad = loadAnnotationsBatch(42, [
      { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }
    ])

    // 2. Clear cache runs (simulates case switch or round-trip A -> B -> A)
    clearAnnotationCache()

    // 3. New fetch starts on returned case and resolves with Benign
    await loadAnnotationsBatch(42, [{ id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }])
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.acmg_classification).toBe('Benign')

    // 4. Now the delayed first fetch (Pathogenic) finally resolves
    resolveFirstBatch({
      '1:100:A:T': mockCacheEntry(1, { acmg_classification: 'Pathogenic' })
    })
    await initialLoad

    // 5. Older read must NOT overwrite Benign because evictionEpoch bumped keyVersion!
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.acmg_classification).toBe('Benign')
  })
})
