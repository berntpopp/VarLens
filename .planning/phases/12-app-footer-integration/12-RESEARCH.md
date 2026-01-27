# Phase 12: App Footer Integration - Research

**Researched:** 2026-01-27
**Domain:** Vue 3 + Vuetify 3 persistent footer with Electron IPC integration
**Confidence:** HIGH

## Summary

Phase 12 integrates all v0.2.0 subsystems into a persistent footer bar using Vuetify 3's v-footer component with the app prop for fixed positioning. The footer serves as the primary access point for meta-features: version info via v-menu popup, external links via secure shell.openExternal, disclaimer/FAQ status indicators, and LogViewer toggle with reactive error count badge.

The standard approach uses v-footer with app prop (position: fixed), compact icon buttons with proper ARIA labels, v-badge for error count tracking, and IPC-based shell.openExternal for secure external link handling. Vue 3 Composition API with Pinia storeToRefs enables reactive badge updates from the log store.

Key technical considerations: URL validation before shell.openExternal (whitelist HTTPS, reject dangerous protocols), proper z-index coordination with existing v-navigation-drawer, and reactive computed properties for real-time error count tracking.

**Primary recommendation:** Use v-footer with app prop outside v-main, expose shell.openExternal via contextBridge with URL validation, track error count using computed property from storeToRefs(useLogStore()), and implement version menu with v-menu activator slot pattern.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vuetify 3 | 3.11.7 | Footer, menu, badge components | Material Design system for Vue 3, app layout coordination |
| Vue 3 | 3.5.27 | Composition API, computed reactivity | Modern reactive framework with superior TypeScript support |
| Pinia | 2.3.1 | State management for log store | Official Vue 3 state management, better TypeScript inference |
| Electron | 40.0.0 | IPC for shell.openExternal | Enables secure external link opening in default browser |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @mdi/font | 7.4.47 | Material Design Icons for footer buttons | Already in use, provides GitHub/license/FAQ icons |
| contextBridge | (Electron API) | Secure IPC exposure to renderer | Required for secure shell.openExternal access |
| storeToRefs | (Pinia utility) | Reactive store destructuring | Maintains reactivity when extracting errorCount from logStore |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| v-footer + app | Custom fixed position div | Loses Vuetify layout coordination, manual z-index management |
| v-badge | Custom span with count | Loses Material Design styling, accessibility features |
| IPC + shell.openExternal | Direct renderer shell access | Security vulnerability, fails with context isolation |
| storeToRefs | Direct store destructure | Loses reactivity on state properties |

**Installation:**
No new dependencies required - all libraries already present in package.json.

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/
├── components/
│   ├── AppFooter.vue        # Main footer component
│   ├── LogViewer.vue        # Existing drawer component
│   └── icons/               # Existing custom icons
├── stores/
│   └── logStore.ts          # Existing Pinia store
├── types/
│   └── log.ts               # LogStatistics interface
└── App.vue                  # Integrates footer

src/preload/
└── index.ts                 # Add shell:openExternal API

src/main/
└── index.ts                 # Add shell.openExternal handler
```

### Pattern 1: Fixed App Footer with Layout Coordination
**What:** v-footer with app prop for automatic positioning and v-main padding adjustment
**When to use:** Persistent footer that should coordinate with v-app-bar and v-navigation-drawer
**Example:**
```vue
<!-- App.vue -->
<template>
  <v-app>
    <v-app-bar>...</v-app-bar>
    <v-navigation-drawer>...</v-navigation-drawer>
    <v-main>...</v-main>
    <AppFooter />
  </v-app>
</template>

<!-- AppFooter.vue -->
<template>
  <v-footer app color="#E5AA94" class="px-4 py-2" height="auto">
    <!-- Footer content -->
  </v-footer>
