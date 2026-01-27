# Phase 10: Logging Infrastructure & Viewer - Research

**Researched:** 2026-01-27
**Domain:** Frontend logging system with sanitization and viewer UI
**Confidence:** HIGH

## Summary

This phase implements a comprehensive logging subsystem for an Electron desktop app built with Vue 3, Vuetify 3, and TypeScript. The research focused on: (1) Pinia store patterns for managing a circular buffer of log entries, (2) Vuetify 3 navigation drawer for bottom-drawer UI, (3) text sanitization patterns for HGVS notation and genomic coordinates, (4) reactive filtering/search patterns, and (5) JSON export and localStorage configuration.

The standard approach uses Pinia setup stores with TypeScript for type-safe state management, Vuetify 3's `v-navigation-drawer` with `location="bottom"` for the drawer UI, regex-based sanitization at capture time, and Vue's computed properties for real-time filtering. The project already has debounce utilities and file-saver in place, reducing external dependencies.

**Primary recommendation:** Install Pinia and implement setup stores (not options API) for better TypeScript inference. Use hand-rolled circular buffer logic within the store rather than external packages—it's simple enough that custom implementation provides better control and integration. Sanitization should occur at log entry capture using typed redaction markers.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Pinia | ^2.2.x | State management for log store | Official Vue 3 state management, first-class TypeScript support, replaces Vuex |
| Vue 3 | ^3.5.x (installed) | Reactive framework | Already project dependency, Composition API ideal for composables |
| Vuetify 3 | ^3.11.7 (installed) | UI components (drawer, chips, cards) | Already project dependency, Material Design components |
| TypeScript | ^5.9.x (installed) | Type safety | Already configured, essential for large apps |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| file-saver | ^2.0.5 (installed) | JSON export downloads | Already installed, use for log export |
| VueUse (optional) | ^11.x | useLocalStorage composable | Optional—could simplify localStorage reactivity but not required |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pinia | Vuex 4 | Vuex is legacy; Pinia has better TypeScript and simpler API |
| Hand-rolled circular buffer | ring-buffer-ts npm package | Hand-rolled is simpler for this use case—only need push/clear/size operations |
| localStorage | electron-store | electron-store not maintained actively; localStorage works fine for JSON config |
| Native Blob/saveAs | Custom download | file-saver already installed, provides cross-browser compatibility |

**Installation:**
```bash
npm install pinia@^2.2
```

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/
├── stores/
│   └── logStore.ts              # Pinia store with circular buffer
├── services/
│   └── LogService.ts            # Logging facade, sanitization
├── components/
│   └── LogViewer.vue            # Bottom drawer component
├── composables/
│   └── useDebounce.ts           # Already exists, use for search
└── utils/
    └── sanitizers.ts            # Regex patterns for PII redaction
```

### Pattern 1: Pinia Setup Store with Circular Buffer

**What:** Setup store (not Options API) with reactive refs for buffer state and computed for derived values.

**When to use:** Always for new Pinia stores in Vue 3 TypeScript projects—better type inference.

**Example:**
```typescript
// stores/logStore.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface LogEntry {
  id: number
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical'
  message: string
  source?: string
}

export interface LogStatistics {
  totalReceived: number
  totalDropped: number
  debugCount: number
  infoCount: number
  warnCount: number
  errorCount: number
  criticalCount: number
}

