<template>
  <Transition name="slide-up">
    <div v-if="isOpen" class="log-viewer-panel d-flex flex-column">
      <!-- Compact toolbar with stats and actions -->
      <v-toolbar density="compact" color="surface" class="flex-grow-0">
        <v-toolbar-title class="text-title-small">Log Viewer</v-toolbar-title>

        <v-spacer />

        <!-- Buffer + memory stats inline -->
        <div class="d-flex align-center text-body-small text-medium-emphasis mr-1">
          <span>{{ bufferUsage.current }}/{{ bufferUsage.max }}</span>
          <span v-if="stats.totalDropped > 0" class="text-warning ml-1">
            ({{ stats.totalDropped }} dropped)
          </span>
          <span class="mx-2">|</span>
          <span
            >Mem: {{ memoryUsage }}
            <v-tooltip activator="parent" location="top">Renderer JS heap usage</v-tooltip>
          </span>
        </div>

        <!-- Action buttons -->
        <div class="log-viewer-actions d-flex align-center">
          <v-btn icon size="small" variant="text" @click="handleExport">
            <v-icon size="small" :icon="mdiDownload" />
            <v-tooltip activator="parent" location="top">Download logs</v-tooltip>
          </v-btn>
          <v-btn icon size="small" variant="text" @click="handleClear">
            <v-icon size="small" :icon="mdiDeleteOutline" />
            <v-tooltip activator="parent" location="top">Clear logs</v-tooltip>
          </v-btn>
          <v-btn icon size="small" variant="text" @click="isOpen = false">
            <v-icon size="small" :icon="mdiClose" />
            <v-tooltip activator="parent" location="top">Close</v-tooltip>
          </v-btn>
        </div>
      </v-toolbar>

      <!-- Single-row filter bar: search + level chips -->
      <div class="d-flex align-center px-2 py-1 bg-grey-lighten-3 flex-grow-0">
        <v-text-field
          v-model="searchInput"
          :prepend-inner-icon="mdiMagnify"
          placeholder="Search..."
          density="compact"
          hide-details
          variant="outlined"
          clearable
          class="filter-search flex-grow-0 flex-shrink-0"
        />
        <v-chip-group v-model="selectedLevels" multiple class="ml-2 flex-shrink-1">
          <v-chip
            v-for="level in LOG_LEVELS"
            :key="level"
            filter
            :value="level"
            :color="LOG_LEVEL_COLORS[level]"
            size="x-small"
            variant="outlined"
          >
            {{ level }} ({{ bufferLevelCounts[level] || 0 }})
          </v-chip>
        </v-chip-group>
      </div>

      <!-- Log entries list -->
      <div class="flex-grow-1 position-relative overflow-hidden">
        <v-virtual-scroll
          v-if="filteredLogs.length > 0"
          ref="virtualScrollRef"
          :items="filteredLogs"
          :item-height="64"
          class="fill-height"
          @scroll="handleScroll"
        >
          <template #default="{ item }">
            <div class="log-entry pa-2">
              <!-- First line: level badge + message -->
              <div class="d-flex align-center mb-1">
                <v-chip
                  :color="LOG_LEVEL_COLORS[item.level]"
                  size="x-small"
                  label
                  variant="flat"
                  class="mr-2"
                >
                  {{ item.level }}
                </v-chip>
                <!-- eslint-disable-next-line vue/no-v-html -- safe: text and search term are HTML-escaped before interpolation -->
                <span class="text-body-medium" v-html="highlightSearch(item.message)" />
              </div>
              <!-- Second line: timestamp + source -->
              <div class="text-body-small text-medium-emphasis">
                {{ formatTimestamp(item.timestamp) }}
                <span v-if="item.source" class="font-italic ml-2">{{ item.source }}</span>
              </div>
            </div>
          </template>
        </v-virtual-scroll>

        <!-- Empty state -->
        <div
          v-else
          class="d-flex align-center justify-center fill-height text-medium-emphasis text-body-medium"
        >
          {{ entries.length === 0 ? 'No log entries' : 'No matching entries' }}
        </div>

        <!-- Scroll to latest FAB -->
        <v-btn
          v-if="!isAutoScroll"
          :icon="mdiChevronDown"
          size="small"
          color="primary"
          class="scroll-to-latest-fab"
          position="absolute"
          style="bottom: 16px; right: 16px"
          @click="scrollToLatest"
        >
        </v-btn>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useLogStore } from '../stores/logStore'
import { logService } from '../services/LogService'
import { useDebounce } from '../composables/useDebounce'
import { LOG_LEVELS, LOG_LEVEL_COLORS, type LogLevel } from '../types/log'
import { mdiChevronDown, mdiClose, mdiDeleteOutline, mdiDownload, mdiMagnify } from '@mdi/js'