</template>
```
**Source:** [Vuetify Application Layout](https://vuetifyjs.com/en/features/application-layout/)

### Pattern 2: v-menu with Activator Slot for Version Popup
**What:** v-menu with activator slot provides props to bind to trigger element
**When to use:** Click-triggered popup menus attached to buttons or text
**Example:**
```vue
<template>
  <v-menu>
    <template v-slot:activator="{ props }">
      <v-btn v-bind="props" variant="text" size="small">
        v{{ appVersion }}
      </v-btn>
    </template>
    <v-list density="compact">
      <v-list-item>
        <v-list-item-title>VarLens v{{ appVersion }}</v-list-item-title>
        <v-list-item-subtitle>Electron v{{ electronVersion }}</v-list-item-subtitle>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const appVersion = ref('0.1.0')
const electronVersion = ref('')

onMounted(async () => {
  const version = await window.api.system.getVersion()
  appVersion.value = version.app
  electronVersion.value = version.electron
})
</script>
```
**Source:** [Vuetify Menu Component](https://vuetifyjs.com/en/components/menus/)

### Pattern 3: Reactive Badge from Pinia Store
**What:** Use storeToRefs to maintain reactivity when destructuring store properties, v-badge for visual indicator
**When to use:** Real-time badge updates based on store state changes
**Example:**
```vue
<template>
  <v-badge
    :content="errorCount"
    :model-value="errorCount > 0"
    color="error"
    overlap
  >
    <v-btn
      icon="mdi-console"
      size="small"
      variant="text"
      @click="logViewerOpen = !logViewerOpen"
      aria-label="Open log viewer"
    />
  </v-badge>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useLogStore } from '../stores/logStore'

const logStore = useLogStore()
const { stats } = storeToRefs(logStore)

// Computed property maintains reactivity through storeToRefs
const errorCount = computed(() =>
  stats.value.errorCount + stats.value.criticalCount
)
</script>
```
**Source:** [Pinia storeToRefs](https://pinia.vuejs.org/api/pinia/functions/storeToRefs.html), [Vuetify Badge Component](https://vuetifyjs.com/en/components/badges/)

### Pattern 4: Secure External Link Handling via IPC
**What:** Expose shell.openExternal through contextBridge with URL validation in main process
**When to use:** Opening external links (GitHub, license) in default browser from Electron app
**Example:**
```typescript
// preload/index.ts
const api = {
  // ... existing API
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
  }
}
contextBridge.exposeInMainWorld('api', api)

// main/index.ts
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  // Validate URL before opening
  try {
    const parsedUrl = new URL(url)

    // Whitelist HTTPS only
    if (parsedUrl.protocol !== 'https:') {
      console.error('Invalid protocol:', parsedUrl.protocol)
      return { success: false, error: 'Only HTTPS URLs allowed' }
    }

    // Optional: whitelist specific domains
    const allowedDomains = ['github.com', 'opensource.org']
    const hostname = parsedUrl.hostname
    const isAllowed = allowedDomains.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    )

    if (!isAllowed) {
      console.error('Domain not allowed:', hostname)
      return { success: false, error: 'Domain not allowed' }
    }

    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    console.error('Invalid URL:', url, error)
    return { success: false, error: 'Invalid URL' }
  }
})

