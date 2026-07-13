<template>
  <v-card variant="outlined" class="mb-3">
    <v-card-text class="pa-3">
      <div v-if="loading" class="d-flex justify-center py-2">
        <v-progress-circular indeterminate size="20" />
      </div>
      <template v-else>
        <!-- Status row -->
        <div class="d-flex align-center mb-3">
          <span class="text-body-medium text-grey mr-2" style="min-width: 60px">Status</span>
          <StatusSelector
            :model-value="currentStatus"
            style="max-width: 180px"
            @update:model-value="handleStatusChange"
          />
        </div>

        <!-- Sex row -->
        <div class="d-flex align-center mb-3">
          <span class="text-body-medium text-grey mr-2" style="min-width: 60px">Sex</span>
          <v-select
            :model-value="currentSex"
            :items="sexOptions"
            item-title="label"
            item-value="value"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 180px"
            :prepend-inner-icon="mdiGenderMaleFemale"
            @update:model-value="handleSexChange"
          />
        </div>

        <!-- Age row -->
        <div class="d-flex align-center mb-3">
          <span class="text-body-medium text-grey mr-2" style="min-width: 60px">Age</span>
          <v-text-field
            :model-value="currentAge"
            type="number"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 120px"
            placeholder="Years"
            @update:model-value="handleAgeChange"
          />
          <span class="text-body-medium text-grey mx-2">DOB</span>
          <v-text-field
            :model-value="currentDob"
            type="date"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 170px"
            @update:model-value="handleDobChange"
          />
        </div>

        <!-- Cohorts row -->
        <div class="d-flex align-start mb-3">
          <span class="text-body-medium text-grey mr-2 mt-2" style="min-width: 60px">Cohorts</span>
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
          <span class="text-body-medium text-grey mr-2 mt-2" style="min-width: 60px"
            >Phenotypes</span
          >
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
import { useAppState } from '../composables/useAppState'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { logService } from '../services/LogService'
import { APP_CONFIG } from '../../../shared/config/app.config'
import type { AffectedStatus, CaseSex, CohortGroup } from '../../../shared/types/api'
import { mdiGenderMaleFemale } from '@mdi/js'

const props = defineProps<{
  caseId: number
}>()

const emit = defineEmits<{
  changed: []
}>()

const {
  loadMetadata,
  loadCohortGroups,
  getMetadata,
  isLoading,
  updateStatus,
  updateSex,
  updateAge,
  updateDob,
  setCaseCohorts,
  createAndAssignCohort,
  assignHpoTerm,
  removeHpoTerm,
  cohortGroupsCache
} = useCaseMetadata()

const { showSnack } = useAppState()

const sexOptions = [
  { label: 'Unknown', value: 'unknown' },
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' }
]

// Computed state
const loading = computed(() => isLoading(props.caseId))
const metadata = computed(() => getMetadata(props.caseId))
const currentStatus = computed(() => metadata.value?.metadata?.affected_status ?? 'unknown')
const currentSex = computed(() => metadata.value?.metadata?.sex ?? 'unknown')
const currentAge = computed(() => metadata.value?.metadata?.age ?? null)
const currentDob = computed(() => metadata.value?.metadata?.date_of_birth ?? null)
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
async function runMutation(
  label: string,
  mutation: () => Promise<unknown>,
  emitChange = false
): Promise<void> {
  try {
    await mutation()
    if (emitChange) emit('changed')
  } catch (error) {
    const message = formatErrorMessage(error, `Failed to ${label}.`)
    logService.error(`Failed to ${label}: ${message}`, 'CaseMetadataCard')
    showSnack(message, 'error', { timeout: APP_CONFIG.SNACKBAR_ERROR_MS })
  }
}

async function handleStatusChange(status: AffectedStatus) {
  await runMutation('update status', () => updateStatus(props.caseId, status))
}

async function handleSexChange(sex: CaseSex) {
  await runMutation('update sex', () => updateSex(props.caseId, sex))
}

async function handleAgeChange(val: string | number | null) {
  const age =
    typeof val === 'number' ? val : typeof val === 'string' && val !== '' ? parseFloat(val) : null
  const validAge = age !== null && !isNaN(age) ? age : null
  await runMutation('update age', () => updateAge(props.caseId, validAge))
}

async function handleDobChange(val: string | null) {
  await runMutation('update date of birth', () =>
    updateDob(props.caseId, typeof val === 'string' && val !== '' ? val : null)
  )
}

async function handleCohortsChange(cohorts: CohortGroup[]) {
  const cohortIds = cohorts.map((c) => c.id)
  await runMutation('set cohorts', () => setCaseCohorts(props.caseId, cohortIds), true)
}

async function handleCreateCohort(name: string) {
  await runMutation('create cohort', () => createAndAssignCohort(props.caseId, name), true)
}

async function handleAddHpoTerm(term: { hpoId: string; hpoLabel: string }) {
  await runMutation(
    'assign HPO term',
    () => assignHpoTerm(props.caseId, term.hpoId, term.hpoLabel),
    true
  )
}

async function handleRemoveHpoTerm(hpoId: string) {
  await runMutation('remove HPO term', () => removeHpoTerm(props.caseId, hpoId), true)
}

onMounted(async () => {
  await loadCohortGroups()
})
</script>
