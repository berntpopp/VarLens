# Phase 5: UI Shell + Cases - Research

**Researched:** 2026-01-26
**Domain:** Vue 3 + Vuetify 3 UI patterns for master-detail layouts
**Confidence:** HIGH

## Summary

Phase 5 implements an application shell with a collapsible left sidebar displaying a case list and a main content area that updates based on case selection. The research covers Vuetify 3's navigation drawer patterns, Vue 3 Composition API state management for selection, list components with compact density, context menus for delete actions, dialog confirmations, and snackbar notifications.

**Key findings:**
- Vuetify 3 uses `v-navigation-drawer` with `rail` prop for collapsible sidebars (replaces Vuetify 2's mini-variant)
- Vue 3 Composition API recommends `ref()` over `reactive()` by default for state management
- Context menus require custom composable using `v-menu` with `target` coordinates and `locationStrategy: "connected"`
- Selection state managed via `v-model:selected` on `v-list` with `active-color` prop for highlighting
- Memory leak prevention requires cleanup in `onUnmounted` for event listeners and timers

**Primary recommendation:** Use Vuetify 3's native components (v-navigation-drawer, v-list, v-menu, v-dialog, v-snackbar) with Vue 3 Composition API patterns. Prefer `ref()` for reactive state and create reusable composables for context menu and case selection logic.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | 3.5+ | Component framework | Latest stable, Composition API mature |
| Vuetify 3 | 3.11.7 | Material Design UI | Official Vue UI framework, comprehensive components |
| TypeScript | 5.9+ | Type safety | Strict typing for component props/emits |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Pinia | 3.x | State management | If state shared across multiple views (not needed for Phase 5) |
| VueUse | 11.x | Composition utilities | Optional for common patterns like `useToggle` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vuetify 3 | PrimeVue, Quasar | Less Material Design, different ecosystem |
| Native components | Third-party plugins (vuetify3-dialog) | Adds dependency, but simplifies dialog/snackbar API |

**Installation:**
```bash
# Already installed in project
npm install vue@^3.5.27 vuetify@^3.11.7
```

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/
├── components/
│   ├── CaseList.vue        # Sidebar case list with selection
│   ├── CaseListItem.vue    # Individual case item (optional)
│   ├── CaseContextMenu.vue # Right-click menu for delete
│   ├── DeleteCaseDialog.vue # Confirmation modal
│   └── EmptyState.vue      # Welcome screen when no case selected
├── composables/
│   ├── useCaseSelection.ts # Selection state management
│   └── useContextMenu.ts   # Context menu positioning
├── App.vue                 # Root with v-app and layout
└── types/
    └── case.ts             # Case interface types
```

### Pattern 1: Collapsible Navigation Drawer with Rail
**What:** Left sidebar that collapses to narrow rail, optionally expands on hover
**When to use:** Desktop layouts where users need space for main content but want persistent navigation

**Example:**
```vue
<template>
  <v-app>
    <v-navigation-drawer
      v-model="drawer"
      :rail="rail"
      permanent
      :width="240"
    >
      <template v-slot:prepend>
        <v-toolbar density="compact">
          <v-toolbar-title>Cases</v-toolbar-title>
          <v-btn icon @click="rail = !rail">
            <v-icon>{{ rail ? 'mdi-chevron-right' : 'mdi-chevron-left' }}</v-icon>
          </v-btn>
        </v-toolbar>
      </template>

      <v-list v-model:selected="selected" density="compact">
        <!-- List items -->
      </v-list>
    </v-navigation-drawer>

    <v-main>
      <!-- Main content -->
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const drawer = ref(true)
const rail = ref(false)
const selected = ref([])
</script>
```
**Source:** [Vuetify Navigation Drawer Documentation](https://vuetifyjs.com/en/components/navigation-drawers/)

### Pattern 2: Master-Detail with Composition API
**What:** Case selection state managed with `ref()`, emits selection changes to parent
**When to use:** Master-detail layouts where selection drives main content display

**Example:**
```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Case } from '@/types/case'

const cases = ref<Case[]>([])
const selectedCaseId = ref<string | null>(null)
const loading = ref(false)

// Load cases from IPC
const loadCases = async () => {
  cases.value = await window.api.cases.list()
}

// Watch for selection changes
watch(selectedCaseId, async (newId) => {
  if (newId) {
    loading.value = true
    // Trigger variant loading in parent or sibling component
    loading.value = false
  }
})

