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
import { useAnnotations } from './useAnnotations'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import type { BatchPerCaseAnnotationUpdates } from '../../../shared/types/api'
import {
  annotationCache,
  evictAnnotationCacheKeys,
  variantKey,
  type VariantCoords
} from './annotation-cache'
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
  const { loadAnnotationsBatch } = useAnnotations()
  const appState = hasInjectionContext() ? inject(AppStateKey, null) : null

  const selectedIds = ref<number[]>([])
  const lastClickedId = ref<number | null>(null)
  const isExecuting = ref(false)
  const coordsById = new Map<number, VariantCoords>()

  function rememberCoords(itemList: readonly T[]): void {
    for (const item of itemList) {
      if (
        item !== null &&
        typeof item === 'object' &&
        'chr' in item &&
        'pos' in item &&
        'ref' in item &&
        'alt' in item
      ) {
        coordsById.set(getItemId(item), {
          chr: String((item as unknown as VariantCoords).chr),
          pos: Number((item as unknown as VariantCoords).pos),
          ref: String((item as unknown as VariantCoords).ref),
          alt: String((item as unknown as VariantCoords).alt)
        })
      }
    }
  }

  watch(
    () => toValue(items),
    (list) => {
      rememberCoords(list)
    },
    { immediate: true }
  )

  // Clear selection whenever caseId changes
  watch(
    () => toValue(caseId),
    () => {
      selectedIds.value = []
      lastClickedId.value = null
      coordsById.clear()
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
    const list = currentItems.value
    rememberCoords(list)
    if (checked) {
      const allIds = list.map(getItemId)
      selectedIds.value = Array.from(new Set([...selectedIds.value, ...allIds]))
    } else {
      const currentIdsSet = new Set(list.map(getItemId))
      selectedIds.value = selectedIds.value.filter((id) => !currentIdsSet.has(id))
    }
  }

  function handleRowCheckboxClick(
    id: number,
    event?: { shiftKey?: boolean; target?: EventTarget | null }
  ): void {
    const list = currentItems.value
    rememberCoords(list)
    const idList = list.map(getItemId)
    const currentIndex = idList.indexOf(id)

    if (event?.shiftKey === true && lastClickedId.value !== null) {
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
      } else {
        toggleSelect(id)
      }
    } else {
      toggleSelect(id)
    }

    lastClickedId.value = id
    const target = event?.target
    if (target && typeof (target as HTMLInputElement).checked === 'boolean') {
      ;(target as HTMLInputElement).checked = selectedIdSet.value.has(id)
    }
  }

  function toggleSelect(id: number): void {
    rememberCoords(currentItems.value)
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
      const selectedSet = selectedIdSet.value
      const affectedKeys = new Set<string>()

      // 1. From coordsById for all selected IDs (preserves coords seen on other pages)
      for (const id of selectedSet) {
        const coords = coordsById.get(id)
        if (coords) {
          affectedKeys.add(variantKey(coords))
        }
      }

      // 2. From current items
      const itemList = toValue(items)
      rememberCoords(itemList)
      for (const item of itemList) {
        if (
          item !== null &&
          typeof item === 'object' &&
          selectedSet.has(getItemId(item)) &&
          'chr' in item &&
          'pos' in item &&
          'ref' in item &&
          'alt' in item
        ) {
          affectedKeys.add(variantKey(item as unknown as VariantCoords))
        }
      }

      // 3. From annotationCache entries matching selected variant IDs
      for (const [key, entry] of annotationCache.value.entries()) {
        const vId = entry.perCase?.variant_id
        if (vId !== undefined && selectedSet.has(vId)) {
          affectedKeys.add(key)
        }
      }

      // 4. From panelVariant (if selected)
      const panelVariant = appState?.selectedPanelVariant?.value
      const isPanelVariantSelected =
        panelVariant !== null &&
        typeof panelVariant === 'object' &&
        'id' in panelVariant &&
        typeof panelVariant.id === 'number' &&
        selectedSet.has(panelVariant.id) &&
        'chr' in panelVariant &&
        'pos' in panelVariant &&
        'ref' in panelVariant &&
        'alt' in panelVariant

      if (isPanelVariantSelected) {
        affectedKeys.add(variantKey(panelVariant as unknown as VariantCoords))
      }

      const res = unwrapIpcResult(
        await api.annotations.batchUpsertPerCase(cid, selectedIds.value, updates)
      )

      evictAnnotationCacheKeys(affectedKeys)

      if (updates.tag_id !== undefined && getActivePinia()) {
        await invalidateTags(true)
      }
      clearSelection()
      await onTriageApplied?.()

      // Ensure open panel variant from another page is refreshed in annotationCache
      if (
        panelVariant !== null &&
        typeof panelVariant === 'object' &&
        'id' in panelVariant &&
        typeof panelVariant.id === 'number' &&
        'chr' in panelVariant &&
        'pos' in panelVariant &&
        'ref' in panelVariant &&
        'alt' in panelVariant
      ) {
        const pKey = variantKey(panelVariant as unknown as VariantCoords)
        if (isPanelVariantSelected || !annotationCache.value.has(pKey)) {
          await loadAnnotationsBatch(cid, [
            {
              id: panelVariant.id,
              chr: String(panelVariant.chr),
              pos: Number(panelVariant.pos),
              ref: String(panelVariant.ref),
              alt: String(panelVariant.alt)
            }
          ])
        }
      }

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
