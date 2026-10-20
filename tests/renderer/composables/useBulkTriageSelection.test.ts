import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, defineComponent, effectScope } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  useBulkTriageSelection,
  MAX_BULK_TRIAGE_SELECTION,
  _resetCommittedWriteListenersForTesting
} from '../../../src/renderer/src/composables/useBulkTriageSelection'
import {
  annotationCache,
  useAnnotations
} from '../../../src/renderer/src/composables/useAnnotations'
import {
  clearAnnotationCache,
  evictAnnotationCacheKeys
} from '../../../src/renderer/src/composables/annotation-cache'
import { AppStateKey } from '../../../src/renderer/src/composables/useAppState'
import { invalidateTags } from '../../../src/renderer/src/queries/tags'

vi.mock('../../../src/renderer/src/queries/tags', () => ({
  invalidateTags: vi.fn().mockResolvedValue(undefined)
}))

describe('useBulkTriageSelection', () => {
  const mockCacheEntry = (id: number, extraPerCase: Record<string, unknown> = {}) => ({
    global: null,
    perCase: {
      id,
      case_id: 42,
      variant_id: id,
      is_starred: false,
      acmg_classification: null,
      created_at: 1000,
      updated_at: 1000,
      ...extraPerCase
    }
  })

  const defer = <T = unknown>() => {
    let resolve!: (val: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

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

  const mountWithBulk = (
    customOptions: Record<string, unknown> = {},
    provides: Record<string | symbol, unknown> = {}
  ) => {
    let bulkInstance!: ReturnType<typeof useBulkTriageSelection>
    const wrapper = mount(
      defineComponent({
        setup: () => ((bulkInstance = createBulk(customOptions)), () => null)
      }),
      { global: { plugins: [pinia], provide: provides } }
    )
    return { wrapper, bulkInstance }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    _resetCommittedWriteListenersForTesting()
    pinia = createPinia()
    setActivePinia(pinia)
    caseId.value = 42
    clearAnnotationCache()
    // @ts-expect-error Mock window.api
    window.api = {
      annotations: {
        batchUpsertPerCase: vi.fn().mockResolvedValue({ updatedCount: 2 }),
        batchGet: vi.fn().mockResolvedValue({ success: true, data: {} })
      }
    }
  })

  it('initializes and toggles selection', () => {
    const bulk = createBulk()
    expect(bulk.selectedIds.value.length).toBe(0)
    expect(bulk.selectedCount.value).toBe(0)
    expect(bulk.isAllSelected.value).toBe(false)
    expect(bulk.isSomeSelected.value).toBe(false)

    bulk.toggleSelect(101)
    expect(bulk.isSelected(101)).toBe(true)
    expect(bulk.selectedCount.value).toBe(1)
    expect(bulk.isSomeSelected.value).toBe(true)
    expect(bulk.isAllSelected.value).toBe(false)

    bulk.toggleSelect(101)
    expect(bulk.isSelected(101)).toBe(false)
    expect(bulk.selectedCount.value).toBe(0)

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
    bulk.handleRowCheckboxClick(101, new MouseEvent('click', { shiftKey: false }))
    expect(bulk.selectedCount.value).toBe(1)
    expect(bulk.isSelected(101)).toBe(true)

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
    await vi.waitFor(() => expect(bulk.selectedCount.value).toBe(0))
  })

  it('dispatches applyBulkTriage with batchUpsertPerCase', async () => {
    const bulk = createBulk()
    bulk.toggleSelect(101)
    bulk.toggleSelect(102)
    await bulk.applyBulkTriage({ starred: true })
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

    const { bulkInstance } = mountWithBulk(
      {},
      { [AppStateKey as symbol]: { showSnack: showSnackSpy } }
    )
    bulkInstance.toggleSelect(101)
    bulkInstance.toggleSelect(102)
    expect(bulkInstance.selectedCount.value).toBe(2)

    const updated = await bulkInstance.applyBulkTriage({ acmg_classification: 'Pathogenic' })
    expect(updated).toBe(0)
    expect(showSnackSpy).toHaveBeenCalledWith('Override reason required', 'error')
    expect(bulkInstance.selectedCount.value).toBe(2)
    expect(bulkInstance.isSelected(101)).toBe(true)
    expect(bulkInstance.isSelected(102)).toBe(true)
    expect(onTriageApplied).not.toHaveBeenCalled()
  })

  it('still reports a failed bulk write after the user switched case mid-flight', async () => {
    const showSnackSpy = vi.fn()
    const upsertDef = defer()
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(upsertDef.promise)
    const { bulkInstance } = mountWithBulk(
      {},
      { [AppStateKey as symbol]: { showSnack: showSnackSpy } }
    )
    bulkInstance.toggleSelect(101)
    const triagePromise = bulkInstance.applyBulkTriage({ acmg_classification: 'Likely benign' })

    caseId.value = 99
    await vi.waitFor(() => expect(bulkInstance.selectedCount.value).toBe(0))
    upsertDef.resolve({ code: 'DB_LOCKED', message: 'database is locked', userMessage: 'Locked' })

    expect(await triagePromise).toBe(0)
    expect(showSnackSpy).toHaveBeenCalledWith('Locked', 'error')
  })

  it('synchronizes native DOM checkbox .checked state on Shift+Click', () => {
    const bulk = createBulk()
    const cb1 = Object.assign(document.createElement('input'), { type: 'checkbox', checked: false })
    const cb3 = Object.assign(document.createElement('input'), { type: 'checkbox' })
    bulk.handleRowCheckboxClick(101, { shiftKey: false, target: cb1 })
    cb1.checked = true
    bulk.handleRowCheckboxClick(103, { shiftKey: false, target: cb3 })
    cb3.checked = true
    expect(bulk.selectedIds.value).toEqual([101, 103])
    cb1.checked = false
    bulk.handleRowCheckboxClick(101, { shiftKey: true, target: cb1 })
    expect(bulk.selectedIds.value).toEqual(expect.arrayContaining([101, 102, 103]))
    expect(cb1.checked).toBe(true)
  })

  it('evicts only selected variant cache entries on bulk triage and preserves unrelated entries', async () => {
    const testItems = ref([
      { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' },
      { id: 2, chr: '1', pos: 200, ref: 'G', alt: 'C' }
    ])
    annotationCache.value.set('1:100:A:T', mockCacheEntry(1))
    annotationCache.value.set('1:200:G:C', mockCacheEntry(2))

    const bulk = createBulk({ items: () => testItems.value })
    bulk.toggleSelect(2)
    expect(bulk.selectedIds.value).toEqual([2])

    await bulk.applyBulkTriage({ starred: true })
    expect(annotationCache.value.has('1:200:G:C')).toBe(false)
    expect(annotationCache.value.has('1:100:A:T')).toBe(true)
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.id).toBe(1)
  })

  it('refreshes open selectedPanelVariant from Page 1 into annotationCache during bulk triage on Page 2 while preserving unrelated cached variants', async () => {
    const page1Items = [{ id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }]
    const page2Items = [{ id: 2, chr: '1', pos: 200, ref: 'G', alt: 'C' }]
    const currentItemsRef = ref(page1Items)
    const panelVariantRef = ref({ id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' })

    annotationCache.value.set('1:100:A:T', mockCacheEntry(1, { starred: 0 }))
    annotationCache.value.set('1:999:C:G', mockCacheEntry(999, { starred: 0 }))

    const batchGetSpy = vi.fn().mockResolvedValue({
      '1:100:A:T': mockCacheEntry(1, { starred: 1, is_starred: true, updated_at: 2000 })
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const { bulkInstance } = mountWithBulk(
      { items: () => currentItemsRef.value },
      { [AppStateKey as symbol]: { selectedPanelVariant: panelVariantRef, showSnack: vi.fn() } }
    )

    bulkInstance.toggleSelect(1)
    expect(bulkInstance.selectedIds.value).toEqual([1])
    currentItemsRef.value = page2Items

    await bulkInstance.applyBulkTriage({ starred: true })
    expect(window.api.annotations.batchUpsertPerCase).toHaveBeenCalledWith(42, [1], {
      starred: true
    })
    expect(batchGetSpy).toHaveBeenCalledWith(
      42,
      expect.arrayContaining([
        expect.objectContaining({ chr: '1', pos: 100, ref: 'A', alt: 'T', variantId: 1 })
      ]),
      null
    )
    expect(annotationCache.value.has('1:100:A:T')).toBe(true)
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.starred).toBe(1)
    expect(annotationCache.value.has('1:999:C:G')).toBe(true)
    expect(annotationCache.value.get('1:999:C:G')?.perCase?.id).toBe(999)
    expect(batchGetSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ chr: '1', pos: 999 })]),
      expect.anything()
    )
  })

  it('discards post-await completion work if caseId changes mid-flight during applyBulkTriage', async () => {
    const upsertDef = defer()
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(upsertDef.promise)

    const bulk = createBulk()
    bulk.toggleSelect(101)
    bulk.toggleSelect(102)
    annotationCache.value.set('chr1:1000:A:T', mockCacheEntry(101))

    const triagePromise = bulk.applyBulkTriage({ starred: true })
    expect(bulk.isExecuting.value).toBe(true)

    caseId.value = 99
    await vi.waitFor(() => expect(bulk.selectedIds.value.length).toBe(0))

    bulk.toggleSelect(104)
    expect(bulk.selectedIds.value).toEqual([104])

    upsertDef.resolve({ updatedCount: 2 })
    const count = await triagePromise
    expect(count).toBe(2)
    expect(onTriageApplied).not.toHaveBeenCalled()
    expect(bulk.selectedIds.value).toEqual([104])
    expect(bulk.isExecuting.value).toBe(false)
  })

  it('prevents older in-flight batchGet from overwriting refreshed data after cache eviction', async () => {
    const firstBatchDef = defer()
    const batchGetSpy = vi
      .fn()
      .mockReturnValueOnce(firstBatchDef.promise)
      .mockResolvedValueOnce({
        '1:100:A:T': mockCacheEntry(1, { acmg_classification: 'Benign' })
      })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const { loadAnnotationsBatch } = useAnnotations()
    const initialLoad = loadAnnotationsBatch(42, [
      { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }
    ])

    evictAnnotationCacheKeys(['1:100:A:T'])
    await loadAnnotationsBatch(42, [{ id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }])
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.acmg_classification).toBe('Benign')

    firstBatchDef.resolve({
      '1:100:A:T': mockCacheEntry(1, { acmg_classification: 'Pathogenic' })
    })
    await initialLoad
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.acmg_classification).toBe('Benign')
  })

  it('bounds coordsById strictly to selected rows across pages and clears on deselect', async () => {
    const page1 = ref([
      { id: 101, chr: '1', pos: 100, ref: 'A', alt: 'T' },
      { id: 102, chr: '1', pos: 200, ref: 'C', alt: 'G' }
    ])
    const bulk = createBulk({ items: () => page1.value })
    expect(bulk.selectedIds.value).toEqual([])

    bulk.toggleSelect(101)
    expect(bulk.isSelected(101)).toBe(true)
    bulk.toggleSelect(101)
    expect(bulk.isSelected(101)).toBe(false)

    bulk.toggleSelect(102)
    page1.value = [
      { id: 103, chr: '2', pos: 300, ref: 'G', alt: 'A' },
      { id: 104, chr: '3', pos: 400, ref: 'T', alt: 'C' }
    ]

    await bulk.applyBulkTriage({ starred: true })
    expect(window.api.annotations.batchUpsertPerCase).toHaveBeenCalledWith(42, [102], {
      starred: true
    })
    expect(bulk.selectedCount.value).toBe(0)
  })

  it('does not wipe unselected cached variants when applyBulkTriage runs after beginAnnotationRequest with known build', async () => {
    const { beginAnnotationRequest } =
      await import('../../../src/renderer/src/composables/annotation-cache')
    beginAnnotationRequest(42, 'GRCh38')
    annotationCache.value.set('1:200:G:C', mockCacheEntry(2))

    const bulk = createBulk({
      items: () => [
        { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' },
        { id: 2, chr: '1', pos: 200, ref: 'G', alt: 'C' }
      ]
    })
    bulk.toggleSelect(1)
    await bulk.applyBulkTriage({ starred: true })

    expect(annotationCache.value.has('1:200:G:C')).toBe(true)
    expect(annotationCache.value.get('1:200:G:C')?.perCase?.id).toBe(2)
  })

  it('invalidates and refreshes affected visible cache entries while preserving new selection on A -> B -> A round-trip', async () => {
    const upsertDef = defer()
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(upsertDef.promise)

    const bulk = createBulk()
    annotationCache.value.set(
      'chr1:1000:A:T',
      mockCacheEntry(101, { acmg_classification: 'Benign' })
    )
    bulk.toggleSelect(101)
    expect(bulk.selectedIds.value).toEqual([101])

    const triagePromise = bulk.applyBulkTriage({ acmg_classification: 'Pathogenic' })
    expect(bulk.isExecuting.value).toBe(true)

    caseId.value = 99
    await vi.waitFor(() => expect(bulk.selectedIds.value.length).toBe(0))

    caseId.value = 42
    await vi.waitFor(() => expect(bulk.selectedIds.value.length).toBe(0))

    annotationCache.value.set(
      'chr1:1000:A:T',
      mockCacheEntry(101, { acmg_classification: 'Benign' })
    )
    bulk.toggleSelect(103)
    expect(bulk.selectedIds.value).toEqual([103])

    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = vi.fn().mockResolvedValue({
      'chr1:1000:A:T': mockCacheEntry(101, { acmg_classification: 'Pathogenic' })
    })

    upsertDef.resolve({ updatedCount: 1 })
    const count = await triagePromise

    expect(count).toBe(1)
    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.acmg_classification).toBe(
      'Pathogenic'
    )
    expect(onTriageApplied).toHaveBeenCalledTimes(1)
    expect(bulk.selectedIds.value).toEqual([103])
    expect(bulk.isExecuting.value).toBe(false)
  })

  it('does not clear newly modified selection when in-flight bulk triage resolves and refreshes panel and table', async () => {
    const upsertDef = defer()
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(upsertDef.promise)

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

    const { bulkInstance } = mountWithBulk(
      {},
      {
        [AppStateKey as symbol]: {
          selectedPanelVariant: panelVariantRef,
          showSnack: vi.fn()
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

    upsertDef.resolve({ updatedCount: 1 })
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
    const upsertDef = defer()
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(upsertDef.promise)
    const batchGetSpy = vi.fn().mockResolvedValue({})
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const { beginAnnotationRequest } =
      await import('../../../src/renderer/src/composables/annotation-cache')

    const { wrapper, bulkInstance } = mountWithBulk()

    // Select row 101 on Case 42
    bulkInstance.toggleSelect(101)
    const triagePromise = bulkInstance.applyBulkTriage({ starred: true })

    // Component unmounts (e.g. user navigates away)
    wrapper.unmount()

    // Case 2 establishes its cache
    beginAnnotationRequest(2, 'GRCh38')
    annotationCache.value.set('chr2:5000:C:T', mockCacheEntry(501, { case_id: 2 }))

    // Resolve old write for Case 42
    upsertDef.resolve({ updatedCount: 1 })
    const count = await triagePromise

    expect(count).toBe(1)
    // Case 2 cache was NOT cleared or touched
    expect(annotationCache.value.has('chr2:5000:C:T')).toBe(true)
    // No batchGet was triggered for Case 1
    expect(batchGetSpy).not.toHaveBeenCalled()
    expect(onTriageApplied).not.toHaveBeenCalled()
  })

  it('does not trigger batchGet for Case 1 or touch Case 2 cache if disposed during invalidateTags await', async () => {
    const invalidateDef = defer<void>()
    vi.mocked(invalidateTags).mockReturnValueOnce(invalidateDef.promise)

    const batchGetSpy = vi.fn().mockResolvedValue({})
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const { beginAnnotationRequest } =
      await import('../../../src/renderer/src/composables/annotation-cache')

    const { wrapper, bulkInstance } = mountWithBulk()

    bulkInstance.toggleSelect(101)
    const triagePromise = bulkInstance.applyBulkTriage({ tag_id: 5 })

    await vi.waitFor(() => {
      expect(invalidateTags).toHaveBeenCalled()
    })

    wrapper.unmount()
    beginAnnotationRequest(2, 'GRCh38')
    annotationCache.value.set('chr2:5000:C:T', mockCacheEntry(501, { case_id: 2 }))

    invalidateDef.resolve()
    const count = await triagePromise

    expect(count).toBe(2)
    expect(batchGetSpy).not.toHaveBeenCalled()
    expect(annotationCache.value.has('chr2:5000:C:T')).toBe(true)
    expect(onTriageApplied).not.toHaveBeenCalled()
  })

  it('hands off to committedWriteListeners and preserves cached annotations on tag-only bulk update when unmounted during invalidateTags await', async () => {
    const invalidateDef = defer<void>()
    vi.mocked(invalidateTags).mockReturnValueOnce(invalidateDef.promise)

    const batchGetSpy = vi.fn()
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const peerOnTriageApplied = vi.fn()
    const peerScope = effectScope()
    peerScope.run(() => {
      createBulk({ onTriageApplied: peerOnTriageApplied })
    })

    const { wrapper, bulkInstance } = mountWithBulk()
    annotationCache.value.set('chr1:1000:A:T', mockCacheEntry(101, { starred: 1 }))

    bulkInstance.toggleSelect(101)
    const triagePromise = bulkInstance.applyBulkTriage({ tag_id: 5 })

    await vi.waitFor(() => {
      expect(invalidateTags).toHaveBeenCalled()
    })

    wrapper.unmount()
    invalidateDef.resolve()
    const count = await triagePromise

    expect(count).toBe(2)
    expect(peerOnTriageApplied).toHaveBeenCalledTimes(1)
    expect(invalidateTags).toHaveBeenCalledWith(true)
    expect(batchGetSpy).not.toHaveBeenCalled()
    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.starred).toBe(1)
    peerScope.stop()
  })

  it('evicts stale cache on round-trip A -> B -> A and reloads fresh annotations even if no peer instance is mounted', async () => {
    const upsertDef = defer()
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(upsertDef.promise)

    let bulk1!: ReturnType<typeof useBulkTriageSelection>
    const scope1 = effectScope()
    scope1.run(() => {
      bulk1 = createBulk()
    })

    bulk1.toggleSelect(101)
    const triagePromise = bulk1.applyBulkTriage({ acmg_classification: 'Pathogenic' })

    // User navigates A -> B: unmount old shortlist
    scope1.stop()

    // User navigates B -> A: returned view caches old Benign data before write finishes (no peer instance mounted yet)
    const { beginAnnotationRequest } =
      await import('../../../src/renderer/src/composables/annotation-cache')
    beginAnnotationRequest(42, 'GRCh38')
    annotationCache.value.set(
      'chr1:1000:A:T',
      mockCacheEntry(101, { acmg_classification: 'Benign' })
    )

    const batchGetSpy = vi.fn().mockResolvedValue({
      'chr1:1000:A:T': mockCacheEntry(101, { acmg_classification: 'Pathogenic' })
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    upsertDef.resolve({ updatedCount: 1 })
    const count = await triagePromise

    expect(count).toBe(1)
    expect(batchGetSpy).toHaveBeenCalled()
    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.acmg_classification).toBe(
      'Pathogenic'
    )
  })

  it('reloads fresh annotations via disposed writer recovery on A -> B -> A when annotation read was in-flight at commit time', async () => {
    const upsertDef = defer()
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(upsertDef.promise)

    let bulk1!: ReturnType<typeof useBulkTriageSelection>
    const scope1 = effectScope()
    scope1.run(() => {
      bulk1 = createBulk()
    })

    bulk1.toggleSelect(101)
    const triagePromise = bulk1.applyBulkTriage({ acmg_classification: 'Pathogenic' })

    scope1.stop()

    const { beginAnnotationRequest, setLoading } =
      await import('../../../src/renderer/src/composables/annotation-cache')
    beginAnnotationRequest(42, 'GRCh38')
    setLoading('chr1:1000:A:T', true)

    const batchGetSpy = vi.fn().mockResolvedValue({
      'chr1:1000:A:T': mockCacheEntry(101, { acmg_classification: 'Pathogenic' })
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    upsertDef.resolve({ updatedCount: 1 })
    const count = await triagePromise

    expect(count).toBe(1)
    expect(batchGetSpy).toHaveBeenCalled()
    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.acmg_classification).toBe(
      'Pathogenic'
    )
  })

  it('enforces MAX_BULK_TRIAGE_SELECTION cap of 1,000 with warning snack', () => {
    const showSnackSpy = vi.fn()
    const CAP_MSG = 'Maximum bulk selection of 1,000 variants reached.'
    const largeItems = Array.from({ length: 1005 }, (_, i) => ({
      id: i + 1,
      chr: 'chr1',
      pos: 1000 + i,
      ref: 'A',
      alt: 'T'
    }))

    const { bulkInstance } = mountWithBulk(
      { items: () => largeItems },
      { [AppStateKey as symbol]: { showSnack: showSnackSpy } }
    )

    bulkInstance.toggleSelectAll(true)
    expect(bulkInstance.selectedCount.value).toBe(MAX_BULK_TRIAGE_SELECTION)
    expect(showSnackSpy).toHaveBeenCalledWith(CAP_MSG, 'warning')

    showSnackSpy.mockClear()
    bulkInstance.toggleSelect(1005)
    expect(bulkInstance.selectedCount.value).toBe(MAX_BULK_TRIAGE_SELECTION)
    expect(bulkInstance.isSelected(1005)).toBe(false)
    expect(showSnackSpy).toHaveBeenCalledWith(CAP_MSG, 'warning')

    bulkInstance.clearSelection()
    for (let i = 1; i <= 995; i++) bulkInstance.toggleSelect(i)
    showSnackSpy.mockClear()
    bulkInstance.handleRowCheckboxClick(1005, new MouseEvent('click', { shiftKey: true }))
    expect(bulkInstance.selectedCount.value).toBe(1000)
    expect(showSnackSpy).toHaveBeenCalledWith(CAP_MSG, 'warning')
  })

  it('drops older in-flight batchGet read even after clearAnnotationCache runs before it resolves', async () => {
    let resolveFirstBatch!: (val: unknown) => void
    const firstBatchPromise = new Promise((resolve) => {
      resolveFirstBatch = resolve
    })

    const batchGetSpy = vi
      .fn()
      .mockReturnValueOnce(firstBatchPromise)
      .mockResolvedValueOnce({ '1:100:A:T': mockCacheEntry(1, { acmg_classification: 'Benign' }) })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const { loadAnnotationsBatch } = useAnnotations()
    const initialLoad = loadAnnotationsBatch(42, [
      { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }
    ])

    clearAnnotationCache()
    await loadAnnotationsBatch(42, [{ id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' }])
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.acmg_classification).toBe('Benign')

    resolveFirstBatch({
      '1:100:A:T': mockCacheEntry(1, { acmg_classification: 'Pathogenic' })
    })
    await initialLoad
    expect(annotationCache.value.get('1:100:A:T')?.perCase?.acmg_classification).toBe('Benign')
  })

  it('retains post-write refreshed annotations across page changes via markAwaited', async () => {
    const batchGetDef = defer()
    const batchGetSpy = vi.fn().mockReturnValue(batchGetDef.promise)
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    const { invalidateAnnotationGeneration } =
      await import('../../../src/renderer/src/composables/annotation-cache')

    const bulk = createBulk()
    bulk.toggleSelect(101)

    const triagePromise = bulk.applyBulkTriage({ starred: true })

    await vi.waitFor(() => {
      expect(batchGetSpy).toHaveBeenCalled()
    })

    invalidateAnnotationGeneration('case')

    batchGetDef.resolve({
      'chr1:1000:A:T': mockCacheEntry(101, { starred: 1 })
    })

    await triagePromise

    expect(annotationCache.value.has('chr1:1000:A:T')).toBe(true)
    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.starred).toBe(1)
  })

  it('preserves single-row ACMG in flight when bulk star completes and reloads before ACMG resolves', async () => {
    const bulkDef = defer()
    const batchGetDef = defer()
    const acmgDef = defer()
    // @ts-expect-error Mock window.api
    window.api.annotations.batchUpsertPerCase = vi.fn().mockReturnValue(bulkDef.promise)
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = vi.fn().mockReturnValue(batchGetDef.promise)
    // @ts-expect-error Mock window.api
    window.api.annotations.upsertPerCase = vi.fn().mockReturnValue(acmgDef.promise)

    annotationCache.value.set(
      'chr1:1000:A:T',
      mockCacheEntry(101, { starred: 0, acmg_classification: 'Benign' })
    )

    const bulk = createBulk()
    bulk.toggleSelect(101)
    const bulkPromise = bulk.applyBulkTriage({ starred: true })

    const { setAcmgClassification } = useAnnotations()
    const acmgPromise = setAcmgClassification(42, 101, 'chr1', 1000, 'A', 'T', 'Pathogenic')

    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.acmg_classification).toBe(
      'Pathogenic'
    )

    bulkDef.resolve({ updatedCount: 1 })
    await vi.waitFor(() => {
      expect(window.api.annotations.batchGet).toHaveBeenCalled()
    })

    batchGetDef.resolve({
      'chr1:1000:A:T': mockCacheEntry(101, { starred: 1, acmg_classification: 'Benign' })
    })
    await bulkPromise

    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.starred).toBe(1)
    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.acmg_classification).toBe(
      'Pathogenic'
    )

    acmgDef.resolve(
      mockCacheEntry(101, {
        starred: 1,
        acmg_classification: 'Pathogenic',
        acmg_evidence: null,
        per_case_comment: null
      }).perCase
    )
    await acmgPromise

    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.starred).toBe(1)
    expect(annotationCache.value.get('chr1:1000:A:T')?.perCase?.acmg_classification).toBe(
      'Pathogenic'
    )
  })
})