onMounted(loadCases)
</script>
```
**Source:** [Vue State Management Guide](https://vuejs.org/guide/scaling-up/state-management.html)

### Pattern 3: Context Menu with Composable
**What:** Right-click menu positioned at cursor coordinates using `v-menu`
**When to use:** Actions triggered by right-click (delete, edit, etc.)

**Example:**
```typescript
// composables/useContextMenu.ts
import { ref, h } from 'vue'
import { VMenu } from 'vuetify/components/VMenu'

export const useContextMenu = () => {
  const show = ref(false)
  const x = ref(0)
  const y = ref(0)

  const ContextMenu = {
    setup(_, { slots, attrs }) {
      return () =>
        h(
          VMenu,
          {
            modelValue: show.value,
            target: [x.value, y.value],
            locationStrategy: 'connected',
            scrim: false,
            ...attrs,
            'onUpdate:modelValue': ($event) => (show.value = $event),
          },
          slots,
        )
    },
  }

  const openFromEvent = (ev: MouseEvent) => {
    x.value = ev.clientX
    y.value = ev.clientY
    show.value = true
  }

  return {
    show,
    x,
    y,
    ContextMenu,
    openFromEvent,
  }
}
```

**Usage:**
```vue
<template>
  <v-list-item
    @contextmenu.prevent="handleContextMenu($event, item)"
  >
    {{ item.name }}
  </v-list-item>

  <ContextMenu>
    <v-list>
      <v-list-item @click="handleDelete">
        <v-icon start>mdi-delete</v-icon>
        Delete
      </v-list-item>
    </v-list>
  </ContextMenu>
</template>

<script setup lang="ts">
const { ContextMenu, openFromEvent } = useContextMenu()

const handleContextMenu = (ev: MouseEvent, item: Case) => {
  selectedItem.value = item
  openFromEvent(ev)
}
</script>
```
**Source:** [GitHub Vuetify Discussion #16259](https://github.com/vuetifyjs/vuetify/discussions/16259)

### Pattern 4: Confirmation Dialog with Promise
**What:** Modal dialog that returns user confirmation as a Promise
**When to use:** Destructive actions requiring user confirmation (delete, clear, etc.)

**Example:**
```vue
<template>
  <v-dialog v-model="dialog" max-width="400">
    <v-card>
      <v-card-title>Delete Case?</v-card-title>
      <v-card-text>
        Delete "{{ caseName }}"? This will remove all {{ variantCount }} variants.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancel">Cancel</v-btn>
        <v-btn color="error" @click="confirm">Delete</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const dialog = ref(false)
const caseName = ref('')
const variantCount = ref(0)
let resolvePromise: (value: boolean) => void

const show = (name: string, count: number): Promise<boolean> => {
  caseName.value = name
  variantCount.value = count
  dialog.value = true

  return new Promise((resolve) => {
    resolvePromise = resolve
  })
}

const confirm = () => {
  dialog.value = false
  resolvePromise(true)
}

const cancel = () => {
  dialog.value = false
  resolvePromise(false)
}

defineExpose({ show })
</script>
```
**Source:** [Vuetify Dialog Documentation](https://vuetifyjs.com/en/components/dialogs/)

### Pattern 5: Snackbar Notification Service
**What:** Toast-style notification for success/error feedback
**When to use:** Brief feedback after actions (case deleted, import complete)

**Example:**
```vue
<template>
  <v-snackbar
    v-model="snackbar"
    :color="color"
    :timeout="3000"
    location="bottom right"
  >
    {{ message }}
    <template v-slot:actions>
      <v-btn variant="text" @click="snackbar = false">Close</v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const snackbar = ref(false)
const message = ref('')
const color = ref('success')

const show = (msg: string, type: 'success' | 'error' = 'success') => {
  message.value = msg
  color.value = type
  snackbar.value = true
}

