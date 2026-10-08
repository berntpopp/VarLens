/**
 * Composable for annotation dialog state management
 *
 * Manages the state and handlers for comment and ACMG evidence dialogs
 * in the variant table. Extracted from VariantTable.vue.
 */

import { ref, computed, nextTick, type Ref } from 'vue'
import type { Variant } from '../../../shared/types/api'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import type AcmgEvidenceDialog from '../components/AcmgEvidenceDialog.vue'
import type { AnnotationScope, AnnotationTarget } from '../../../shared/types/annotations'

type DialogVariant = Variant | AnnotationTarget

/** The annotation composable return type (subset used here) */
interface AnnotationFunctions {
  getAcmgEvidence: (chr: string, pos: number, ref: string, alt: string) => string | null
  toggleStar: (
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<boolean>
  setAcmgClassification: (
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null
  ) => Promise<boolean>
  setAcmgClassificationWithEvidence: (
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null,
    evidenceJson: string
  ) => Promise<boolean>
  upsertGlobalComment: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    comment: string | null
  ) => Promise<boolean>
  upsertPerCaseComment: (
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    comment: string | null
  ) => Promise<boolean>
  getAnnotations: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) =>
    | {
        global: { created_at: number; updated_at: number } | null
        perCase: { created_at: number; updated_at: number } | null
      }
    | undefined
  // Global variants (used when scope === 'all' or in cohort mode)
  toggleGlobalStar?: (chr: string, pos: number, ref: string, alt: string) => Promise<boolean>
  setGlobalAcmgClassification?: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null
  ) => Promise<boolean>
  setGlobalAcmgClassificationWithEvidence?: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null,
    evidenceJson: string
  ) => Promise<boolean>
  getGlobalAcmgEvidence?: (chr: string, pos: number, ref: string, alt: string) => string | null
  getGlobalComment?: (chr: string, pos: number, ref: string, alt: string) => string | null
  getPerCaseComment?: (chr: string, pos: number, ref: string, alt: string) => string | null
}

