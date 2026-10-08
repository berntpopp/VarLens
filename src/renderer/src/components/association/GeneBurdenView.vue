<template>
  <div class="gene-burden-view pa-3">
    <!-- Config panel -->
    <AssociationConfigPanel
      :all-cases="cases"
      :cohort-groups="cohortGroups"
      :running="isRunning"
      :has-results="results !== null"
      :unavailable-reason="unavailableReason"
      @run="runAnalysis"
    />

    <v-alert v-if="unavailableReason" type="info" variant="tonal" density="compact" class="mb-3">
      {{ unavailableReason }}
    </v-alert>

    <!-- Progress bar -->
    <div v-if="isRunning" class="mb-3">
      <v-progress-linear :model-value="progressPercent" color="primary" height="20" rounded>
        <template #default>
          <span class="text-caption"> {{ progressCompleted }} / {{ progressTotal }} genes </span>
        </template>
      </v-progress-linear>
      <v-btn variant="text" color="error" size="small" class="mt-1" @click="cancelAnalysis">
        Cancel
      </v-btn>
    </div>

    <!-- Error -->
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      closable
      class="mb-3"
      @click:close="error = null"
    >
      {{ error }}
    </v-alert>

    <!-- Warnings -->
    <v-alert
      v-if="results && results.warnings.length > 0"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      {{ results.warnings.length }} warning(s) during analysis
      <template #append>
        <v-btn size="x-small" variant="text" @click="showWarnings = !showWarnings">
          {{ showWarnings ? 'Hide' : 'Show' }}
        </v-btn>
      </template>
      <div
        v-if="showWarnings"
        class="mt-1 text-caption"
        style="max-height: 100px; overflow-y: auto"
      >
        <div v-for="(w, i) in results.warnings.slice(0, 50)" :key="i">
          {{ w }}
        </div>
        <div v-if="results.warnings.length > 50">
          ... and {{ results.warnings.length - 50 }} more
        </div>
      </div>
    </v-alert>

    <!-- Results summary -->
    <v-alert v-if="results" type="success" variant="tonal" density="compact" class="mb-3">
      Analysis complete: {{ results.results.length }} genes tested,
      {{ significantCount }} significant (FDR &lt; 0.05) in
      {{ (results.elapsed_ms / 1000).toFixed(1) }}s
    </v-alert>

    <!-- Results tabs -->
    <v-tabs v-if="results" v-model="activeTab" color="secondary" class="mb-2">
      <v-tab value="table">Table</v-tab>
      <v-tab value="volcano">Volcano Plot</v-tab>
      <v-tab value="manhattan">Manhattan Plot</v-tab>
    </v-tabs>

    <v-tabs-window v-if="results" v-model="activeTab">
      <v-tabs-window-item value="table">
        <AssociationResultsTable
          :results="results.results"
          :primary-test="results.primary_test"
          :non-autosomal-variants="results.non_autosomal_variants"
        />
      </v-tabs-window-item>
      <v-tabs-window-item value="volcano">
        <VolcanoPlot :results="results.results" :primary-test="results.primary_test" />
      </v-tabs-window-item>
      <v-tabs-window-item value="manhattan">
        <ManhattanPlot :results="results.results" :primary-test="results.primary_test" />
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AssociationConfigPanel from './AssociationConfigPanel.vue'
import AssociationResultsTable from './AssociationResultsTable.vue'
import VolcanoPlot from './VolcanoPlot.vue'
import ManhattanPlot from './ManhattanPlot.vue'
import { useAssociation } from '../../composables/useAssociation'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import { formatError } from '../../utils/ipc-result'

interface CaseInfo {
  id: number
  name: string
  status: string | null
  sex: string | null
  cohortIds: number[]
}

interface CohortGroup {
  id: number
  name: string
}

interface AssociationResult {
  gene_symbol: string
  n_variants: number
  sites_excluded: { missing_call: number; conflicting_calls: number; no_called_alleles: number }
  groupA_carriers: number
  groupB_carriers: number
  groupA_total: number
  groupB_total: number
  fisher: {
    p_value: number | null
    odds_ratio: number | null
    ci_lower: number | null
    ci_upper: number | null
  }
  logistic_burden: {
    p_value: number | null
    beta: number | null
    se: number | null
    ci_lower: number | null
    ci_upper: number | null
    used_firth: boolean
    warning?: string
  }
  q_value: number | null
}

interface AssociationResultsData {
  results: AssociationResult[]
  warnings: string[]
  elapsed_ms: number
  primary_test: string
  non_autosomal_variants: number
}

const {
  runAssociation: apiRunAssociation,
  cancelAssociation: apiCancelAssociation,
  onAssociationProgress,
  loadCasesWithMetadata,
  unavailableReason
} = useAssociation()

const cases = ref<CaseInfo[]>([])
const cohortGroups = ref<CohortGroup[]>([])
const isRunning = ref(false)
const progressCompleted = ref(0)
const progressTotal = ref(0)
const results = ref<AssociationResultsData | null>(null)
const error = ref<string | null>(null)
const showWarnings = ref(false)
const activeTab = ref('table')

const progressPercent = computed(() => {
  if (progressTotal.value === 0) return 0
  return Math.round((progressCompleted.value / progressTotal.value) * 100)
})

const significantCount = computed(() => {
  if (!results.value) return 0
  return results.value.results.filter((r) => r.q_value !== null && r.q_value < 0.05).length
})

let unsubProgress: (() => void) | null = null

onMounted(async () => {
  try {
    const raw = await loadCasesWithMetadata()
    const allCases = unwrapIpcResult(raw)
    cases.value = (allCases || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status ?? null,
      sex: c.sex ?? null,
      cohortIds: c.cohortIds ?? []
    }))
  } catch (e) {
    error.value = `Failed to load cases: ${formatError(e)}`
  }

  try {
    const groupsRaw = await window.api.cases.cohortGroups()
    cohortGroups.value = unwrapIpcResult(groupsRaw) || []
  } catch (e) {
    error.value = `Failed to load cohort groups: ${formatError(e)}`
  }

  unsubProgress = onAssociationProgress((data) => {
    progressCompleted.value = data.completed
    progressTotal.value = data.total
  })
})

onBeforeUnmount(() => {
  if (unsubProgress) unsubProgress()
})

async function runAnalysis(config: any): Promise<void> {
  isRunning.value = true
  error.value = null
  results.value = null
  progressCompleted.value = 0
  progressTotal.value = 0

  try {
    const raw = await apiRunAssociation(config)
    results.value = unwrapIpcResult(raw) as AssociationResultsData
  } catch (e) {
    error.value = formatError(e)
  } finally {
    isRunning.value = false
  }
}

async function cancelAnalysis(): Promise<void> {
  try {
    await apiCancelAssociation()
  } catch (e) {
    error.value = formatError(e)
  }
}
</script>

<style scoped>
.gene-burden-view {
  max-width: 1200px;
}
</style>
