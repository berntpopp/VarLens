/**
 * Composable for variant annotation state management
 *
 * Provides reactive annotation state per variant with IPC-backed persistence.
 * Used by VariantTable for star toggle and ACMG display.
 *
 * This file is the public surface only. The shared cache lives in
 * `annotation-cache.ts`; loads and optimistic writes are implemented once in
 * `annotation-scoped-ops.ts` and bound here to the per-case / global pairs.
 */

import { hasInjectionContext, inject, toValue, type InjectionKey, type MaybeRefOrGetter } from 'vue'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import { useSettingsStore } from '../stores/settingsStore'
import { useApiService } from './useApiService'
import { AppStateKey } from './useAppState'
import {
  annotationCache,
  clearAnnotationCache,
  invalidateAnnotationGeneration,
  isCacheOfBuild,
  isKeyLoading,
  resetAnnotationState,
  variantKey,
  type AnnotationCache,
  type VariantCoords
} from './annotation-cache'
import { createScopedAnnotationOps, globalScope } from './annotation-scoped-ops'

export { MAX_CACHE_SIZE, annotationCache, variantKey } from './annotation-cache'

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

function coordsOf(chr: string, pos: number, ref: string, alt: string): VariantCoords {
  return { chr, pos, ref, alt }
}

/**
 * Genome build of the variants a view shows: global annotations are keyed by
 * it (#577). The case and cohort views provide it; a component outside them
 * (the details panel) passes `useAnnotations({ genomeBuild })`.
 */
export const AnnotationBuildKey: InjectionKey<MaybeRefOrGetter<string | null>> =
  Symbol('annotationBuild')

export interface UseAnnotationsOptions {
  genomeBuild?: MaybeRefOrGetter<string | null>
}

/** The build of this caller: its option, else the view's, else unknown. */
function buildGetter(options: UseAnnotationsOptions): () => string | null {
  const source =
    options.genomeBuild ?? (hasInjectionContext() ? inject(AnnotationBuildKey, null) : null)
  return () => (source === null ? null : (toValue(source) ?? null))
}

/** Synchronous cache readers for both scopes. */
function createAnnotationGetters(build: () => string | null) {
  // Get annotations from cache; never another build's (#577).
  function getAnnotations(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): AnnotationCache | undefined {
    if (!isCacheOfBuild(build())) return undefined
    return annotationCache.value.get(variantKey({ chr, pos, ref, alt }))
  }

  type Reader<T> = (chr: string, pos: number, ref: string, alt: string) => T

  /** Build a getter that reads one value from the per-case or global slot. */
  function slotReader<S extends keyof AnnotationCache, T>(
    slot: S,
    read: (value: AnnotationCache[S] | undefined) => T
  ): Reader<T> {
    return (chr, pos, ref, alt) => read(getAnnotations(chr, pos, ref, alt)?.[slot])
  }

  return {
    getAnnotations,
    // Check if variant is starred (per-case / globally)
    isStarred: slotReader('perCase', (a) => a?.starred === 1 || false),
    isGlobalStarred: slotReader('global', (a) => a?.starred === 1 || false),
    // Check if loading
    isLoading: ((chr, pos, ref, alt) =>
      isKeyLoading(variantKey({ chr, pos, ref, alt }))) as Reader<boolean>,
    // ACMG classification (per-case / global)
    getAcmgClassification: slotReader<'perCase', AcmgClassification | null>(
      'perCase',
      (a) => a?.acmg_classification ?? null
    ),
    getGlobalAcmgClassification: slotReader<'global', AcmgClassification | null>(
      'global',
      (a) => a?.acmg_classification ?? null
    ),
    // Comments
    getGlobalComment: slotReader('global', (a) => a?.global_comment ?? null),
    getPerCaseComment: slotReader('perCase', (a) => a?.per_case_comment ?? null),
    // ACMG evidence JSON (per-case / global)
    getAcmgEvidence: slotReader('perCase', (a) => a?.acmg_evidence ?? null),
    getGlobalAcmgEvidence: slotReader('global', (a) => a?.acmg_evidence ?? null)
  }
}

