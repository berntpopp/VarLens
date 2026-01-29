<template>
  <div class="annotation-scores-section">
    <div class="text-subtitle-2 mb-2">Annotation Scores</div>

    <!-- Database scores (CADD, gnomAD) -->
    <div v-if="isFullVariant" class="d-flex flex-wrap ga-1 mb-2">
      <v-chip :color="getScoreColor('cadd', (variant as Variant).cadd)" size="small" label>
        <span class="font-weight-medium">CADD</span>
        <span class="ml-1">{{ formatScoreValue('cadd', (variant as Variant).cadd) }}</span>
      </v-chip>

      <v-chip
        :color="getScoreColor('gnomad_af', (variant as Variant).gnomad_af)"
        size="small"
        label
      >
        <span class="font-weight-medium">gnomAD</span>
        <span class="ml-1">{{
          formatScoreValue('gnomad_af', (variant as Variant).gnomad_af)
        }}</span>
      </v-chip>
    </div>

    <!-- VEP enrichment scores -->
    <div v-if="vepLoading" class="text-caption text-grey">
      <v-progress-circular indeterminate size="16" width="2" class="mr-1" />
      Loading VEP data...
    </div>

    <div v-else-if="isOffline" class="text-caption text-warning">VEP unavailable - offline</div>

    <div v-else-if="preferredTranscript" class="d-flex flex-wrap ga-1">
      <!-- REVEL -->
      <v-chip
        v-if="preferredTranscript.revel_score !== undefined"
        :color="getScoreColor('revel', preferredTranscript.revel_score)"
        size="small"
        label
      >
        <span class="font-weight-medium">REVEL</span>
        <span class="ml-1">{{ formatScoreValue('revel', preferredTranscript.revel_score) }}</span>
      </v-chip>

      <!-- SpliceAI max delta -->
      <v-chip
        v-if="spliceAiMaxDelta !== null"
        :color="getScoreColor('spliceai', spliceAiMaxDelta)"
        size="small"
        label
      >
        <span class="font-weight-medium">SpliceAI</span>
        <span class="ml-1">{{ formatScoreValue('spliceai', spliceAiMaxDelta) }}</span>
      </v-chip>

      <!-- SIFT -->
      <v-chip
        v-if="preferredTranscript.sift_score !== undefined"
        :color="getSiftColor(preferredTranscript.sift_score)"
        size="small"
        label
      >
        <span class="font-weight-medium">SIFT</span>
        <span class="ml-1">{{ formatScoreValue('sift', preferredTranscript.sift_score) }}</span>
      </v-chip>

      <!-- PolyPhen -->
      <v-chip
        v-if="preferredTranscript.polyphen_score !== undefined"
        :color="getPolyPhenColor(preferredTranscript.polyphen_score)"
        size="small"
        label
      >
        <span class="font-weight-medium">PolyPhen</span>
        <span class="ml-1">{{
          formatScoreValue('polyphen', preferredTranscript.polyphen_score)
        }}</span>
      </v-chip>
    </div>

    <div v-else-if="isFullVariant" class="text-caption text-grey">VEP data unavailable</div>

    <div v-else class="text-caption text-grey">Scores available in Case Analysis mode</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getScoreColor, formatScoreValue } from '../utils/scoreThresholds'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type { VepTranscriptConsequence } from '../../../main/services/api/schemas/vep-response'

interface Props {
  variant: Variant | CohortVariant
  preferredTranscript?: VepTranscriptConsequence | null
  vepLoading?: boolean
  isOffline?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  preferredTranscript: null,
  vepLoading: false,
  isOffline: false
})

/**
 * Check if variant is a full Variant (not CohortVariant)
 */
const isFullVariant = computed(() => {
  return 'cadd' in props.variant
})

// Calculate SpliceAI max delta from 4 delta scores
const spliceAiMaxDelta = computed(() => {
  if (props.preferredTranscript === null) return null
  const t = props.preferredTranscript
  const deltas = [
    t.spliceai_pred_ds_ag,
    t.spliceai_pred_ds_al,
    t.spliceai_pred_ds_dg,
    t.spliceai_pred_ds_dl
  ].filter((d): d is number => d !== undefined)

  if (deltas.length === 0) return null
  return Math.max(...deltas)
})

// SIFT: lower is more deleterious (<=0.05 deleterious)
function getSiftColor(score: number): string {
  if (score <= 0.05) return 'error'
  if (score <= 0.1) return 'warning'
  return 'success'
}

// PolyPhen: higher is more damaging (>=0.85 probably damaging)
function getPolyPhenColor(score: number): string {
  if (score >= 0.85) return 'error'
  if (score >= 0.5) return 'warning'
  return 'success'
}
</script>
