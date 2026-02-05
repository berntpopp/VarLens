<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    location="bottom start"
    offset="4"
    max-height="400"
    min-width="280"
    @keydown.escape="menuOpen = false"
  >
    <template #activator="{ props: menuProps }">
      <v-text-field
        v-bind="menuProps"
        :model-value="displayValue"
        :label="label"
        :placeholder="placeholder"
        variant="outlined"
        density="compact"
        readonly
        hide-details
        class="grouped-select-input"
        :class="{ 'filter-active': hasSelection }"
        role="combobox"
        :aria-expanded="menuOpen"
        :aria-label="label + (hasSelection ? ` (${selectedValues.length} selected)` : '')"
        @click:clear="clearAll"
      >
        <template #prepend-inner>
          <v-icon size="small" class="mr-1">{{ icon }}</v-icon>
        </template>
        <template #append-inner>
          <v-badge
            v-if="selectedValues.length > 0"
            :content="selectedValues.length"
            color="primary"
            inline
            class="mr-1"
          />
          <v-icon size="small">{{ menuOpen ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
        </template>
      </v-text-field>
    </template>

    <v-card class="grouped-select-menu" role="listbox" :aria-label="label + ' options'">
      <!-- Quick action bar -->
      <v-card-actions class="pa-2 border-b">
        <v-btn size="small" variant="text" aria-label="Select all options" @click="selectAll">
          Select All
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          color="error"
          :disabled="!hasSelection"
          @click="clearAll"
        >
          Clear
        </v-btn>
        <v-spacer />
        <v-btn size="small" variant="text" @click="menuOpen = false"> Done </v-btn>
      </v-card-actions>

      <!-- Group sections -->
      <v-list density="compact" class="py-0">
        <template v-for="(group, index) in effectiveGroups" :key="group.id">
          <!-- Group header with checkbox -->
          <v-list-item
            class="group-header"
            :class="{ 'group-active': isGroupActive(group.id) }"
            @click="toggleGroupSelection(group.id)"
          >
            <template #prepend>
              <v-checkbox-btn
                :model-value="isGroupFullySelected(group.id)"
                :indeterminate="isGroupPartiallySelected(group.id)"
                :color="group.color"
                density="compact"
                hide-details
                @click.stop="toggleGroupSelection(group.id)"
              />
            </template>
            <v-list-item-title class="d-flex align-center">
              <v-icon :color="group.color" size="small" class="mr-2">{{ group.icon }}</v-icon>
              <span class="font-weight-medium">{{ group.label }}</span>
              <v-chip size="x-small" class="ml-2" variant="tonal" :color="group.color">
                {{ getGroupSelectedCount(group.id) }}/{{ group.items.length }}
              </v-chip>
            </v-list-item-title>
            <template #append>
              <v-btn
                :icon="expandedGroups.includes(group.id) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                size="x-small"
                variant="text"
                @click.stop="toggleGroupExpanded(group.id)"
              />
            </template>
          </v-list-item>

          <!-- Group items (collapsible) -->
          <v-expand-transition>
            <div v-show="expandedGroups.includes(group.id)">
              <v-list-item
                v-for="item in group.items"
                :key="item.value"
                class="pl-10 item-row"
                density="compact"
                @click="toggleItem(item.value)"
              >
                <template #prepend>
                  <v-checkbox-btn
                    :model-value="selectedValues.includes(item.value)"
                    :color="group.color"
                    density="compact"
                    hide-details
                    @click.stop="toggleItem(item.value)"
                  />
                </template>
                <v-list-item-title class="text-body-2">
                  {{ item.label }}
                </v-list-item-title>
              </v-list-item>
            </div>
          </v-expand-transition>

          <v-divider v-if="index < effectiveGroups.length - 1" />
        </template>
      </v-list>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FilterGroupConfig, FilterGroup } from '../config/filterGroups'
import {
  getGroupValues,
  isGroupFullySelected as checkGroupFullySelected,
  isGroupPartiallySelected as checkGroupPartiallySelected,
  toggleGroup,
  getAllGroupValues
} from '../config/filterGroups'

interface Props {
  config: FilterGroupConfig
  modelValue: string[]
  /** All available values from the database - used to show "Other" items not in config groups */
  availableValues?: string[]
  label?: string
  placeholder?: string
  icon?: string
}

const props = withDefaults(defineProps<Props>(), {
  label: 'Select',
  placeholder: 'Click to select...',
  icon: 'mdi-filter-variant',
  availableValues: () => []
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const menuOpen = ref(false)
const expandedGroups = ref<string[]>([])

// Computed: values from config groups
const configuredValues = computed(() => getAllGroupValues(props.config))

// Computed: "Other" items not covered by config groups
const otherItems = computed(() => {
  if (props.availableValues.length === 0) return []
  return props.availableValues
    .filter((v) => !configuredValues.value.includes(v))
    .map((v) => ({
      value: v,
      label: v.replace(/_/g, ' ') // Simple humanization
    }))
})

// Computed: effective groups (config groups + dynamic "Other" group if needed)
const effectiveGroups = computed<FilterGroup[]>(() => {
  const groups = [...props.config.groups]
  if (otherItems.value.length > 0) {
    groups.push({
      id: '_other',
      label: 'Other',
      color: 'grey',
      icon: 'mdi-dots-horizontal',
      items: otherItems.value
    })
  }
  return groups
})

// Computed properties
const selectedValues = computed(() => props.modelValue)

const hasSelection = computed(() => selectedValues.value.length > 0)

const displayValue = computed(() => {
  if (selectedValues.value.length === 0) return ''
  if (selectedValues.value.length === 1) {
    // Find the label for the single selected item
    for (const group of props.config.groups) {
      const item = group.items.find((i) => i.value === selectedValues.value[0])
      if (item) return item.label
    }
    return selectedValues.value[0]
  }
  return `${selectedValues.value.length} selected`
})

// Get values for a group (handles both config and dynamic "Other" group)
function getEffectiveGroupValues(groupId: string): string[] {
  if (groupId === '_other') {
    return otherItems.value.map((item) => item.value)
  }
  return getGroupValues(props.config, groupId)
}

// Group state checks
function isGroupFullySelected(groupId: string): boolean {
  if (groupId === '_other') {
    const otherVals = getEffectiveGroupValues(groupId)
    return otherVals.length > 0 && otherVals.every((v) => selectedValues.value.includes(v))
  }
  return checkGroupFullySelected(props.config, groupId, selectedValues.value)
}

function isGroupPartiallySelected(groupId: string): boolean {
  if (groupId === '_other') {
    const otherVals = getEffectiveGroupValues(groupId)
    const selectedCount = otherVals.filter((v) => selectedValues.value.includes(v)).length
    return selectedCount > 0 && selectedCount < otherVals.length
  }
  return checkGroupPartiallySelected(props.config, groupId, selectedValues.value)
}

function isGroupActive(groupId: string): boolean {
  return isGroupFullySelected(groupId) || isGroupPartiallySelected(groupId)
}

function getGroupSelectedCount(groupId: string): number {
  const groupValues = getEffectiveGroupValues(groupId)
  return groupValues.filter((v) => selectedValues.value.includes(v)).length
}

// Toggle functions
function toggleGroupExpanded(groupId: string): void {
  const index = expandedGroups.value.indexOf(groupId)
  if (index === -1) {
    expandedGroups.value.push(groupId)
  } else {
    expandedGroups.value.splice(index, 1)
  }
}

function toggleGroupSelection(groupId: string): void {
  if (groupId === '_other') {
    // Handle "Other" group toggle manually
    const otherVals = getEffectiveGroupValues(groupId)
    const allSelected = otherVals.every((v) => selectedValues.value.includes(v))
    if (allSelected) {
      // Deselect all other items
      emit(
        'update:modelValue',
        selectedValues.value.filter((v) => !otherVals.includes(v))
      )
    } else {
      // Select all other items
      const newSelection = [...selectedValues.value]
      otherVals.forEach((v) => {
        if (!newSelection.includes(v)) {
          newSelection.push(v)
        }
      })
      emit('update:modelValue', newSelection)
    }
  } else {
    const newSelection = toggleGroup(props.config, groupId, selectedValues.value)
    emit('update:modelValue', newSelection)
  }
}

function toggleItem(value: string): void {
  const newSelection = selectedValues.value.includes(value)
    ? selectedValues.value.filter((v) => v !== value)
    : [...selectedValues.value, value]
  emit('update:modelValue', newSelection)
}

function selectAll(): void {
  // Select all from config groups + all "other" items
  const allValues = [
    ...getAllGroupValues(props.config),
    ...otherItems.value.map((item) => item.value)
  ]
  emit('update:modelValue', allValues)
}

function clearAll(): void {
  emit('update:modelValue', [])
}
</script>

<style scoped>
.grouped-select-input {
  min-width: 140px;
  max-width: 180px;
}

.grouped-select-input :deep(.v-field__input) {
  cursor: pointer;
}

.grouped-select-menu {
  max-height: 400px;
  overflow-y: auto;
}

.group-header {
  background: rgb(var(--v-theme-surface-variant), 0.3);
}

.group-header:hover {
  background: rgb(var(--v-theme-surface-variant), 0.5);
}

.group-active {
  background: rgb(var(--v-theme-primary), 0.08);
}

.item-row:hover {
  background: rgb(var(--v-theme-surface-variant), 0.2);
}

.border-b {
  border-bottom: 1px solid rgb(var(--v-border-color), var(--v-border-opacity));
}
</style>
