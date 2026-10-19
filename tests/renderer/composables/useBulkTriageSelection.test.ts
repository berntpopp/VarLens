import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useBulkTriageSelection } from '../../../src/renderer/src/composables/useBulkTriageSelection'
import { annotationCache } from '../../../src/renderer/src/composables/useAnnotations'

describe('useBulkTriageSelection', () => {
  const items = ref([
    { id: 101, chr: 'chr1', pos: 1000, ref: 'A', alt: 'T' },
    { id: 102, chr: 'chr1', pos: 2000, ref: 'C', alt: 'G' },
    { id: 103, chr: 'chr2', pos: 3000, ref: 'G', alt: 'A' },
    { id: 104, chr: 'chr3', pos: 4000, ref: 'T', alt: 'C' }
  ])
  const caseId = ref<number | null>(42)
  const onTriageApplied = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
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
})