// AppFooter.vue
async function openGitHub() {
  const result = await window.api.shell.openExternal(
    'https://github.com/berntpopp/varlens'
  )
  if (!result.success) {
    console.error('Failed to open URL:', result.error)
  }
}
```
**Source:** [Electron shell API](https://www.electronjs.org/docs/latest/api/shell), [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)

### Anti-Patterns to Avoid

- **Direct shell access in renderer:** Don't import shell module directly in renderer - fails with context isolation and creates security vulnerability
- **Unvalidated shell.openExternal:** Never pass user-controlled URLs directly - validate protocol (reject javascript:, file:, data:) and optionally whitelist domains
- **Direct store destructuring:** Don't use `const { errorCount } = logStore.stats` - loses reactivity, use storeToRefs instead
- **Footer inside v-main:** Don't place v-footer with app prop inside v-main - breaks layout coordination
- **Hardcoded version strings:** Don't hardcode version in footer - use window.api.system.getVersion() to get package.json version

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Badge counter display | Custom span with conditional rendering | v-badge with :model-value | Handles positioning, theming, accessibility, overlapping |
| Menu popup positioning | Absolute positioned div with manual offset | v-menu with activator slot | Auto-positioning, click-outside handling, focus trap, ARIA |
| App footer positioning | Fixed position with manual z-index/padding | v-footer with app prop | Auto z-index, v-main padding calculation, drawer coordination |
| External link opening | window.open or <a target="_blank"> | shell.openExternal via IPC | Opens in system browser (not in-app), respects user's default browser |
| Version number access | Import package.json in renderer | app.getVersion() via IPC | Works in packaged app, handles electron-builder version mapping |
| Reactive store properties | Manual watch/computed from store | storeToRefs utility | Maintains reactivity, handles setup timing, type-safe |

**Key insight:** Vuetify 3's app layout system handles z-index coordination, padding calculations, and responsive behavior that are error-prone to implement manually. Electron's security model requires IPC-based shell access - direct access fails or creates vulnerabilities.

## Common Pitfalls

### Pitfall 1: Footer z-index Conflicts with Drawer
**What goes wrong:** Footer appears above or below navigation drawer inappropriately, especially when drawer slides in/out
**Why it happens:** Manual z-index values conflict with Vuetify's automatic layer management
**How to avoid:** Use app prop on v-footer (position: fixed is automatic), let Vuetify manage z-index. Footer gets appropriate layer below drawer overlay.
**Warning signs:** Footer visible through drawer overlay, drawer slides under footer

### Pitfall 2: shell.openExternal Security Vulnerabilities
**What goes wrong:** Attacker-controlled URLs passed to shell.openExternal can execute arbitrary commands (e.g., javascript:, file://, data: URLs)
**Why it happens:** shell.openExternal trusts URL protocol without validation
**How to avoid:**
- Parse URL with new URL() in try/catch
- Whitelist protocols (HTTPS only, or HTTP + HTTPS)
- Reject dangerous protocols: javascript:, file:, data:, custom schemes
- Optionally whitelist specific domains for sensitive links
**Warning signs:** Security audit tools flag shell.openExternal calls, penetration testing reveals RCE
**Source:** [The dangers of Electron's shell.openExternal()](https://benjamin-altpeter.de/shell-openexternal-dangers/)

### Pitfall 3: Lost Reactivity with Store Destructuring
**What goes wrong:** Badge count doesn't update when log store changes, shows stale error count
**Why it happens:** Direct destructuring (`const { errorCount } = logStore.stats`) loses reactive connection
**How to avoid:** Use storeToRefs for reactive properties: `const { stats } = storeToRefs(logStore)`, then compute from stats.value
**Warning signs:** Badge shows 0 errors when LogViewer shows errors, count only updates on component remount

### Pitfall 4: Footer Height Calculation Issues
**What goes wrong:** v-main content overlaps footer or leaves too much empty space
**Why it happens:** Footer with fixed height doesn't communicate size to v-main, or dynamic content causes height changes
**How to avoid:** Use height="auto" on v-footer with app prop - Vuetify recalculates padding dynamically. Keep footer content height predictable (avoid dynamic multiline content).
**Warning signs:** Content scrolls under footer, excessive whitespace above footer

### Pitfall 5: Missing ARIA Labels on Icon Buttons
**What goes wrong:** Screen readers can't identify footer button purposes ("button" announced without context)
**Why it happens:** Icon-only buttons lack accessible name
**How to avoid:** Add aria-label to all icon buttons (e.g., aria-label="Open GitHub repository"), use descriptive labels not generic "icon"
**Warning signs:** Accessibility audits fail, screen reader testing shows unlabeled buttons
**Source:** [Icon accessibility and aria-label](https://gomakethings.com/icon-accessibility-and-aria-label/)

### Pitfall 6: Version Fetching Timing Issues
**What goes wrong:** Version shows as "undefined" or "0.1.0" in footer, doesn't match actual app version
**Why it happens:** app.getVersion() called before Electron main process ready, or version fetched from wrong package.json in dev vs. production
**How to avoid:** Call window.api.system.getVersion() in onMounted hook, ensure IPC handler returns both app and electron versions, test in packaged app (not just dev)
**Warning signs:** Version displays correctly in dev but shows wrong version in built app

## Code Examples

Verified patterns from official sources and existing codebase:

### Complete AppFooter Component Structure
```vue
<template>
  <v-footer app color="#E5AA94" class="px-4 py-2" height="auto">
    <div class="d-flex align-center justify-space-between" style="width: 100%">
      <!-- Left: Version menu -->
      <div class="d-flex align-center">
        <v-menu>
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" variant="text" size="small" class="text-caption">
              v{{ appVersion }}
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item>
              <v-list-item-title>VarLens v{{ appVersion }}</v-list-item-title>
              <v-list-item-subtitle>Electron v{{ electronVersion }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>

      <!-- Right: Action buttons -->
      <div class="d-flex align-center ga-2">
        <!-- GitHub link -->
        <v-btn
          icon="mdi-github"
          size="small"
          variant="text"
          @click="openGitHub"
          aria-label="Open GitHub repository"
        />

        <!-- License link -->
        <v-btn
          icon="mdi-license"
          size="small"
          variant="text"
          @click="openLicense"
          aria-label="View license"
        />

        <!-- Disclaimer status indicator -->
        <v-btn
          :icon="disclaimerAcknowledged ? 'mdi-shield-check' : 'mdi-shield-alert'"
          :color="disclaimerAcknowledged ? 'success' : 'warning'"
          size="small"
          variant="text"
          @click="openDisclaimer"
          aria-label="View disclaimer"
        />

        <!-- FAQ button -->
        <v-btn
          icon="mdi-help-circle"
          size="small"
          variant="text"
          @click="openFAQ"
          aria-label="Open FAQ"
        />

        <!-- Log viewer with error badge -->
        <v-badge
          :content="errorCount"
          :model-value="errorCount > 0"
          color="error"
          overlap
        >
          <v-btn
            icon="mdi-console"
            size="small"
            variant="text"
            @click="toggleLogViewer"
            aria-label="Open log viewer"
          />
        </v-badge>
      </div>
    </div>
  </v-footer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useLogStore } from '../stores/logStore'