type ScopedOps = ReturnType<typeof createScopedAnnotationOps>

/** A per-case row to batch-load: coordinates plus its `variants.id`. */
export type CaseBatchVariant = VariantCoords & { id: number }

/** Per-case / global load functions. */
function bindLoads(ops: ScopedOps, build: () => string | null) {
  // Load annotations for a variant (call on row visible or expand)
  function loadAnnotations(
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
    return ops.load({ kind: 'case', caseId, build: build() }, coordsOf(chr, pos, ref, alt))
  }

  // Bulk load annotations for visible variants. Rows must carry their
  // `variants.id` so the per-case lookup is bound to the row, not just its coordinates.
  function loadAnnotationsBatch(caseId: number, variants: CaseBatchVariant[]): Promise<void> {
    return ops.loadBatch({ kind: 'case', caseId, build: build() }, variants)
  }

  // Load global annotations only (for cohort mode - no caseId needed)
  function loadGlobalAnnotations(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
    return ops.load(globalScope(build()), coordsOf(chr, pos, ref, alt))
  }

  // Bulk load global annotations for cohort mode
  function loadGlobalAnnotationsBatch(variants: VariantCoords[]): Promise<void> {
    return ops.loadBatch(globalScope(build()), variants)
  }

  return {
    loadAnnotations,
    loadAnnotationsBatch,
    loadGlobalAnnotations,
    loadGlobalAnnotationsBatch
  }
}

