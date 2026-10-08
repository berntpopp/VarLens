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
      effectiveScope === 'case' && selectedVariantForComment
        ? getPerCaseComment(
            selectedVariantForComment.chr,
            selectedVariantForComment.pos,
            selectedVariantForComment.ref,
            selectedVariantForComment.alt
          )
        : null
    "
    :global-timestamps="getGlobalTimestamps(selectedVariantForComment)"
    :per-case-timestamps="
      effectiveScope === 'case' ? getPerCaseTimestamps(selectedVariantForComment) : null
    "
    @save="handleCommentSave"
  />

  <AcmgEvidenceDialog
    ref="acmgEvidenceDialogRef"
    :evidence-json="acmgEvidenceJson"
    :variant-data="acmgVariantData"
    :variant-label="acmgVariantLabel"
    :variant-cdna="selectedVariantForAcmg?.cdna ?? null"
    :variant-aa-change="selectedVariantForAcmg?.aa_change ?? null"
    :save="handleAcmgEvidenceChange"
  />
</template>

<script setup lang="ts">
import { toRef, computed } from 'vue'
import CommentDialog from './CommentDialog.vue'
import AcmgEvidenceDialog from './AcmgEvidenceDialog.vue'
import { useAnnotationDialogs } from '../composables/useAnnotationDialogs'
import { useVariantLinks } from '../composables/useVariantLinks'
import type { useAnnotations } from '../composables/useAnnotations'
import type { AnnotationScope } from '../../../shared/types/annotations'

interface Props {
  caseId: number | null
  annotationScope?: AnnotationScope
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
    // Global methods (used when scope === 'all')
    toggleGlobalStar?: ReturnType<typeof useAnnotations>['toggleGlobalStar']
    setGlobalAcmgClassification?: ReturnType<typeof useAnnotations>['setGlobalAcmgClassification']
    setGlobalAcmgClassificationWithEvidence?: ReturnType<
      typeof useAnnotations
    >['setGlobalAcmgClassificationWithEvidence']
    getGlobalAcmgEvidence?: ReturnType<typeof useAnnotations>['getGlobalAcmgEvidence']
  }
}

const props = withDefaults(defineProps<Props>(), {
  annotationScope: 'case'
})

const emit = defineEmits<{
  changed: []
}>()

const effectiveScope = computed(() => props.annotationScope)

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
  handleStarToggle: persistStarToggle,
  handleQuickAcmgSelect: persistQuickAcmgSelect,
  handleAcmgEvidenceChange: persistAcmgEvidenceChange,
  handleCommentSave: persistCommentSave,
  getGlobalTimestamps,
  getPerCaseTimestamps
} = useAnnotationDialogs(
  toRef(props, 'caseId'),
  {
    getAcmgEvidence: props.annotationActions.getAcmgEvidence,
    toggleStar: props.annotationActions.toggleStar,
    setAcmgClassification: props.annotationActions.setAcmgClassification,
    setAcmgClassificationWithEvidence: props.annotationActions.setAcmgClassificationWithEvidence,
    upsertGlobalComment: props.annotationActions.upsertGlobalComment,
    upsertPerCaseComment: props.annotationActions.upsertPerCaseComment,
    getAnnotations: props.annotationActions.getAnnotations,
    toggleGlobalStar: props.annotationActions.toggleGlobalStar,
    setGlobalAcmgClassification: props.annotationActions.setGlobalAcmgClassification,
    setGlobalAcmgClassificationWithEvidence:
      props.annotationActions.setGlobalAcmgClassificationWithEvidence,
    getGlobalAcmgEvidence: props.annotationActions.getGlobalAcmgEvidence,
    getGlobalComment: props.annotationActions.getGlobalComment,
    getPerCaseComment: props.annotationActions.getPerCaseComment
  },
  effectiveScope
)

// Re-export comment accessors for template
const { getGlobalComment, getPerCaseComment } = props.annotationActions

// Suppress unused ref warning
void acmgEvidenceDialogRef

async function handleStarToggle(item: Parameters<typeof persistStarToggle>[0]): Promise<void> {
  await persistStarToggle(item)
  emit('changed')
}

async function handleQuickAcmgSelect(
  item: Parameters<typeof persistQuickAcmgSelect>[0],
  classification: Parameters<typeof persistQuickAcmgSelect>[1]
): Promise<void> {
  await persistQuickAcmgSelect(item, classification)
  emit('changed')
}

async function handleAcmgEvidenceChange(
  payload: Parameters<typeof persistAcmgEvidenceChange>[0]
): Promise<boolean> {
  const saved = await persistAcmgEvidenceChange(payload)
  emit('changed')
  return saved
}

async function handleCommentSave(payload: Parameters<typeof persistCommentSave>[0]): Promise<void> {
  await persistCommentSave(payload)
  if (payload.globalChanged || payload.perCaseChanged) emit('changed')
}

defineExpose({
  openCommentDialog,
  openAcmgEvidenceDialog,
  handleStarToggle,
  handleQuickAcmgSelect
})
</script>
