/* eslint-disable vue/one-component-per-file -- inline test components */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useBulkTriageSelection } from '../../../src/renderer/src/composables/useBulkTriageSelection'
import { annotationCache } from '../../../src/renderer/src/composables/useAnnotations'
import { AppStateKey } from '../../../src/renderer/src/composables/useAppState'

describe('useBulkTriageSelection', () => {
  const items = ref([
    { id: 101, chr: 'chr1', pos: 1000, ref: 'A', alt: 'T' },
    { id: 102, chr: 'chr1', pos: 2000, ref: 'C', alt: 'G' },
    { id: 103, chr: 'chr2', pos: 3000, ref: 'G', alt: 'A' },
    { id: 104, chr: 'chr3', pos: 4000, ref: 'T', alt: 'C' }
  ])
  const caseId = ref<number | null>(42)
  const onTriageApplied = vi.fn()
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    vi.clearAllMocks()
    pinia = createPinia()
    setActivePinia(pinia)
    caseId.value = 42
    annotationCache.value.clear()
    // @ts-expect-error Mock window.api
    window.api = {
      annotations: {
        batchUpsertPerCase: vi.fn().mockResolvedValue({
          success: true,
          data: { updatedCount: 2 }
        }),
        batchGet: vi.fn().mockResolvedValue({
          success: true,
          data: {}
        })
      }
    }
  })

  it('initializes with empty selection', () => {
    const bulk = useBulkTriageSelection({
      items: () => items.value,
      getItemId: (v) => v.id,
      caseId,
      onTriageApplied
    })

    expect(bulk.selectedIds.value.length).toBe(0)
    expect(bulk.selectedCount.value).toBe(0)
    expect(bulk.isAllSelected.value).toBe(false)
    expect(bulk.isSomeSelected.value).toBe(false)
  })

  it('selects and deselects single items', () => {
    const bulk = useBulkTriageSelection({
      items: () => items.value,
      getItemId: (v) => v.id,
      caseId,
      onTriageApplied
    })

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
    const bulk = useBulkTriageSelection({
      items: () => items.value,
      getItemId: (v) => v.id,
      caseId,
      onTriageApplied
    })

    bulk.toggleSelectAll(true)
    expect(bulk.selectedCount.value).toBe(4)
    expect(bulk.isAllSelected.value).toBe(true)
    expect(bulk.isSomeSelected.value).toBe(false)

    bulk.toggleSelectAll(false)
    expect(bulk.selectedCount.value).toBe(0)
    expect(bulk.isAllSelected.value).toBe(false)
  })

  it('supports Shift+Click range selection', () => {
    const bulk = useBulkTriageSelection({
      items: () => items.value,
      getItemId: (v) => v.id,
      caseId,
      onTriageApplied
    })

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
    const bulk = useBulkTriageSelection({
      items: () => items.value,
      getItemId: (v) => v.id,
      caseId,
      onTriageApplied
    })

    bulk.toggleSelect(101)
    expect(bulk.selectedCount.value).toBe(1)

    caseId.value = 99
    await vi.waitFor(() => {
      expect(bulk.selectedCount.value).toBe(0)
    })
  })

  it('dispatches applyBulkTriage with batchUpsertPerCase', async () => {
    const bulk = useBulkTriageSelection({
      items: () => items.value,
      getItemId: (v) => v.id,
      caseId,
      onTriageApplied
    })

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
        bulkInstance = useBulkTriageSelection({
          items: () => items.value,
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
    const bulk = useBulkTriageSelection({
      items: () => items.value,
      getItemId: (v) => v.id,
      caseId,
      onTriageApplied
    })

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

    annotationCache.value.set('1:100:A:T', {
      global: null,
      perCase: {
        id: 1,
        case_id: 42,
        variant_id: 1,
        is_starred: false,
        acmg_classification: null,
        acmg_evidence: null,
        acmg_override_reason: null,
        notes: null,
        created_at: 1000,
        updated_at: 1000
      }
    })
    annotationCache.value.set('1:200:G:C', {
      global: null,
      perCase: {
        id: 2,
        case_id: 42,
        variant_id: 2,
        is_starred: false,
        acmg_classification: null,
        acmg_evidence: null,
        acmg_override_reason: null,
        notes: null,
        created_at: 1000,
        updated_at: 1000
      }
    })

    const bulk = useBulkTriageSelection({
      items: () => testItems.value,
      getItemId: (v) => v.id,
      caseId,
      onTriageApplied
    })

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

    annotationCache.value.set('1:100:A:T', {
      global: null,
      perCase: {
        id: 1,
        case_id: 42,
        variant_id: 1,
        starred: 0,
        is_starred: false,
        acmg_classification: null,
        acmg_evidence: null,
        acmg_override_reason: null,
        notes: null,
        created_at: 1000,
        updated_at: 1000
      }
    })
    annotationCache.value.set('1:999:C:G', {
      global: null,
      perCase: {
        id: 999,
        case_id: 42,
        variant_id: 999,
        starred: 0,
        is_starred: false,
        acmg_classification: null,
        acmg_evidence: null,
        acmg_override_reason: null,
        notes: null,
        created_at: 1000,
        updated_at: 1000
      }
    })

    const batchGetSpy = vi.fn().mockResolvedValue({
      '1:100:A:T': {
        global: null,
        perCase: {
          id: 1,
          case_id: 42,
          variant_id: 1,
          starred: 1,
          is_starred: true,
          acmg_classification: null,
          acmg_evidence: null,
          acmg_override_reason: null,
          notes: null,
          created_at: 1000,
          updated_at: 2000
        }
      }
    })
    // @ts-expect-error Mock window.api
    window.api.annotations.batchGet = batchGetSpy

    let bulkInstance!: ReturnType<typeof useBulkTriageSelection>
    const TestComponent = defineComponent({
      setup() {
        bulkInstance = useBulkTriageSelection({
          items: () => currentItemsRef.value,
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
            selectedPanelVariant: panelVariantRef,
            showSnack: vi.fn()
          }
        }
      }
    })

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
})
