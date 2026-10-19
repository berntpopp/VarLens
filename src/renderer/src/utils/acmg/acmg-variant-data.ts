import { ref, computed, watch, type Ref } from 'vue'
import type { Variant } from '../../../../shared/types/api'
import type { CohortVariant } from '../../../../shared/types/cohort'
import { generateSuggestions, type VariantAnnotationData } from './acmg-suggestions'

export function buildAcmgVariantData(
  variant: Variant | CohortVariant | null,
  revelFallback?: number | null,
  spliceAiFallback?: number | null
): VariantAnnotationData | null {
  if (!variant) return null
  const v = variant as unknown as Record<string, unknown>
  return {
    gnomad_af: variant.gnomad_af ?? null,
    cadd: 'cadd' in variant ? (variant.cadd ?? null) : (variant.cadd_phred ?? null),
    clinvar: variant.clinvar ?? null,
    revel:
      ('revel' in v && v.revel !== undefined ? (v.revel as number | null) : null) ??
      revelFallback ??
      null,
    spliceai_max:
      ('spliceai_max' in v && v.spliceai_max !== undefined
        ? (v.spliceai_max as number | null)
        : null) ??
      spliceAiFallback ??
      null
  }
}

export function buildAcmgVariantKey(
  variant: Variant | CohortVariant | null,
  caseId?: number | null
): string | null {
  if (!variant) return null
  const build = 'genome_build' in variant ? (variant.genome_build ?? '') : ''
  return `${caseId ?? ''}:${build}:${variant.chr}:${variant.pos}:${variant.ref}:${variant.alt}`
}

export interface UseVariantAcmgPreviewOptions {
  variant: Ref<Variant | CohortVariant | null>
  caseId: Ref<number | null>
  revelFallback?: Ref<number | null>
  spliceAiFallback?: Ref<number | null>
}

export function useVariantAcmgPreview(options: UseVariantAcmgPreviewOptions) {
  const currentVariantData = computed<VariantAnnotationData | null>(() =>
    buildAcmgVariantData(
      options.variant.value,
      options.revelFallback?.value,
      options.spliceAiFallback?.value
    )
  )

  const variantKey = computed<string | null>(() =>
    buildAcmgVariantKey(options.variant.value, options.caseId.value)
  )

  const suggestedAcmgCodes = computed<string[]>(() => {
    if (!currentVariantData.value) return []
    return generateSuggestions(currentVariantData.value).map((s) => s.code)
  })

  const acmgExpanded = ref<number | undefined>(undefined)

  const acmgPanelRef = ref<{
    confirmLeave: () => Promise<boolean> | null
    applySuggestions?: () => void
  } | null>(null)

  const pendingSuggestedStaging = ref<string | null>(null)

  watch(acmgPanelRef, (panel) => {
    if (panel !== null && pendingSuggestedStaging.value === variantKey.value) {
      panel.applySuggestions?.()
      pendingSuggestedStaging.value = null
    }
  })

  watch(variantKey, () => {
    pendingSuggestedStaging.value = null
  })

  const handleApplySuggestionsPreview = (): void => {
    acmgExpanded.value = 0
    const key = variantKey.value
    if (key === null) return

    const panel = acmgPanelRef.value
    if (panel !== null) {
      panel.applySuggestions?.()
      pendingSuggestedStaging.value = null
    } else {
      pendingSuggestedStaging.value = key
    }
  }

  return {
    currentVariantData,
    variantKey,
    suggestedAcmgCodes,
    acmgExpanded,
    acmgPanelRef,
    handleApplySuggestionsPreview
  }
}
