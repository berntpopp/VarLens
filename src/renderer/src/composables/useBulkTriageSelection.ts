import {
  ref,
  computed,
  watch,
  toValue,
  inject,
  hasInjectionContext,
  getCurrentScope,
  onScopeDispose,
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
  beginAnnotationRequest,
  evictAnnotationCacheKeys,
  getCachedBuild,
  getCachedCaseId,
  getCurrentDbPath,
  getGeneration,
  hasDbSwitchedSince,
  variantKey,
  type VariantCoords
} from './annotation-cache'
import { invalidateTags } from '../queries/tags'
import { logService } from '../services/LogService'
import { AppStateKey } from './useAppState'

export const MAX_BULK_TRIAGE_SELECTION = 1000

export interface UseBulkTriageSelectionOptions<T> {
  items: Ref<readonly T[]> | (() => readonly T[])
  getItemId: (item: T) => number
  caseId: MaybeRefOrGetter<number | null | undefined>
  genomeBuild?: MaybeRefOrGetter<string | null>
  onTriageApplied?: () => void | Promise<void>
}

export function useBulkTriageSelection<T>(options: UseBulkTriageSelectionOptions<T>) {
  const { items, getItemId, caseId, onTriageApplied } = options
  const { api } = useApiService()
  const { loadAnnotationsBatch } = useAnnotations({
    genomeBuild: () => toValue(options.genomeBuild) ?? getCachedBuild()
  })
  const appState = hasInjectionContext() ? inject(AppStateKey, null) : null

  const selectedIds = ref<number[]>([])
  const lastClickedId = ref<number | null>(null)
  const isExecuting = ref(false)
  const coordsById = new Map<number, VariantCoords>()

  let isDisposed = false
  if (getCurrentScope()) {
    onScopeDispose(() => {
      isDisposed = true
      scopeGen += 1
      selectionRev += 1
      activeApplyId += 1
    })
  }

  let scopeGen = 0
  let selectionRev = 0
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
    (newCid) => {
      scopeGen += 1
      selectionRev += 1
      activeApplyId += 1
      isExecuting.value = false
      selectedIds.value = []
      lastClickedId.value = null
      coordsById.clear()
      if (newCid != null && getCachedCaseId() !== null && getCachedCaseId() !== newCid) {
        beginAnnotationRequest(newCid, toValue(options.genomeBuild) ?? getCachedBuild())
      }
    }
  )

  function isStillActiveCase(cid: number, myDbPath: string | null): boolean {
    if (isDisposed || hasDbSwitchedSince(myDbPath) || toValue(caseId) !== cid) return false
    const appCaseId = appState?.selectedCaseId?.value
    if (appCaseId !== undefined && appCaseId !== null && appCaseId !== cid) return false
    const cachedCid = getCachedCaseId()
    if (cachedCid !== null && cachedCid !== cid) return false
    return true
  }

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
      const currentSet = new Set(selectedIds.value)
      let reachedCap = false
      const toAdd: T[] = []
      for (const item of list) {
        const id = getItemId(item)
        if (!currentSet.has(id)) {
          if (currentSet.size + toAdd.length >= MAX_BULK_TRIAGE_SELECTION) {
            reachedCap = true
            break
          }
          toAdd.push(item)
        }
      }
      if (reachedCap) {
        appState?.showSnack('Maximum bulk selection of 1,000 variants reached.', 'warning')
      }
      if (toAdd.length > 0) {
        selectionRev += 1
        for (const item of toAdd) {
          const id = getItemId(item)
          currentSet.add(id)
          const coords = extractCoords(item)
          if (coords !== null) {
            coordsById.set(id, coords)
          }
        }
        selectedIds.value = Array.from(currentSet)
      }
    } else {
      const currentIdsSet = new Set(list.map(getItemId))
      const nextIds = selectedIds.value.filter((id) => !currentIdsSet.has(id))
      if (nextIds.length !== selectedIds.value.length) {
        selectionRev += 1
        selectedIds.value = nextIds
        for (const id of currentIdsSet) {
          coordsById.delete(id)
        }
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
        const currentSet = new Set(selectedIds.value)
        let reachedCap = false
        const toAdd: T[] = []
        for (const item of rangeSlice) {
          const rId = getItemId(item)
          if (!currentSet.has(rId)) {
            if (currentSet.size + toAdd.length >= MAX_BULK_TRIAGE_SELECTION) {
              reachedCap = true
              break
            }
            toAdd.push(item)
          }
        }
        if (reachedCap) {
          appState?.showSnack('Maximum bulk selection of 1,000 variants reached.', 'warning')
        }
        if (toAdd.length > 0) {
          selectionRev += 1
          for (const item of toAdd) {
            const rId = getItemId(item)
            currentSet.add(rId)
            const coords = extractCoords(item)
            if (coords !== null) {
              coordsById.set(rId, coords)
            }
          }
          selectedIds.value = Array.from(currentSet)
        }
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
      selectionRev += 1
      next.delete(id)
      coordsById.delete(id)
      selectedIds.value = Array.from(next)
      lastClickedId.value = id
    } else {
      if (next.size >= MAX_BULK_TRIAGE_SELECTION) {
        appState?.showSnack('Maximum bulk selection of 1,000 variants reached.', 'warning')
        return
      }
      selectionRev += 1
      next.add(id)
      const item = currentItems.value.find((it) => getItemId(it) === id)
      if (item !== undefined) {
        const coords = extractCoords(item)
        if (coords !== null) {
          coordsById.set(id, coords)
        }
      }
      selectedIds.value = Array.from(next)
      lastClickedId.value = id
    }
  }

  function clearSelection(): void {
    if (selectedIds.value.length > 0) {
      selectionRev += 1
    }
    selectedIds.value = []
    lastClickedId.value = null
    coordsById.clear()
  }

  async function applyBulkTriage(updates: BatchPerCaseAnnotationUpdates): Promise<number> {
    const cid = toValue(caseId)
    if (cid === undefined || cid === null || selectedIds.value.length === 0 || !api) {
      return 0
    }
    const myDbPath = getCurrentDbPath()
    const targetIds = [...selectedIds.value]
    const targetSet = new Set(targetIds)
    const myScopeGen = scopeGen
    const mySelectionRev = selectionRev
    const myCacheGen = getGeneration()
    const myApplyId = ++activeApplyId

    isExecuting.value = true
    try {
      const affectedKeys = new Set<string>()

      // 1. From coordsById for all selected IDs (preserves coords seen on other pages)
      for (const id of targetSet) {
        const coords = coordsById.get(id)
        if (coords !== undefined) {
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
            if (coords !== null) {
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

      // If active case or database changed away from cid, write has committed in storage
      // but we do not touch the active different case's selection or cache.
      if (!isStillActiveCase(cid, myDbPath)) {
        return res.updatedCount
      }

      // cid is currently active (even if scopeGen !== myScopeGen after an A -> B -> A round-trip!)
      evictAnnotationCacheKeys(affectedKeys)

      if (updates.tag_id !== undefined && getActivePinia()) {
        await invalidateTags(true)
      }

      // Reload annotations for affected visible rows and open panel variant so active case never serves stale cached data
      const toReloadMap = new Map<
        number,
        { id: number; chr: string; pos: number; ref: string; alt: string }
      >()
      for (const item of currentItems.value) {
        const id = getItemId(item)
        if (targetSet.has(id)) {
          const coords = extractCoords(item)
          if (coords !== null) {
            toReloadMap.set(id, { id, ...coords })
          }
        }
      }

      // Ensure open panel variant (even if from another page) is refreshed in annotationCache
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
            toReloadMap.set(currentPanel.id, {
              id: currentPanel.id,
              chr: String(currentPanel.chr),
              pos: Number(currentPanel.pos),
              ref: String(currentPanel.ref),
              alt: String(currentPanel.alt)
            })
          }
        }
      }

      if (toReloadMap.size > 0) {
        await loadAnnotationsBatch(cid, Array.from(toReloadMap.values()))
      }

      // Only perform selection cleanup if selection was not modified and session is unchanged
      if (
        scopeGen === myScopeGen &&
        selectionRev === mySelectionRev &&
        getGeneration() === myCacheGen
      ) {
        clearSelection()
      }

      if (isStillActiveCase(cid, myDbPath)) {
        await onTriageApplied?.()
      }

      return res.updatedCount
    } catch (error) {
      if (!isStillActiveCase(cid, myDbPath)) return 0
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
