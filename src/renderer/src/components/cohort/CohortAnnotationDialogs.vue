<template>
  <!-- Comment Dialog -->
  <CommentDialog
    v-model="commentDialogOpen"
    :global-comment="selectedVariantComment"
    :per-case-comment="null"
    :global-timestamps="selectedVariantTimestamps"
    :per-case-timestamps="null"
    @save="handleCommentSave"
  />

  <!-- ACMG Evidence Dialog -->
  <AcmgEvidenceDialog
    ref="acmgEvidenceDialogRef"
    :evidence-json="acmgEvidenceJson"
    :variant-data="acmgVariantData"
    :variant-label="acmgVariantLabel"
    :variant-cdna="selectedVariantForAcmg?.cdna ?? null"
    :variant-aa-change="selectedVariantForAcmg?.aa_change ?? null"
    @change="handleAcmgEvidenceChange"
  />

  <!-- Success Snackbar -->
  <v-snackbar
    v-model="snackbar.visible"
    :color="snackbar.color"
    :timeout="snackbar.timeout"
    location="bottom right"
  >
    {{ snackbar.message }}
    <template #actions>
      <v-btn v-if="snackbar.actionText" variant="text" @click="snackbar.actionCallback?.()">
        {{ snackbar.actionText }}
      </v-btn>
      <v-btn variant="text" @click="snackbar.visible = false">Close</v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import CommentDialog from '../CommentDialog.vue'
import AcmgEvidenceDialog from '../AcmgEvidenceDialog.vue'
import type { CohortVariant } from '../../../../shared/types/cohort'
import type { AcmgClassification } from '../../../../main/database/types'
import type { useAnnotations } from '../../composables/useAnnotations'
import type { useFilters } from '../../composables/useFilters'
import { useApiService } from '../../composables/useApiService'

interface Props {
  annotationActions: {
    toggleGlobalStar: ReturnType<typeof useAnnotations>['toggleGlobalStar']
    setGlobalAcmgClassification: ReturnType<typeof useAnnotations>['setGlobalAcmgClassification']
    setGlobalAcmgClassificationWithEvidence: ReturnType<
      typeof useAnnotations
    >['setGlobalAcmgClassificationWithEvidence']
    upsertGlobalComment: ReturnType<typeof useAnnotations>['upsertGlobalComment']
    getGlobalAcmgEvidence: ReturnType<typeof useAnnotations>['getGlobalAcmgEvidence']
    getGlobalComment: ReturnType<typeof useAnnotations>['getGlobalComment']
    getAnnotations: ReturnType<typeof useAnnotations>['getAnnotations']
  }
  filterState: {
    searchTerm: ReturnType<typeof useFilters>['searchTerm']
    filters: ReturnType<typeof useFilters>['filters']
    selectedImpactPresets: ReturnType<typeof useFilters>['selectedImpactPresets']
  }
}

const props = defineProps<Props>()

const { api } = useApiService()

// Comment dialog state
const commentDialogOpen = ref(false)
const selectedVariantForComment = ref<CohortVariant | null>(null)

// ACMG evidence dialog state
const acmgEvidenceDialogRef = ref<InstanceType<typeof AcmgEvidenceDialog> | null>(null)
const selectedVariantForAcmg = ref<CohortVariant | null>(null)

const acmgEvidenceJson = computed(() => {
  const v = selectedVariantForAcmg.value
  if (v === null) return null
  return props.annotationActions.getGlobalAcmgEvidence(v.chr, v.pos, v.ref, v.alt)
})

const acmgVariantData = computed(() => {
  const v = selectedVariantForAcmg.value
  if (v === null) return null
  return {
    gnomad_af: v.gnomad_af ?? null,
    cadd: v.cadd_phred ?? null,
    clinvar: v.clinvar ?? null
  }
})

const acmgVariantLabel = computed(() => {
  const v = selectedVariantForAcmg.value
  if (v === null) return ''
  return `${v.chr}:${v.pos} ${v.ref}>${v.alt}${v.gene_symbol !== null ? ` (${v.gene_symbol})` : ''}`
})

// Export state
const exporting = ref(false)
const snackbar = ref({
  visible: false,
  message: '',
  color: 'success' as 'success' | 'error',
  timeout: 3000,
  actionText: null as string | null,
  actionCallback: null as (() => void) | null
})

// Computed properties for comment dialog
const selectedVariantComment = computed(() => {
  if (!selectedVariantForComment.value) return null
  return props.annotationActions.getGlobalComment(
    selectedVariantForComment.value.chr,
    selectedVariantForComment.value.pos,
    selectedVariantForComment.value.ref,
    selectedVariantForComment.value.alt
  )
})

