<template>
  <!-- At a Glance: 4 tonal stat cards -->
  <div class="text-title-small mb-2">
    <v-icon size="small" class="mr-1">mdi-chart-bar</v-icon>
    At a Glance
  </div>
  <v-row density="compact" class="mb-2">
    <v-col cols="3">
      <v-card variant="tonal" class="text-center pa-3">
        <v-icon size="24" class="mb-1">mdi-account-group</v-icon>
        <div class="text-title-large">
          {{ summary.total_cases.toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Total Cases</div>
      </v-card>
    </v-col>
    <v-col cols="3">
      <v-card variant="tonal" class="text-center pa-3">
        <v-icon size="24" class="mb-1">mdi-dna</v-icon>
        <div class="text-title-large">
          {{ summary.total_variants.toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Total Variants</div>
      </v-card>
    </v-col>
    <v-col cols="3">
      <v-card variant="tonal" class="text-center pa-3">
        <v-icon size="24" class="mb-1">mdi-fingerprint</v-icon>
        <div class="text-title-large">
          {{ summary.unique_variants.toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Unique Variants</div>
      </v-card>
    </v-col>
    <v-col cols="3">
      <v-card variant="tonal" class="text-center pa-3">
        <v-icon size="24" class="mb-1">mdi-set-none</v-icon>
        <div class="text-title-large">
          {{ summary.genes_with_variants.toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Genes with Variants</div>
      </v-card>
    </v-col>
  </v-row>

  <!-- Annotation stat cards: Starred + ACMG -->
  <v-row density="compact" class="mb-4 annotation-stats-row">
    <v-col cols="6" class="d-flex">
      <v-card
        variant="tonal"
        class="text-center pa-3 d-flex flex-column align-center justify-center flex-grow-1"
      >
        <v-icon size="24" class="mb-1">mdi-star</v-icon>
        <div class="text-title-large">
          {{ (summary.starred_variants ?? 0).toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Starred Variants</div>
      </v-card>
    </v-col>
    <v-col cols="6" class="d-flex">
      <v-card variant="tonal" class="text-center pa-3 flex-grow-1">
        <v-icon size="24" class="mb-1">mdi-tag-check</v-icon>
        <div class="text-title-large">
          {{ totalAcmgClassified.toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">ACMG Classified</div>
        <div v-if="totalAcmgClassified > 0" class="mt-1 d-flex justify-center ga-1 flex-wrap">
          <v-chip
            v-if="summary.acmg_counts.pathogenic > 0"
            size="x-small"
            variant="tonal"
            color="error"
          >
            P: {{ summary.acmg_counts.pathogenic }}
          </v-chip>
          <v-chip
            v-if="summary.acmg_counts.likely_pathogenic > 0"
            size="x-small"
            variant="tonal"
            color="deep-orange"
          >
            LP: {{ summary.acmg_counts.likely_pathogenic }}
          </v-chip>
          <v-chip v-if="summary.acmg_counts.vus > 0" size="x-small" variant="tonal" color="amber">
            VUS: {{ summary.acmg_counts.vus }}
          </v-chip>
          <v-chip
            v-if="summary.acmg_counts.likely_benign > 0"
            size="x-small"
            variant="tonal"
            color="light-green"
          >
            LB: {{ summary.acmg_counts.likely_benign }}
          </v-chip>
          <v-chip
            v-if="summary.acmg_counts.benign > 0"
            size="x-small"
            variant="tonal"
            color="success"
          >
            B: {{ summary.acmg_counts.benign }}
          </v-chip>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CohortSummary } from '../../../../shared/types/cohort'

const props = defineProps<{
  summary: CohortSummary
}>()

const totalAcmgClassified = computed(() => {
  const c = props.summary.acmg_counts
  return c.pathogenic + c.likely_pathogenic + c.vus + c.likely_benign + c.benign
})
</script>
