# Phase 25: Table UX & Filter Persistence - Research

**Researched:** 2026-01-29
**Domain:** Vue 3 / Vuetify 3 table UX, drag-and-drop interactions, browser storage patterns
**Confidence:** MEDIUM

## Summary

This phase implements professional-grade table UX features for Vuetify 3's v-data-table-server component, including column management (draggable, resizable, hideable), sticky positioning for navigation elements, draggable filter groups with persistence, and a case metadata modal. The research reveals that Vuetify 3 lacks native support for these advanced table features, requiring custom implementation with third-party drag-and-drop libraries and manual DOM manipulation.

**Key findings:**
- Vuetify 3 v-data-table does NOT support draggable/resizable columns natively - requires SortableJS integration and custom event handlers
- vuedraggable@next (Vue 3 port of SortableJS) is the standard library for drag-and-drop in Vue 3 ecosystem
- LocalStorage persistence requires reactive wrappers (VueUse's useStorage recommended) to maintain component reactivity
- CSS sticky positioning works but requires careful z-index management with Vuetify overlays
- Column resize requires manual mouse event handling and DOM width calculations

**Primary recommendation:** Use vuedraggable@next for filter group reordering (straightforward), implement column reorder/resize with custom handlers (complex), leverage VueUse's useStorage for reactive localStorage, and apply sticky positioning with z-index > overlay layers.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vuedraggable@next | 2.3.0 | Drag-and-drop for filter groups | Official Vue 3 port of SortableJS, most widely used drag-and-drop in Vue ecosystem |
| @vueuse/core | 14.1.0+ | Reactive localStorage with useStorage | Battle-tested composables, handles reactivity pitfalls automatically |
| SortableJS | 1.15+ (peer dep) | Underlying drag-and-drop engine | Industry standard, powers vuedraggable, supports touch/keyboard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @imengyu/vue3-context-menu | Latest | Right-click column menu | Alternative to custom implementation, provides polished UX |
| vue-horizontal | Latest | Horizontal scroll with arrows | If filter bar needs sophisticated scroll controls (optional) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vuedraggable@next | Vue DnD Kit | DnD Kit is newer with better TypeScript/accessibility, but less mature ecosystem |
| Custom localStorage | Pinia plugin persistence | Pinia adds IPC overhead in Electron, localStorage is simpler for UI preferences |
| Custom context menu | @imengyu/vue3-context-menu | Library adds dependency, custom is 30-40 lines with @contextmenu.prevent |

**Installation:**
```bash
npm install vuedraggable@next
# @vueuse/core already in package.json v14.1.0
```

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/
├── composables/
│   ├── useColumnPreferences.ts    # Column order/visibility/width state + localStorage sync
│   ├── useFilterPreferences.ts    # Filter group order/active state + localStorage sync
│   └── useStickyOffset.ts         # Calculate sticky top offset for stacked sticky elements
├── components/
│   ├── VariantTable.vue            # Enhance with column controls, resizable headers
│   ├── FilterToolbar.vue           # Enhance with draggable filter groups, sticky positioning
│   ├── ColumnVisibilityMenu.vue    # Right-click or button menu for hide/show columns
│   └── CaseMetadataModal.vue       # New: modal for case metadata (status/cohorts/HPO)
└── utils/
    └── columnResize.ts             # Pure functions for calculating column widths from mouse events
```

### Pattern 1: Reactive localStorage with VueUse
**What:** Wrap localStorage access in VueUse's useStorage to maintain reactivity across components
**When to use:** All preference persistence (column order, widths, filter state)
**Example:**
```typescript
// composables/useColumnPreferences.ts
import { useStorage } from '@vueuse/core'
import { computed, type Ref } from 'vue'

interface ColumnPreferences {
  order: string[]        // Column keys in user's preferred order
  visibility: Record<string, boolean>
  widths: Record<string, number>
}

export function useColumnPreferences(tableId: string) {
  const prefs: Ref<ColumnPreferences> = useStorage(
    `varlens-columns-${tableId}`,
    {
      order: [],
      visibility: {},
      widths: {}
    },
    localStorage,
    { mergeDefaults: true } // Merge with defaults when adding new properties
  )

  const resetToDefaults = () => {
    prefs.value = { order: [], visibility: {}, widths: {} }
  }

  return { prefs, resetToDefaults }
}
```
**Source:** [VueUse useStorage documentation](https://vueuse.org/core/usestorage/)

### Pattern 2: Column Reordering with vuedraggable in Table Headers
**What:** Wrap header row with vuedraggable to enable drag-to-reorder columns
**When to use:** Table column reordering (note: complex with v-data-table due to slot structure)
**Example:**
```vue
<template>
  <!-- Custom header implementation (v-data-table doesn't expose header row for dragging) -->
  <table>
    <thead>
      <tr>
        <draggable
          v-model="orderedHeaders"
          tag="tr"
          item-key="key"
          :animation="200"
          handle=".drag-handle"
          @end="saveColumnOrder"
        >
          <template #item="{ element: header }">
            <th :style="{ width: getColumnWidth(header.key) }">
              <div class="header-content">
                <v-icon class="drag-handle" size="small">mdi-drag-vertical</v-icon>
                {{ header.title }}
                <div class="resize-handle" @mousedown="startResize($event, header.key)"></div>
              </div>
            </th>
          </template>
        </draggable>
      </tr>
    </thead>
    <tbody>
      <!-- v-data-table-server body here -->
    </tbody>
  </table>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import draggable from 'vuedraggable'
import { useColumnPreferences } from '@/composables/useColumnPreferences'

const { prefs } = useColumnPreferences('variant-table')
const orderedHeaders = computed({
  get: () => sortHeadersByPreference(baseHeaders, prefs.value.order),
  set: (newOrder) => { prefs.value.order = newOrder.map(h => h.key) }
})

function saveColumnOrder() {
  // Automatically saved by useStorage reactivity
}
</script>
```
**Source:** [vuedraggable@next GitHub](https://github.com/SortableJS/vue.draggable.next)

### Pattern 3: Column Resizing with Mouse Events
**What:** Manual mouse event handling on resize handles between column headers
**When to use:** Resizable table columns (no native Vuetify support)
**Example:**
```typescript
// utils/columnResize.ts
export interface ResizeState {
  columnKey: string
  startX: number
  startWidth: number
}

export function startColumnResize(
  event: MouseEvent,
  columnKey: string,
  currentWidth: number
): ResizeState {
  return {
    columnKey,
    startX: event.clientX,
    startWidth: currentWidth
  }
}

export function calculateNewWidth(
  state: ResizeState,
  currentX: number,
  minWidth = 80,
  maxWidth = 500
): number {
  const delta = currentX - state.startX
  const newWidth = state.startWidth + delta
  return Math.max(minWidth, Math.min(maxWidth, newWidth))
}

// Component usage
const resizing = ref<ResizeState | null>(null)

function startResize(event: MouseEvent, columnKey: string) {
  const currentWidth = prefs.value.widths[columnKey] || 120
  resizing.value = startColumnResize(event, columnKey, currentWidth)

  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
}

function handleResize(event: MouseEvent) {
  if (!resizing.value) return
  const newWidth = calculateNewWidth(resizing.value, event.clientX)
  prefs.value.widths[resizing.value.columnKey] = newWidth
}

function stopResize() {
  resizing.value = null
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
}
```
**Source:** [Resizable Table Columns tutorial](https://www.brainbell.com/javascript/making-resizable-table-js.html)

### Pattern 4: Draggable Filter Groups (Horizontal)
**What:** Use vuedraggable with horizontal layout for reorderable filter chips/groups
**When to use:** Filter bar with multiple filter groups that users can rearrange
**Example:**
```vue
<template>
  <v-toolbar class="filter-toolbar">
    <draggable
      v-model="filterGroups"
      class="filter-groups-container"
      item-key="id"
      :animation="200"
      direction="horizontal"
      @end="saveFilterOrder"
    >
      <template #item="{ element: filterGroup }">
        <div class="filter-group" :class="{ collapsed: !filterGroup.active }">
          <div class="filter-group-header">
            <v-icon class="drag-handle" size="small">mdi-drag-horizontal</v-icon>
            <span>{{ filterGroup.label }}</span>
            <v-btn
              icon="mdi-close"
              size="x-small"
              variant="text"
              @click="toggleFilterGroup(filterGroup.id)"
            />
          </div>
          <div v-if="filterGroup.active" class="filter-group-content">
            <!-- Filter controls here -->
          </div>
        </div>
      </template>
    </draggable>
  </v-toolbar>
</template>

<script setup lang="ts">
import draggable from 'vuedraggable'
import { useFilterPreferences } from '@/composables/useFilterPreferences'

const { filterGroups, toggleFilterGroup } = useFilterPreferences()

function saveFilterOrder() {
  // Automatically saved by useStorage in composable
}
</script>

<style scoped>
.filter-groups-container {
  display: flex;
  flex-direction: row;
  gap: 8px;
  overflow-x: auto;
}

.filter-group.collapsed {
  width: auto;
}

.filter-group.collapsed .filter-group-content {
  display: none;
}
</style>
```
**Source:** [Using Vue 3 draggable and sortable](https://oladetoungee.hashnode.dev/using-vue-3-draggable-and-sortable)

### Pattern 5: Sticky Positioning with Stacked Elements
**What:** Apply CSS sticky with calculated top offsets for stacked sticky elements (tabs + filter bar)
**When to use:** Multiple sticky elements that should stack vertically
**Example:**
```vue
<template>
  <div class="app-content">
    <!-- Tabs: First sticky layer -->
    <v-tabs
      v-model="activeTab"
      class="sticky-tabs"
      :style="{ top: '48px' }" <!-- App bar height -->
    >
      <v-tab value="case">Case Analysis</v-tab>
      <v-tab value="cohort">Cohort Analysis</v-tab>
    </v-tabs>

    <!-- Filter bar: Second sticky layer -->
    <FilterToolbar
      class="sticky-filter-bar"
      :style="{ top: stickyFilterTop }"
    />

    <!-- Scrollable content -->
    <div class="scrollable-content">
      <VariantTable />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const APP_BAR_HEIGHT = 48
const TABS_HEIGHT = 48

const stickyFilterTop = computed(() => `${APP_BAR_HEIGHT + TABS_HEIGHT}px`)
</script>

<style scoped>
.sticky-tabs {
  position: sticky;
  top: 48px; /* Below app bar */
  z-index: 4; /* Above content, below overlays (Vuetify overlays: z-index 1000+) */
  background: rgb(var(--v-theme-surface));
}

.sticky-filter-bar {
  position: sticky;
  top: 96px; /* Below app bar + tabs */
  z-index: 3;
  background: rgb(var(--v-theme-surface));
}
</style>
```
**Source:** [Sticky Tabs Bar with Vuetify](https://journal.simondepelchin.be/2019/03/04/how-to-make-a-sticky-tabs-bar-with-vuetify/)

### Pattern 6: Conditional Tooltip for Ellipsis Text
**What:** Show tooltip only when text overflows with ellipsis
**When to use:** Table columns with max-width and text truncation
**Example:**
```vue
<template #[`item.gene_symbol`]="{ value }">
  <span
    ref="cellRef"
    class="truncated-cell"
    @mouseenter="checkOverflow"
  >
    <v-tooltip v-if="showTooltip" location="top">
      <template #activator="{ props }">
        <span v-bind="props">{{ value }}</span>
      </template>
      {{ value }}
    </v-tooltip>
    <span v-else>{{ value }}</span>
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const cellRef = ref<HTMLElement | null>(null)
const showTooltip = ref(false)

function checkOverflow() {
  if (!cellRef.value) return
  showTooltip.value = cellRef.value.scrollWidth > cellRef.value.offsetWidth
}
</script>

<style scoped>
.truncated-cell {
  display: inline-block;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```
**Source:** [Show Vuetify Tooltip only if text is truncate](https://codepen.io/eliyahu-kriel/pen/mdKrwyZ)

### Anti-Patterns to Avoid
- **Direct localStorage access in components:** Breaks reactivity, changes don't trigger re-renders. Always use reactive wrapper (VueUse useStorage or custom composable with watch).
- **Mutating vuedraggable v-model array directly:** Causes reactivity issues. Use computed getter/setter to sync with persistent store.
- **Setting z-index without considering Vuetify overlay layers:** Vuetify overlays use z-index 1000+. Sticky elements should use z-index < 100 to stay below modals.
- **Applying sticky to elements with overflow: hidden ancestors:** Sticky won't work if any parent has overflow set. Use overflow: unset on table wrapper.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop lists | Custom mousedown/mousemove handlers | vuedraggable@next + SortableJS | Touch support, accessibility, ghost elements, animations, cross-browser edge cases (50+ gotchas) |
| Reactive localStorage | Manual localStorage.setItem() + watch() | VueUse useStorage | Handles serialization, SSR safety, storage events, merge defaults, type inference |
| Horizontal scroll with arrows | Custom scroll buttons + IntersectionObserver | vue-horizontal or CSS scroll-snap | Smooth scrolling, momentum, keyboard nav, RTL support, resize handling |
| Context menu positioning | Manual clientX/clientY calculations | @imengyu/vue3-context-menu | Viewport boundary detection, submenu positioning, keyboard navigation, click-outside handling |

**Key insight:** Drag-and-drop is deceptively complex. Native HTML drag-and-drop API has poor mobile support and inconsistent browser behavior. SortableJS solves 50+ edge cases (nested dragging, scroll zones, touch events, ghost element styling, revert animations). Don't reimplement it.

## Common Pitfalls

### Pitfall 1: Vuedraggable Reactivity with Nested Objects
**What goes wrong:** When dragging filter groups or columns, the component doesn't re-render with new order, or localStorage doesn't update.
**Why it happens:** vuedraggable modifies the array in-place. If using reactive() with nested objects, Vue's reactivity may not detect the change. If using v-model with localStorage directly, changes don't persist.
**How to avoid:**
```typescript
// BAD: Direct localStorage in v-model
const filterGroups = ref(JSON.parse(localStorage.getItem('filters') || '[]'))

// GOOD: Use VueUse with computed setter
const { prefs } = useFilterPreferences()
const filterGroups = computed({
  get: () => prefs.value.groups,
  set: (newGroups) => { prefs.value.groups = newGroups }
})
```
**Warning signs:** Dragging works visually but order resets on refresh, or console shows "target is read-only" errors.

### Pitfall 2: SortableJS Interfering with Vuetify Click Events
**What goes wrong:** Clicking table rows or buttons inside draggable elements doesn't trigger @click handlers, or triggers drag instead of click.
**Why it happens:** SortableJS captures mousedown events and may prevent click propagation if drag threshold is too low.
**How to avoid:** Use the `handle` option to restrict dragging to specific elements (e.g., drag icon), and set `delay: 100` to require hold before dragging.
```vue
<draggable
  v-model="items"
  handle=".drag-handle"
  :delay="100"
  :force-fallback="true"
>
  <template #item="{ element }">
    <div>
      <v-icon class="drag-handle">mdi-drag</v-icon>
      <v-btn @click="handleClick(element)">Click me</v-btn>
    </div>
  </template>
</draggable>
```
**Warning signs:** Buttons inside draggable items don't respond to clicks, or require double-click.

**Source:** [Draggable table row with VueJS, Vuetify and SortableJS](https://dev.to/gaisinskii/draggable-table-row-with-vuejs-vuetify-and-sortablejs-1o7l)

### Pitfall 3: Sticky Positioning Z-Index Battles with Vuetify Overlays
**What goes wrong:** Sticky filter bar or tabs appear above dialogs, menus, or snackbars. Or conversely, overlays cover sticky elements that should remain visible.
**Why it happens:** Sticky elements with z-index create their own stacking context. Vuetify overlays use z-index 1000+. If sticky element has z-index > 1000, it will appear above modals (wrong). If too low, it may be covered by other page content.
**How to avoid:**
- Sticky UI elements: z-index 1-10 (below overlays)
- Vuetify menus/tooltips: z-index 1000-2000 (default)
- Vuetify dialogs/overlays: z-index 2000+ (default)
```css
.sticky-tabs {
  position: sticky;
  top: 0;
  z-index: 4; /* Below overlays, above content */
}

.sticky-filter-bar {
  position: sticky;
  top: 48px;
  z-index: 3; /* Below tabs */
}
```
**Warning signs:** Dialogs appear behind sticky headers, or sticky headers cover dropdown menus.

**Source:** [The Hidden Battle Between sticky position and z-index](https://medium.com/@ayham.attar98/the-hidden-battle-between-sticky-position-and-z-index-78097175c3b2)

### Pitfall 4: Column Resize Memory Leaks from Event Listeners
**What goes wrong:** After resizing columns multiple times, app becomes sluggish, or mousemove events continue firing after mouseup.
**Why it happens:** Event listeners added in startResize() aren't removed if component unmounts during resize, or if stopResize() fails to clean up.
**How to avoid:** Use onBeforeUnmount to ensure cleanup, and store event handlers as refs so they can be removed.
```typescript
import { ref, onBeforeUnmount } from 'vue'

const resizing = ref<ResizeState | null>(null)

function startResize(event: MouseEvent, columnKey: string) {
  // ... setup resize state
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
}

function stopResize() {
  resizing.value = null
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
}

// Critical: cleanup on unmount
onBeforeUnmount(() => {
  if (resizing.value) {
    stopResize()
  }
})
```
**Warning signs:** High CPU usage after resizing, or cursor remains as resize cursor after mouseup.

### Pitfall 5: LocalStorage Quota Exceeded
**What goes wrong:** Saving column preferences throws DOMException: QuotaExceededError, especially for large tables with many columns.
**Why it happens:** localStorage has 5-10MB limit. Saving verbose preference objects (with duplicate data, long keys) can fill quota quickly.
**How to avoid:** Use short key names, avoid storing computed values, compress preference structure.
```typescript
// BAD: Verbose keys and redundant data (50+ bytes per column)
{
  "varlens-variant-table-columns": {
    "column_annotations_visibility": true,
    "column_annotations_width": 100,
    "column_annotations_order": 0,
    // ... 20 columns = 1KB+ per table
  }
}

// GOOD: Compact structure (10 bytes per column)
{
  "vlt-cols": {
    "vis": { "ann": 1, "chr": 1 }, // Visibility bitmap
    "w": { "ann": 100, "chr": 80 }, // Widths (only if non-default)
    "ord": ["ann", "chr", "pos"]    // Order array
  }
}
```
**Warning signs:** Console errors "QuotaExceededError" when saving preferences, especially after adding many columns.

## Code Examples

Verified patterns from official sources:

### Column Visibility Toggle Menu
```vue
<!-- ColumnVisibilityMenu.vue -->
<template>
  <v-menu>
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        icon="mdi-table-column"
        size="small"
        variant="text"
      >
        <v-tooltip activator="parent" location="bottom">Show/Hide Columns</v-tooltip>
      </v-btn>
    </template>
    <v-list density="compact">
      <v-list-subheader>Visible Columns</v-list-subheader>
      <v-list-item
        v-for="column in availableColumns"
        :key="column.key"
        @click="toggleColumn(column.key)"
      >
        <template #prepend>
          <v-checkbox-btn
            :model-value="isColumnVisible(column.key)"
            hide-details
            @click.stop="toggleColumn(column.key)"
          />
        </template>
        <v-list-item-title>{{ column.title }}</v-list-item-title>
      </v-list-item>
      <v-divider class="my-2" />
      <v-list-item @click="resetColumns">
        <template #prepend>
          <v-icon>mdi-refresh</v-icon>
        </template>
        <v-list-item-title>Reset to Defaults</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useColumnPreferences } from '@/composables/useColumnPreferences'

const { prefs, resetToDefaults } = useColumnPreferences('variant-table')

const availableColumns = [
  { key: 'annotations', title: 'Annotations' },
  { key: 'chr', title: 'Chromosome' },
  { key: 'pos', title: 'Position' },
  // ... all columns
]

const isColumnVisible = (key: string) => {
  return prefs.value.visibility[key] !== false // Default visible
}

const toggleColumn = (key: string) => {
  prefs.value.visibility[key] = !isColumnVisible(key)
}

const resetColumns = () => {
  resetToDefaults()
}
</script>
```

### Horizontal Scroll with Arrow Buttons
```vue
<!-- FilterToolbar.vue (enhanced) -->
<template>
  <v-toolbar class="filter-toolbar">
    <v-btn
      v-if="canScrollLeft"
      icon="mdi-chevron-left"
      size="small"
      variant="text"
      class="scroll-arrow"
      @click="scrollLeft"
    />

    <div ref="scrollContainer" class="filter-groups-scroll">
      <draggable
        v-model="filterGroups"
        class="filter-groups-container"
        item-key="id"
        :animation="200"
      >
        <template #item="{ element }">
          <!-- Filter group content -->
        </template>
      </draggable>
    </div>

    <v-btn
      v-if="canScrollRight"
      icon="mdi-chevron-right"
      size="small"
      variant="text"
      class="scroll-arrow"
      @click="scrollRight"
    />
  </v-toolbar>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const scrollContainer = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

const updateScrollButtons = () => {
  if (!scrollContainer.value) return
  const el = scrollContainer.value
  canScrollLeft.value = el.scrollLeft > 0
  canScrollRight.value = el.scrollLeft < (el.scrollWidth - el.clientWidth)
}

const scrollLeft = () => {
  scrollContainer.value?.scrollBy({ left: -200, behavior: 'smooth' })
}

const scrollRight = () => {
  scrollContainer.value?.scrollBy({ left: 200, behavior: 'smooth' })
}

onMounted(() => {
  scrollContainer.value?.addEventListener('scroll', updateScrollButtons)
  updateScrollButtons()
})

onBeforeUnmount(() => {
  scrollContainer.value?.removeEventListener('scroll', updateScrollButtons)
})
</script>

<style scoped>
.filter-groups-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none; /* Hide scrollbar */
}

.filter-groups-scroll::-webkit-scrollbar {
  display: none;
}

.scroll-arrow {
  flex-shrink: 0;
}
</style>
```
**Source:** [Vue Horizontal Card Scroll with Arrow](https://www.testkarts.com/blog/vue-horizontal-card-scroll-with-arrow)

### Case Metadata Modal
```vue
<!-- CaseMetadataModal.vue -->
<template>
  <v-dialog v-model="open" max-width="600px">
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        prepend-icon="mdi-information-outline"
        size="small"
        variant="tonal"
      >
        Case Info
      </v-btn>
    </template>

    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Case Metadata</span>
        <v-btn icon="mdi-close" variant="text" @click="open = false" />
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-4">
        <CaseMetadataCard :case-id="caseId" />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import CaseMetadataCard from './CaseMetadataCard.vue'

defineProps<{
  caseId: number
}>()

const open = ref(false)
</script>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jQuery plugins (colResizable, resizable-columns) | Pure Vue composables with mouse events | Vue 3 release (2020) | Smaller bundle, better integration with reactive state |
| vue-draggable (Vue 2) | vuedraggable@next | Vue 3 GA (Sept 2020) | Composition API support, better TypeScript |
| Manual localStorage with JSON.parse/stringify | VueUse useStorage | VueUse 4.0 (2021) | Automatic reactivity, SSR safety, better DX |
| Fixed z-index values | CSS custom properties + Vuetify 3 elevation system | Vuetify 3 (2022) | Consistent layering, theme integration |

**Deprecated/outdated:**
- **vue-simple-context-menu v3.x**: Vue 2 only. Use v4.0+ for Vue 3, or @imengyu/vue3-context-menu
- **vue-horizontal-scroll**: Last updated 4 years ago, not maintained. Use native CSS scroll-snap or vue-horizontal for production
- **@spacebnd/vuetify-data-table-resizable-columns**: Last updated 4 years ago, Vuetify 2 only. Custom implementation required for Vuetify 3

## Open Questions

Things that couldn't be fully resolved:

1. **v-data-table-server with custom header DOM structure**
   - What we know: Vuetify's v-data-table-server uses complex slot system for headers, making direct DOM manipulation difficult
   - What's unclear: Whether custom header template can coexist with server-side features (sorting, column width)
   - Recommendation: May need to use custom table implementation with manual v-for over columns for full control over header DOM. Test if v-data-table's header slot allows custom structure without breaking server-side sorting.

2. **Column resize performance with 20+ columns**
   - What we know: Mouse event handling on every mousemove can cause jank with many columns
   - What's unclear: Whether requestAnimationFrame throttling is necessary, or if Vue's reactivity batching is sufficient
   - Recommendation: Implement basic version first, add RAF throttling if performance issues arise during testing. Monitor FPS in DevTools during resize.

3. **Filter group collapse animation performance**
   - What we know: Animating width/height with CSS transitions can cause reflow
   - What's unclear: Whether Vue's transition component or CSS transitions are better for horizontal collapse
   - Recommendation: Use CSS transition on max-width with overflow: hidden for simplest implementation. Test with 8+ filter groups to verify smoothness.

## Sources

### Primary (HIGH confidence)
- [VueUse useStorage - Official Documentation](https://vueuse.org/core/usestorage/)
- [vuedraggable@next - Official GitHub](https://github.com/SortableJS/vue.draggable.next)
- [Vuetify 3 Dialog Component - Official Documentation](https://vuetifyjs.com/en/components/dialogs/)
- [Vuetify 3 Data Tables - Official Documentation](https://vuetifyjs.com/en/components/data-tables/basics/)

### Secondary (MEDIUM confidence)
- [Draggable table row with VueJS, Vuetify and SortableJS - DEV Community](https://dev.to/gaisinskii/draggable-table-row-with-vuejs-vuetify-and-sortablejs-1o7l) - Practical implementation guide
- [Create Resizable Columns with JavaScript - Brainbell](https://www.brainbell.com/javascript/making-resizable-table-js.html) - Column resize implementation pattern
- [How to make a sticky tabs bar with Vuetify - Simon Depelchin](https://journal.simondepelchin.be/2019/03/04/how-to-make-a-sticky-tabs-bar-with-vuetify/) - Sticky positioning pattern
- [Reactive localStorage Wrapper - CodingEasyPeasy](https://www.codingeasypeasy.com/blog/reactive-localstorage-wrapper-with-vue-composition-api-a-comprehensive-guide) - localStorage composable pattern
- [Vue Horizontal Card Scroll with Arrow - TestKarts](https://www.testkarts.com/blog/vue-horizontal-card-scroll-with-arrow) - Horizontal scroll implementation

### Tertiary (LOW confidence - flag for validation)
- [Vuetify Datatable Resizable Column - CodePen](https://codepen.io/crwilson311/pen/Bajbdwd) - Example implementation (may be outdated)
- [Show Vuetify Tooltip only if text is truncate - CodePen](https://codepen.io/eliyahu-kriel/pen/mdKrwyZ) - Conditional tooltip pattern
- Multiple GitHub issues on Vuetify repository - Community discussions (not official guidance)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - vuedraggable@next and VueUse are well-documented with stable APIs
- Architecture: MEDIUM - Patterns are proven but Vuetify 3 v-data-table integration requires custom work
- Pitfalls: MEDIUM - Common issues are documented, but some edge cases may emerge in implementation

**Research date:** 2026-01-29
**Valid until:** ~30 days (stable ecosystem, minor library updates expected)

**Notes:**
- Vuetify 3 lacks native advanced table features (confirmed by multiple GitHub feature requests)
- Custom implementation required for column reorder/resize (not hand-roll the drag-and-drop itself, but the integration layer)
- Filter group dragging is straightforward with vuedraggable
- localStorage patterns are well-established with VueUse