/** Per-case / global star and comment writes. */
function bindStarsAndComments(ops: ScopedOps, build: () => string | null) {
  // Toggle star (per-case)
  function toggleStar(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<boolean> {
    return ops.toggleStar(
      { kind: 'case', caseId, variantId, build: build() },
      coordsOf(chr, pos, ref, alt)
    )
  }

  // Toggle global star (for cohort mode)
  function toggleGlobalStar(chr: string, pos: number, ref: string, alt: string): Promise<boolean> {
    return ops.toggleStar(globalScope(build()), coordsOf(chr, pos, ref, alt))
  }

  // Upsert global comment with optimistic update
  function upsertGlobalComment(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    comment: string | null
  ): Promise<boolean> {
    return ops.upsertComment(globalScope(build()), coordsOf(chr, pos, ref, alt), comment)
  }

  // Upsert per-case comment with optimistic update
  function upsertPerCaseComment(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    comment: string | null
  ): Promise<boolean> {
    return ops.upsertComment(
      { kind: 'case', caseId, variantId, build: build() },
      coordsOf(chr, pos, ref, alt),
      comment
    )
  }

  // Delete global comment (sets to null, preserves other fields)
  async function deleteGlobalComment(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<boolean> {
    return upsertGlobalComment(chr, pos, ref, alt, null)
  }

  // Delete per-case comment (sets to null, preserves other fields)
  async function deletePerCaseComment(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<boolean> {
    return upsertPerCaseComment(caseId, variantId, chr, pos, ref, alt, null)
  }

  return {
    toggleStar,
    toggleGlobalStar,
    upsertGlobalComment,
    upsertPerCaseComment,
    deleteGlobalComment,
    deletePerCaseComment
  }
}

/** Per-case / global ACMG classification writes. */
function bindAcmg(ops: ScopedOps, build: () => string | null) {
  // Set ACMG classification with optimistic update (per-case)
  function setAcmgClassification(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null
  ): Promise<boolean> {
    return ops.setAcmgClassification(
      { kind: 'case', caseId, variantId, build: build() },
      coordsOf(chr, pos, ref, alt),
      classification
    )
  }

  // Set global ACMG classification (for cohort mode)
  function setGlobalAcmgClassification(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null
  ): Promise<boolean> {
    return ops.setAcmgClassification(
      globalScope(build()),
      coordsOf(chr, pos, ref, alt),
      classification
    )
  }

  // Set ACMG classification and evidence together (per-case)
  function setAcmgClassificationWithEvidence(
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null,
    evidenceJson: string
  ): Promise<boolean> {
    return ops.setAcmgClassificationWithEvidence(
      { kind: 'case', caseId, variantId, build: build() },
      coordsOf(chr, pos, ref, alt),
      classification,
      evidenceJson
    )
  }

  // Set global ACMG classification and evidence together (cohort mode)
  function setGlobalAcmgClassificationWithEvidence(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null,
    evidenceJson: string
  ): Promise<boolean> {
    return ops.setAcmgClassificationWithEvidence(
      globalScope(build()),
      coordsOf(chr, pos, ref, alt),
      classification,
      evidenceJson
    )
  }

  return {
    setAcmgClassification,
    setGlobalAcmgClassification,
    setAcmgClassificationWithEvidence,
    setGlobalAcmgClassificationWithEvidence
  }
}

export function useAnnotations(options: UseAnnotationsOptions = {}) {
  const { api } = useApiService()
  // A failed write is rolled back; say so, or the user believes it was saved (#486).
  const appState = hasInjectionContext() ? inject(AppStateKey, null) : null
  const ops = createScopedAnnotationOps(api, getUserName, (message) =>
    appState?.showSnack(message ?? 'Annotation not saved. The change was reverted.', 'error')
  )
  const build = buildGetter(options)
  const getters = createAnnotationGetters(build)
  const loads = bindLoads(ops, build)
  const marks = bindStarsAndComments(ops, build)
  const acmg = bindAcmg(ops, build)

  // Key order is part of the pinned public surface — keep it stable.
  return {
    getAnnotations: getters.getAnnotations,
    isStarred: getters.isStarred,
    isGlobalStarred: getters.isGlobalStarred,
    isLoading: getters.isLoading,
    getAcmgClassification: getters.getAcmgClassification,
    getGlobalAcmgClassification: getters.getGlobalAcmgClassification,
    loadAnnotations: loads.loadAnnotations,
    loadAnnotationsBatch: loads.loadAnnotationsBatch,
    loadGlobalAnnotations: loads.loadGlobalAnnotations,
    loadGlobalAnnotationsBatch: loads.loadGlobalAnnotationsBatch,
    toggleStar: marks.toggleStar,
    toggleGlobalStar: marks.toggleGlobalStar,
    // Clear cache (call on case switch)
    clearCache: clearAnnotationCache,
    getGlobalComment: getters.getGlobalComment,
    getPerCaseComment: getters.getPerCaseComment,
    upsertGlobalComment: marks.upsertGlobalComment,
    upsertPerCaseComment: marks.upsertPerCaseComment,
    deleteGlobalComment: marks.deleteGlobalComment,
    deletePerCaseComment: marks.deletePerCaseComment,
    setAcmgClassification: acmg.setAcmgClassification,
    setGlobalAcmgClassification: acmg.setGlobalAcmgClassification,
    getAcmgEvidence: getters.getAcmgEvidence,
    getGlobalAcmgEvidence: getters.getGlobalAcmgEvidence,
    setAcmgClassificationWithEvidence: acmg.setAcmgClassificationWithEvidence,
    setGlobalAcmgClassificationWithEvidence: acmg.setGlobalAcmgClassificationWithEvidence,
    // Page-change guards: drop in-flight batches of the case / cohort table.
    invalidateAnnotationGeneration: () => invalidateAnnotationGeneration('case'),
    invalidateGlobalAnnotationGeneration: () => invalidateAnnotationGeneration('global')
  }
}

/**
 * Reset annotation cache and loading states for testing.
 *
 * Call this in beforeEach() to ensure test isolation.
 * Only exported for testing - not part of the public API.
 */
export function _resetAnnotationsForTesting(): void {
  resetAnnotationState()
}

export {
  ACMG_CLASSIFICATIONS,
  ACMG_COLORS,
  ACMG_ABBREV
} from '../../../shared/config/domain.config'
