<template>
  <!-- At a Glance: 4 tonal stat cards -->
  <div class="text-title-small mb-2">
    <v-icon size="small" class="mr-1" :icon="mdiChartBar" />
    At a Glance
  </div>
  <v-row density="compact" class="mb-2">
    <v-col cols="3">
      <v-card variant="tonal" class="text-center pa-3">
        <v-icon size="24" class="mb-1" :icon="mdiAccountGroup" />
        <div class="text-title-large">
          {{ summary.total_cases.toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Total Cases</div>
      </v-card>
    </v-col>
    <v-col cols="3">
      <v-card variant="tonal" class="text-center pa-3">
        <v-icon size="24" class="mb-1" :icon="mdiDna" />
        <div class="text-title-large">
          {{ summary.total_variants.toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Total Variants</div>
      </v-card>
    </v-col>
    <v-col cols="3">
      <v-card variant="tonal" class="text-center pa-3">
        <v-icon size="24" class="mb-1" :icon="mdiFingerprint" />
        <div class="text-title-large">
          {{ summary.unique_variants.toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Unique Variants</div>
        <div
          v-if="summaryStale"
          class="text-body-small text-medium-emphasis"
          role="status"
          data-testid="summary-refreshing"
        >
          <v-icon size="x-small" :icon="mdiDatabaseSync" /> Being refreshed
        </div>
      </v-card>
    </v-col>
    <v-col cols="3">
      <v-card variant="tonal" class="text-center pa-3">
        <v-icon size="24" class="mb-1" :icon="mdiSetNone" />
        <div class="text-title-large">
          {{ summary.genes_with_variants.toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Genes with Variants</div>
        <div
          v-if="summaryStale"
          class="text-body-small text-medium-emphasis"
          role="status"
          data-testid="summary-refreshing"
        >
          <v-icon size="x-small" :icon="mdiDatabaseSync" /> Being refreshed
        </div>
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
        <v-icon size="24" class="mb-1" :icon="mdiStar" />
        <div class="text-title-large">
          {{ (summary.starred_variants ?? 0).toLocaleString() }}
        </div>
        <div class="text-body-small text-medium-emphasis">Starred Variants</div>
      </v-card>
    </v-col>
    <v-col cols="6" class="d-flex">
      <v-card variant="tonal" class="text-center pa-3 flex-grow-1">
        <v-icon size="24" class="mb-1" :icon="mdiTagCheck" />
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
import {
  mdiAccountGroup,
  mdiChartBar,
  mdiDatabaseSync,
  mdiDna,
  mdiFingerprint,
  mdiSetNone,
  mdiStar,
  mdiTagCheck
} from '@mdi/js'

const props = defineProps<{
  summary: CohortSummary
  /** The cohort summary is being rebuilt: the figures taken from it may lag. */
  summaryStale?: boolean
}>()

const totalAcmgClassified = computed(() => {
  const c = props.summary.acmg_counts
  return c.pathogenic + c.likely_pathogenic + c.vus + c.likely_benign + c.benign
})
</script>
