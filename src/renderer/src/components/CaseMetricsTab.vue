<template>
  <div>
    <!-- Add metric form -->
    <v-card variant="outlined" class="mb-3">
      <v-card-text class="pa-3">
        <v-autocomplete
          v-model="selectedDefinition"
          :items="availableDefinitions"
          item-title="name"
          item-value="id"
          return-object
          label="Add a metric..."
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="mb-2"
          :no-data-text="
            searchQuery
              ? 'No matching metrics — press Enter to create custom'
              : 'Type to search metrics'
          "
          @update:search="searchQuery = $event"
          @keydown.enter="handleEnterOnSearch"
        >
          <template #item="{ item, props: itemProps }">
            <v-list-item v-bind="itemProps">
              <template #subtitle>
                <span class="text-caption">
                  {{ (item as any).raw?.category ?? '' }}
                  <template v-if="(item as any).raw?.unit">
                    &middot; {{ (item as any).raw.unit }}
                  </template>
                </span>
              </template>
            </v-list-item>
          </template>
        </v-autocomplete>

        <!-- Value input (shown when metric selected) -->
        <template v-if="selectedDefinition">
          <div class="d-flex align-center ga-2">
            <!-- Numeric -->
            <v-text-field
              v-if="selectedDefinition.value_type === 'numeric'"
              v-model.number="numericInput"
              :label="selectedDefinition.unit ? `Value (${selectedDefinition.unit})` : 'Value'"
              type="number"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 200px"
            />

            <!-- Text -->
            <v-text-field
              v-if="selectedDefinition.value_type === 'text'"
              v-model="textInput"
              label="Value"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 300px"
            />

            <!-- Date -->
            <v-text-field
              v-if="selectedDefinition.value_type === 'date'"
              v-model="dateInput"
              label="Value"
              type="date"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 200px"
            />

            <v-btn
              color="primary"
              size="small"
              :disabled="!hasValidInput"
              :loading="isSaving"
              @click="handleSave"
            >
              Save
            </v-btn>
          </div>
        </template>
      </v-card-text>
    </v-card>

    <!-- Create custom metric dialog -->
    <v-dialog v-model="showCreateDialog" max-width="400px">
      <v-card>
        <v-card-title>Create Custom Metric</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="customName"
            label="Metric Name"
            density="compact"
            variant="outlined"
            class="mb-2"
          />
          <v-select
            v-model="customValueType"
            :items="['numeric', 'text', 'date']"
            label="Value Type"
            density="compact"
            variant="outlined"
            class="mb-2"
          />
          <v-text-field
            v-model="customUnit"
            label="Unit (optional)"
            density="compact"
            variant="outlined"
            class="mb-2"
          />
          <v-text-field
            v-model="customCategory"
            label="Category"
            density="compact"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCreateDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            :disabled="!customName.trim() || !customCategory.trim()"
            @click="handleCreateDefinition"
          >
            Create
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Loading state -->
    <div v-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" />
    </div>

    <!-- Metrics list grouped by category -->
    <template v-else>
      <div v-if="metrics.length === 0" class="text-center text-medium-emphasis py-4">
        No metrics recorded yet
      </div>

      <template v-for="(group, category) in metricsByCategory" :key="category">
        <div class="text-caption text-medium-emphasis text-uppercase mb-1 mt-3">
          {{ category }}
        </div>
        <v-table density="compact">
          <tbody>
            <tr v-for="metric in group" :key="metric.id">
              <td style="width: 50%">
                <span class="text-body-2">{{ metric.name }}</span>
              </td>
              <td>
                <span class="text-body-2 font-weight-medium">
                  {{ formatMetricValue(metric) }}
                </span>
                <span v-if="metric.unit" class="text-caption text-medium-emphasis ml-1">
                  {{ metric.unit }}
                </span>
              </td>
              <td style="width: 40px">
                <v-btn
                  icon="mdi-delete-outline"
                  size="x-small"
                  variant="text"
                  color="error"
                  @click="handleDelete(metric.metric_id)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useCaseMetrics } from '../composables/useCaseMetrics'
import type { MetricDefinition, CaseMetricWithDefinition } from '../../../shared/types/api'
import { EMPTY_VALUE_PLACEHOLDER } from '../utils/formatters'