// Version state
const appVersion = ref('0.1.0')
const electronVersion = ref('')

// Log store integration
const logStore = useLogStore()
const { stats } = storeToRefs(logStore)

// Computed error count (errors + critical)
const errorCount = computed(() =>
  stats.value.errorCount + stats.value.criticalCount
)

// Disclaimer state (Phase 11 integration - placeholder)
const disclaimerAcknowledged = ref(true) // TODO: Connect to disclaimer store

// Emits
const emit = defineEmits<{
  'toggle-log-viewer': []
  'open-disclaimer': []
  'open-faq': []
}>()

// Lifecycle
onMounted(async () => {
  try {
    const version = await window.api.system.getVersion()
    appVersion.value = version.app
    electronVersion.value = version.electron
  } catch (error) {
    console.error('Failed to fetch version:', error)
  }
})

// Handlers
function toggleLogViewer() {
  emit('toggle-log-viewer')
}

async function openGitHub() {
  const result = await window.api.shell.openExternal(
    'https://github.com/berntpopp/varlens'
  )
  if (!result.success) {
    console.error('Failed to open GitHub:', result.error)
  }
}

async function openLicense() {
  const result = await window.api.shell.openExternal(
    'https://opensource.org/licenses/MIT'
  )
  if (!result.success) {
    console.error('Failed to open license:', result.error)
  }
}

function openDisclaimer() {
  emit('open-disclaimer')
}

