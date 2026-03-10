<template>
  <v-snackbar v-model="snackbar.visible" :color="snackbar.color" :timeout="3000" location="bottom">
    {{ snackbar.message }}
  </v-snackbar>

  <CommentDialog
    v-model="commentDialogOpen"
    :global-comment="
      selectedVariantForComment
        ? getGlobalComment(
            selectedVariantForComment.chr,
            selectedVariantForComment.pos,
            selectedVariantForComment.ref,
            selectedVariantForComment.alt
          )
        : null
    "
    :per-case-comment="
      selectedVariantForComment
        ? getPerCaseComment(
            selectedVariantForComment.chr,
            selectedVariantForComment.pos,
            selectedVariantForComment.ref,
            selectedVariantForComment.alt
          )
        : null
    "
    :global-timestamps="getGlobalTimestamps(selectedVariantForComment)"
    :per-case-timestamps="getPerCaseTimestamps(selectedVariantForComment)"
    @save="handleCommentSave"
  />

  <AcmgEvidenceDialog
    ref="acmgEvidenceDialogRef"
    :evidence-json="acmgEvidenceJson"
    :variant-data="acmgVariantData"
    :variant-label="acmgVariantLabel"
    :variant-cdna="selectedVariantForAcmg?.cdna ?? null"
    :variant-aa-change="selectedVariantForAcmg?.aa_change ?? null"
    @change="handleAcmgEvidenceChange"
  />
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import CommentDialog from '../CommentDialog.vue'
import AcmgEvidenceDialog from '../AcmgEvidenceDialog.vue'
import { useAnnotationDialogs } from '../../composables/useAnnotationDialogs'
import { useVariantLinks } from '../../composables/useVariantLinks'
import type { useAnnotations } from '../../composables/useAnnotations'

interface Props {
  caseId: number
  annotationActions: {
    getAcmgEvidence: ReturnType<typeof useAnnotations>['getAcmgEvidence']
    toggleStar: ReturnType<typeof useAnnotations>['toggleStar']
    setAcmgClassification: ReturnType<typeof useAnnotations>['setAcmgClassification']
    setAcmgClassificationWithEvidence: ReturnType<
      typeof useAnnotations
    >['setAcmgClassificationWithEvidence']
    upsertGlobalComment: ReturnType<typeof useAnnotations>['upsertGlobalComment']
    upsertPerCaseComment: ReturnType<typeof useAnnotations>['upsertPerCaseComment']
    getAnnotations: ReturnType<typeof useAnnotations>['getAnnotations']
    getGlobalComment: ReturnType<typeof useAnnotations>['getGlobalComment']
    getPerCaseComment: ReturnType<typeof useAnnotations>['getPerCaseComment']
  }
}

const props = defineProps<Props>()

const { snackbar } = useVariantLinks()

const {
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
} = useAnnotationDialogs(toRef(props, 'caseId'), {
  getAcmgEvidence: props.annotationActions.getAcmgEvidence,
  toggleStar: props.annotationActions.toggleStar,
  setAcmgClassification: props.annotationActions.setAcmgClassification,
  setAcmgClassificationWithEvidence: props.annotationActions.setAcmgClassificationWithEvidence,
  upsertGlobalComment: props.annotationActions.upsertGlobalComment,
  upsertPerCaseComment: props.annotationActions.upsertPerCaseComment,
  getAnnotations: props.annotationActions.getAnnotations
})

// Re-export getGlobalComment/getPerCaseComment from annotation actions for template
const { getGlobalComment, getPerCaseComment } = props.annotationActions

// acmgEvidenceDialogRef is used as template ref
void acmgEvidenceDialogRef

defineExpose({
  openCommentDialog,
  openAcmgEvidenceDialog,
  handleStarToggle,
  handleQuickAcmgSelect
})
</script>