export const useLogStore = defineStore('logs', () => {
  const maxEntries = ref(1000)
  const entries = ref<LogEntry[]>([])
  const stats = ref<LogStatistics>({
    totalReceived: 0,
    totalDropped: 0,
    debugCount: 0,
    infoCount: 0,
    warnCount: 0,
    errorCount: 0,
    criticalCount: 0
  })

  // Computed for buffer fullness
  const bufferUsage = computed(() => ({
    current: entries.value.length,
    max: maxEntries.value,
    percentage: (entries.value.length / maxEntries.value) * 100
  }))

  // Action: Add log entry (circular buffer logic)
  function addEntry(entry: Omit<LogEntry, 'id'>) {
    const newEntry: LogEntry = {
      ...entry,
      id: stats.value.totalReceived
    }

    // Circular buffer: if full, remove oldest
    if (entries.value.length >= maxEntries.value) {
      entries.value.shift()
      stats.value.totalDropped++
    }

    entries.value.push(newEntry)
    stats.value.totalReceived++

    // Update per-level counts
    const levelKey = `${entry.level}Count` as keyof LogStatistics
    stats.value[levelKey] = (stats.value[levelKey] as number) + 1
  }

  // Action: Clear all logs
  function clear() {
    entries.value = []
    // Keep cumulative stats, only reset current buffer
  }

  // Action: Configure max entries
  function setMaxEntries(max: number) {
    maxEntries.value = max
    // Trim if new max is smaller
    if (entries.value.length > max) {
      const toRemove = entries.value.length - max
      entries.value.splice(0, toRemove)
      stats.value.totalDropped += toRemove
    }
  }

  return {
    entries,
    stats,
    maxEntries,
    bufferUsage,
    addEntry,
    clear,
    setMaxEntries
  }
})
```
_Source: [Pinia Core Concepts](https://pinia.vuejs.org/core-concepts/), project pattern from useDebounce.ts_

### Pattern 2: Regex-Based Sanitization at Capture Time

**What:** Apply regex patterns to log messages before storing, replacing matches with typed redaction markers.

**When to use:** At log entry creation, before passing to store—ensures sensitive data never persists.

**Example:**
```typescript
// utils/sanitizers.ts

// HGVS notation patterns: c.123A>G, p.Arg459*, g.12345C>T
const HGVS_PATTERN = /\b[cgpmn]\.\d+[+-]?\d*([A-Z][a-z]{2})?\d*[*>_]?\S*/gi

// Genomic coordinates: chr1:12345, chr1:12345-67890, 1:12345
const GENOMIC_COORD_PATTERN = /\b(chr)?([0-9]{1,2}|X|Y|M|MT):(\d+)(-\d+)?\b/gi

// Patient/sample identifiers: flexible patterns for common ID formats
// Examples: PATIENT-12345, SAMPLE_ABC123, ID:987654
const PATIENT_ID_PATTERN = /\b(PATIENT|SAMPLE|SUBJECT|ID)[_:-]?[A-Z0-9]{3,}\b/gi

export function sanitizeLogMessage(message: string): string {
  let sanitized = message

  // Redact HGVS notation
  sanitized = sanitized.replace(HGVS_PATTERN, '[REDACTED:HGVS]')

  // Redact genomic coordinates
  sanitized = sanitized.replace(GENOMIC_COORD_PATTERN, '[REDACTED:COORD]')

  // Redact patient identifiers
  sanitized = sanitized.replace(PATIENT_ID_PATTERN, '[REDACTED:ID]')

  return sanitized
}
```
_Source: [HGVS Nomenclature](https://hgvs-nomenclature.org/stable/), [hgvs-regexp GitHub](https://github.com/7ravis/hgvs-regexp), [Datadog PII Redaction](https://www.datadoghq.com/blog/observability-pipelines-sensitive-data-redaction/)_

### Pattern 3: LogService Facade

**What:** Service class that wraps the Pinia store, provides level-specific methods, applies sanitization.

**When to use:** Always—separates logging API from storage implementation.

**Example:**
```typescript
// services/LogService.ts
import { useLogStore, type LogEntry } from '../stores/logStore'
import { sanitizeLogMessage } from '../utils/sanitizers'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical'

class LogService {
  private store = useLogStore()

  private log(level: LogLevel, message: string, source?: string) {
    const sanitizedMessage = sanitizeLogMessage(message)

    this.store.addEntry({
      timestamp: Date.now(),
      level,
      message: sanitizedMessage,
      source
    })
  }

  debug(message: string, source?: string) {
    this.log('debug', message, source)
  }

  info(message: string, source?: string) {
    this.log('info', message, source)
  }

  warn(message: string, source?: string) {
    this.log('warn', message, source)
  }

  error(message: string, source?: string) {
    this.log('error', message, source)
  }

  critical(message: string, source?: string) {
    this.log('critical', message, source)
  }

  exportLogs(): Blob {
    const entries = this.store.entries
    const data = JSON.stringify(entries, null, 2)
    return new Blob([data], { type: 'application/json' })
  }