defineExpose({ show })
</script>
```
**Source:** [Vuetify Snackbar Documentation](https://vuetifyjs.com/en/components/snackbars/)

### Anti-Patterns to Avoid

- **Using `reactive()` for single values:** Prefer `ref()` for primitives; `reactive()` causes issues with destructuring and reassignment
- **Not cleaning up event listeners:** Context menu event listeners must be removed in `onUnmounted` to prevent memory leaks
- **Direct IPC calls in components:** Wrap IPC calls in composables or services for testability and reusability
- **Global event bus for component communication:** Use props/emits or provide/inject; Vue 3 removed the global event bus pattern
- **Synchronous IPC calls:** Always use async IPC (`invoke` not `sendSync`) to prevent blocking the renderer process

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Context menu positioning | Custom absolute positioning logic | `v-menu` with `target` + `locationStrategy: "connected"` | Handles viewport edge detection, scrolling, RTL automatically |
| Dialog management | Custom modal state manager | Vuetify `v-dialog` with expose/ref | Built-in animations, focus trap, ESC handling, backdrop click |
| Toast notifications | Custom toast queue system | `v-snackbar` with timeout | Handles stacking, queue, animations, accessibility |
| List selection state | Manual array tracking | `v-list` with `v-model:selected` | Handles single/multiple selection, keyboard nav, ARIA |
| Responsive breakpoints | Custom media query listeners | Vuetify `$vuetify.display` breakpoints | Reactive, SSR-safe, consistent with Vuetify grid |
| Date formatting | String manipulation | Built-in `Intl.DateTimeFormat` or library | Handles localization, timezones, edge cases |
| Debouncing search input | `setTimeout` logic | VueUse `useDebounceFn` or native `debounce` | Prevents memory leaks, handles cleanup |

**Key insight:** Vuetify 3 components are built on Vue 3's Composition API and handle complex edge cases (accessibility, RTL, mobile touch, keyboard navigation) that custom implementations often miss. Always check Vuetify docs before building custom UI logic.

## Common Pitfalls

### Pitfall 1: Memory Leaks from Context Menu Event Listeners
**What goes wrong:** Adding `@contextmenu` listeners without cleanup causes memory to accumulate with each component mount/unmount cycle
**Why it happens:** Context menu events are attached to DOM elements but not automatically removed when component unmounts
**How to avoid:**
```typescript
const cleanup = () => {
  document.removeEventListener('click', closeMenu)
}

onUnmounted(cleanup)
```
**Warning signs:** Memory usage increases when navigating between views repeatedly; DevTools shows growing number of listeners

**Source:** [How to Clean Up Global Event Listeners in Vue](https://markus.oberlehner.net/blog/how-to-clean-up-global-event-listeners-intervals-and-third-party-libraries-in-vue-components)

### Pitfall 2: Rail Drawer Width Not Updating v-main
**What goes wrong:** Main content area doesn't adjust width when navigation drawer collapses to rail
**Why it happens:** Vuetify's layout system requires `permanent` prop for automatic layout adjustment
**How to avoid:** Use `permanent` prop on `v-navigation-drawer` rather than controlling visibility with `v-model` alone
```vue
<v-navigation-drawer permanent :rail="rail">
```
**Warning signs:** Main content has fixed width regardless of drawer state; horizontal scrollbar appears

**Source:** [Vuetify Navigation Drawer Issue #13309](https://github.com/vuetifyjs/vuetify/issues/13309)

### Pitfall 3: Active List Item Color Not Applying
**What goes wrong:** Selected list item doesn't show highlight color or uses wrong color
**Why it happens:** Vuetify 3 changed from `active-class` to `active-color` prop; color/active-color props have known issues in some versions
**How to avoid:** Use `active-color` prop on `v-list-item` and ensure Vuetify version is 3.11+
```vue
<v-list-item active-color="primary">
```
If color doesn't apply, use CSS override as fallback:
```css
.v-list-item--active {
  background-color: rgba(var(--v-theme-primary), 0.12);
}
```
**Warning signs:** Selected item has no visual indication; hover and active states look identical

**Source:** [Vuetify Issue #16624](https://github.com/vuetifyjs/vuetify/issues/16624)

### Pitfall 4: Destructuring Reactive Objects Loses Reactivity
**What goes wrong:** Destructuring a `reactive()` object causes loss of reactivity
```typescript
const state = reactive({ count: 0 })
const { count } = state // ❌ count is not reactive
```
**Why it happens:** JavaScript destructuring creates a copy of the primitive value, breaking Vue's reactive reference
**How to avoid:** Use `ref()` for primitives or access properties directly without destructuring
```typescript
// Option 1: Use ref
const count = ref(0)

