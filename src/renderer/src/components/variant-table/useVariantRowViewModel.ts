/**
 * Composable for precomputing variant row display state
 *
 * Builds a Map<variantKey, RowViewModel> from the current page's variants,
 * annotation cache, and link configuration. Template slots read from this map
 * by variant key instead of calling per-cell functions on every render.
 *
 * This turns O(rows × columns × function calls) into O(rows) for annotation
 * and link lookups.
 */

import { computed, type Ref, type ShallowRef } from 'vue'
import type { AcmgClassification, Variant } from '../../../../main/database/types'

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
  linkConfig: Record<string, LinkConfig>
): Map<string, RowViewModel> {
  const map = new Map<string, RowViewModel>()

  for (const v of variants) {
    const key = variantKey(v.chr, v.pos, v.ref, v.alt)
    const ann = annotationCache.get(key)
    const perCase = ann?.perCase ?? null
    const global = ann?.global ?? null

    const links: Record<string, string | null> = {}
    for (const [column, config] of Object.entries(linkConfig)) {
      links[column] = config.resolve(v)
    }

    // Support both the DB field names and the short 'comment' form used in tests
    const perCaseComment = perCase ? (perCase.per_case_comment ?? perCase.comment ?? null) : null
    const globalComment = global ? (global.global_comment ?? global.comment ?? null) : null

    map.set(key, {
      links,
      isStarred: (perCase?.starred ?? 0) === 1,
      isGlobalStarred: (global?.starred ?? 0) === 1,
      acmgClassification: perCase?.acmg_classification ?? null,
      globalAcmgClassification: global?.acmg_classification ?? null,
      hasComment: perCaseComment !== null && perCaseComment !== '',
      hasGlobalComment: globalComment !== null && globalComment !== ''
    })
  }

  return map
}

export function useVariantRowViewModel(
  variants: Ref<Variant[]>,
  annotationCache: ShallowRef<ReadableMap<string, AnnotationEntry>>,
  linkConfig: Ref<Record<string, LinkConfig>>
) {
  const rowViewModels = computed(() =>
    buildRowViewModels(variants.value, annotationCache.value, linkConfig.value)
  )

  function getViewModel(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): RowViewModel | undefined {
    return rowViewModels.value.get(variantKey(chr, pos, ref, alt))
  }

  return { rowViewModels, getViewModel }
}
