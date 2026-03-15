<template>
  <div
    class="d-flex align-center justify-space-between header-wrapper"
    :class="{ 'filtered-column': hasFilter }"
  >
    <div
      class="d-flex align-center flex-grow-1 sortable-header"
      :class="{ 'sorted-header': isSorted(headerColumn) }"
      @click.stop="toggleSort(headerColumn)"
    >
      <span class="header-title"
        >{{ headerColumn.title }}
        <v-tooltip activator="parent" location="bottom">{{ headerColumn.title }}</v-tooltip>
      </span>
      <span v-if="isSorted(headerColumn)" class="sort-indicator ml-1">
        <v-icon size="x-small">{{ getSortIcon(headerColumn) }}</v-icon>
        <span v-if="sortIndex > 0" class="sort-priority">{{ sortIndex }}</span>
      </span>
      <v-icon v-else size="x-small" class="ml-1 sort-icon-inactive">mdi-sort</v-icon>
    </div>
    <v-menu v-model="menuOpen" :close-on-content-click="false" location="bottom">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          icon
          size="x-small"
          variant="text"
          :color="hasFilter ? 'primary' : undefined"
          @click.stop
        >
          <v-icon size="small">
            {{ hasFilter ? 'mdi-filter' : 'mdi-filter-outline' }}
          </v-icon>
          <v-tooltip activator="parent" location="bottom">Filter this column</v-tooltip>
        </v-btn>
      </template>

      <!-- Numeric filter -->
      <NumericColumnFilter
        v-if="filterMode === 'numeric'"
        :column-title="headerColumn.title"
        :min="columnMeta?.min"
        :max="columnMeta?.max"
        :initial-operator="numericInitialOperator"
        :initial-value="numericInitialValue"
        :initial-include-empty="numericInitialIncludeEmpty"
        @apply="handleNumericApply"
        @clear="handleClear"
      />

      <!-- Categorical filter -->
      <CategoricalColumnFilter
        v-else-if="filterMode === 'categorical'"
        :column-title="headerColumn.title"
        :values="columnMeta?.distinctValues ?? []"
        :initial-selected="categoricalInitialSelected"
        @apply="handleCategoricalApply"
        @clear="handleClear"
      />

      <!-- Text-suggest filter (default) -->
      <TextSuggestColumnFilter
        v-else
        :column-title="headerColumn.title"
        :suggestions="columnMeta?.distinctValues ?? []"
        :initial-value="textInitialValue"
        @apply="handleTextApply"
        @clear="handleClear"
      />
    </v-menu>
  </div>
</template>

<script setup lang="ts">
/**
 * VariantColumnHeader - Shared header template for variant/cohort table columns
 *
 * Renders a sortable header with sort priority indicator and per-column filter menu.
 * Auto-selects the correct filter component (numeric, categorical, text-suggest)
 * based on the filterMode prop. Used by both VariantTable and CohortDataTable.
 */
import { ref, computed } from 'vue'
import type {
  ColumnFilter,
  ColumnFilterMeta,
  ColumnFilterMode,
  ColumnFilterOperator
} from '../../../../shared/types/column-filters'
import NumericColumnFilter from './NumericColumnFilter.vue'
import CategoricalColumnFilter from './CategoricalColumnFilter.vue'
import TextSuggestColumnFilter from './TextSuggestColumnFilter.vue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VuetifyInternalColumn = any

interface SortItem {
  key: string
  order?: boolean | 'asc' | 'desc'
}

interface Props {
  /** The Vuetify internal column object from the header slot */
  headerColumn: VuetifyInternalColumn
  /** Function to get the sort icon for a column (Vuetify returns IconValue - complex union type) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSortIcon: (...args: any[]) => any
  /** Function to toggle sort on a column */
  toggleSort: (column: VuetifyInternalColumn) => void
  /** Function to check if a column is sorted */
  isSorted: (column: VuetifyInternalColumn) => boolean
  /** Current sortBy array from Vuetify (for multi-sort priority display) */
  sortBy?: readonly SortItem[]
  /** Whether this column currently has an active filter */
  hasFilter: boolean
  /** Current typed filter for this column */
  currentFilter?: ColumnFilter
  /** Column metadata from backend for filter UI (min/max, distinct values) */
  columnMeta?: ColumnFilterMeta
  /** Auto-detected or overridden filter mode */
  filterMode?: ColumnFilterMode
}

const props = withDefaults(defineProps<Props>(), {
  sortBy: undefined,
  currentFilter: undefined,
  columnMeta: undefined,
  filterMode: 'text-suggest'
})

/** 1-based sort priority index. Only shown when multiple columns are sorted. */
const sortIndex = computed(() => {
  if (!props.sortBy || props.sortBy.length <= 1) return 0
  const idx = props.sortBy.findIndex((s) => s.key === props.headerColumn.key)
  return idx >= 0 ? idx + 1 : 0
})

const emit = defineEmits<{
  'apply-filter': [filter: ColumnFilter]
  'clear-filter': []
}>()

const menuOpen = ref(false)

// Derive initial values from currentFilter for each filter type
const numericInitialOperator = computed<ColumnFilterOperator>(() => {
  if (props.currentFilter && props.filterMode === 'numeric') {
    return props.currentFilter.operator
  }
  return '='
})

const numericInitialValue = computed<number | undefined>(() => {
  if (props.currentFilter && props.filterMode === 'numeric') {
    const num = Number(props.currentFilter.value)
    return Number.isFinite(num) ? num : undefined
  }
  return undefined
})

const numericInitialIncludeEmpty = computed<boolean>(() => {
  if (props.currentFilter && props.filterMode === 'numeric') {
    return props.currentFilter.includeEmpty !== false
  }
  return true
})

const categoricalInitialSelected = computed<string[]>(() => {
  if (props.currentFilter && props.filterMode === 'categorical') {
    return Array.isArray(props.currentFilter.value) ? props.currentFilter.value : []
  }
  return []
})

const textInitialValue = computed<string>(() => {
  if (props.currentFilter && props.filterMode === 'text-suggest') {
    return String(props.currentFilter.value)
  }
  return ''
})

function handleNumericApply(payload: {
  operator: ColumnFilterOperator
  value: number
  includeEmpty?: boolean
}) {
  emit('apply-filter', {
    operator: payload.operator,
    value: payload.value,
    includeEmpty: payload.includeEmpty
  })
  menuOpen.value = false
}

function handleCategoricalApply(payload: { operator: 'in'; value: string[] }) {
  emit('apply-filter', { operator: payload.operator, value: payload.value })
  menuOpen.value = false
}

function handleTextApply(payload: { operator: ColumnFilterOperator; value: string }) {
  emit('apply-filter', { operator: payload.operator, value: payload.value })
  menuOpen.value = false
}

function handleClear() {
  emit('clear-filter')
  menuOpen.value = false
}
</script>

<style scoped>
.header-wrapper {
  width: 100%;
  gap: 4px;
}

.sortable-header {
  cursor: pointer;
  user-select: none;
  min-width: 0;
}

.sortable-header:hover {
  opacity: 0.7;
}

.sorted-header {
  color: rgb(var(--v-theme-primary));
}

.header-title {
  font-weight: 600;
  font-size: 0.8125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sort-indicator {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.sort-priority {
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1;
  opacity: 0.8;
}

.sort-icon-inactive {
  opacity: 0.3;
}

.sortable-header:hover .sort-icon-inactive {
  opacity: 0.6;
}

.filtered-column {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 6%, transparent);
  border-radius: 4px;
  padding: 2px 4px;
  margin: -2px -4px;
}
</style>
