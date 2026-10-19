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
})
