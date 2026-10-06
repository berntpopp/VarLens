/**
 * Composable for precomputing variant row display state
 *
 * Builds a Map<variant.id, RowViewModel> from the current page's variants,
 * annotation cache, and link configuration. Template slots read from this map
 * by row id instead of calling per-cell functions on every render.
 *
 * Rows are keyed by `variant.id`, NOT by locus: one locus can appear on
 * several rows (different transcripts/genes/consequences), and a locus key
 * would collapse them onto a single cached row. Annotations, however, are
 * locus-scoped, so the annotation cache is still looked up by chr:pos:ref:alt.
 *
 * This turns O(rows × columns × function calls) into O(rows) for annotation
 * and link lookups.
 */

import { computed, type Ref, type ShallowRef } from 'vue'
import type { AcmgClassification } from '../../../../shared/config/domain.config'
import type { Variant } from '../../../../shared/types/api'

export interface RowViewModel {
  links: Record<string, string | null>
  isStarred: boolean
  isGlobalStarred: boolean
  acmgClassification: AcmgClassification | null
  globalAcmgClassification: AcmgClassification | null
  hasComment: boolean
  hasGlobalComment: boolean
}

export interface LinkConfig {
  id: string
  resolve: (item: Variant) => string | null
}

type AnnotationEntry = {
  perCase: {
    starred?: number
    acmg_classification?: AcmgClassification | null
    per_case_comment?: string | null
    /** short-form alias used in tests */
    comment?: string | null
  } | null
  global: {
    starred?: number
    acmg_classification?: AcmgClassification | null
    global_comment?: string | null
    /** short-form alias used in tests */
    comment?: string | null
  } | null
}

function variantKey(chr: string, pos: number, ref: string, alt: string): string {
  return `${chr}:${pos}:${ref}:${alt}`
}

interface ReadableMap<K, V> {
  get(key: K): V | undefined
}

export function buildRowViewModels(
  variants: Variant[],
  annotationCache: ReadableMap<string, AnnotationEntry>,
  linkConfig: Record<string, LinkConfig>,
  previous: Map<number, RowViewModel> = new Map()
): Map<number, RowViewModel> {
  const map = new Map<number, RowViewModel>()

  for (const v of variants) {
    const key = v.id
    const ann = annotationCache.get(variantKey(v.chr, v.pos, v.ref, v.alt))
    const perCase = ann?.perCase ?? null
    const global = ann?.global ?? null

    const links: Record<string, string | null> = {}
    for (const [column, config] of Object.entries(linkConfig)) {
      links[column] = config.resolve(v)
    }

    // Support both the DB field names and the short 'comment' form used in tests
    const perCaseComment = perCase ? (perCase.per_case_comment ?? perCase.comment ?? null) : null
    const globalComment = global ? (global.global_comment ?? global.comment ?? null) : null
    const nextModel: RowViewModel = {
      links,
      isStarred: (perCase?.starred ?? 0) === 1,
      isGlobalStarred: (global?.starred ?? 0) === 1,
      acmgClassification: perCase?.acmg_classification ?? null,
      globalAcmgClassification: global?.acmg_classification ?? null,
      hasComment: perCaseComment !== null && perCaseComment !== '',
      hasGlobalComment: globalComment !== null && globalComment !== ''
    }
    const previousModel = previous.get(key)

    if (
      previousModel &&
      previousModel.isStarred === nextModel.isStarred &&
      previousModel.isGlobalStarred === nextModel.isGlobalStarred &&
      previousModel.acmgClassification === nextModel.acmgClassification &&
      previousModel.globalAcmgClassification === nextModel.globalAcmgClassification &&
      previousModel.hasComment === nextModel.hasComment &&
      previousModel.hasGlobalComment === nextModel.hasGlobalComment &&
      sameLinks(previousModel.links, nextModel.links)
    ) {
      map.set(key, previousModel)
      continue
    }

    map.set(key, nextModel)
  }

  return map
}

function sameLinks(
  previousLinks: Record<string, string | null>,
  nextLinks: Record<string, string | null>
): boolean {
  const previousKeys = Object.keys(previousLinks)
  const nextKeys = Object.keys(nextLinks)
  if (previousKeys.length !== nextKeys.length) return false

  for (const key of nextKeys) {
    if (previousLinks[key] !== nextLinks[key]) {
      return false
    }
  }

  return true
}

export function useVariantRowViewModel(
  variants: Ref<Variant[]>,
  annotationCache: ShallowRef<ReadableMap<string, AnnotationEntry>>,
  linkConfig: Ref<Record<string, LinkConfig>>
) {
  const rowViewModels = computed<Map<number, RowViewModel>>(
    (previous?: Map<number, RowViewModel>) =>
      buildRowViewModels(variants.value, annotationCache.value, linkConfig.value, previous)
  )

  function getViewModel(variantId: number): RowViewModel | undefined {
    return rowViewModels.value.get(variantId)
  }

  return { rowViewModels, getViewModel }
}
