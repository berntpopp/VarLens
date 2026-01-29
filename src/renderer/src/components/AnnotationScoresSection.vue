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

    <!-- API enrichment scores -->
    <div v-if="isLoading" class="text-caption text-grey">
      <v-progress-circular indeterminate size="16" width="2" class="mr-1" />
      Loading enrichment data...
    </div>

    <div v-else-if="isOffline" class="text-caption text-warning">
      Enrichment unavailable - offline
    </div>

    <div v-else class="d-flex flex-wrap ga-1">
      <!-- REVEL (from myvariant.info) -->
      <v-chip v-if="revelScore !== null" :color="getRevelColor(revelScore)" size="small" label>
        <span class="font-weight-medium">REVEL</span>
        <span class="ml-1">{{ revelScore.toFixed(2) }}</span>
      </v-chip>

      <!-- SpliceAI (from Broad Institute API) -->
      <v-chip
        v-if="spliceaiMaxDelta !== null"
        :color="getSpliceAIColor(spliceaiMaxDelta)"
        size="small"
        label
      >
        <span class="font-weight-medium">SpliceAI</span>
        <span class="ml-1">{{ spliceaiMaxDelta.toFixed(2) }}</span>
      </v-chip>

      <!-- SIFT (from VEP) -->
      <v-chip
        v-if="preferredTranscript?.sift_score !== undefined"
        :color="getSiftColor(preferredTranscript.sift_score)"
        size="small"
        label
      >
        <span class="font-weight-medium">SIFT</span>
        <span class="ml-1">{{ preferredTranscript.sift_score.toFixed(2) }}</span>
      </v-chip>

      <!-- PolyPhen (from VEP) -->
      <v-chip
        v-if="preferredTranscript?.polyphen_score !== undefined"
        :color="getPolyPhenColor(preferredTranscript.polyphen_score)"
        size="small"
        label
      >
        <span class="font-weight-medium">PolyPhen</span>
        <span class="ml-1">{{ preferredTranscript.polyphen_score.toFixed(2) }}</span>
      </v-chip>

      <!-- AlphaMissense (from myvariant.info) -->
      <v-chip
        v-if="alphamissenseScore !== null"
        :color="getAlphaMissenseColor(alphamissenseScore)"
        size="small"
        label
      >
        <span class="font-weight-medium">AlphaMissense</span>
        <span class="ml-1">{{ alphamissenseScore.toFixed(2) }}</span>
      </v-chip>
    </div>

    <!-- No scores available message -->
    <div
      v-if="!isLoading && !isOffline && !hasAnyScore && isFullVariant"
      class="text-caption text-grey mt-1"
    >
      No additional scores available for this variant
    </div>

    <div v-if="!isFullVariant && !isLoading" class="text-caption text-grey">
      Scores available in Case Analysis mode
    </div>
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
  revelScore?: number | null
  alphamissenseScore?: number | null
  spliceaiMaxDelta?: number | null
  isLoading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  preferredTranscript: null,
  vepLoading: false,
  isOffline: false,
  revelScore: null,
  alphamissenseScore: null,
  spliceaiMaxDelta: null,
  isLoading: false
})

/**
 * Check if variant is a full Variant (not CohortVariant)
 */
const isFullVariant = computed(() => {
  return 'cadd' in props.variant
})

/**
 * Check if any enrichment score is available
 */
const hasAnyScore = computed(() => {
  return (
    props.revelScore !== null ||
    props.spliceaiMaxDelta !== null ||
    props.alphamissenseScore !== null ||
    props.preferredTranscript?.sift_score !== undefined ||
    props.preferredTranscript?.polyphen_score !== undefined
  )
})

// REVEL: higher is more pathogenic (>=0.644 likely pathogenic per ClinGen)
function getRevelColor(score: number): string {
  if (score >= 0.644) return 'error'
  if (score >= 0.5) return 'warning'
  return 'success'
}

// SpliceAI: higher is more likely splice-altering (>=0.2 high recall, >=0.5 high precision)
function getSpliceAIColor(score: number): string {
  if (score >= 0.5) return 'error'
  if (score >= 0.2) return 'warning'
  return 'success'
}

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

// AlphaMissense: higher is more pathogenic (>=0.564 likely pathogenic per paper)
function getAlphaMissenseColor(score: number): string {
  if (score >= 0.564) return 'error'
  if (score >= 0.34) return 'warning'
  return 'success'
}
</script>
