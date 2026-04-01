/**
 * Composable for variant annotation state management
 *
 * Provides reactive annotation state per variant with IPC-backed persistence.
 * Used by VariantTable for star toggle and ACMG display.
 */

import { shallowRef, triggerRef } from 'vue'
import { logService } from '../services/LogService'
import type { VariantAnnotation, CaseVariantAnnotation } from '../../../main/database/types'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import { useSettingsStore } from '../stores/settingsStore'
import { useDatabaseStore } from '../stores/databaseStore'
import { useApiService } from './useApiService'
import { LruMap } from '../../../shared/utils/lru-map'

interface AnnotationCache {
  global: VariantAnnotation | null
  perCase: CaseVariantAnnotation | null
}

// Maximum number of annotation cache entries before LRU eviction
export const MAX_CACHE_SIZE = 5000

// Cache annotations by variant key (chr:pos:ref:alt)
// shallowRef avoids deep reactive proxies on 5000+ Map entries
// Exported so useVariantRowViewModel can read it for precomputed row state
const lruCache = new LruMap<string, AnnotationCache>(MAX_CACHE_SIZE)
export const annotationCache = shallowRef<LruMap<string, AnnotationCache>>(lruCache)

// Loading states per variant key
const loadingStates = shallowRef<Map<string, boolean>>(new Map())

/**
 * LRU-aware cache setter. Delegates promotion and eviction to LruMap.
 *
 * Uses microtask batching: multiple cacheSet calls in the same tick produce
 * only one triggerRef flush, reducing reactivity churn during batch loads.
 */
let pendingCacheTrigger = false
function cacheSet(key: string, value: AnnotationCache): void {
  annotationCache.value.set(key, value)
  if (!pendingCacheTrigger) {
    pendingCacheTrigger = true
    Promise.resolve().then(() => {
      triggerRef(annotationCache)
      pendingCacheTrigger = false
    })
  }
}

/** Set loading state and trigger shallowRef reactivity. */
function setLoading(key: string, value: boolean): void {
  loadingStates.value.set(key, value)
  triggerRef(loadingStates)
}

// Generation counter — incremented on page/variant-set change so in-flight
// batch results from a prior page are discarded when they resolve.
let annotationGeneration = 0

// Scope tracking — detect db/case switches and auto-clear stale cache
let lastDbPath: string | null = null
let lastCaseId: number | null = null

/**
 * Get current database path safely (returns null if Pinia not available,
 * e.g. in unit tests without a store setup).
 */
function getCurrentDbPath(): string | null {
  try {
    const db = useDatabaseStore()
    return db.currentPath
  } catch {
    // Pinia not available (e.g. in unit tests without store setup)
    return null
  }
}

/**
 * Check if the scope (dbPath + caseId) has changed and clear cache if so.
 * Called before cache reads/writes to ensure stale data from a previous
 * database or case is never served.
 */
function ensureScopeOrClear(dbPath: string | null, caseId: number | null): void {
  const dbChanged = dbPath !== null && lastDbPath !== null && dbPath !== lastDbPath
  const caseChanged = caseId !== null && lastCaseId !== null && caseId !== lastCaseId

  if (dbChanged || caseChanged) {
    annotationCache.value.clear()
    loadingStates.value.clear()
    triggerRef(annotationCache)
    triggerRef(loadingStates)
  }

  if (dbPath !== null) lastDbPath = dbPath
  if (caseId !== null) lastCaseId = caseId
}

