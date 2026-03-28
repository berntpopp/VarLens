/**
 * Composable for variant annotation state management
 *
 * Provides reactive annotation state per variant with IPC-backed persistence.
 * Used by VariantTable for star toggle and ACMG display.
 */

import { shallowRef, triggerRef } from 'vue'
import { logService } from '../services/LogService'
import type {
  VariantAnnotation,
  CaseVariantAnnotation,
  AcmgClassification
} from '../../../main/database/types'
import { useSettingsStore } from '../stores/settingsStore'
import { useApiService } from './useApiService'

interface AnnotationCache {
  global: VariantAnnotation | null
  perCase: CaseVariantAnnotation | null
}

// Maximum number of annotation cache entries before LRU eviction
export const MAX_CACHE_SIZE = 5000

// Cache annotations by variant key (chr:pos:ref:alt)
// shallowRef avoids deep reactive proxies on 5000+ Map entries
const annotationCache = shallowRef<Map<string, AnnotationCache>>(new Map())

// Loading states per variant key
const loadingStates = shallowRef<Map<string, boolean>>(new Map())

/**
 * LRU-aware cache setter. Moves existing keys to the end (most-recently-used)
 * and evicts oldest entries when the cache exceeds MAX_CACHE_SIZE.
 * JavaScript Map maintains insertion order, so the first entry is the oldest.
 *
 * Uses microtask batching: multiple cacheSet calls in the same tick produce
 * only one triggerRef flush, reducing reactivity churn during batch loads.
 */
let pendingCacheTrigger = false
function cacheSet(key: string, value: AnnotationCache): void {
  const cache = annotationCache.value
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, value)
  // Evict oldest entries without allocating an intermediate keys array
  while (cache.size > MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
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

export function useAnnotations() {
  const { api } = useApiService()

  // Get current user name for audit trail
  function getUserName(): string | undefined {
    try {
      const settings = useSettingsStore()
      return settings.userName || undefined
    } catch {
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
    const key = variantKey(chr, pos, ref, alt)

    // Skip if already cached or loading
    if (annotationCache.value.has(key) || loadingStates.value.get(key) === true) {
      return
    }

    setLoading(key, true)
    try {
      const result = await api.annotations.getForVariant(caseId, chr, pos, ref, alt)
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
    // Load in parallel, skip already cached
    const promises = variants
      .filter((v) => !annotationCache.value.has(variantKey(v.chr, v.pos, v.ref, v.alt)))
      .map((v) => loadAnnotations(caseId, v.chr, v.pos, v.ref, v.alt))

    const results = await Promise.allSettled(promises)
    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      logService.warn(
        `Failed to load ${failed.length}/${promises.length} annotations`,
        'annotations'
      )
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
    const key = variantKey(chr, pos, ref, alt)

    // Skip if already cached or loading
    if (annotationCache.value.has(key) || loadingStates.value.get(key) === true) {
      return
    }

    setLoading(key, true)
    try {
      const global = await api.annotations.getGlobal(chr, pos, ref, alt)
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
    const promises = variants
      .filter((v) => !annotationCache.value.has(variantKey(v.chr, v.pos, v.ref, v.alt)))
      .map((v) => loadGlobalAnnotations(v.chr, v.pos, v.ref, v.alt))

    const results = await Promise.allSettled(promises)
    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      logService.warn(
        `Failed to load ${failed.length}/${promises.length} global annotations`,
        'annotations'
      )
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
    setGlobalAcmgClassificationWithEvidence
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
}

// ACMG classification values in display order
export const ACMG_CLASSIFICATIONS: AcmgClassification[] = [
  'Pathogenic',
  'Likely Pathogenic',
  'VUS',
  'Likely Benign',
  'Benign'
]

// ACMG color mapping — colorblind-safe palette (Okabe-Ito derived).
// Avoids red/green confusion for deuteranopia/protanopia (~8% of males).
// Uses blue for benign instead of green, vermillion for pathogenic instead of
// pure red, ensuring distinguishable hues across all CVD types.
export const ACMG_COLORS: Record<AcmgClassification, string> = {
  Pathogenic: '#C62828', // Deep red — distinct in all CVD types
  'Likely Pathogenic': '#D55E00', // Vermillion (Okabe-Ito) — warm, distinct from red
  VUS: '#757575', // Neutral grey — no hue confusion
  'Likely Benign': '#0072B2', // Blue (Okabe-Ito) — universally distinguishable
  Benign: '#009E73' // Teal/bluish-green (Okabe-Ito) — distinct from red/orange for CVD
}

// ACMG abbreviations for compact display
export const ACMG_ABBREV: Record<AcmgClassification, string> = {
  Pathogenic: 'P',
  'Likely Pathogenic': 'LP',
  VUS: 'VUS',
  'Likely Benign': 'LB',
  Benign: 'B'
}
