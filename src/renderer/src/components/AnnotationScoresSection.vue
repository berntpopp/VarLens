<template>
  <div class="annotation-scores-section">
    <div class="text-subtitle-2 mb-2">Annotation Scores</div>
    <div v-if="isFullVariant" class="d-flex flex-wrap ga-1">
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

    <!-- Placeholder for cohort mode or VEP enrichment -->
    <div v-else class="text-caption text-grey">Scores available in Case Analysis mode</div>

    <!-- Placeholder for VEP enrichment (Phase 21) -->
    <div v-if="isFullVariant" class="text-caption text-grey mt-3">
      VEP enrichment: Coming in Phase 21
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getScoreColor, formatScoreValue } from '../utils/scoreThresholds'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'

interface Props {
  variant: Variant | CohortVariant
}

const props = defineProps<Props>()

/**
 * Check if variant is a full Variant (not CohortVariant)
 */
const isFullVariant = computed(() => {
  return 'cadd' in props.variant
})
</script>
