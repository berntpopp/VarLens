<template>
  <v-card variant="outlined" class="mb-3">
    <v-card-text class="pa-3">
      <div v-if="loading" class="d-flex justify-center py-2">
        <v-progress-circular indeterminate size="20" />
      </div>
      <template v-else>
        <!-- Status row -->
        <div class="d-flex align-center mb-3">
          <span class="text-body-2 text-grey mr-2" style="min-width: 60px">Status</span>
          <StatusSelector
            :model-value="currentStatus"
            style="max-width: 180px"
            @update:model-value="handleStatusChange"
          />
        </div>

        <!-- Cohorts row -->
        <div class="d-flex align-start mb-3">
          <span class="text-body-2 text-grey mr-2 mt-2" style="min-width: 60px">Cohorts</span>
          <div class="flex-grow-1">
            <CohortCombobox
              :model-value="currentCohorts"
              :available-cohorts="allCohorts"
              @update:model-value="handleCohortsChange"
              @create:cohort="handleCreateCohort"
            />
          </div>
        </div>

        <!-- HPO Terms row -->
        <div class="d-flex align-start">
          <span class="text-body-2 text-grey mr-2 mt-2" style="min-width: 60px">Phenotypes</span>
          <div class="flex-grow-1">
            <HpoTermSelector
              :model-value="currentHpoTerms"
              @add:term="handleAddHpoTerm"
              @remove:term="handleRemoveHpoTerm"
            />
          </div>
        </div>
      </template>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import StatusSelector from './StatusSelector.vue'
import CohortCombobox from './CohortCombobox.vue'
import HpoTermSelector from './HpoTermSelector.vue'
import { useCaseMetadata } from '../composables/useCaseMetadata'
import type { AffectedStatus, CohortGroup } from '../../../shared/types/api'

const props = defineProps<{
  caseId: number
}>()

const {
  loadMetadata,
  loadCohortGroups,
  getMetadata,
  isLoading,
  updateStatus,
  setCaseCohorts,
  createAndAssignCohort,
  assignHpoTerm,
  removeHpoTerm,
  cohortGroupsCache
} = useCaseMetadata()

// Computed state
const loading = computed(() => isLoading(props.caseId))
const metadata = computed(() => getMetadata(props.caseId))
const currentStatus = computed(() => metadata.value?.metadata?.affected_status ?? 'unknown')
const currentCohorts = computed(() => metadata.value?.cohorts ?? [])
const currentHpoTerms = computed(() => metadata.value?.hpoTerms ?? [])
const allCohorts = computed(() => cohortGroupsCache.value)

// Load metadata when caseId changes
watch(
  () => props.caseId,
  async (newCaseId) => {
    if (newCaseId) {
      await Promise.all([loadMetadata(newCaseId), loadCohortGroups()])
    }
  },
  { immediate: true }
)

// Handlers
async function handleStatusChange(status: AffectedStatus) {
  await updateStatus(props.caseId, status)
}

async function handleCohortsChange(cohorts: CohortGroup[]) {
  const cohortIds = cohorts.map((c) => c.id)
  await setCaseCohorts(props.caseId, cohortIds)
}

async function handleCreateCohort(name: string) {
  await createAndAssignCohort(props.caseId, name)
}

async function handleAddHpoTerm(term: { hpoId: string; hpoLabel: string }) {
  await assignHpoTerm(props.caseId, term.hpoId, term.hpoLabel)
}

async function handleRemoveHpoTerm(hpoId: string) {
  await removeHpoTerm(props.caseId, hpoId)
}

onMounted(async () => {
  await loadCohortGroups()
})
</script>
