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
  getGeneration,
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

  let scopeGen = 0
  let activeApplyId = 0

  function extractCoords(item: T): VariantCoords | null {
    if (
      item !== null &&
      typeof item === 'object' &&
      'chr' in item &&
      'pos' in item &&
      'ref' in item &&
      'alt' in item
    ) {
      return {
        chr: String((item as unknown as VariantCoords).chr),
        pos: Number((item as unknown as VariantCoords).pos),
        ref: String((item as unknown as VariantCoords).ref),
        alt: String((item as unknown as VariantCoords).alt)
      }
    }
    return null
  }

  // Clear selection whenever caseId changes
  watch(
    () => toValue(caseId),
    () => {
      scopeGen += 1
      activeApplyId += 1
      isExecuting.value = false
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
    if (checked) {
      const allIds = list.map(getItemId)
      selectedIds.value = Array.from(new Set([...selectedIds.value, ...allIds]))
      for (const item of list) {
        const coords = extractCoords(item)
        if (coords) {
          coordsById.set(getItemId(item), coords)
        }
      }
    } else {
      const currentIdsSet = new Set(list.map(getItemId))
      selectedIds.value = selectedIds.value.filter((id) => !currentIdsSet.has(id))
      for (const id of currentIdsSet) {
        coordsById.delete(id)
      }
    }
  }

  function handleRowCheckboxClick(
    id: number,
    event?: { shiftKey?: boolean; target?: EventTarget | null }
  ): void {
    const list = currentItems.value
    const idList = list.map(getItemId)
    const currentIndex = idList.indexOf(id)

    if (event?.shiftKey === true && lastClickedId.value !== null) {
      const prevIndex = idList.indexOf(lastClickedId.value)
      if (prevIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(prevIndex, currentIndex)
        const end = Math.max(prevIndex, currentIndex)
        const rangeSlice = list.slice(start, end + 1)
        const next = new Set(selectedIds.value)
        for (const item of rangeSlice) {
          const rId = getItemId(item)
          next.add(rId)
          const coords = extractCoords(item)
          if (coords) {
            coordsById.set(rId, coords)
          }
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
    const next = new Set(selectedIds.value)
    if (next.has(id)) {
      next.delete(id)
      coordsById.delete(id)
    } else {
      next.add(id)
      const item = currentItems.value.find((it) => getItemId(it) === id)
      if (item !== undefined) {
        const coords = extractCoords(item)
        if (coords !== null) {
          coordsById.set(id, coords)
        }
      }
    }
    selectedIds.value = Array.from(next)
    lastClickedId.value = id
  }

  function clearSelection(): void {
    selectedIds.value = []
    lastClickedId.value = null
    coordsById.clear()
  }

  async function applyBulkTriage(updates: BatchPerCaseAnnotationUpdates): Promise<number> {
    const cid = toValue(caseId)
    if (cid === undefined || cid === null || selectedIds.value.length === 0 || !api) {
      return 0
    }
    const targetIds = [...selectedIds.value]
    const targetSet = new Set(targetIds)
    const myScopeGen = scopeGen
    const myCacheGen = getGeneration()
    const myApplyId = ++activeApplyId
    const isStale = (): boolean =>
      scopeGen !== myScopeGen || getGeneration() !== myCacheGen || toValue(caseId) !== cid

    isExecuting.value = true
    try {
      const affectedKeys = new Set<string>()

      // 1. From coordsById for all selected IDs (preserves coords seen on other pages)
      for (const id of targetSet) {
        const coords = coordsById.get(id)
        if (coords) {
          affectedKeys.add(variantKey(coords))
        }
      }

      // 2. From current items
      const itemList = toValue(items)
      for (const item of itemList) {
        if (item !== null && typeof item === 'object') {
          const itemId = getItemId(item)
          if (targetSet.has(itemId)) {
            const coords = extractCoords(item)
            if (coords) {
              coordsById.set(itemId, coords)
              affectedKeys.add(variantKey(coords))
            }
          }
        }
      }

      // 3. From annotationCache entries matching selected variant IDs
      for (const [key, entry] of annotationCache.value.entries()) {
        const vId = entry.perCase?.variant_id
        if (vId !== undefined && targetSet.has(vId)) {
          affectedKeys.add(key)
        }
      }

      // 4. From panelVariant (if selected)
      const initialPanel = appState?.selectedPanelVariant?.value
      const isInitialPanelSelected =
        initialPanel !== null &&
        typeof initialPanel === 'object' &&
        'id' in initialPanel &&
        typeof initialPanel.id === 'number' &&
        targetSet.has(initialPanel.id) &&
        'chr' in initialPanel &&
        'pos' in initialPanel &&
        'ref' in initialPanel &&
        'alt' in initialPanel

      if (isInitialPanelSelected) {
        affectedKeys.add(
          variantKey({
            chr: String(initialPanel.chr),
            pos: Number(initialPanel.pos),
            ref: String(initialPanel.ref),
            alt: String(initialPanel.alt)
          })
        )
      }

      const res = unwrapIpcResult(await api.annotations.batchUpsertPerCase(cid, targetIds, updates))
      if (isStale()) return res.updatedCount

      evictAnnotationCacheKeys(affectedKeys)

      if (updates.tag_id !== undefined && getActivePinia()) {
        await invalidateTags(true)
      }
      if (isStale()) return res.updatedCount

      clearSelection()
      await onTriageApplied?.()
      if (isStale()) return res.updatedCount

      // Ensure open panel variant from another page is refreshed in annotationCache
      const currentPanel = appState?.selectedPanelVariant?.value
      if (
        currentPanel !== null &&
        typeof currentPanel === 'object' &&
        'id' in currentPanel &&
        typeof currentPanel.id === 'number' &&
        'chr' in currentPanel &&
        'pos' in currentPanel &&
        'ref' in currentPanel &&
        'alt' in currentPanel
      ) {
        const panelCaseId =
          'case_id' in currentPanel ? (currentPanel as { case_id?: unknown }).case_id : undefined
        if (panelCaseId === undefined || panelCaseId === cid) {
          const pKey = variantKey({
            chr: String(currentPanel.chr),
            pos: Number(currentPanel.pos),
            ref: String(currentPanel.ref),
            alt: String(currentPanel.alt)
          })
          if (targetSet.has(currentPanel.id) || !annotationCache.value.has(pKey)) {
            await loadAnnotationsBatch(cid, [
              {
                id: currentPanel.id,
                chr: String(currentPanel.chr),
                pos: Number(currentPanel.pos),
                ref: String(currentPanel.ref),
                alt: String(currentPanel.alt)
              }
            ])
          }
        }
      }

      return res.updatedCount
    } catch (error) {
      if (isStale()) return 0
      const msg = isIpcError(error)
        ? (error.userMessage ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error)
      logService.error(`Bulk triage failed: ${msg}`, 'useBulkTriageSelection')
      appState?.showSnack(msg, 'error')
      return 0
    } finally {
      if (activeApplyId === myApplyId) {
        isExecuting.value = false
      }
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