const props = defineProps<{
  caseId: number
}>()

const {
  definitionsCache,
  loadDefinitions,
  loadMetrics,
  getMetrics,
  isLoading,
  upsertMetric,
  deleteMetric,
  createDefinition
} = useCaseMetrics()

// Add metric form state
const selectedDefinition = ref<MetricDefinition | null>(null)
const searchQuery = ref('')
const numericInput = ref<number | null>(null)
const textInput = ref('')
const dateInput = ref('')
const isSaving = ref(false)

// Create custom metric dialog
const showCreateDialog = ref(false)
const customName = ref('')
const customValueType = ref<'numeric' | 'text' | 'date'>('numeric')
const customUnit = ref('')
const customCategory = ref('Custom')

// Computed
const loading = computed(() => isLoading(props.caseId))
const metrics = computed(() => getMetrics(props.caseId))

// Filter out already-assigned metric definitions
const assignedMetricIds = computed(() => new Set(metrics.value.map((m) => m.metric_id)))
const availableDefinitions = computed(() =>
  definitionsCache.value.filter((d) => !assignedMetricIds.value.has(d.id))
)

// Group metrics by category for display
const metricsByCategory = computed(() => {
  const grouped: Record<string, CaseMetricWithDefinition[]> = {}
  for (const m of metrics.value) {
    const cat = m.metric_category
    if (grouped[cat] === undefined) grouped[cat] = []
    grouped[cat].push(m)
  }
  return grouped
})

const hasValidInput = computed(() => {
  if (!selectedDefinition.value) return false
  switch (selectedDefinition.value.value_type) {
    case 'numeric':
      return numericInput.value !== null && numericInput.value !== undefined
    case 'text':
      return textInput.value.trim().length > 0
    case 'date':
      return dateInput.value.length > 0
    default:
      return false
  }
})

// Load on mount
watch(
  () => props.caseId,
  async (id) => {
    if (id) {
      await Promise.all([loadDefinitions(), loadMetrics(id)])
    }
  },
  { immediate: true }
)

async function handleSave(): Promise<void> {
  if (!selectedDefinition.value || !hasValidInput.value) return

  isSaving.value = true
  try {
    const value =
      selectedDefinition.value.value_type === 'numeric'
        ? { numeric_value: numericInput.value }
        : selectedDefinition.value.value_type === 'text'
          ? { text_value: textInput.value.trim() }
          : { date_value: dateInput.value }

    await upsertMetric(props.caseId, selectedDefinition.value.id, value)

    // Reset form
    selectedDefinition.value = null
    numericInput.value = null
    textInput.value = ''
    dateInput.value = ''
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to save metric:', error)
  } finally {
    isSaving.value = false
  }
}

async function handleDelete(metricId: number): Promise<void> {
  try {
    await deleteMetric(props.caseId, metricId)
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to delete metric:', error)
  }
}

function handleEnterOnSearch(): void {
  // If user typed something and no definitions match the search text, offer to create custom
  if (!searchQuery.value) return
  const query = searchQuery.value.toLowerCase()
  const hasMatch = availableDefinitions.value.some((d) => d.name.toLowerCase().includes(query))
  if (!hasMatch) {
    customName.value = searchQuery.value
    showCreateDialog.value = true
  }
}

async function handleCreateDefinition(): Promise<void> {
  try {
    const def = await createDefinition(
      customName.value.trim(),
      customValueType.value,
      customUnit.value.trim(),
      customCategory.value.trim()
    )
    // Auto-select the new definition
    selectedDefinition.value = def
    showCreateDialog.value = false
    customName.value = ''
    customUnit.value = ''
    customCategory.value = 'Custom'
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to create metric definition:', error)
  }
}

function formatMetricValue(metric: CaseMetricWithDefinition): string {
  if (metric.numeric_value !== null && metric.numeric_value !== undefined) {
    return String(metric.numeric_value)
  }
  if (metric.text_value !== null && metric.text_value !== undefined) {
    return metric.text_value
  }
  if (metric.date_value !== null && metric.date_value !== undefined) {
    return metric.date_value
  }
  return EMPTY_VALUE_PLACEHOLDER
}
</script>