// Option 2: Don't destructure
const state = reactive({ count: 0 })
// Use state.count everywhere
```
**Warning signs:** Template doesn't update when values change; watchers don't fire

**Source:** [Vue Ref vs Reactive Best Practices](https://mokkapps.de/blog/ref-vs-reactive-what-to-choose-using-vue-3-composition-api)

### Pitfall 5: Not Preventing Default Context Menu
**What goes wrong:** Browser's native context menu appears alongside custom menu
**Why it happens:** Forgetting to use `.prevent` modifier on `@contextmenu` event
**How to avoid:** Always use `@contextmenu.prevent` to suppress default menu
```vue
<v-list-item @contextmenu.prevent="handleContextMenu">
```
**Warning signs:** Two context menus appear (native + custom); right-click shows browser menu

**Source:** [Custom Right Click Context Menu in Vue 3](https://medium.com/@sj.anyway/custom-right-click-context-menu-in-vue3-b323a3913684)

### Pitfall 6: Async IPC Calls Without Loading State
**What goes wrong:** UI appears frozen while waiting for IPC response; users click multiple times
**Why it happens:** No visual feedback during async operations
**How to avoid:** Always set loading state before IPC calls
```typescript
const deleteCase = async (id: string) => {
  loading.value = true
  try {
    await window.api.cases.delete(id)
  } finally {
    loading.value = false
  }
}
```
**Warning signs:** Users report "unresponsive" UI; duplicate operations from repeated clicks

**Source:** [Electron IPC Best Practices](https://www.electronjs.org/docs/latest/tutorial/ipc)

## Code Examples

Verified patterns from official sources:

### Compact List with Selection Tracking
```vue
<template>
  <v-list
    v-model:selected="selected"
    density="compact"
    select-strategy="single-leaf"
  >
    <v-list-item
      v-for="item in items"
      :key="item.id"
      :value="item.id"
      :title="item.name"
      :subtitle="`${item.variantCount.toLocaleString()} variants • ${formatDate(item.importDate)}`"
      active-color="primary"
    >
      <template v-slot:prepend>
        <v-icon>mdi-dna</v-icon>
      </template>
    </v-list-item>
  </v-list>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const selected = ref<string[]>([])

watch(selected, (newSelection) => {
  if (newSelection.length > 0) {
    emit('case-selected', newSelection[0])
  }
})
</script>
```
**Source:** [Vuetify List Documentation](https://vuetifyjs.com/en/components/lists/)

### Empty State Component
```vue
<template>
  <v-container class="fill-height">
    <v-row align="center" justify="center">
      <v-col cols="12" class="text-center">
        <v-icon size="120" color="grey-lighten-1">mdi-folder-open-outline</v-icon>
        <h2 class="text-h5 mt-4 text-grey-darken-1">No Case Selected</h2>
        <p class="text-body-1 mt-2 text-grey">
          Import a VCF file or select a case from the sidebar to view variants
        </p>
      </v-col>
    </v-row>
  </v-container>
</template>
```
**Source:** [Vuetify Empty States Component](https://vuetifyjs.com/en/components/empty-states/)

### TypeScript Types for Case Data
```typescript
// types/case.ts
export interface Case {
  id: string
  name: string
  variantCount: number
  importDate: number // Unix timestamp
  filePath: string
}

// Component props typing
defineProps<{
  cases: Case[]
}>()

// Emits typing
const emit = defineEmits<{
  'case-selected': [caseId: string]
  'case-deleted': [caseId: string]
}>()
```
**Source:** [Vue TypeScript with Composition API](https://vuejs.org/guide/typescript/composition-api)

### Filter Cases with Text Input
```vue
<template>
  <v-text-field
    v-model="search"
    prepend-inner-icon="mdi-magnify"
    placeholder="Search cases..."
    density="compact"
    hide-details
    clearable
  />

  <v-list v-model:selected="selected" density="compact">
    <v-list-item
      v-for="item in filteredCases"
      :key="item.id"
      :value="item.id"
      :title="item.name"
    />
  </v-list>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const search = ref('')
const cases = ref<Case[]>([])

const filteredCases = computed(() => {
  if (!search.value) return cases.value

  const query = search.value.toLowerCase()
  return cases.value.filter(c =>
    c.name.toLowerCase().includes(query)
  )
})
</script>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `mini-variant` + `expand-on-hover` props | `rail` prop | Vuetify 3.0 (2022) | Simpler API, single prop handles collapsible behavior |
| `active-class` for list selection | `active-color` prop | Vuetify 3.0 | Easier theming, direct color assignment |
| Options API with mixins | Composition API with composables | Vue 3.0 (2020) | Better TypeScript support, clearer dependencies |
| Vuex for state | Pinia or Composition API | Vue 3.3 (2023) | Simpler API, better TypeScript inference |
| `position-x`/`position-y` for menu | `target` + `locationStrategy` | Vuetify 3.0 | More flexible positioning, viewport-aware |
| Global event bus (`$emit`/`$on`) | Props/emits or provide/inject | Vue 3.0 | Removed global event bus, explicit data flow |