export function useAnnotations() {
  const { api } = useApiService()

  function invalidateAnnotationGeneration(): void {
    annotationGeneration++
  }

  // Get current user name for audit trail
  function getUserName(): string | undefined {
    try {
      const settings = useSettingsStore()
      return settings.userName || undefined
    } catch {
      // Pinia not available (e.g. in unit tests without store setup)
      return undefined
    }
  }

  // Build variant key for cache lookup
  function variantKey(chr: string, pos: number, ref: string, alt: string): string {
    return `${chr}:${pos}:${ref}:${alt}`
  }

  // Get annotations from cache
  function getAnnotations(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): AnnotationCache | undefined {
    return annotationCache.value.get(variantKey(chr, pos, ref, alt))
  }

  // Check if variant is starred (per-case)
  function isStarred(chr: string, pos: number, ref: string, alt: string): boolean {
    const cached = getAnnotations(chr, pos, ref, alt)
    if (!cached) return false
    return cached.perCase?.starred === 1 || false
  }

  // Check if variant is globally starred
  function isGlobalStarred(chr: string, pos: number, ref: string, alt: string): boolean {
    const cached = getAnnotations(chr, pos, ref, alt)
    if (!cached) return false
    return cached.global?.starred === 1 || false
  }

  // Check if loading
  function isLoading(chr: string, pos: number, ref: string, alt: string): boolean {
    return loadingStates.value.get(variantKey(chr, pos, ref, alt)) ?? false
  }

  // Get ACMG classification (per-case)
  function getAcmgClassification(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): AcmgClassification | null {
    const cached = getAnnotations(chr, pos, ref, alt)
    return cached?.perCase?.acmg_classification ?? null
  }

  // Get global ACMG classification
  function getGlobalAcmgClassification(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): AcmgClassification | null {
    const cached = getAnnotations(chr, pos, ref, alt)
    return cached?.global?.acmg_classification ?? null
  }

  // Load annotations for a variant (call on row visible or expand)
  async function loadAnnotations(
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, caseId)
    const key = variantKey(chr, pos, ref, alt)

    // Skip if already cached or loading
    if (annotationCache.value.has(key) || loadingStates.value.get(key) === true) {
      return
    }

    setLoading(key, true)
    try {
      const result = await api.annotations.getForVariant(caseId, chr, pos, ref, alt)

      // Guard against db/case switch during await
      const currentDbPath = getCurrentDbPath()
      const currentCaseId = lastCaseId
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      if (currentCaseId !== caseId) return
      cacheSet(key, result)
    } catch (error) {
      logService.error(
        'Failed to load annotations: ' + (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
    } finally {
      setLoading(key, false)
    }
  }

  // Toggle star (per-case)
  async function toggleStar(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, caseId)
    const key = variantKey(chr, pos, ref, alt)
    const current = annotationCache.value.get(key)
    const currentStarred = current?.perCase?.starred === 1
    const newStarred = !currentStarred

    // Optimistic update
    if (current) {
      current.perCase = {
        ...current.perCase,
        starred: newStarred ? 1 : 0,
        case_id: caseId,
        variant_id: variantId
      } as CaseVariantAnnotation
      triggerRef(annotationCache)
    }

    try {
      const updated = await api.annotations.upsertPerCase(caseId, variantId, {
        starred: newStarred
      })
      // Guard against db/case switch during await
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      if (lastCaseId !== caseId) return
      // Update cache with server response
      cacheSet(key, {
        global: current?.global ?? null,
        perCase: updated
      })
    } catch (error) {
      logService.error(
        'Failed to toggle star: ' + (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
      // Revert optimistic update
      if (current) {
        current.perCase = {
          ...current.perCase,
          starred: currentStarred ? 1 : 0
        } as CaseVariantAnnotation
        triggerRef(annotationCache)
      }
    }
  }

  // Bulk load annotations for visible variants
  async function loadAnnotationsBatch(
    caseId: number,
    variants: Array<{ chr: string; pos: number; ref: string; alt: string }>
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, caseId)

    // Capture generation at call time — used to detect stale results
    const currentGeneration = annotationGeneration

    // Filter out cached AND in-flight keys to prevent duplicate IPC calls
    const uncached = variants
      .filter(
        (v) =>
          !annotationCache.value.has(variantKey(v.chr, v.pos, v.ref, v.alt)) &&
          loadingStates.value.get(variantKey(v.chr, v.pos, v.ref, v.alt)) !== true
      )
      .map((v) => ({ chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }))

    if (uncached.length === 0) return

    // Mark all keys as in-flight before the IPC call
    for (const vk of uncached) {
      setLoading(variantKey(vk.chr, vk.pos, vk.ref, vk.alt), true)
    }

    try {
      const results = await api.annotations.batchGet(caseId, uncached)

      // Discard results if user navigated to a new page while this was in-flight
      if (currentGeneration !== annotationGeneration) return

      // Discard results if db or case switched during the async call
      const currentDbPath = getCurrentDbPath()
      const currentCaseId = lastCaseId
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      if (currentCaseId !== caseId) return

      for (const [key, value] of Object.entries(results)) {
        cacheSet(key, value as AnnotationCache)
      }
    } catch (error) {
      logService.warn(
        'Failed to load annotation batch: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
    } finally {
      for (const vk of uncached) {
        setLoading(variantKey(vk.chr, vk.pos, vk.ref, vk.alt), false)
      }
    }
  }

  // Load global annotations only (for cohort mode - no caseId needed)
  async function loadGlobalAnnotations(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, null)
    const key = variantKey(chr, pos, ref, alt)

    // Skip if already cached or loading
    if (annotationCache.value.has(key) || loadingStates.value.get(key) === true) {
      return
    }

    setLoading(key, true)
    try {
      const global = await api.annotations.getGlobal(chr, pos, ref, alt)

      // Guard against db switch during await
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      cacheSet(key, { global, perCase: null })
    } catch (error) {
      logService.error(
        'Failed to load global annotations: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
    } finally {
      setLoading(key, false)
    }
  }

  // Bulk load global annotations for cohort mode
  async function loadGlobalAnnotationsBatch(
    variants: Array<{ chr: string; pos: number; ref: string; alt: string }>
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, null)

    // Filter out cached AND in-flight keys to prevent duplicate IPC calls
    const uncached = variants
      .filter(
        (v) =>
          !annotationCache.value.has(variantKey(v.chr, v.pos, v.ref, v.alt)) &&
          loadingStates.value.get(variantKey(v.chr, v.pos, v.ref, v.alt)) !== true
      )
      .map((v) => ({ chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }))

    if (uncached.length === 0) return

    // Mark all keys as in-flight before the IPC call
    for (const vk of uncached) {
      setLoading(variantKey(vk.chr, vk.pos, vk.ref, vk.alt), true)
    }

    try {
      const results = await api.annotations.batchGet(null, uncached)

      // Discard results if db switched during the async call
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return

      for (const [key, value] of Object.entries(results)) {
        cacheSet(key, value as AnnotationCache)
      }
    } catch (error) {
      logService.warn(
        'Failed to load global annotation batch: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
    } finally {
      for (const vk of uncached) {
        setLoading(variantKey(vk.chr, vk.pos, vk.ref, vk.alt), false)
      }
    }
  }

  // Toggle global star (for cohort mode)
  async function toggleGlobalStar(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, null)
    const key = variantKey(chr, pos, ref, alt)
    const current = annotationCache.value.get(key)
    const currentStarred = current?.global?.starred === 1
    const newStarred = !currentStarred

    // Optimistic update
    if (current) {
      current.global = {
        ...current.global,
        starred: newStarred ? 1 : 0
      } as VariantAnnotation
      triggerRef(annotationCache)
    }

    try {
      const updated = await api.annotations.upsertGlobal(chr, pos, ref, alt, {
        starred: newStarred
      })
      // Guard against db switch during await
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      // Update cache with server response
      cacheSet(key, {
        global: updated,
        perCase: current?.perCase ?? null
      })
    } catch (error) {
      logService.error(
        'Failed to toggle global star: ' + (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
      // Revert optimistic update
      if (current) {
        current.global = {
          ...current.global,
          starred: currentStarred ? 1 : 0
        } as VariantAnnotation
      }
      triggerRef(annotationCache)
    }
  }

  // Set global ACMG classification (for cohort mode)
  async function setGlobalAcmgClassification(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, null)
    const key = variantKey(chr, pos, ref, alt)
    const current = annotationCache.value.get(key)
    const previousClassification = current?.global?.acmg_classification ?? null

    // Optimistic update
    if (current) {
      current.global = {
        ...current.global,
        acmg_classification: classification
      } as VariantAnnotation
      triggerRef(annotationCache)
    }

    try {
      const updated = await api.annotations.upsertGlobal(chr, pos, ref, alt, {
        acmg_classification: classification
      })
      // Guard against db switch during await
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      // Update cache with server response
      cacheSet(key, {
        global: updated,
        perCase: current?.perCase ?? null
      })
    } catch (error) {
      logService.error(
        'Failed to set global ACMG classification: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
      // Revert optimistic update
      if (current) {
        current.global = {
          ...current.global,
          acmg_classification: previousClassification
        } as VariantAnnotation
      }
      triggerRef(annotationCache)
    }
  }

  // Get global comment from cache
  function getGlobalComment(chr: string, pos: number, ref: string, alt: string): string | null {
    const cached = getAnnotations(chr, pos, ref, alt)
    return cached?.global?.global_comment ?? null
  }

  // Get per-case comment from cache
  function getPerCaseComment(chr: string, pos: number, ref: string, alt: string): string | null {
    const cached = getAnnotations(chr, pos, ref, alt)
    return cached?.perCase?.per_case_comment ?? null
  }

  // Upsert global comment with optimistic update
  async function upsertGlobalComment(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    comment: string | null
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, null)
    const key = variantKey(chr, pos, ref, alt)
    const current = annotationCache.value.get(key)
    const previousComment = current?.global?.global_comment ?? null

    // Optimistic update
    if (current) {
      current.global = {
        ...current.global,
        global_comment: comment
      } as VariantAnnotation
      triggerRef(annotationCache)
    }

    try {
      const updated = await api.annotations.upsertGlobal(chr, pos, ref, alt, {
        global_comment: comment
      })
      // Guard against db switch during await
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      // Update cache with server response
      cacheSet(key, {
        global: updated,
        perCase: current?.perCase ?? null
      })
    } catch (error) {
      logService.error(
        'Failed to upsert global comment: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
      // Revert optimistic update
      if (current) {
        current.global = {
          ...current.global,
          global_comment: previousComment
        } as VariantAnnotation
      }
      triggerRef(annotationCache)
    }
  }

  // Upsert per-case comment with optimistic update
  async function upsertPerCaseComment(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    comment: string | null
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, caseId)
    const key = variantKey(chr, pos, ref, alt)
    const current = annotationCache.value.get(key)
    const previousComment = current?.perCase?.per_case_comment ?? null

    // Optimistic update
    if (current) {
      current.perCase = {
        ...current.perCase,
        per_case_comment: comment,
        case_id: caseId,
        variant_id: variantId
      } as CaseVariantAnnotation
      triggerRef(annotationCache)
    }

    try {
      const updated = await api.annotations.upsertPerCase(caseId, variantId, {
        per_case_comment: comment
      })
      // Guard against db/case switch during await
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      if (lastCaseId !== caseId) return
      // Update cache with server response
      cacheSet(key, {
        global: current?.global ?? null,
        perCase: updated
      })
    } catch (error) {
      logService.error(
        'Failed to upsert per-case comment: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
      // Revert optimistic update
      if (current) {
        current.perCase = {
          ...current.perCase,
          per_case_comment: previousComment
        } as CaseVariantAnnotation
      }
      triggerRef(annotationCache)
    }
  }

  // Delete global comment (sets to null, preserves other fields)
  async function deleteGlobalComment(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
    await upsertGlobalComment(chr, pos, ref, alt, null)
  }

  // Delete per-case comment (sets to null, preserves other fields)
  async function deletePerCaseComment(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
    await upsertPerCaseComment(caseId, variantId, chr, pos, ref, alt, null)
  }

  // Set ACMG classification with optimistic update (per-case)
  async function setAcmgClassification(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, caseId)
    const key = variantKey(chr, pos, ref, alt)
    const current = annotationCache.value.get(key)
    const previousClassification = current?.perCase?.acmg_classification ?? null

    // Optimistic update
    if (current) {
      current.perCase = {
        ...current.perCase,
        acmg_classification: classification,
        case_id: caseId,
        variant_id: variantId
      } as CaseVariantAnnotation
      triggerRef(annotationCache)
    }

    try {
      const updated = await api.annotations.upsertPerCase(caseId, variantId, {
        acmg_classification: classification
      })
      // Guard against db/case switch during await
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      if (lastCaseId !== caseId) return
      // Update cache with server response
      cacheSet(key, {
        global: current?.global ?? null,
        perCase: updated
      })
    } catch (error) {
      logService.error(
        'Failed to set ACMG classification: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
      // Revert optimistic update
      if (current) {
        current.perCase = {
          ...current.perCase,
          acmg_classification: previousClassification
        } as CaseVariantAnnotation
      }
      triggerRef(annotationCache)
    }
  }

  // Get ACMG evidence JSON (per-case)
  function getAcmgEvidence(chr: string, pos: number, ref: string, alt: string): string | null {
    const cached = getAnnotations(chr, pos, ref, alt)
    return cached?.perCase?.acmg_evidence ?? null
  }

  // Get global ACMG evidence JSON
  function getGlobalAcmgEvidence(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): string | null {
    const cached = getAnnotations(chr, pos, ref, alt)
    return cached?.global?.acmg_evidence ?? null
  }

  // Set ACMG classification and evidence together (per-case)
  async function setAcmgClassificationWithEvidence(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null,
    evidenceJson: string
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, caseId)
    const key = variantKey(chr, pos, ref, alt)
    const current = annotationCache.value.get(key)

    // Save previous state for rollback
    const previousPerCase = current?.perCase ?? null

    // Optimistic update
    if (current) {
      current.perCase = {
        ...current.perCase,
        acmg_classification: classification,
        acmg_evidence: evidenceJson,
        case_id: caseId,
        variant_id: variantId
      } as CaseVariantAnnotation
      triggerRef(annotationCache)
    }

    try {
      const updated = await api.annotations.upsertPerCase(caseId, variantId, {
        acmg_classification: classification,
        acmg_evidence: evidenceJson,
        user_name: getUserName()
      })
      // Guard against db/case switch during await
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      if (lastCaseId !== caseId) return
      cacheSet(key, {
        global: current?.global ?? null,
        perCase: updated
      })
    } catch (error) {
      logService.error(
        'Failed to set ACMG classification with evidence: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
      // Rollback optimistic update
      if (current) {
        current.perCase = previousPerCase
      }
    }
  }

  // Set global ACMG classification and evidence together (cohort mode)
  async function setGlobalAcmgClassificationWithEvidence(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null,
    evidenceJson: string
  ): Promise<void> {
    if (!api) return
    const dbPath = getCurrentDbPath()
    ensureScopeOrClear(dbPath, null)
    const key = variantKey(chr, pos, ref, alt)
    const current = annotationCache.value.get(key)

    // Save previous state for rollback
    const previousGlobal = current?.global ?? null

    // Optimistic update
    if (current) {
      current.global = {
        ...current.global,
        acmg_classification: classification,
        acmg_evidence: evidenceJson
      } as VariantAnnotation
      triggerRef(annotationCache)
    }

    try {
      const updated = await api.annotations.upsertGlobal(chr, pos, ref, alt, {
        acmg_classification: classification,
        acmg_evidence: evidenceJson,
        user_name: getUserName()
      })
      // Guard against db switch during await
      const currentDbPath = getCurrentDbPath()
      if (currentDbPath !== null && dbPath !== null && currentDbPath !== dbPath) return
      cacheSet(key, {
        global: updated,
        perCase: current?.perCase ?? null
      })
    } catch (error) {
      logService.error(
        'Failed to set global ACMG classification with evidence: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
      // Rollback optimistic update
      if (current) {
        current.global = previousGlobal
      }
    }
  }

  // Clear cache (call on case switch)
  function clearCache(): void {
    annotationCache.value.clear()
    loadingStates.value.clear()
    triggerRef(annotationCache)
    triggerRef(loadingStates)
    lastDbPath = null
    lastCaseId = null
  }

  return {
    getAnnotations,
    isStarred,
    isGlobalStarred,
    isLoading,
    getAcmgClassification,
    getGlobalAcmgClassification,
    loadAnnotations,
    loadAnnotationsBatch,
    loadGlobalAnnotations,
    loadGlobalAnnotationsBatch,
    toggleStar,
    toggleGlobalStar,
    clearCache,
    getGlobalComment,
    getPerCaseComment,
    upsertGlobalComment,
    upsertPerCaseComment,
    deleteGlobalComment,
    deletePerCaseComment,
    setAcmgClassification,
    setGlobalAcmgClassification,
    getAcmgEvidence,
    getGlobalAcmgEvidence,
    setAcmgClassificationWithEvidence,
    setGlobalAcmgClassificationWithEvidence,
    invalidateAnnotationGeneration
  }
}

/**
 * Reset annotation cache and loading states for testing.
 *
 * Call this in beforeEach() to ensure test isolation.
 * Only exported for testing - not part of the public API.
 */
export function _resetAnnotationsForTesting(): void {
  annotationCache.value.clear()
  loadingStates.value.clear()
  triggerRef(annotationCache)
  triggerRef(loadingStates)
  annotationGeneration = 0
  lastDbPath = null
  lastCaseId = null
}

export {
  ACMG_CLASSIFICATIONS,
  ACMG_COLORS,
  ACMG_ABBREV
} from '../../../shared/config/domain.config'
