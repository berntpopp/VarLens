<template>
  <v-card min-width="200" max-width="300" class="filter-popup">
    <v-card-title class="text-caption font-weight-medium py-1 px-3">
      Filter: {{ columnTitle }}
    </v-card-title>
    <v-divider />
    <v-card-text class="pa-2">
      <v-text-field
        v-model="searchText"
        placeholder="Search..."
        density="compact"
        variant="outlined"
        clearable
        hide-details
        class="mb-1"
        prepend-inner-icon="mdi-magnify"
      />
      <div class="text-caption text-medium-emphasis">{{ selected.length }} selected</div>
      <div class="checkbox-list">
        <v-checkbox
          v-for="val in filteredValues"
          :key="val"
          :label="val"
          :model-value="selected.includes(val)"
          density="compact"
          hide-details
          class="checkbox-dense"
          @update:model-value="toggleValue(val, $event)"
        />
      </div>
    </v-card-text>
    <v-divider />
    <v-card-actions class="pa-1 px-2">
      <v-btn size="x-small" variant="text" @click="onClear">Clear</v-btn>
      <v-btn size="x-small" variant="text" @click="selectAll">All</v-btn>
      <v-spacer />
      <v-btn size="x-small" variant="text" color="primary" @click="onApply">OK</v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
/**
 * CategoricalColumnFilter - Per-column categorical filter with checkboxes.
 *
 * Shows a searchable list of distinct values with checkboxes.
 * Emits an 'in' operator filter with the selected values array.
 */
import { ref, computed } from 'vue'

interface Props {
  /** Column display name shown in the card title */
  columnTitle: string
  /** List of distinct values for this column */
  values: string[]
  /** Pre-selected values */
  initialSelected?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  initialSelected: () => []
})

const emit = defineEmits<{
  apply: [payload: { operator: 'in'; value: string[] }]
  clear: []
}>()

const searchText = ref('')
const selected = ref<string[]>([...props.initialSelected])

const filteredValues = computed(() => {
  if (!searchText.value) return props.values
  const q = searchText.value.toLowerCase()
  return props.values.filter((v) => v.toLowerCase().includes(q))
})

function toggleValue(val: string, checked: boolean | null | undefined) {
  if (checked === true) {
    if (!selected.value.includes(val)) {
      selected.value.push(val)
    }
  } else {
    selected.value = selected.value.filter((v) => v !== val)
  }
}

function selectAll() {
  selected.value = [...props.values]
}

function onApply() {
  if (selected.value.length === 0) return
  emit('apply', { operator: 'in', value: [...selected.value] })
}

function onClear() {
  emit('clear')
}
</script>

<style scoped>
.checkbox-list {
  max-height: 200px;
  overflow-y: auto;
}

.checkbox-dense :deep(.v-label) {
  font-size: 0.75rem;
}

.checkbox-dense :deep(.v-selection-control) {
  min-height: 28px;
}
</style>