// Props
const isOpen = defineModel<boolean>('open', { default: false })

// Store
const logStore = useLogStore()
const { entries, stats, bufferUsage } = storeToRefs(logStore)

// Search state
const searchInput = ref('')
const debouncedSearch = ref('')

// Debounce search input
const { debouncedFn: updateDebouncedSearch } = useDebounce((value: string) => {
  debouncedSearch.value = value
}, 300)

watch(searchInput, (newValue) => {
  updateDebouncedSearch(newValue ?? '')
})

// Filter state
const selectedLevels = ref<LogLevel[]>([...LOG_LEVELS])

// Memory usage state
const memoryUsage = ref('N/A')

// Auto-scroll state
const isAutoScroll = ref(true)
const virtualScrollRef = ref<{ $el: HTMLElement } | null>(null)

// Computed: filtered logs
const filteredLogs = computed(() => {
  let result = entries.value

  // Filter by selected levels
  if (selectedLevels.value.length > 0) {
    result = result.filter((entry) => selectedLevels.value.includes(entry.level))
  }

  // Filter by search text
  if (debouncedSearch.value !== '') {
    const searchLower = debouncedSearch.value.toLowerCase()
    result = result.filter((entry) => {
      const messageMatch = entry.message.toLowerCase().includes(searchLower) === true
      const sourceMatch =
        entry.source !== undefined && entry.source.toLowerCase().includes(searchLower) === true
      return messageMatch || sourceMatch
    })
  }

  return result
})

// Computed: per-level counts from current entries
const bufferLevelCounts = computed(() => {
  const counts: Record<LogLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    critical: 0
  }

  for (const entry of entries.value) {
    counts[entry.level]++
  }

  return counts
})

// Format timestamp
function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  } as Intl.DateTimeFormatOptions).format(new Date(timestamp))
}

// Highlight search matches
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightSearch(text: string): string {
  const escaped = escapeHtml(text)
  if (debouncedSearch.value === '') {
    return escaped
  }

  const safeSearch = escapeHtml(debouncedSearch.value)
  const regex = new RegExp(`(${escapeRegExp(safeSearch)})`, 'gi')
  return escaped.replace(regex, '<mark class="bg-yellow">$1</mark>')
}

// Handle scroll — RAF-batched to avoid firing hundreds of times per second
let scrollTicking = false
function handleScroll(event: Event): void {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(() => {
    const target = event.target as HTMLElement
    if (target !== null) {
      const { scrollTop, scrollHeight, clientHeight } = target
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50
      if (!isNearBottom) {
        isAutoScroll.value = false
      }
    }
    scrollTicking = false
  })
}

// Scroll to latest
function scrollToLatest(): void {
  if (virtualScrollRef.value !== null && virtualScrollRef.value.$el !== undefined) {
    const container = virtualScrollRef.value.$el.querySelector('.v-virtual-scroll__container')
    if (container !== null) {
      container.scrollTop = container.scrollHeight
    }
  }
  isAutoScroll.value = true
}

// Auto-scroll on new entries
watch(
  () => entries.value.length,
  () => {
    if (isAutoScroll.value === true) {
      nextTick(() => {
        scrollToLatest()
      })
    }
  }
)

// Export logs
function handleExport(): void {
  logService.exportLogs()
}

// Clear logs
function handleClear(): void {
  if (window.confirm('Clear all log entries?') === true) {
    logService.clearLogs()
  }
}

// Memory polling
let memoryInterval: number | null = null

function updateMemoryUsage(): void {
  const perf = performance as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }
  if (perf.memory !== undefined) {
    const usedMB = perf.memory.usedJSHeapSize / (1024 * 1024)
    memoryUsage.value = `${usedMB.toFixed(1)} MB`
  } else {
    memoryUsage.value = 'N/A'
  }
}

onMounted(() => {
  updateMemoryUsage()
  memoryInterval = window.setInterval(updateMemoryUsage, 5000) as unknown as number
})

onBeforeUnmount(() => {
  if (memoryInterval !== null) {
    window.clearInterval(memoryInterval)
    memoryInterval = null
  }
})
</script>

<style scoped>
.log-viewer-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40vh;
  z-index: 2010;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-border-color), 0.2);
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.15);
}

.log-entry {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
}

.log-entry:hover {
  background-color: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 4%, transparent);
}

.log-viewer-actions {
  gap: 6px;
  padding-right: 4px;
}

.scroll-to-latest-fab {
  z-index: 10;
}

.filter-search {
  width: 200px;
  min-width: 120px;
}

.filter-search :deep(.v-field) {
  font-size: 0.8125rem;
}

:deep(.bg-yellow) {
  background-color: #ffeb3b;
  padding: 0 2px;
}

/* Slide-up transition */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.2s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
