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

interface AnnotationCache {
  global: VariantAnnotation | null
  perCase: CaseVariantAnnotation | null
}

// Cache annotations by variant key (chr:pos:ref:alt)
const annotationCache = ref<Map<string, AnnotationCache>>(new Map())

// Loading states per variant key
const loadingStates = ref<Map<string, boolean>>(new Map())

export function useAnnotations() {
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

  // Check if variant is starred (global OR per-case)
  function isStarred(chr: string, pos: number, ref: string, alt: string): boolean {
    const cached = getAnnotations(chr, pos, ref, alt)
    if (!cached) return false
    return cached.global?.starred === 1 || false
  }

  // Check if loading
  function isLoading(chr: string, pos: number, ref: string, alt: string): boolean {
    return loadingStates.value.get(variantKey(chr, pos, ref, alt)) ?? false
  }

  // Get ACMG classification
  function getAcmgClassification(
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
    const key = variantKey(chr, pos, ref, alt)

    // Skip if already cached or loading
    if (annotationCache.value.has(key) || loadingStates.value.get(key) === true) {
      return
    }

    loadingStates.value.set(key, true)
    try {
      const result = await window.api.annotations.getForVariant(caseId, chr, pos, ref, alt)
      annotationCache.value.set(key, result)
    } catch (error) {
      console.error('Failed to load annotations:', error)
    } finally {
      loadingStates.value.set(key, false)
    }
  }

  // Toggle global star
  async function toggleGlobalStar(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
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
      const updated = await window.api.annotations.upsertGlobal(chr, pos, ref, alt, {
        starred: newStarred
      })
      // Update cache with server response
      annotationCache.value.set(key, {
        global: updated,
        perCase: current?.perCase ?? null
      })
    } catch (error) {
      console.error('Failed to toggle star:', error)
      // Revert optimistic update
      if (current) {
        current.global = {
          ...current.global,
          starred: currentStarred ? 1 : 0
        } as VariantAnnotation
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

  // Clear cache (call on case switch)
  function clearCache(): void {
    annotationCache.value.clear()
    loadingStates.value.clear()
  }

  return {
    getAnnotations,
    isStarred,
    isLoading,
    getAcmgClassification,
    loadAnnotations,
    loadAnnotationsBatch,
    toggleGlobalStar,
    clearCache
  }
}

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
