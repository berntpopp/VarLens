<template>
  <div ref="rootRef" class="filter-toolbar-container">
    <v-defaults-provider
      :defaults="{ VBtn: { size: 'small' }, VTextField: { density: 'compact' } }"
    >
      <v-toolbar
        density="compact"
        flat
        class="filter-toolbar px-2"
        tag="div"
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
          <v-icon start size="small" :icon="mdiFilterVariant" />
          <strong>{{ filteredCount.toLocaleString() }}</strong>
          <template v-if="totalCount !== null">
            <span class="mx-1" style="opacity: 0.7">/</span>
            <span style="opacity: 0.7">{{ totalCount.toLocaleString() }}</span>
          </template>
        </v-chip>

        <!-- Clear filters (also clears sort when hasClearableState is true) -->
        <v-btn
          :disabled="!hasActiveFilters && !hasClearableState"
          :color="hasActiveFilters || hasClearableState ? 'error' : undefined"
          :variant="hasActiveFilters || hasClearableState ? 'tonal' : 'text'"
          @click="clearAll"
        >
          <v-icon start size="small" :icon="mdiFilterOff" />
          Clear
          <v-tooltip activator="parent" location="bottom">Clear all filters</v-tooltip>
        </v-btn>

        <!-- Open filter drawer -->
        <v-btn variant="tonal" @click="emit('open-filter-drawer')">
          <v-icon start size="small" :icon="mdiFilterVariant" />
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
            <v-icon start size="small" :icon="mdiTableColumn" />
            Columns
            <v-tooltip activator="parent" location="bottom"
              >Toggle columns ({{ alt }}+Shift+C)</v-tooltip
            >
          </v-btn>

          <v-menu v-if="exportFormats && exportBlockedReason == null">
            <template #activator="{ props: exportMenuProps }">
              <v-btn
                v-bind="exportMenuProps"
                :loading="exporting"
                :disabled="filteredCount === 0"
                color="success"
                variant="tonal"
                data-testid="export-menu"
              >
                <v-icon start size="small" :icon="mdiMicrosoftExcel" />
                Export
              </v-btn>
            </template>
            <v-list density="compact">
              <v-list-item
                v-for="option in EXPORT_FORMAT_OPTIONS"
                :key="option.format"
                :title="option.title"
                :subtitle="`${filteredCount.toLocaleString()} variants`"
                :data-testid="`export-${option.format}`"
                @click="emit('export', option.format)"
              />
            </v-list>
          </v-menu>
          <v-btn
            v-else
            :loading="exporting"
            :disabled="filteredCount === 0 || exportBlockedReason != null"
            color="success"
            variant="tonal"
            @click="emit('export')"
          >
            <v-icon start size="small" :icon="mdiMicrosoftExcel" />
            Export
            <v-tooltip activator="parent" location="bottom">
              {{
                exportBlockedReason ?? `Export ${filteredCount.toLocaleString()} variants to Excel`
              }}
            </v-tooltip>
          </v-btn>
        </template>

        <!-- At narrow widths: overflow menu -->
        <v-menu v-else>
          <template #activator="{ props: menuProps }">
            <v-btn aria-label="More actions" v-bind="menuProps" icon size="small" variant="text">
              <v-icon :icon="mdiDotsVertical" />
              <v-tooltip activator="parent" location="bottom">More actions</v-tooltip>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              v-if="columns && columns.length > 0"
              :prepend-icon="mdiTableColumn"
              title="Columns"
              @click="emit('open-columns-drawer')"
            />
            <template v-if="exportFormats && exportBlockedReason == null">
              <v-list-item
                v-for="option in EXPORT_FORMAT_OPTIONS"
                :key="option.format"
                :prepend-icon="mdiMicrosoftExcel"
                :title="option.title"
                :disabled="filteredCount === 0"
                @click="emit('export', option.format)"
              />
            </template>
            <v-list-item
              v-else
              :prepend-icon="mdiMicrosoftExcel"
              title="Export"
              :subtitle="exportBlockedReason ?? undefined"
              :disabled="filteredCount === 0 || exportBlockedReason != null"
              @click="emit('export')"
            />
          </v-list>
        </v-menu>
      </v-toolbar>
    </v-defaults-provider>

    <!-- Preset bar (optional, provided by consumer) -->
    <slot name="preset-bar" />

    <!-- Applied Filters Summary Bar. Always rendered at a reserved height so
         applying/clearing a filter never pushes the table down or up. -->
    <div
      class="applied-filters-bar"
      :class="{ 'applied-filters-bar--empty': activeFiltersList.length === 0 }"
    >
      <v-icon size="small" class="text-medium-emphasis mr-1" :icon="mdiFilterCheck" />
      <span v-if="activeFiltersList.length === 0" class="text-caption text-medium-emphasis">
        No filters applied
      </span>
      <template v-else>
        <v-chip
          v-for="filter in activeFiltersList"
          :key="filter.id"
          size="small"
          closable
          variant="flat"
          color="primary"
          class="mr-1"
          @click:close="emit('clear-filter', filter.id)"
        >
          <strong>{{ filter.label }}</strong>
          <span class="ml-1">{{ filter.value }}</span>
        </v-chip>
        <v-btn variant="text" size="x-small" color="error" class="ml-auto" @click="clearAll">
          Clear all
        </v-btn>
      </template>
    </div>

    <!-- Optional hint bar (e.g. annotation filter hint) -->
    <slot name="hints" />

    <!-- Drawers rendered here so they stay in correct DOM position -->
    <slot name="drawers" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useResponsiveLayout } from '../composables/useResponsiveLayout'