function openFAQ() {
  emit('open-faq')
}
</script>
```

### Preload API Extension
```typescript
// preload/index.ts - add to existing api object
const api = {
  // ... existing API (cases, variants, import, system, export)

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
  }
}
```

### Main Process IPC Handler
```typescript
// main/index.ts - add with other ipcMain handlers
import { shell } from 'electron'

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  try {
    const parsedUrl = new URL(url)

    // Whitelist HTTPS only
    if (parsedUrl.protocol !== 'https:') {
      return { success: false, error: 'Only HTTPS URLs allowed' }
    }

    // Optional: whitelist specific domains
    const allowedDomains = [
      'github.com',
      'opensource.org'
    ]

    const hostname = parsedUrl.hostname
    const isAllowed = allowedDomains.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    )

    if (!isAllowed) {
      return { success: false, error: 'Domain not allowed' }
    }

    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    return { success: false, error: 'Invalid URL' }
  }
})
```

### App.vue Integration
```vue
<template>
  <v-app>
    <v-app-bar color="primary" density="compact" flat>
      <!-- Existing app bar content -->
    </v-app-bar>

    <v-navigation-drawer v-model="sidebarOpen" :width="280">
      <!-- Existing sidebar content -->
    </v-navigation-drawer>

    <v-main>
      <!-- Existing main content -->
    </v-main>

    <AppFooter
      @toggle-log-viewer="logViewerOpen = !logViewerOpen"
      @open-disclaimer="handleOpenDisclaimer"
      @open-faq="handleOpenFAQ"
    />

    <!-- Existing dialogs -->
    <LogViewer v-model:open="logViewerOpen" />

    <!-- Remove temporary FAB - footer replaces it -->
    <!-- <v-btn class="log-viewer-fab" ... /> -->
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppFooter from './components/AppFooter.vue'
import LogViewer from './components/LogViewer.vue'
// ... other imports

const logViewerOpen = ref(false)

function handleOpenDisclaimer() {
  // TODO: Phase 11 integration
  console.log('Open disclaimer dialog')
}

