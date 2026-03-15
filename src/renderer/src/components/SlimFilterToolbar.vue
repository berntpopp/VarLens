<template>
  <div class="filter-toolbar-container">
    <v-defaults-provider
      :defaults="{ VBtn: { size: 'small' }, VTextField: { density: 'compact' } }"
    >
      <v-toolbar
        density="compact"
        flat
        class="filter-toolbar px-2"
        role="toolbar"
        aria-label="Variant filters"
      >
        <!-- Variable filter inputs provided by consumer -->
        <slot name="filters" />

        <v-spacer />

        <!-- Result count chip -->
        <v-chip
          :color="hasActiveFilters ? 'primary' : 'default'"
          :variant="hasActiveFilters ? 'flat' : 'tonal'"
          size="small"
          class="results-chip mr-1"
          :class="{ 'count-updated': countPulsing }"
          aria-live="polite"
          :aria-label="`${filteredCount} of ${totalCount ?? 'unknown'} variants shown`"
        >
          <v-icon start size="small">mdi-filter-variant</v-icon>
          <strong>{{ filteredCount.toLocaleString() }}</strong>
          <template v-if="totalCount !== null">
            <span class="mx-1 text-medium-emphasis">/</span>
            <span class="text-medium-emphasis">{{ totalCount.toLocaleString() }}</span>
          </template>
        </v-chip>

        <!-- Clear filters (also clears sort when hasClearableState is true) -->
        <v-btn
          :disabled="!hasActiveFilters && !hasClearableState"
          :color="hasActiveFilters || hasClearableState ? 'error' : undefined"
          :variant="hasActiveFilters || hasClearableState ? 'tonal' : 'text'"
          @click="emit('clear-all')"
        >
          <v-icon start size="small">mdi-filter-off</v-icon>
          Clear
          <v-tooltip activator="parent" location="bottom">Clear all filters</v-tooltip>
        </v-btn>

        <!-- Open filter drawer -->
        <v-btn variant="tonal" @click="emit('open-filter-drawer')">
          <v-icon start size="small">mdi-filter-variant</v-icon>
          Filters
          <v-badge
            v-if="activeFilterCount > 0"
            :content="activeFilterCount"
            color="primary"
            inline
            class="ml-1"
          />
          <v-tooltip activator="parent" location="bottom">
            Toggle filters ({{ mod }}+Shift+F){{
              activeFilterCount > 0 ? ` \u2014 ${activeFilterCount} active` : ''
            }}
          </v-tooltip>
        </v-btn>

        <!-- At wide widths: show Columns and Export buttons directly -->
        <template v-if="!showOverflowMenu">
          <v-btn
            v-if="columns && columns.length > 0"
            variant="tonal"
            @click="emit('open-columns-drawer')"
          >
            <v-icon start size="small">mdi-table-column</v-icon>
            Columns
            <v-tooltip activator="parent" location="bottom"
              >Toggle columns ({{ mod }}+Shift+C)</v-tooltip
            >
          </v-btn>

          <v-btn
            :loading="exporting"
            :disabled="filteredCount === 0"
            color="success"
            variant="tonal"
            @click="emit('export')"
          >
            <v-icon start size="small">mdi-microsoft-excel</v-icon>
            Export
            <v-tooltip activator="parent" location="bottom">
              Export {{ filteredCount.toLocaleString() }} variants to Excel
            </v-tooltip>
          </v-btn>
        </template>

        <!-- At narrow widths: overflow menu -->
        <v-menu v-else>
          <template #activator="{ props: menuProps }">
            <v-btn v-bind="menuProps" icon size="small" variant="text">
              <v-icon>mdi-dots-vertical</v-icon>
              <v-tooltip activator="parent" location="bottom">More actions</v-tooltip>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              v-if="columns && columns.length > 0"
              prepend-icon="mdi-table-column"
              title="Columns"
              @click="emit('open-columns-drawer')"
            />
            <v-list-item
              prepend-icon="mdi-microsoft-excel"
              title="Export"
              :disabled="filteredCount === 0"
              @click="emit('export')"
            />
          </v-list>
        </v-menu>
      </v-toolbar>
    </v-defaults-provider>

    <!-- Preset bar (optional, provided by consumer) -->
    <slot name="preset-bar" />

    <!-- Applied Filters Summary Bar -->
    <v-expand-transition>
      <div v-if="activeFiltersList.length > 0" class="applied-filters-bar">
        <v-icon size="small" class="text-medium-emphasis mr-1">mdi-filter-check</v-icon>
        <v-chip
          v-for="filter in activeFiltersList"
          :key="filter.id"
          size="small"
          closable
          variant="tonal"
          color="primary"
          class="mr-1"
          @click:close="emit('clear-filter', filter.id)"
        >
          <strong>{{ filter.label }}</strong>
          <span class="ml-1">{{ filter.value }}</span>
        </v-chip>
        <v-btn
          variant="text"
          size="x-small"
          color="error"
          class="ml-auto"
          @click="emit('clear-all')"
        >
          Clear all
        </v-btn>
      </div>
    </v-expand-transition>

    <!-- Optional hint bar (e.g. annotation filter hint) -->
    <slot name="hints" />

    <!-- Drawers rendered here so they stay in correct DOM position -->
    <slot name="drawers" />
  </div>
</template>

<script setup lang="ts">
/* global navigator */
import { ref, computed, watch } from 'vue'
import { useResponsiveLayout } from '../composables/useResponsiveLayout'

interface ActiveFilter {
  id: string
  label: string
  value: string
}

interface ColumnDef {
  key: string
  title: string
}

interface Props {
  filteredCount: number
  totalCount: number | null
  hasActiveFilters: boolean
  activeFilterCount: number
  activeFiltersList: ActiveFilter[]
  exporting?: boolean
  columns?: ColumnDef[]
  /** When true, Clear button is enabled even without active filters (e.g. sort is applied) */
  hasClearableState?: boolean
}

const props = defineProps<Props>()

// Pulse animation on count change
const countPulsing = ref(false)

watch(
  () => props.filteredCount,
  () => {
    countPulsing.value = true
    globalThis.setTimeout(() => {
      countPulsing.value = false
    }, 300)
  }
)

// Responsive: collapse Columns/Export into overflow menu at non-full widths
const { tier } = useResponsiveLayout()
const showOverflowMenu = computed(() => tier.value !== 'full')

const isMac =
  typeof navigator !== 'undefined' &&
  typeof navigator.platform === 'string' &&
  navigator.platform.toUpperCase().indexOf('MAC') >= 0
const mod = isMac ? 'Cmd' : 'Ctrl'

const emit = defineEmits<{
  'clear-all': []
  'clear-filter': [filterId: string]
  'open-filter-drawer': []
  'open-columns-drawer': []
  export: []
}>()
</script>

<style scoped>
.filter-toolbar-container {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  background: rgb(var(--v-theme-surface));
}

.filter-toolbar {
  background: transparent !important;
}

.results-chip {
  font-size: 0.85rem;
  transition:
    transform 150ms ease,
    box-shadow 150ms ease;
}

.results-chip.count-updated {
  animation: count-pulse 300ms ease;
}

@keyframes count-pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
    box-shadow: 0 0 0 4px color-mix(in srgb, rgb(var(--v-theme-primary)) 20%, transparent);
  }
  100% {
    transform: scale(1);
  }
}

/* Applied filters summary bar */
.applied-filters-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 16px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
  border-left: 3px solid rgb(var(--v-theme-primary));
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
}

.applied-filters-bar .v-chip {
  max-width: 200px;
}

.applied-filters-bar .v-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
