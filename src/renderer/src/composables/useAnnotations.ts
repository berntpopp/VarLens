/**
 * Composable for variant annotation state management
 *
 * Provides reactive annotation state per variant with IPC-backed persistence.
 * Used by VariantTable for star toggle and ACMG display.
 */

import { ref } from 'vue'
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

// Cache annotations by variant key (chr:pos:ref:alt)
const annotationCache = ref<Map<string, AnnotationCache>>(new Map())

// Loading states per variant key
const loadingStates = ref<Map<string, boolean>>(new Map())

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

    loadingStates.value.set(key, true)
    try {
      const result = await api.annotations.getForVariant(caseId, chr, pos, ref, alt)
      annotationCache.value.set(key, result)
    } catch (error) {
      console.error('Failed to load annotations:', error)
    } finally {
      loadingStates.value.set(key, false)
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
    }

    try {
      const updated = await api.annotations.upsertPerCase(caseId, variantId, {
        starred: newStarred
      })
      // Update cache with server response
      annotationCache.value.set(key, {
        global: current?.global ?? null,
        perCase: updated
      })
    } catch (error) {
      console.error('Failed to toggle star:', error)
      // Revert optimistic update
      if (current) {
        current.perCase = {
          ...current.perCase,
          starred: currentStarred ? 1 : 0
        } as CaseVariantAnnotation
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

    await Promise.all(promises)
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

    loadingStates.value.set(key, true)
    try {
      const global = await api.annotations.getGlobal(chr, pos, ref, alt)
      annotationCache.value.set(key, { global, perCase: null })
    } catch (error) {
      console.error('Failed to load global annotations:', error)
    } finally {
      loadingStates.value.set(key, false)
    }
  }

  // Bulk load global annotations for cohort mode
  async function loadGlobalAnnotationsBatch(
    variants: Array<{ chr: string; pos: number; ref: string; alt: string }>
  ): Promise<void> {
    const promises = variants
      .filter((v) => !annotationCache.value.has(variantKey(v.chr, v.pos, v.ref, v.alt)))
      .map((v) => loadGlobalAnnotations(v.chr, v.pos, v.ref, v.alt))

    await Promise.all(promises)
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
    }

    try {
      const updated = await api.annotations.upsertGlobal(chr, pos, ref, alt, {
        starred: newStarred
      })
      // Update cache with server response
      annotationCache.value.set(key, {
        global: updated,
        perCase: current?.perCase ?? null
      })
    } catch (error) {
      console.error('Failed to toggle global star:', error)
      // Revert optimistic update
      if (current) {
        current.global = {
          ...current.global,
          starred: currentStarred ? 1 : 0
        } as VariantAnnotation
      }
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
    }

    try {
      const updated = await api.annotations.upsertGlobal(chr, pos, ref, alt, {
        acmg_classification: classification
      })
      // Update cache with server response
      annotationCache.value.set(key, {
        global: updated,
        perCase: current?.perCase ?? null
      })
    } catch (error) {
      console.error('Failed to set global ACMG classification:', error)
      // Revert optimistic update
      if (current) {
        current.global = {
          ...current.global,
          acmg_classification: previousClassification
        } as VariantAnnotation
      }
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
    }

    try {
      const updated = await api.annotations.upsertGlobal(chr, pos, ref, alt, {
        global_comment: comment
      })
      // Update cache with server response
      annotationCache.value.set(key, {
        global: updated,
        perCase: current?.perCase ?? null
      })
    } catch (error) {
      console.error('Failed to upsert global comment:', error)
      // Revert optimistic update
      if (current) {
        current.global = {
          ...current.global,
          global_comment: previousComment
        } as VariantAnnotation
      }
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
    }

    try {
      const updated = await api.annotations.upsertPerCase(caseId, variantId, {
        per_case_comment: comment
      })
      // Update cache with server response
      annotationCache.value.set(key, {
        global: current?.global ?? null,
        perCase: updated
      })
    } catch (error) {
      console.error('Failed to upsert per-case comment:', error)
      // Revert optimistic update
      if (current) {
        current.perCase = {
          ...current.perCase,
          per_case_comment: previousComment
        } as CaseVariantAnnotation
      }
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
    }

    try {
      const updated = await api.annotations.upsertPerCase(caseId, variantId, {
        acmg_classification: classification
      })
      // Update cache with server response
      annotationCache.value.set(key, {
        global: current?.global ?? null,
        perCase: updated
      })
    } catch (error) {
      console.error('Failed to set ACMG classification:', error)
      // Revert optimistic update
      if (current) {
        current.perCase = {
          ...current.perCase,
          acmg_classification: previousClassification
        } as CaseVariantAnnotation
      }
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
    }

    try {
      const updated = await api.annotations.upsertPerCase(caseId, variantId, {
        acmg_classification: classification,
        acmg_evidence: evidenceJson,
        user_name: getUserName()
      })
      annotationCache.value.set(key, {
        global: current?.global ?? null,
        perCase: updated
      })
    } catch (error) {
      console.error('Failed to set ACMG classification with evidence:', error)
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
    }

    try {
      const updated = await api.annotations.upsertGlobal(chr, pos, ref, alt, {
        acmg_classification: classification,
        acmg_evidence: evidenceJson,
        user_name: getUserName()
      })
      annotationCache.value.set(key, {
        global: updated,
        perCase: current?.perCase ?? null
      })
    } catch (error) {
      console.error('Failed to set global ACMG classification with evidence:', error)
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

// ACMG classification values in display order
export const ACMG_CLASSIFICATIONS: AcmgClassification[] = [
  'Pathogenic',
  'Likely Pathogenic',
  'VUS',
  'Likely Benign',
  'Benign'
]

// ACMG color mapping for badges
export const ACMG_COLORS: Record<AcmgClassification, string> = {
  Pathogenic: 'error', // Red
  'Likely Pathogenic': 'orange', // Orange
  VUS: 'grey', // Gray
  'Likely Benign': 'light-blue', // Light blue
  Benign: 'success' // Green
}

// ACMG abbreviations for compact display
export const ACMG_ABBREV: Record<AcmgClassification, string> = {
  Pathogenic: 'P',
  'Likely Pathogenic': 'LP',
  VUS: 'VUS',
  'Likely Benign': 'LB',
  Benign: 'B'
}
