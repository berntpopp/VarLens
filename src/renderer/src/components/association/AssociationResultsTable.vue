<template>
  <div>
    <!-- Toolbar: Search + Export -->
    <div class="d-flex align-center gap-2 mb-2">
      <v-text-field
        v-model="searchTerm"
        placeholder="Search gene..."
        density="compact"
        hide-details
        style="max-width: 250px"
        clearable
        :prepend-inner-icon="mdiMagnify"
      />
      <v-spacer />
      <v-btn
        size="small"
        variant="outlined"
        :prepend-icon="mdiDownload"
        :disabled="results.length === 0"
        @click="exportResults"
      >
        Export
      </v-btn>
    </div>

    <p class="text-caption text-medium-emphasis mb-2" data-testid="burden-reference-note">
      {{ BURDEN_REFERENCE_NOTE }}
    </p>
    <p
      v-if="skippedNote"
      class="text-caption text-medium-emphasis mb-2"
      data-testid="burden-non-autosomal-note"
    >
      {{ skippedNote }}
    </p>

    <v-data-table
      v-model:items-per-page="itemsPerPage"
      :headers="headers"
      :items="filteredResults"
      :sort-by="[{ key: 'q_value', order: 'asc' }]"
      :items-per-page-options="[10, 25, 50, 100]"
      density="compact"
      item-value="gene_symbol"
      class="elevation-1"
    >
      <!-- Gene symbol -->
      <template #[`item.gene_symbol`]="{ value }">
        <span class="gene-symbol font-weight-medium">{{ value }}</span>
      </template>

      <!-- Sites left out of this gene; the tooltip names the reasons -->
      <template #[`item.sites_excluded`]="{ item }">
        <span data-testid="sites-excluded" :title="excludedSitesLabel(item.sites_excluded)">
          {{ excludedSiteCount(item.sites_excluded) }}
        </span>
      </template>

      <!-- Significant row highlighting -->
      <template #[`item.q_value`]="{ value }">
        <v-chip v-if="value !== null && value < 0.05" size="small" color="error" variant="tonal">
          {{ formatPValue(value) }}
        </v-chip>
        <span v-else>{{ formatPValue(value) }}</span>
      </template>

      <!-- Fisher p-value -->
      <template #[`item.fisher_p`]="{ item }">
        {{ formatPValue(item.fisher?.p_value) }}
      </template>

      <!-- Fisher OR -->
      <template #[`item.fisher_or`]="{ item }">
        {{ formatNumber(item.fisher?.odds_ratio) }}
      </template>

      <!-- Fisher CI -->
      <template #[`item.fisher_ci`]="{ item }">
        <span v-if="item.fisher?.ci_lower != null">
          {{ formatNumber(item.fisher.ci_lower) }} –
          {{ formatNumber(item.fisher.ci_upper) }}
        </span>
        <span v-else>–</span>
      </template>

      <!-- Burden beta -->
      <template #[`item.burden_beta`]="{ item }">
        {{ formatNumber(item.logistic_burden?.beta) }}
      </template>

      <!-- Burden SE -->
      <template #[`item.burden_se`]="{ item }">
        {{ formatNumber(item.logistic_burden?.se) }}
      </template>

      <!-- Burden p-value -->
      <template #[`item.burden_p`]="{ item }">
        <span>
          {{ formatPValue(item.logistic_burden?.p_value) }}
          <v-icon
            v-if="item.logistic_burden?.used_firth"
            size="x-small"
            color="warning"
            title="Firth correction applied"
            :icon="mdiAlertCircleOutline"
          />
        </span>
      </template>
    </v-data-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { mdiAlertCircleOutline, mdiDownload, mdiMagnify } from '@mdi/js'
import {
  BURDEN_REFERENCE_NOTE,
  buildAssociationTsv,
  excludedSiteCount,
  excludedSitesLabel,
  nonAutosomalNote,
  type AssociationResultRow
} from '../../utils/association-results'

const props = defineProps<{
  results: AssociationResultRow[]
  primaryTest: string
  /** Qualifying variants the run left out because they are not on an autosome. */
  nonAutosomalVariants?: number
}>()

const settingsStore = useSettingsStore()
const itemsPerPage = ref(settingsStore.itemsPerPage)
const searchTerm = ref('')

watch(itemsPerPage, (v) => {
  settingsStore.itemsPerPage = v
})

const skippedNote = computed(() => nonAutosomalNote(props.nonAutosomalVariants ?? 0))

const headers = [
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Variants', key: 'n_variants', sortable: true, align: 'end' as const },
  { title: 'Excluded sites', key: 'sites_excluded', sortable: false, align: 'end' as const },
  {
    title: 'Cases A',
    key: 'groupA_carriers',
    sortable: true,
    align: 'end' as const
  },
  {
    title: 'Cases B',
    key: 'groupB_carriers',
    sortable: true,
    align: 'end' as const
  },
  { title: 'Fisher OR', key: 'fisher_or', sortable: false, align: 'end' as const },
  { title: 'Fisher 95% CI', key: 'fisher_ci', sortable: false },
  { title: 'Fisher p', key: 'fisher_p', sortable: false, align: 'end' as const },
  {
    title: 'Burden \u03B2',
    key: 'burden_beta',
    sortable: false,
    align: 'end' as const
  },
  { title: 'Burden SE', key: 'burden_se', sortable: false, align: 'end' as const },
  { title: 'Burden p', key: 'burden_p', sortable: false, align: 'end' as const },
  { title: 'q-value', key: 'q_value', sortable: true, align: 'end' as const }
]

const filteredResults = computed(() => {
  if (!searchTerm.value) return props.results
  const term = searchTerm.value.toLowerCase()
  return props.results.filter((r) => r.gene_symbol.toLowerCase().includes(term))
})

function formatPValue(val: number | null | undefined): string {
  if (val === null || val === undefined) return '\u2013'
  if (val < 0.001) return val.toExponential(2)
  return val.toFixed(4)
}

function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined) return '\u2013'
  if (!isFinite(val)) return '\u221E'
  return val.toFixed(3)
}

function exportResults(): void {
  const tsv = buildAssociationTsv(props.results, props.nonAutosomalVariants ?? 0)
  const blob = new Blob([tsv], { type: 'text/tab-separated-values' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gene_burden_results_${new Date().toISOString().split('T')[0]}.tsv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.gene-symbol {
  font-family: 'Courier New', monospace;
}
</style>