import {
  mdiDotsVertical,
  mdiFilterCheck,
  mdiFilterOff,
  mdiFilterVariant,
  mdiMicrosoftExcel,
  mdiTableColumn
} from '@mdi/js'

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
  /** Why export is unavailable for this user (role); null/undefined = allowed. */
  exportBlockedReason?: string | null
  /** Offer a CSV / Excel choice (web: the browser download has no save dialog). */
  exportFormats?: boolean
}

const EXPORT_FORMAT_OPTIONS = [
  { format: 'csv', title: 'Download CSV' },
  { format: 'xlsx', title: 'Download Excel (.xlsx)' }
] as const

const props = defineProps<Props>()

// Pulse animation on count change
const countPulsing = ref(false)

watch(
  () => props.filteredCount,
  () => {
    countPulsing.value = true
    globalThis.setTimeout(() => {
      countPulsing.value = false
    }, 200)
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
const alt = isMac ? 'Option' : 'Alt'

const emit = defineEmits<{
  'clear-all': []
  'clear-filter': [filterId: string]
  'open-filter-drawer': []
  'open-columns-drawer': []
  export: [format?: 'csv' | 'xlsx']
}>()

const rootRef = ref<HTMLElement | null>(null)

/**
 * Clear, then keep keyboard focus inside the toolbar: the Clear buttons
 * disable/unmount once nothing is left to clear, which would otherwise drop
 * focus to <body>. Falls back to the first input (the search field).
 */
function clearAll(): void {
  emit('clear-all')
  void nextTick(() => {
    const active = document.activeElement as HTMLElement | null
    const lost =
      active === null ||
      active === document.body ||
      !active.isConnected ||
      active.hasAttribute('disabled')
    if (lost) rootRef.value?.querySelector<HTMLInputElement>('input')?.focus()
  })
}
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
  animation: count-pulse 200ms ease;
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

/* Applied filters summary bar (reserved height; see template) */
.applied-filters-bar {
  min-height: 37px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 16px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 6%, transparent);
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
  border-bottom: 1px solid rgba(var(--v-border-color), 0.08);
}

.applied-filters-bar--empty {
  background: transparent;
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
