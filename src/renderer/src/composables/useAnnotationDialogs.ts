/**
 * Composable for annotation dialog state management
 *
 * Manages the state and handlers for comment and ACMG evidence dialogs
 * in the variant table. Extracted from VariantTable.vue.
 */

import { ref, computed, nextTick, type Ref } from 'vue'
import type { Variant } from '../../../shared/types/api'
import type { AcmgClassification } from '../../../main/database/types'
import type AcmgEvidenceDialog from '../components/AcmgEvidenceDialog.vue'

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
  ) => Promise<void>
  setAcmgClassification: (
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null
  ) => Promise<void>
  setAcmgClassificationWithEvidence: (
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null,
    evidenceJson: string
  ) => Promise<void>
  upsertGlobalComment: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    comment: string | null
  ) => Promise<void>
  upsertPerCaseComment: (
    caseId: number,
    variantId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    comment: string | null
  ) => Promise<void>
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
}

export function useAnnotationDialogs(caseId: Ref<number>, annotations: AnnotationFunctions) {
  // Comment dialog state
  const commentDialogOpen = ref(false)
  const selectedVariantForComment = ref<Variant | null>(null)

  // ACMG evidence dialog state
  const acmgEvidenceDialogRef = ref<InstanceType<typeof AcmgEvidenceDialog> | null>(null)
  const selectedVariantForAcmg = ref<Variant | null>(null)

  const acmgEvidenceJson = computed(() => {
    const v = selectedVariantForAcmg.value
    if (v === null) return null
    return annotations.getAcmgEvidence(v.chr, v.pos, v.ref, v.alt)
  })

  const acmgVariantData = computed(() => {
    const v = selectedVariantForAcmg.value
    if (v === null) return null
    return {
      gnomad_af: v.gnomad_af ?? null,
      cadd: v.cadd ?? null,
      clinvar: v.clinvar ?? null
    }
  })

  const acmgVariantLabel = computed(() => {
    const v = selectedVariantForAcmg.value
    if (v === null) return ''
    return `${v.chr}:${v.pos} ${v.ref}>${v.alt}${v.gene_symbol !== null ? ` (${v.gene_symbol})` : ''}`
  })

  /** Open comment dialog for a variant */
  const openCommentDialog = (item: Variant) => {
    selectedVariantForComment.value = item
    commentDialogOpen.value = true
  }

  /** Open ACMG evidence dialog for a variant */
  const openAcmgEvidenceDialog = (item: Variant): void => {
    selectedVariantForAcmg.value = item
    nextTick(() => {
      acmgEvidenceDialogRef.value?.open()
    })
  }

  /** Handle star toggle (per-case) */
  const handleStarToggle = async (item: Variant): Promise<void> => {
    await annotations.toggleStar(caseId.value, item.id, item.chr, item.pos, item.ref, item.alt)
  }

  /** Quick ACMG classification (no evidence, just set the classification) */
  const handleQuickAcmgSelect = async (
    item: Variant,
    classification: AcmgClassification | null
  ): Promise<void> => {
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

  /** Handle ACMG evidence change from dialog */
  const handleAcmgEvidenceChange = async (payload: {
    classification: AcmgClassification | null
    evidenceJson: string
  }): Promise<void> => {
    const v = selectedVariantForAcmg.value
    if (v === null) return
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

  /** Handle comment save */
  const handleCommentSave = async (data: {
    globalComment: string | null
    perCaseComment: string | null
    globalChanged: boolean
    perCaseChanged: boolean
  }): Promise<void> => {
    if (!selectedVariantForComment.value) return
    const v = selectedVariantForComment.value

    if (data.globalChanged) {
      await annotations.upsertGlobalComment(v.chr, v.pos, v.ref, v.alt, data.globalComment)
    }
    if (data.perCaseChanged) {
      await annotations.upsertPerCaseComment(
        caseId.value,
        v.id,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        data.perCaseComment
      )
    }

    commentDialogOpen.value = false
  }

  /** Get global timestamps from annotation cache */
  const getGlobalTimestamps = (
    item: Variant | null
  ): { created_at: number; updated_at: number } | null => {
    if (!item) return null
    const ann = annotations.getAnnotations(item.chr, item.pos, item.ref, item.alt)
    if (!ann?.global) return null
    return { created_at: ann.global.created_at, updated_at: ann.global.updated_at }
  }

  /** Get per-case timestamps from annotation cache */
  const getPerCaseTimestamps = (
    item: Variant | null
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