export function useAnnotationDialogs(
  caseId: Ref<number | null>,
  annotations: AnnotationFunctions,
  scope?: Ref<AnnotationScope>
) {
  // Comment dialog state
  const commentDialogOpen = ref(false)
  const selectedVariantForComment = ref<DialogVariant | null>(null)

  // ACMG evidence dialog state
  const acmgEvidenceDialogRef = ref<InstanceType<typeof AcmgEvidenceDialog> | null>(null)
  const selectedVariantForAcmg = ref<DialogVariant | null>(null)

  const acmgEvidenceJson = computed(() => {
    const v = selectedVariantForAcmg.value
    if (v === null) return null
    const effectiveScope = scope?.value ?? 'case'
    if (effectiveScope === 'all' && annotations.getGlobalAcmgEvidence) {
      return annotations.getGlobalAcmgEvidence(v.chr, v.pos, v.ref, v.alt)
    }
    return annotations.getAcmgEvidence(v.chr, v.pos, v.ref, v.alt)
  })

  const acmgVariantData = computed(() => {
    const v = selectedVariantForAcmg.value
    if (v === null) return null
    return {
      gnomad_af: v.gnomad_af ?? null,
      cadd: v.cadd ?? ('cadd_phred' in v ? v.cadd_phred : null) ?? null,
      clinvar: v.clinvar ?? null
    }
  })

  const acmgVariantLabel = computed(() => {
    const v = selectedVariantForAcmg.value
    if (v === null) return ''
    return `${v.chr}:${v.pos} ${v.ref}>${v.alt}${v.gene_symbol != null ? ` (${v.gene_symbol})` : ''}`
  })

  /** Open comment dialog for a variant */
  const openCommentDialog = (item: DialogVariant) => {
    selectedVariantForComment.value = item
    commentDialogOpen.value = true
  }

  /** Open ACMG evidence dialog for a variant */
  const openAcmgEvidenceDialog = (item: DialogVariant): void => {
    selectedVariantForAcmg.value = item
    nextTick(() => {
      acmgEvidenceDialogRef.value?.open()
    })
  }

  /** Handle star toggle (per-case or global depending on scope) */
  const handleStarToggle = async (item: DialogVariant): Promise<void> => {
    const effectiveScope = scope?.value ?? 'case'
    if (effectiveScope === 'all' && annotations.toggleGlobalStar) {
      await annotations.toggleGlobalStar(item.chr, item.pos, item.ref, item.alt)
    } else if (caseId.value !== null && item.id !== undefined) {
      await annotations.toggleStar(caseId.value, item.id, item.chr, item.pos, item.ref, item.alt)
    }
  }

  /** Quick ACMG classification (no evidence, just set the classification) */
  const handleQuickAcmgSelect = async (
    item: DialogVariant,
    classification: AcmgClassification | null
  ): Promise<void> => {
    const effectiveScope = scope?.value ?? 'case'
    if (effectiveScope === 'all' && annotations.setGlobalAcmgClassification) {
      await annotations.setGlobalAcmgClassification(
        item.chr,
        item.pos,
        item.ref,
        item.alt,
        classification
      )
    } else if (caseId.value !== null && item.id !== undefined) {
      await annotations.setAcmgClassification(
        caseId.value,
        item.id,
        item.chr,
        item.pos,
        item.ref,
        item.alt,
        classification
      )
    }
  }

  /** Handle ACMG evidence change from dialog */
  const handleAcmgEvidenceChange = async (payload: {
    classification: AcmgClassification | null
    evidenceJson: string
  }): Promise<void> => {
    const v = selectedVariantForAcmg.value
    if (v === null) return
    const effectiveScope = scope?.value ?? 'case'
    if (effectiveScope === 'all' && annotations.setGlobalAcmgClassificationWithEvidence) {
      await annotations.setGlobalAcmgClassificationWithEvidence(
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        payload.classification,
        payload.evidenceJson
      )
    } else if (caseId.value !== null && v.id !== undefined) {
      await annotations.setAcmgClassificationWithEvidence(
        caseId.value,
        v.id,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        payload.classification,
        payload.evidenceJson
      )
    }
  }

  /** Handle comment save */
  const handleCommentSave = async (data: {
    globalComment: string | null
    perCaseComment: string | null
    globalChanged: boolean
    perCaseChanged: boolean
  }): Promise<void> => {
    if (!selectedVariantForComment.value) return
    const v = selectedVariantForComment.value
    const effectiveScope = scope?.value ?? 'case'

    // A failed save keeps the dialog open, so the typed comment is not lost (#486).
    if (
      data.globalChanged &&
      !(await annotations.upsertGlobalComment(v.chr, v.pos, v.ref, v.alt, data.globalComment))
    ) {
      return
    }
    if (
      data.perCaseChanged &&
      effectiveScope === 'case' &&
      caseId.value !== null &&
      v.id !== undefined
    ) {
      const saved = await annotations.upsertPerCaseComment(
        caseId.value,
        v.id,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        data.perCaseComment
      )
      if (!saved) return
    }

    commentDialogOpen.value = false
  }

  /** Get global timestamps from annotation cache */
  const getGlobalTimestamps = (
    item: DialogVariant | null
  ): { created_at: number; updated_at: number } | null => {
    if (!item) return null
    const ann = annotations.getAnnotations(item.chr, item.pos, item.ref, item.alt)
    if (!ann?.global) return null
    return { created_at: ann.global.created_at, updated_at: ann.global.updated_at }
  }

  /** Get per-case timestamps from annotation cache */
  const getPerCaseTimestamps = (
    item: DialogVariant | null
  ): { created_at: number; updated_at: number } | null => {
    if (!item) return null
    const ann = annotations.getAnnotations(item.chr, item.pos, item.ref, item.alt)
    if (!ann?.perCase) return null
    return { created_at: ann.perCase.created_at, updated_at: ann.perCase.updated_at }
  }

  return {
    commentDialogOpen,
    selectedVariantForComment,
    selectedVariantForAcmg,
    acmgEvidenceDialogRef,
    acmgEvidenceJson,
    acmgVariantData,
    acmgVariantLabel,
    openCommentDialog,
    openAcmgEvidenceDialog,
    handleStarToggle,
    handleQuickAcmgSelect,
    handleAcmgEvidenceChange,
    handleCommentSave,
    getGlobalTimestamps,
    getPerCaseTimestamps
  }
}