function handleOpenFAQ() {
  // TODO: Phase 11 integration
  console.log('Open FAQ dialog')
}
</script>
```

### TypeScript Declarations
```typescript
// src/preload/index.d.ts - extend existing Window interface
export interface Window {
  api: {
    // ... existing API types
    shell: {
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
    }
    system: {
      getVersion: () => Promise<{ app: string; electron: string }>
      getUserDataPath: () => Promise<string>
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vuetify 2 v-footer with fixed prop | Vuetify 3 v-footer with app prop | Vuetify 3.0 (2022) | Automatic position: fixed, better layout coordination |
| v-slot:activator="{ on }" | v-slot:activator="{ props }" | Vuetify 3.0 (2022) | Cleaner API aligned with Vue 3 Composition API |
| Direct shell.openExternal in renderer | IPC-based shell access with validation | Electron security best practices (ongoing) | Prevents RCE vulnerabilities from untrusted URLs |
| toRefs(store) for destructuring | storeToRefs(store) for Pinia stores | Pinia 2.0 (2021) | Ignores methods/non-reactive props, cleaner API |
| Temporary floating FAB for log viewer | Footer-integrated button with badge | Phase 12 design (v0.2.0) | Cohesive app chrome, persistent access |

**Deprecated/outdated:**
- **Vuetify 2 v-footer fixed prop:** No longer needed, app prop implies fixed positioning
- **v-menu position-x/y props:** Removed in Vuetify 3, use location and offset props instead
- **Direct package.json import for version:** Works in dev but fails in packaged app, use app.getVersion()
- **Renderer-side shell module:** Doesn't work with context isolation (required for security)

## Open Questions

Things that couldn't be fully resolved:

1. **Disclaimer/FAQ Integration Points**
   - What we know: Footer needs disclaimer status indicator and FAQ trigger button
   - What's unclear: Disclaimer/FAQ components don't exist yet (Phase 11), exact API for status check
   - Recommendation: Add placeholder boolean `disclaimerAcknowledged` in footer, emit events for button clicks. Phase 11 implementation will provide actual disclaimer store and dialog components. Footer receives state via props and emits actions.

2. **Footer Height with Dynamic Content**
   - What we know: Using height="auto" lets Vuetify recalculate, but performance implications unclear
   - What's unclear: Whether real-time height changes (e.g., footer text wrapping on narrow screens) cause layout jank
   - Recommendation: Use height="auto" for initial implementation, test on various screen sizes. If jank occurs, consider min-height with predictable content design (no wrapping).

3. **External Link Domain Whitelist Scope**
   - What we know: GitHub and license links are known, should be whitelisted
   - What's unclear: Whether to allow arbitrary HTTPS URLs (e.g., for future help links, documentation) or strict whitelist only
   - Recommendation: Start with strict whitelist [github.com, opensource.org], add domains as needed. Document in security policy. Consider configuration file for allowed domains if list grows.

4. **Badge Animation Performance**
   - What we know: v-badge updates on every log entry when errorCount changes
   - What's unclear: Whether high-frequency logging (100+ logs/sec) causes badge re-render performance issues
   - Recommendation: Start with reactive computed property, monitor performance. If issues occur, consider debouncing badge updates or using shallowRef for stats. Log store already has circular buffer to limit growth.

## Sources

### Primary (HIGH confidence)
- [Electron shell API Documentation](https://www.electronjs.org/docs/latest/api/shell) - shell.openExternal method, parameters, return types
- [Electron Security Tutorial](https://www.electronjs.org/docs/latest/tutorial/security) - Context isolation, IPC best practices
- [Electron Inter-Process Communication](https://www.electronjs.org/docs/latest/tutorial/ipc) - ipcRenderer.invoke, ipcMain.handle patterns
- [Vuetify Application Layout](https://vuetifyjs.com/en/features/application-layout/) - app prop behavior, layout coordination
- [Vuetify Menu Component](https://vuetifyjs.com/en/components/menus/) - v-menu activator slot pattern
- [Vuetify Badge Component](https://vuetifyjs.com/en/components/badges/) - v-badge props, :model-value for conditional display
- [Pinia storeToRefs API](https://pinia.vuejs.org/api/pinia/functions/storeToRefs.html) - Reactive store destructuring
- [Vue 3 Reactivity Fundamentals](https://vuejs.org/guide/essentials/reactivity-fundamentals) - computed properties, reactive state
- VarLens codebase - Existing logStore.ts, LogViewer.vue, App.vue, preload/index.ts patterns

### Secondary (MEDIUM confidence)
- [The dangers of Electron's shell.openExternal()](https://benjamin-altpeter.de/shell-openexternal-dangers/) - Security vulnerabilities, URL validation patterns (blog post, verified with official docs)
- [Layouts & Theming in Vuetify 3](https://www.thisdot.co/blog/layouts-and-theming-in-vuetify-3) - Custom theme colors, footer styling
- [Icon accessibility and aria-label](https://gomakethings.com/icon-accessibility-and-aria-label/) - ARIA label best practices for icon buttons
- [10 modern footer UX patterns for 2025](https://www.eleken.co/blog-posts/footer-ux) - Compact footer design principles
- [Mastering Reactivity and Data Updates in Vue.js 3](https://vueschool.io/articles/vuejs-tutorials/mastering-reactivity-and-data-updates-in-vue-js-3/) - Computed properties with reactive dependencies
- GitHub Issues: [Vuetify footer height issues](https://github.com/vuetifyjs/vuetify/issues/11121), [layout system improvements](https://github.com/vuetifyjs/vuetify/discussions/16219) - Vuetify 3 layout system fixes

### Tertiary (LOW confidence)
- [How to show your App Version from package.json](https://medium.com/hceverything/how-to-show-your-app-version-from-package-json-in-your-vue-application-11e882b97d8c) - Version display patterns (Medium article, older)
- [Building dynamic Vuetify themes](https://blog.logrocket.com/building-dynamic-vuetify-themes/) - Theme customization patterns (LogRocket article)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified in package.json and official docs
- Architecture patterns: HIGH - v-footer app prop, v-menu activator slot, storeToRefs verified in official Vuetify/Pinia/Vue docs
- Security (shell.openExternal): HIGH - Official Electron security docs confirm URL validation requirement
- Pitfalls: MEDIUM - Some historical Vuetify 2 issues, Vuetify 3 layout system resolved most but specific edge cases not fully tested
- Code examples: HIGH - Based on existing VarLens patterns (App.vue, LogViewer.vue, preload/index.ts) and official docs

**Research date:** 2026-01-27
**Valid until:** 30 days (2026-02-26) - Stable domain, established patterns. Vuetify 3 layout system mature, Electron IPC patterns standardized.