**Deprecated/outdated:**
- **`mini-variant` prop**: Use `rail` prop instead in Vuetify 3
- **`expand-on-hover` prop**: Built into `rail` behavior, no separate prop needed
- **Mixins for reusable logic**: Use composables with Composition API
- **`$vuetify.breakpoint`**: Use `$vuetify.display` in Vuetify 3
- **`v-list-item-group` for selection**: Use `v-model:selected` directly on `v-list`

## Open Questions

Things that couldn't be fully resolved:

1. **Empty state best practices for master-detail layouts**
   - What we know: Vuetify 3 has `v-empty-state` component in documentation
   - What's unclear: Whether component is stable in 3.11.7 or still in labs
   - Recommendation: Use custom empty state with `v-container` + `v-icon` + text as shown in examples; verify v-empty-state availability

2. **Optimal debounce timing for case search filter**
   - What we know: Text filters should debounce to reduce rerenders
   - What's unclear: Best debounce delay for local filtering (no network)
   - Recommendation: Start with 150ms; local filtering is fast so light debounce acceptable

3. **Case list virtualization threshold**
   - What we know: Vuetify 3 supports virtual scrolling for performance
   - What's unclear: At what case count does virtualization become necessary
   - Recommendation: Test with 100+ cases; consider virtualization if scrolling feels sluggish

4. **Session persistence strategy**
   - What we know: User decision is no session persistence for case selection
   - What's unclear: Whether drawer rail state should persist across sessions
   - Recommendation: Ask user if rail state (collapsed/expanded) should persist in settings

## Sources

### Primary (HIGH confidence)
- [Vuetify Navigation Drawer Documentation](https://vuetifyjs.com/en/components/navigation-drawers/) - Component API and examples
- [Vuetify List Documentation](https://vuetifyjs.com/en/components/lists/) - Selection state and density
- [Vuetify Menu Documentation](https://vuetifyjs.com/en/components/menus/) - Positioning and location strategy
- [Vue 3 Composition API Official Guide](https://vuejs.org/guide/typescript/composition-api) - TypeScript patterns
- [Vue 3 Lifecycle Hooks Documentation](https://vuejs.org/api/composition-api-lifecycle) - onMounted/onUnmounted usage
- [Electron IPC Tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc) - Renderer-main communication

### Secondary (MEDIUM confidence)
- [GitHub Vuetify Discussion #16259](https://github.com/vuetifyjs/vuetify/discussions/16259) - Context menu composable code example
- [Vue State Management Guide](https://vuejs.org/guide/scaling-up/state-management.html) - ref vs reactive best practices
- [How to Clean Up Global Event Listeners in Vue](https://markus.oberlehner.net/blog/how-to-clean-up-global-event-listeners-intervals-and-third-party-libraries-in-vue-components) - Memory leak prevention
- [Ref vs Reactive Best Practices](https://mokkapps.de/blog/ref-vs-reactive-what-to-choose-using-vue-3-composition-api) - When to use each
- [Vue Component Organization Patterns](https://vueschool.io/articles/vuejs-tutorials/structuring-vue-components/) - Folder structure recommendations

### Tertiary (LOW confidence)
- Community blog posts about skeleton vs spinner UX (consensus: skeleton for content loading)
- GitHub issues for Vuetify 3 active-color bugs (workarounds provided)
- Medium articles on Vue 3 TypeScript patterns (general guidance, not phase-specific)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Vuetify 3.11.7 installed, Vue 3.5+ documented, TypeScript patterns verified
- Architecture: HIGH - Official Vuetify docs provide all component patterns needed
- Context menu: MEDIUM - Working code example from GitHub discussion, but requires custom composable
- Pitfalls: HIGH - Documented issues with known workarounds, official cleanup patterns

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days - stable framework, slow-moving patterns)

**Note:** Vuetify 3 is mature and stable as of 3.11.x series. API patterns are unlikely to change significantly in near term. Vue 3 Composition API patterns are well-established best practices.
