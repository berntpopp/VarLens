import {
  ref,
  computed,
  watch,
  toValue,
  inject,
  hasInjectionContext,
  type Ref,
  type MaybeRefOrGetter
} from 'vue'
import { getActivePinia } from 'pinia'
import { useApiService } from './useApiService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import type { BatchPerCaseAnnotationUpdates } from '../../../shared/types/api'
import { clearAnnotationCache } from './annotation-cache'
import { invalidateTags } from '../queries/tags'
import { logService } from '../services/LogService'
import { AppStateKey } from './useAppState'

export interface UseBulkTriageSelectionOptions<T> {
  items: Ref<readonly T[]> | (() => readonly T[])
  getItemId: (item: T) => number
  caseId: MaybeRefOrGetter<number | null | undefined>
  onTriageApplied?: () => void | Promise<void>
}

export function useBulkTriageSelection<T>(options: UseBulkTriageSelectionOptions<T>) {
  const { items, getItemId, caseId, onTriageApplied } = options
  const { api } = useApiService()
  const appState = hasInjectionContext() ? inject(AppStateKey, null) : null

  const selectedIds = ref<number[]>([])
  const lastClickedId = ref<number | null>(null)
  const isExecuting = ref(false)

  // Clear selection whenever caseId changes
  watch(
    () => toValue(caseId),
    () => {
      selectedIds.value = []
      lastClickedId.value = null
    }
  )

  const selectedIdSet = computed(() => new Set(selectedIds.value))
  const selectedCount = computed(() => selectedIds.value.length)
  const isSelected = (id: number): boolean => selectedIdSet.value.has(id)

  const currentItems = computed(() => toValue(items))

  const isAllSelected = computed(() => {
    const list = currentItems.value
    if (list.length === 0) return false
    return list.every((item) => selectedIdSet.value.has(getItemId(item)))
  })

  const isSomeSelected = computed(() => {
    return selectedCount.value > 0 && !isAllSelected.value
  })

  function toggleSelectAll(checked: boolean): void {
    if (checked) {
      const allIds = currentItems.value.map(getItemId)
      selectedIds.value = Array.from(new Set([...selectedIds.value, ...allIds]))
    } else {
      const currentIdsSet = new Set(currentItems.value.map(getItemId))
      selectedIds.value = selectedIds.value.filter((id) => !currentIdsSet.has(id))
    }
  }

  function handleRowCheckboxClick(id: number, event: MouseEvent): void {
    const list = currentItems.value
    const idList = list.map(getItemId)
    const currentIndex = idList.indexOf(id)

    if (event.shiftKey && lastClickedId.value !== null) {
      const prevIndex = idList.indexOf(lastClickedId.value)
      if (prevIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(prevIndex, currentIndex)
        const end = Math.max(prevIndex, currentIndex)
        const rangeIds = idList.slice(start, end + 1)
        const next = new Set(selectedIds.value)
        for (const rId of rangeIds) {
          next.add(rId)
        }
        selectedIds.value = Array.from(next)
        lastClickedId.value = id
        return
      }
    }

    // Normal click toggle
    toggleSelect(id)
  }

  function toggleSelect(id: number): void {
    const next = new Set(selectedIds.value)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    selectedIds.value = Array.from(next)
    lastClickedId.value = id
  }

  function clearSelection(): void {
    selectedIds.value = []
    lastClickedId.value = null
  }

  async function applyBulkTriage(updates: BatchPerCaseAnnotationUpdates): Promise<number> {
    const cid = toValue(caseId)
    if (cid === undefined || cid === null || selectedIds.value.length === 0 || !api) {
      return 0
    }
    isExecuting.value = true
    try {
      const res = unwrapIpcResult(
        await api.annotations.batchUpsertPerCase(cid, selectedIds.value, updates)
      )
      clearAnnotationCache()
      if (updates.tag_id !== undefined && getActivePinia()) {
        await invalidateTags(true)
      }
      clearSelection()
      await onTriageApplied?.()
      return res.updatedCount
    } catch (error) {
      const msg = isIpcError(error)
        ? (error.userMessage ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error)
      logService.error(`Bulk triage failed: ${msg}`, 'useBulkTriageSelection')
      appState?.showSnack(msg, 'error')
      return 0
    } finally {
      isExecuting.value = false
    }
  }

  return {
    selectedIds,
    selectedCount,
    isSelected,
    isAllSelected,
    isSomeSelected,
    isExecuting,
    toggleSelect,
    toggleSelectAll,
    handleRowCheckboxClick,
    clearSelection,
    applyBulkTriage
  }
}