  clearLogs() {
    this.store.clear()
  }
}

export const logService = new LogService()
```

### Pattern 4: Vuetify Bottom Drawer

**What:** `v-navigation-drawer` with `location="bottom"` for DevTools-style slide-up panel.

**When to use:** For log viewer UI, similar to browser DevTools console.

**Example:**
```vue
<template>
  <v-navigation-drawer
    v-model="isOpen"
    location="bottom"
    :height="drawerHeight"
    temporary
    :scrim="false"
  >
    <v-toolbar color="surface" density="compact">
      <v-toolbar-title>Log Viewer</v-toolbar-title>
      <v-spacer />
      <v-btn icon="mdi-close" @click="isOpen = false" />
    </v-toolbar>

    <!-- Toolbar with search/filters -->
    <v-sheet class="pa-2 border-b">
      <v-text-field
        v-model="searchQuery"
        prepend-inner-icon="mdi-magnify"
        placeholder="Search logs..."
        density="compact"
        hide-details
      />

      <v-chip-group v-model="selectedLevels" multiple class="mt-2">
        <v-chip
          v-for="level in LOG_LEVELS"
          :key="level"
          filter
          :value="level"
        >
          {{ level }} ({{ levelCounts[level] }})
        </v-chip>
      </v-chip-group>
    </v-sheet>

    <!-- Log entries list -->
    <v-virtual-scroll
      :items="filteredLogs"
      height="400"
      item-height="80"
    >
      <template #default="{ item }">
        <LogEntryCard :entry="item" />
      </template>
    </v-virtual-scroll>
  </v-navigation-drawer>
</template>
```
_Source: [Vuetify Navigation Drawer](https://vuetifyjs.com/en/components/navigation-drawers/)_

### Pattern 5: Computed-Based Real-Time Filtering

**What:** Computed property that filters log array based on search text and selected levels, with debounced search input.

**When to use:** For responsive filtering without external libraries—Vue's reactivity handles updates.

**Example:**
```typescript
// In LogViewer.vue <script setup>
import { ref, computed } from 'vue'
import { useDebounce } from '../composables/useDebounce'
import { useLogStore } from '../stores/logStore'

const logStore = useLogStore()
const searchQuery = ref('')
const selectedLevels = ref(['debug', 'info', 'warn', 'error', 'critical'])

// Debounce search input (already have this composable)
const { debouncedFn: updateSearch } = useDebounce((value: string) => {
  searchQuery.value = value
}, 300)

// Computed filter: runs on every state change
const filteredLogs = computed(() => {
  return logStore.entries.filter(entry => {
    // Filter by level
    if (!selectedLevels.value.includes(entry.level)) {
      return false
    }

    // Filter by search text
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      return entry.message.toLowerCase().includes(query) ||
             entry.source?.toLowerCase().includes(query)
    }

    return true
  })
})

// Computed level counts for chip badges
const levelCounts = computed(() => {
  const counts = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    critical: 0
  }

  logStore.entries.forEach(entry => {
    counts[entry.level]++
  })

  return counts
})
```
_Source: [5 Balloons VueJS Filtering](https://5balloons.info/filtering-list-using-computed-properties-in-vuejs/), [SoftAuthor Vue 3 Search](https://softauthor.com/vuejs-composition-api-search-bar-using-computed-properties/)_

### Pattern 6: localStorage Configuration with Reactive Sync

**What:** Store log configuration in localStorage, load on startup, sync changes bidirectionally.

**When to use:** For user preferences that persist across app restarts—localStorage is simplest for Electron apps.

**Example:**
```typescript
// stores/logStore.ts (add to setup store)

const CONFIG_KEY = 'varlens_log_config'

interface LogConfig {
  maxEntries: number
  minLevel: 'debug' | 'info' | 'warn' | 'error' | 'critical'
}

const DEFAULT_CONFIG: LogConfig = {
  maxEntries: 1000,
  minLevel: 'debug'
}

// Load config from localStorage on store creation
function loadConfig(): LogConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY)
    return stored ? JSON.parse(stored) : DEFAULT_CONFIG
  } catch {
    return DEFAULT_CONFIG
  }
}