const selectedVariantTimestamps = computed(() => {
  if (!selectedVariantForComment.value) return null
  const annotations = props.annotationActions.getAnnotations(
    selectedVariantForComment.value.chr,
    selectedVariantForComment.value.pos,
    selectedVariantForComment.value.ref,
    selectedVariantForComment.value.alt
  )
  if (!annotations?.global) return null
  return { created_at: annotations.global.created_at, updated_at: annotations.global.updated_at }
})

// --- Exposed methods ---

const handleStarToggle = async (item: CohortVariant): Promise<void> => {
  await props.annotationActions.toggleGlobalStar(item.chr, item.pos, item.ref, item.alt)
}

const handleAcmgSelect = async (payload: {
  item: CohortVariant
  classification: AcmgClassification | null
}): Promise<void> => {
  await props.annotationActions.setGlobalAcmgClassification(
    payload.item.chr,
    payload.item.pos,
    payload.item.ref,
    payload.item.alt,
    payload.classification
  )
}

const openAcmgEvidenceDialog = (item: CohortVariant): void => {
  selectedVariantForAcmg.value = item
  nextTick(() => {
    acmgEvidenceDialogRef.value?.open()
  })
}

const handleAcmgEvidenceChange = async (payload: {
  classification: AcmgClassification | null
  evidenceJson: string
}): Promise<void> => {
  const v = selectedVariantForAcmg.value
  if (v === null) return
  await props.annotationActions.setGlobalAcmgClassificationWithEvidence(
    v.chr,
    v.pos,
    v.ref,
    v.alt,
    payload.classification,
    payload.evidenceJson
  )
}

const openCommentDialog = (item: CohortVariant): void => {
  selectedVariantForComment.value = item
  commentDialogOpen.value = true
}

const handleCommentSave = async (data: {
  globalComment: string | null
  perCaseComment: string | null
  globalChanged: boolean
  perCaseChanged: boolean
}): Promise<void> => {
  if (!selectedVariantForComment.value) return
  const item = selectedVariantForComment.value

  // In cohort mode, only save global comments
  if (data.globalChanged) {
    await props.annotationActions.upsertGlobalComment(
      item.chr,
      item.pos,
      item.ref,
      item.alt,
      data.globalComment
    )
  }

  commentDialogOpen.value = false
}

const exportToExcel = async (): Promise<void> => {
  // Guard for browser dev mode (no preload)
  if (!api) {
    // eslint-disable-next-line no-undef
    console.warn('API not available - running outside Electron')
    return
  }

  exporting.value = true
  try {
    const { searchTerm, filters, selectedImpactPresets } = props.filterState

    // Build export params without pagination
    const exportParams = {
      search_term: searchTerm.value || undefined,
      gene_symbol: filters.value.geneSymbol || undefined,
      consequences:
        selectedImpactPresets.value.length > 0 ? selectedImpactPresets.value : undefined,
      funcs: filters.value.funcs.length > 0 ? filters.value.funcs : undefined,
      clinvars: filters.value.clinvars.length > 0 ? filters.value.clinvars : undefined,
      gnomad_af_max: filters.value.maxGnomadAf ?? undefined,
      cadd_min: filters.value.minCadd ?? undefined,
      cohort_frequency_min: filters.value.minCohortFrequency ?? undefined
    }

    // Deep clone to strip Vue proxies
    const plainParams = globalThis.structuredClone(exportParams)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).export.cohort(plainParams)

    if (result !== null && result !== undefined && 'code' in result) {
      snackbar.value = {
        visible: true,
        message: `Export failed: ${result.message ?? result.userMessage ?? 'Unknown error'}`,
        color: 'error',
        timeout: -1,
        actionText: null,
        actionCallback: null
      }
    } else if (result !== null && result !== undefined && result.success === true) {
      snackbar.value = {
        visible: true,
        message: `Exported to ${result.filePath}`,
        color: 'success',
        timeout: 3000,
        actionText: 'Open folder',
        actionCallback: () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(api as any).shell.showItemInFolder(result.filePath)
        }
      }
    }
  } finally {
    exporting.value = false
  }
}

// Suppress unused ref warning - acmgEvidenceDialogRef is used as template ref
void acmgEvidenceDialogRef.value

defineExpose({
  openCommentDialog,
  openAcmgEvidenceDialog,
  handleStarToggle,
  handleAcmgSelect,
  exportToExcel,
  exporting
})
</script>
