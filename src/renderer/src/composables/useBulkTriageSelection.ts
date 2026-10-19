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
  bumpWriteVersion,
  ensurePerCaseSlotOwner,
  evictAnnotationCacheKeys,
  evictAnnotationCacheKeysForBulkTriage,
  getCachedBuild,
  getCachedCaseId,
  getCurrentDbPath,
  getGeneration,
  hasDbSwitchedSince,
  isKeyLoading,
  isPerCaseSlotOwner,
  markAwaited,
  perCaseVersionSlot,
  variantKey,
  type VariantCoords
} from './annotation-cache'
import { invalidateTags } from '../queries/tags'
import { logService } from '../services/LogService'
import { AppStateKey } from './useAppState'

export const MAX_BULK_TRIAGE_SELECTION = 1000

type CommittedWriteListener = (
  cid: number,
  dbPath: string | null,
  targetSet: ReadonlySet<number>,
  updates: BatchPerCaseAnnotationUpdates
) => Promise<void>

const committedWriteListeners = new Set<CommittedWriteListener>()

export function _resetCommittedWriteListenersForTesting(): void {
  committedWriteListeners.clear()
}

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
      const v = item as unknown as VariantCoords
      return { chr: String(v.chr), pos: Number(v.pos), ref: String(v.ref), alt: String(v.alt) }
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

  function isCacheStillOnCase(cid: number, myDbPath: string | null): boolean {
    if (hasDbSwitchedSince(myDbPath)) return false
    if (!isDisposed && toValue(caseId) !== cid) return false
    const appCaseId = appState?.selectedCaseId?.value
    if (appCaseId !== undefined && appCaseId !== null && appCaseId !== cid) return false
    const cachedCid = getCachedCaseId()
    if (cachedCid !== null && cachedCid !== cid) return false
    return true
  }

  function isStillActiveCase(cid: number, myDbPath: string | null): boolean {
    return !isDisposed && isCacheStillOnCase(cid, myDbPath)
  }

  function getPanelVariantCoords(targetCid: number): (VariantCoords & { id: number }) | null {
    const p = appState?.selectedPanelVariant?.value
    if (
      p !== null &&
      typeof p === 'object' &&
      'id' in p &&
      typeof p.id === 'number' &&
      'chr' in p &&
      'pos' in p &&
      'ref' in p &&
      'alt' in p
    ) {
      const panelCaseId = 'case_id' in p ? (p as { case_id?: unknown }).case_id : undefined
      if (panelCaseId === undefined || panelCaseId === targetCid) {
        return {
          id: p.id,
          chr: String(p.chr),
          pos: Number(p.pos),
          ref: String(p.ref),
          alt: String(p.alt)
        }
      }
    }
    return null
  }

  const selectedIdSet = computed(() => new Set(selectedIds.value))
  const selectedCount = computed(() => selectedIds.value.length)
  const isSelected = (id: number): boolean => selectedIdSet.value.has(id)

  const currentItems = computed(() => toValue(items))

  async function reloadBatchAwaited(
    targetCid: number,
    items: Array<VariantCoords & { id: number }>
  ): Promise<void> {
    beginAnnotationRequest(targetCid, toValue(options.genomeBuild) ?? getCachedBuild())
    for (const item of items) {
      const k = variantKey(item)
      if (!annotationCache.value.has(k) && isKeyLoading(k)) {
        evictAnnotationCacheKeys([k])
      }
      markAwaited('case', k)
    }
    await loadAnnotationsBatch(targetCid, items)
  }

  async function reloadAffectedAndPanel(
    targetCid: number,
    targetDbPath: string | null,
    targetSet: ReadonlySet<number>,
    extraReloadItems?: ReadonlyArray<{
      id: number
      chr: string
      pos: number
      ref: string
      alt: string
    }>
  ): Promise<boolean> {
    const toReloadMap = new Map<
      string,
      { id: number; chr: string; pos: number; ref: string; alt: string }
    >()
    if (extraReloadItems) {
      for (const item of extraReloadItems) toReloadMap.set(variantKey(item), item)
    }
    for (const item of currentItems.value) {
      const id = getItemId(item)
      if (targetSet.has(id)) {
        const coords = extractCoords(item)
        if (coords !== null) toReloadMap.set(variantKey(coords), { id, ...coords })
      }
    }

    const currentPanel = getPanelVariantCoords(targetCid)
    if (currentPanel !== null) {
      if (targetSet.has(currentPanel.id) || !annotationCache.value.has(variantKey(currentPanel))) {
        toReloadMap.set(variantKey(currentPanel), currentPanel)
      }
    }

    if (toReloadMap.size > 0) {
      await reloadBatchAwaited(targetCid, Array.from(toReloadMap.values()))
      if (!isStillActiveCase(targetCid, targetDbPath)) return false
    }
    return true
  }

  const listener: CommittedWriteListener = async (
    targetCid,
    targetDbPath,
    notifiedTargetSet,
    _notifiedUpdates
  ) => {
    if (!isStillActiveCase(targetCid, targetDbPath)) return
    const ok = await reloadAffectedAndPanel(targetCid, targetDbPath, notifiedTargetSet)
    if (!ok) return
    if (isStillActiveCase(targetCid, targetDbPath)) {
      await onTriageApplied?.()
    }
  }

  committedWriteListeners.add(listener)

  if (getCurrentScope()) {
    onScopeDispose(() => {
      isDisposed = true
      scopeGen += 1
      selectionRev += 1
      activeApplyId += 1
      committedWriteListeners.delete(listener)
    })
  }

  const isAllSelected = computed(() => {
    const list = currentItems.value
    return list.length > 0 && list.every((item) => selectedIdSet.value.has(getItemId(item)))
  })

  const isSomeSelected = computed(() => selectedCount.value > 0 && !isAllSelected.value)

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
        if (coords !== null) coordsById.set(id, coords)
      }
    }
    selectedIds.value = Array.from(next)
    lastClickedId.value = id
  }

  function clearSelection(): void {
    if (selectedIds.value.length > 0) selectionRev += 1
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
      const targetCoords = new Map<number, VariantCoords>()

      // 1. From coordsById for all selected IDs (preserves coords seen on other pages)
      for (const id of targetSet) {
        const coords = coordsById.get(id)
        if (coords !== undefined) {
          targetCoords.set(id, coords)
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
              targetCoords.set(itemId, coords)
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
      const initialPanel = getPanelVariantCoords(cid)
      if (initialPanel !== null && targetSet.has(initialPanel.id)) {
        targetCoords.set(initialPanel.id, initialPanel)
        affectedKeys.add(variantKey(initialPanel))
      }

      const touchedFields: Array<'star' | 'acmg' | 'comment'> = []
      if (updates.starred !== undefined || 'is_starred' in updates) touchedFields.push('star')
      if ('acmg_classification' in updates || 'acmg_evidence' in updates) touchedFields.push('acmg')
      if ('per_case_comment' in updates) touchedFields.push('comment')

      const bulkOwners = new Map<string, { caseId: number; variantId: number }>()
      for (const [id, coords] of targetCoords.entries()) {
        const k = variantKey(coords)
        if (!bulkOwners.has(k) || isPerCaseSlotOwner(k, cid, id)) {
          bulkOwners.set(k, { caseId: cid, variantId: id })
        }
      }
      for (const [k, o] of bulkOwners) ensurePerCaseSlotOwner(k, o.caseId, o.variantId)

      const bulkWriteVersions = new Map<string, Map<'star' | 'acmg' | 'comment', number>>()
      for (const k of affectedKeys) {
        const m = new Map<'star' | 'acmg' | 'comment', number>()
        const o = bulkOwners.get(k)
        for (const fg of touchedFields) {
          const vSlot = o ? perCaseVersionSlot(o.caseId, o.variantId, fg) : `perCase:${fg}`
          m.set(fg, bumpWriteVersion(k, vSlot))
        }
        bulkWriteVersions.set(k, m)
      }

      const res = unwrapIpcResult(await api.annotations.batchUpsertPerCase(cid, targetIds, updates))

      // If active case or database changed away from cid, write has committed in storage
      // but we do not touch the active different case's selection or cache.
      if (!isCacheStillOnCase(cid, myDbPath)) {
        return res.updatedCount
      }

      const postWritePanel = getPanelVariantCoords(cid)
      if (postWritePanel !== null && targetSet.has(postWritePanel.id)) {
        targetCoords.set(postWritePanel.id, postWritePanel)
        const pKey = variantKey(postWritePanel)
        affectedKeys.add(pKey)
        if (!bulkOwners.has(pKey) || isPerCaseSlotOwner(pKey, cid, postWritePanel.id)) {
          bulkOwners.set(pKey, { caseId: cid, variantId: postWritePanel.id })
        }
      }

      const preCachedToReload: Array<{
        id: number
        chr: string
        pos: number
        ref: string
        alt: string
      }> = []
      for (const [id, coords] of targetCoords.entries()) {
        const k = variantKey(coords)
        if (annotationCache.value.has(k) || isKeyLoading(k)) {
          preCachedToReload.push({ id, ...coords })
        }
      }

      evictAnnotationCacheKeysForBulkTriage(
        affectedKeys,
        touchedFields,
        bulkWriteVersions,
        updates,
        bulkOwners
      )

      if (updates.tag_id !== undefined && getActivePinia()) {
        await invalidateTags(true)
        if (!isCacheStillOnCase(cid, myDbPath)) {
          return res.updatedCount
        }
      }

      async function runDisposedRecovery(targetCid: number): Promise<void> {
        await Promise.allSettled(
          Array.from(committedWriteListeners).map((fn) =>
            fn(targetCid, myDbPath, targetSet, updates)
          )
        )
        if (!isCacheStillOnCase(targetCid, myDbPath)) return
        const missingMap = new Map<
          string,
          { id: number; chr: string; pos: number; ref: string; alt: string }
        >()
        for (const v of preCachedToReload) {
          if (!annotationCache.value.has(variantKey(v))) missingMap.set(variantKey(v), v)
        }
        const currentPanel = getPanelVariantCoords(targetCid)
        if (currentPanel !== null && !annotationCache.value.has(variantKey(currentPanel))) {
          missingMap.set(variantKey(currentPanel), currentPanel)
        }
        if (missingMap.size > 0) {
          await reloadBatchAwaited(targetCid, Array.from(missingMap.values()))
        }
      }

      if (isDisposed) {
        await runDisposedRecovery(cid)
        return res.updatedCount
      }

      const ok = await reloadAffectedAndPanel(cid, myDbPath, targetSet, preCachedToReload)
      if (!ok) {
        if (isDisposed && isCacheStillOnCase(cid, myDbPath)) {
          await runDisposedRecovery(cid)
        }
        return res.updatedCount
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

      await Promise.allSettled(
        Array.from(committedWriteListeners)
          .filter((fn) => fn !== listener)
          .map((fn) => fn(cid, myDbPath, targetSet, updates))
      )

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