// Save config to localStorage
function saveConfig(config: LogConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

// Initialize with stored config
const config = ref<LogConfig>(loadConfig())

// Watch for changes and persist
watch(config, (newConfig) => {
  saveConfig(newConfig)
  maxEntries.value = newConfig.maxEntries
}, { deep: true })
```
_Source: [GeeksforGeeks localStorage reactive](https://www.geeksforgeeks.org/javascript/how-to-make-localstorage-reactive-in-vue-js/)_

### Pattern 7: Auto-Scroll with User Pause Detection

**What:** Auto-scroll to newest logs, but pause when user scrolls up, show "resume" button.

**When to use:** Chat-style log viewers where newest entries appear at bottom.

**Example:**
```typescript
// In LogViewer.vue
const scrollContainer = ref<HTMLElement | null>(null)
const isAutoScrollEnabled = ref(true)
const isUserScrolling = ref(false)

// Scroll to bottom when new entries arrive
watch(() => logStore.entries.length, () => {
  if (isAutoScrollEnabled.value && !isUserScrolling.value) {
    nextTick(() => {
      scrollContainer.value?.scrollTo({
        top: scrollContainer.value.scrollHeight,
        behavior: 'smooth'
      })
    })
  }
})

// Detect user scrolling up (pauses auto-scroll)
function handleScroll(event: Event) {
  const el = event.target as HTMLElement
  const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50

  isAutoScrollEnabled.value = isAtBottom
}
```
_Source: [Vue Chat Scroll Gist](https://gist.github.com/sagearslan/31c017d2d772d3612a90d29a2d82859e)_

### Anti-Patterns to Avoid

- **Don't destructure Pinia stores without `storeToRefs()`** — Breaks reactivity; use `const { entries } = storeToRefs(logStore)` instead of `const { entries } = logStore`
- **Don't use reactive() for arrays that get replaced** — Use `ref()` for arrays to avoid reference issues
- **Don't sanitize on read/export** — Sanitize at capture time; sensitive data should never enter the store
- **Don't use v-navigation-drawer `bottom` prop** — Deprecated in Vuetify 3; use `location="bottom"` instead
- **Don't filter logs with watchers** — Use computed properties for automatic reactivity
- **Don't store large objects in reactive state** — For 1000+ log entries, use virtual scrolling (`v-virtual-scroll`)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounced search input | Custom setTimeout wrapper | Project's `useDebounce` composable | Already exists in `src/renderer/src/composables/useDebounce.ts` |
| JSON file download | Custom Blob + URL.createObjectURL | file-saver package | Already installed, handles cross-browser edge cases |
| Virtual scrolling | Custom windowing logic | Vuetify's `v-virtual-scroll` | Built-in, handles variable heights, performance optimized |
| Timestamp formatting | String manipulation | Native `Intl.DateTimeFormat` | Locale-aware, handles timezones, standard |

**Key insight:** For circular buffer, hand-rolling is actually *preferred* here—the logic is trivial (array push + shift) and avoids an extra dependency. External packages like `ring-buffer-ts` are overkill for this use case.

## Common Pitfalls

### Pitfall 1: Pinia Store Destructuring Breaks Reactivity

**What goes wrong:** Destructuring store properties directly (without `storeToRefs()`) loses reactivity in components.

**Why it happens:** Stores are wrapped with `reactive()`, and destructuring extracts plain values, not reactive refs.

**How to avoid:**
```typescript
// ❌ Wrong: Breaks reactivity
const { entries } = useLogStore()

// ✅ Correct: Preserves reactivity
import { storeToRefs } from 'pinia'
const { entries } = storeToRefs(useLogStore())

// Actions can be destructured directly (they're methods, not reactive state)
const { addEntry, clear } = useLogStore()
```

**Warning signs:** UI doesn't update when store state changes; Vue DevTools shows store updating but component stays stale.

_Source: [Mastering Pinia Top 5 Mistakes](https://masteringpinia.com/blog/top-5-mistakes-to-avoid-when-using-pinia)_

### Pitfall 2: Vuetify Drawer Z-Index Conflicts

**What goes wrong:** Drawer appears behind other components (toolbar, overlays) or doesn't show overlay scrim correctly.

**Why it happens:** Vuetify's z-index layering conflicts with custom components; `temporary` mode sometimes doesn't set correct z-index class.

**How to avoid:**
- Use `temporary` prop for modal-style drawers (adds overlay)
- Set `scrim="false"` if you want drawer without overlay
- If z-index issues persist, wrap drawer in `v-app` or add explicit z-index via class
- Avoid mixing `position: fixed` elements with drawer—use Vuetify's layout system

**Warning signs:** Drawer hidden behind toolbar; can't click drawer contents; drawer overlay covers drawer itself.

_Source: [Vuetify GitHub Issue #4241](https://github.com/vuetifyjs/vuetify/issues/4241), [Issue #2687](https://github.com/vuetifyjs/vuetify/issues/2687)_

### Pitfall 3: Regex Sanitization Performance on Large Logs

**What goes wrong:** Applying multiple regex patterns to every log message causes noticeable lag when logging frequently (e.g., 100+ logs/sec).

**Why it happens:** Regex is CPU-intensive; running 3+ patterns on every message adds up quickly.

**How to avoid:**
- Apply sanitization only if message contains potential matches (use quick pre-check like `includes('chr')` before genomic coord regex)
- Consider debouncing rapid log bursts from same source
- If performance issues persist, move sanitization to a Web Worker (overkill for most cases)

**Warning signs:** UI jank when many logs arrive; profiler shows high time in sanitization functions.

_Source: Domain knowledge, [Elastic PII Redaction Part 2](https://www.elastic.co/observability-labs/blog/pii-ner-regex-assess-redact-part-2)_

### Pitfall 4: Circular Buffer Statistics Out of Sync

**What goes wrong:** Per-level counts don't match actual entries in buffer after entries are dropped.

**Why it happens:** When circular buffer drops old entries, per-level stats still count them (cumulative), but buffer only shows current entries.

**How to avoid:**
- Clearly separate cumulative stats (total received, total dropped) from current buffer stats
- Provide two stat views: "Session Stats" (cumulative) and "Buffer Stats" (current entries only)
- Recompute per-level counts from current buffer when displaying "Buffer Stats"

**Warning signs:** Chip badge shows "Error (50)" but only 10 error logs visible in list; stats don't decrease when old logs drop.

### Pitfall 5: Auto-Scroll Fights User Interaction

**What goes wrong:** User scrolls up to read old logs, but auto-scroll keeps snapping back to bottom on new entries.

**Why it happens:** Watch on log length triggers scroll without checking user intent.

**How to avoid:**
- Detect when user manually scrolls away from bottom (compare scrollTop + clientHeight vs scrollHeight)
- Pause auto-scroll when user is not at bottom
- Show floating "Resume Auto-Scroll" button when paused
- Resume auto-scroll when user manually scrolls to bottom

**Warning signs:** User complains they can't read old logs; scroll position jumps unexpectedly.

_Source: [vue-chat-scroll GitHub](https://github.com/theomessin/vue-chat-scroll), [Auto-scroll Gist](https://gist.github.com/sagearslan/31c017d2d772d3612a90d29a2d82859e)_

### Pitfall 6: Memory Leak from Unbounded Watch/Computed

**What goes wrong:** Creating computed properties or watchers inside loops or without proper cleanup causes memory leaks.

**Why it happens:** Vue doesn't automatically clean up watchers/computed created outside component lifecycle.

**How to avoid:**
- Use computed properties at component top level, not inside functions
- When creating watchers programmatically, store the stop handle and call it on unmount
- For log viewer, use single computed for filtered logs, not per-entry computed

**Warning signs:** Memory usage grows over time; DevTools shows increasing watcher count; app slows down after prolonged use.

_Source: [Medium Vue 3 Performance Pitfalls](https://medium.com/simform-engineering/7-vue-3-performance-pitfalls-that-quietly-derail-your-app-33c7180d68d4)_

## Code Examples

Verified patterns from official sources:

### Level Color Palette (Material Design Semantic)

```typescript
// For log level colors, integrate with Vuetify theme
// Define in vuetify config or use built-in semantic colors

export const LOG_LEVEL_COLORS = {
  debug: 'grey',          // Grey for low-priority
  info: 'blue',           // Blue for informational
  warn: 'amber',          // Amber/yellow for warnings
  error: 'red',           // Red for errors
  critical: 'deep-purple' // Purple for critical (highest severity)
} as const

// Use in components:
<v-chip :color="LOG_LEVEL_COLORS[entry.level]">
  {{ entry.level.toUpperCase() }}
</v-chip>

// Or as border strip:
<v-card :border-start="LOG_LEVEL_COLORS[entry.level]">
  <!-- log content -->
</v-card>
```
_Source: [Material UI Palette](https://mui.com/material-ui/customization/palette/), [Cieden System Colors](https://cieden.com/book/sub-atomic/color/system-colors)_

### FileSaver JSON Export

```typescript
// services/LogService.ts
import { saveAs } from 'file-saver'

export function exportLogsToFile() {
  const logStore = useLogStore()

  const exportData = {
    exportedAt: new Date().toISOString(),
    appVersion: '0.2.0',
    stats: logStore.stats,
    entries: logStore.entries
  }

  const blob = new Blob(
    [JSON.stringify(exportData, null, 2)],
    { type: 'application/json;charset=utf-8' }
  )

  const filename = `varlens-logs-${Date.now()}.json`
  saveAs(blob, filename)
}
```
_Source: [FileSaver.js GitHub](https://github.com/eligrey/FileSaver.js), [Erik Martin Jordan Tutorial](https://erikmartinjordan.com/download-data-json)_

### Memory Usage Display (Electron-Safe)

```typescript
// For Electron, performance.memory is available in Chromium but non-standard
// Use with fallback for safety

interface MemoryInfo {
  usedJSHeapSize?: number
  totalJSHeapSize?: number
  jsHeapSizeLimit?: number
}

function getMemoryUsage(): MemoryInfo | null {
  // Cast to any since performance.memory is non-standard
  const perf = performance as any

  if (perf.memory) {
    return {
      usedJSHeapSize: perf.memory.usedJSHeapSize,
      totalJSHeapSize: perf.memory.totalJSHeapSize,
      jsHeapSizeLimit: perf.memory.jsHeapSizeLimit
    }
  }

  return null
}

// Format for display
function formatMemory(bytes?: number): string {
  if (!bytes) return 'N/A'
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

// Usage in component:
const memoryInfo = ref<MemoryInfo | null>(null)

onMounted(() => {
  // Update memory info every 5 seconds
  const interval = setInterval(() => {
    memoryInfo.value = getMemoryUsage()
  }, 5000)

  onBeforeUnmount(() => clearInterval(interval))
})
```
_Source: [MDN performance.memory](https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory), [Thyngster Memory Guide](https://www.thyngster.com/step-by-step-guide-measuring-javascript-memory-usage-on-your-web-pages)_

**Note:** `performance.memory` is non-standard and only available in Chromium-based browsers (which includes Electron). Since this is an Electron app, it's safe to use but should include null checks.

### Search Highlighting

```vue
<!-- Component: HighlightedText.vue -->
<template>
  <span v-html="highlightedText" />
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  text: string
  query: string
}

const props = defineProps<Props>()

const highlightedText = computed(() => {
  if (!props.query) return props.text

  // Escape regex special characters in query
  const escaped = props.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')

  return props.text.replace(
    regex,
    '<mark class="bg-yellow-200">$1</mark>'
  )
})
</script>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vuex | Pinia | 2021 | Simpler API, better TypeScript, less boilerplate |
| Options API stores | Setup stores | 2022 | Better type inference, Composition API consistency |
| `v-navigation-drawer` `bottom` prop | `location="bottom"` | Vuetify 3 (2022) | More flexible positioning (top/bottom/left/right) |
| localStorage direct access | Reactive localStorage composables | 2023+ | Auto-sync with state, but localStorage still works fine |
| performance.memory | performance.measureUserAgentSpecificMemory() | 2021 | New API more accurate but requires cross-origin isolation (not needed for Electron) |

**Deprecated/outdated:**
- **electron-store**: Last maintained 1+ year ago; localStorage is sufficient for JSON config
- **Vuex**: Legacy state management; use Pinia for all new projects
- **Options API stores**: Still supported but setup stores preferred for TypeScript

## Open Questions

Things that couldn't be fully resolved:

1. **Temporary dev shortcut vs floating button**
   - What we know: Need temporary access before footer exists in Phase 12
   - What's unclear: User preference—keyboard shortcut (Ctrl+L) vs floating FAB button
   - Recommendation: Implement keyboard shortcut first (easier), add floating button if user feedback requests it

2. **Buffer default size (1000 vs 5000 entries)**
   - What we know: Circular buffer with configurable max, needs sensible default
   - What's unclear: Tradeoff between memory usage and history retention for genetics app
   - Recommendation: Start with 1000 (reasonable for most users), make it configurable in localStorage, monitor feedback

3. **Drawer default height**
   - What we know: Bottom drawer should feel like DevTools console
   - What's unclear: Fixed height (400px? 500px?) vs percentage (30vh? 40vh?) vs user-resizable
   - Recommendation: Start with 40vh (percentage adapts to screen size), consider adding resize handle later if requested

4. **Patient ID regex patterns**
   - What we know: Need to redact patient/sample identifiers
   - What's unclear: Exact ID format conventions in genetics labs—highly variable
   - Recommendation: Start with common patterns (PATIENT-XXX, SAMPLE_XXX, ID:XXX), document the regex in config for user customization if needed

## Sources

### Primary (HIGH confidence)
- [Pinia Core Concepts](https://pinia.vuejs.org/core-concepts/) - Store definition, setup stores, TypeScript
- [Pinia State Management](https://pinia.vuejs.org/core-concepts/state.html) - State patterns, reactivity
- [Vuetify Navigation Drawer](https://vuetifyjs.com/en/components/navigation-drawers/) - Bottom drawer component
- [Vuetify Chip Groups](https://vuetifyjs.com/en/components/chip-groups/) - Multi-select filter chips
- [Vuetify Theme](https://vuetifyjs.com/en/features/theme/) - Custom color palette integration
- [MDN performance.memory](https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory) - Memory usage API
- [FileSaver.js GitHub](https://github.com/eligrey/FileSaver.js) - JSON export implementation

### Secondary (MEDIUM confidence)
- [hgvs-regexp GitHub](https://github.com/7ravis/hgvs-regexp) - HGVS regex patterns (verified with HGVS nomenclature docs)
- [Datadog PII Redaction](https://www.datadoghq.com/blog/observability-pipelines-sensitive-data-redaction/) - Sanitization best practices
- [Elastic PII Detection](https://www.elastic.co/observability-labs/blog/pii-ner-regex-assess-redact-part-2) - Regex pattern optimization
- [5 Balloons VueJS Filtering](https://5balloons.info/filtering-list-using-computed-properties-in-vuejs/) - Computed filter patterns (verified with official Vue docs)
- [SoftAuthor Vue 3 Search](https://softauthor.com/vuejs-composition-api-search-bar-using-computed-properties/) - Composition API search patterns
- [Material UI Palette](https://mui.com/material-ui/customization/palette/) - Semantic color guidelines
- [Mastering Pinia Top 5 Mistakes](https://masteringpinia.com/blog/top-5-mistakes-to-avoid-when-using-pinia) - Common pitfalls (aligns with official docs)

### Tertiary (LOW confidence - flagged for validation)
- [WebOsmotic Modern App Colors](https://webosmotic.com/blog/modern-app-colors/) - 2026 color trends (opinion-based)
- [vue-chat-scroll GitHub](https://github.com/theomessin/vue-chat-scroll) - Auto-scroll patterns (Vue 2, needs adaptation)
- [ring-buffer-ts GitHub](https://github.com/domske/ring-buffer-ts) - TypeScript circular buffer (alternative considered but not using)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Pinia official docs, Vuetify official docs, file-saver already installed
- Architecture patterns: HIGH - Verified with official Pinia/Vuetify docs, existing project patterns (useDebounce)
- Sanitization patterns: MEDIUM - HGVS patterns verified with hgvs-regexp but genomic coords need domain expert validation
- Pitfalls: HIGH - Verified with Pinia GitHub issues, Vuetify GitHub issues, official docs warnings

**Research date:** 2026-01-27
**Valid until:** 2026-03-27 (60 days - stable ecosystem, Vuetify 3 and Pinia mature)
