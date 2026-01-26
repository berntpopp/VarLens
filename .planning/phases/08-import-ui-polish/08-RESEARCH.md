# Phase 8: Import UI + Polish - Research

**Researched:** 2026-01-26
**Domain:** Vue 3 + Vuetify 3 dialog-based file import with progress tracking and error handling
**Confidence:** HIGH

## Summary

This phase implements an import dialog component using Vuetify 3's v-dialog with file selection, progress tracking, error handling, and success confirmation. The research reveals that the project already has a complete IPC-based import backend with progress events, error handling, and transaction rollback. The UI layer needs to connect to this via a new ImportDialog component following existing patterns (DeleteCaseDialog, AppSnackbar).

**Key findings:**
- Vuetify 3 provides v-dialog, v-file-input, v-progress-linear, and v-snackbar components that match all requirements
- Project already uses defineExpose pattern for dialog methods (see DeleteCaseDialog.vue)
- IPC layer already handles file selection (import:selectFile), progress throttling (100ms), and cancellation (AbortController)
- Error handling infrastructure already converts database UNIQUE constraint violations to user-friendly messages
- Vue 3 Composition API cleanup pattern (onMounted/onUnmounted) must be used to prevent IPC listener memory leaks

**Primary recommendation:** Create ImportDialog.vue following DeleteCaseDialog.vue pattern, expose show() method via defineExpose, use IPC progress listener with onUnmounted cleanup, and integrate with existing AppSnackbar for post-import toast.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vuetify 3 | 3.11.7 | Material Design UI components | Already project dependency, provides v-dialog, v-file-input, v-progress-linear |
| Vue 3 Composition API | 3.5.27 | Component logic and lifecycle | Project standard, enables ref/reactive state, defineExpose, onMounted/onUnmounted |
| Electron IPC | 40.0.0 | Main-renderer communication | Project architecture, handles file dialogs and import operations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | 12.6.2 | SQLite database (main process) | Already handles UNIQUE constraint validation |
| Node.js path module | Built-in | File path parsing (main process) | Extract filename from full path for default case name |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vuetify v-dialog | Custom modal | Vuetify provides accessibility, theming, and tested patterns |
| Electron native dialog | HTML file input | Native dialog remembers directory, filters extensions properly |
| Built-in file size/number formatting | pretty-bytes, numeral.js | Built-in toLocaleString() sufficient for this use case |

**Installation:**
No new packages required - all dependencies already in package.json.

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/components/
├── ImportDialog.vue        # New: Import dialog component
├── AppSnackbar.vue         # Existing: Toast notifications
├── DeleteCaseDialog.vue    # Existing: Reference pattern for dialogs
└── CaseList.vue            # Existing: Trigger import from "+ Import" button
```

### Pattern 1: Dialog Component with defineExpose
**What:** Reusable dialog component that exposes methods via defineExpose for parent control
**When to use:** Dialogs that need programmatic open/close from parent components
**Example:**
```vue
<!-- ImportDialog.vue -->
<template>
  <v-dialog v-model="dialog" max-width="500" :persistent="isImporting">
    <v-card>
      <v-card-title>Import Variant Data</v-card-title>
      <v-card-text>
        <!-- dialog content -->
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const dialog = ref(false)
const isImporting = ref(false)

const show = (): void => {
  dialog.value = true
}

const close = (): void => {
  if (!isImporting.value) {
    dialog.value = false
  }
}

defineExpose({ show })
</script>
```
**Source:** Existing DeleteCaseDialog.vue (project codebase)

### Pattern 2: IPC Progress Listener with Cleanup
**What:** Register IPC event listener in onMounted, clean up in onUnmounted to prevent memory leaks
**When to use:** Any component that listens to Electron IPC events
**Example:**
```typescript
import { onMounted, onUnmounted } from 'vue'

let cleanupProgress: (() => void) | null = null

onMounted(() => {
  cleanupProgress = window.api.import.onProgress((progress) => {
    // Update UI with progress
  })
})

onUnmounted(() => {
  cleanupProgress?.()
})
```
**Source:** Preload API already provides cleanup function pattern (src/preload/index.ts:45-54)

### Pattern 3: File Path to Case Name
**What:** Extract filename without extension for auto-populating case name input
**When to use:** Converting file paths from native dialog to user-friendly default names
**Example:**
```typescript
// Main process (IPC handler)
import { basename } from 'path'

const filePath = '/users/data/sample.json.gz'
const filename = basename(filePath, '.gz')  // 'sample.json'
const caseName = basename(filename, '.json') // 'sample'
```
**Source:** Node.js path.basename() accepts optional extension parameter to strip

### Pattern 4: Vuetify Form Validation Rules
**What:** Array of validation functions that return true or error message string
**When to use:** v-text-field, v-file-input, any Vuetify form input requiring validation
**Example:**
```typescript
const caseNameRules = [
  (v: string) => !!v || 'Case name is required',
  (v: string) => v.length >= 3 || 'Case name must be at least 3 characters',
  (v: string) => v.length <= 50 || 'Case name must be less than 50 characters'
]
```
**Source:** Vuetify validation pattern - rules return true (valid) or string (error message)

### Pattern 5: Determinate Progress Bar
**What:** v-progress-linear with v-model bound to percentage (0-100)
**When to use:** Showing progress when total count is known
**Example:**
```vue
<v-progress-linear
  v-model="progressPercent"
  color="primary"
  height="25"
/>
<div>Inserting variants... {{ progress.count.toLocaleString() }} / {{ totalCount.toLocaleString() }}</div>
```
**Source:** Vuetify v-progress-linear component with determinate mode

### Anti-Patterns to Avoid
- **Forgetting IPC listener cleanup:** Always use onUnmounted to remove listeners - project preload API returns cleanup function for this exact reason
- **Modifying dialog state during import:** persistent prop prevents close, but code should also check isImporting flag before allowing close
- **Not handling duplicate case names:** Backend throws UniqueConstraintError - UI must catch this via isIpcError type guard and display inline
- **Setting v-model on v-file-input:** Use @change event instead - Electron IPC handles file selection, not HTML input
- **Hardcoding file extensions:** Use accept prop on browse button, but actual filtering happens in Electron showOpenDialog

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File dialog with filters | HTML input[type=file] | Electron dialog.showOpenDialog | Remembers last directory, proper .gz filtering, native UX |
| Progress event throttling | Custom debounce/throttle | Already implemented in import.ts:44 | IPC handler throttles to 100ms, prevents renderer flooding |
| Transaction rollback on error | Manual cleanup | ImportService already does this | Lines 104-113 handle case deletion on import failure |
| Error message mapping | Switch/case in UI | toSerializableError in errorHandler.ts | Already maps UNIQUE_CONSTRAINT, FILE_NOT_FOUND, PARSE_ERROR, etc. |
| Number formatting | Custom comma insertion | Number.toLocaleString() | Built-in, locale-aware, handles thousands separators |
| AbortController management | Custom cancellation | Already implemented in import.ts:15-16 | Main process tracks currentAbortController, handles cleanup |

**Key insight:** The backend already handles all complex logic (streaming, parsing, validation, progress, cancellation, rollback). UI only needs to orchestrate IPC calls and reflect state visually.

## Common Pitfalls

### Pitfall 1: IPC Listener Memory Leaks
**What goes wrong:** IPC progress listeners accumulate when dialog opens/closes multiple times, causing memory bloat
**Why it happens:** ipcRenderer.on adds listener each time, but listener never removed on component unmount
**How to avoid:** Preload API returns cleanup function - store it and call in onUnmounted
**Warning signs:** MaxListenersExceededWarning in console, memory usage climbing with each import

### Pitfall 2: Dialog Closes During Import
**What goes wrong:** User clicks outside or presses Escape, canceling active import mid-stream
**Why it happens:** v-dialog defaults to closing on outside click and Escape key
**How to avoid:** Set :persistent="isImporting" to block close during import, allow close before/after
**Warning signs:** Partial data in database, import never completes

### Pitfall 3: Case Name Not Validated Before Import
**What goes wrong:** User clicks Import with empty case name, backend throws error, poor UX
**Why it happens:** Validation only happens on submit, not during typing
**How to avoid:** Use Vuetify validation rules on v-text-field, disable Import button until form valid
**Warning signs:** Users see backend error messages instead of inline field validation

### Pitfall 4: Duplicate Case Name Shows Generic Error
**What goes wrong:** User imports case with existing name, sees "Database error" instead of specific message
**Why it happens:** Not checking error.code === ErrorCode.UNIQUE_CONSTRAINT
**How to avoid:** Use isIpcError type guard, check error.code, display error.userMessage inline in dialog
**Warning signs:** Error messages don't mention "case name already exists"

### Pitfall 5: Progress Text Not Formatted
**What goes wrong:** Progress shows "12450 / 65000" instead of "12,450 / 65,000" - harder to read
**Why it happens:** Using .toString() instead of .toLocaleString()
**How to avoid:** Always use toLocaleString() for displaying counts over 1000
**Warning signs:** Numbers displayed without thousands separators

### Pitfall 6: File Extensions Not Properly Filtered
**What goes wrong:** Users see all files or .gz filtering doesn't work properly
**Why it happens:** Using compound extensions like 'json.gz' or 'tar.gz' has known issues in Electron
**How to avoid:** Filter with separate entries: ['json', 'gz'] not ['json.gz']
**Warning signs:** .json.gz files appear grayed out in file picker

### Pitfall 7: Auto-Close Timing Too Fast/Slow
**What goes wrong:** Success message disappears before user sees it, or dialog lingers too long
**Why it happens:** No user testing of auto-close delay timing
**How to avoid:** Use 1500-2000ms delay (1.5-2 seconds), show success state before closing
**Warning signs:** Users report "didn't see what happened" or "dialog stuck open"

## Code Examples

Verified patterns from official sources and existing codebase:

### Opening Native File Dialog via IPC
```typescript
// Trigger from parent component
const handleImportClick = async () => {
  const filePath = await window.api.import.selectFile()
  if (filePath) {
    importDialogRef.value?.show(filePath)
  }
}
```
**Source:** Existing preload API (src/preload/index.ts:36)

### Starting Import with Progress Tracking
```typescript
import { ref, onMounted, onUnmounted } from 'vue'
import type { ProgressUpdate, ImportResult } from '@/types/api'
import { isIpcError, ErrorCode } from '@/types/errors'

const progress = ref<ProgressUpdate>({ phase: 'reading', count: 0, elapsed: 0 })
const isImporting = ref(false)
const errorMessage = ref('')

let cleanupProgress: (() => void) | null = null

onMounted(() => {
  cleanupProgress = window.api.import.onProgress((update) => {
    progress.value = update
  })
})

onUnmounted(() => {
  cleanupProgress?.()
})

const startImport = async (filePath: string, caseName: string) => {
  isImporting.value = true
  errorMessage.value = ''

  const result = await window.api.import.start(filePath, caseName)

  if (isIpcError(result)) {
    // Handle error
    if (result.code === ErrorCode.UNIQUE_CONSTRAINT) {
      errorMessage.value = 'A case with this name already exists'
    } else {
      errorMessage.value = result.userMessage
    }
    isImporting.value = false
  } else {
    // Success - result is ImportResult
    isImporting.value = false
    // Show success state, then auto-close
  }
}
```
**Source:** Preload API types and error handling patterns from existing codebase

### Canceling Import
```typescript
const cancelImport = async () => {
  await window.api.import.cancel()
  isImporting.value = false
  dialog.value = false
}
```
**Source:** Existing preload API (src/preload/index.ts:57)

### Progress Percentage Calculation
```typescript
import { computed } from 'vue'

// Assuming we track total from initial file scan or estimate
const totalVariants = ref(0)

const progressPercent = computed(() => {
  if (totalVariants.value === 0) return 0
  return Math.min(100, Math.round((progress.value.count / totalVariants.value) * 100))
})
```
**Note:** Current backend doesn't provide total count in progress events - may need indeterminate mode or estimate from file size

### Error Display Pattern
```vue
<v-card-text>
  <v-alert v-if="errorMessage" type="error" class="mb-4">
    {{ errorMessage }}
  </v-alert>

  <v-text-field
    v-model="caseName"
    label="Case Name"
    :rules="caseNameRules"
    :disabled="isImporting"
  />
</v-card-text>
```
**Source:** Vuetify v-alert component pattern

### Success State with Auto-Close
```typescript
const showSuccessAndClose = (result: ImportResult) => {
  isSuccess.value = true

  setTimeout(() => {
    dialog.value = false
    isSuccess.value = false

    // Emit event to parent to select case and show snackbar
    emit('import-complete', {
      caseId: result.caseId,
      variantCount: result.variantCount,
      caseName: caseName.value
    })
  }, 1500) // 1.5 second delay
}
```
**Source:** Common Vue timeout pattern for auto-close dialogs

### Filename Extraction (Main Process)
```typescript
// In import IPC handler - extract default case name from file path
import { basename } from 'path'

const filePath = '/users/data/sample.json.gz'
let defaultName = basename(filePath)

// Strip .gz extension
if (defaultName.endsWith('.gz')) {
  defaultName = defaultName.slice(0, -3)
}

// Strip .json extension
if (defaultName.endsWith('.json')) {
  defaultName = defaultName.slice(0, -5)
}

// Return to renderer
return { filePath, defaultName }
```
**Source:** Node.js path.basename() - official Node.js documentation

### Number Formatting for Display
```typescript
const formattedCount = computed(() => {
  return progress.value.count.toLocaleString()
})

const formattedTotal = computed(() => {
  return totalVariants.value.toLocaleString()
})
```
**Source:** Built-in Number.toLocaleString() - MDN Web Docs

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Options API with data() | Composition API with ref() | Vue 3 (2020) | Better TypeScript support, easier cleanup |
| v-model on dialogs only | v-model + persistent prop | Vuetify 3 | Granular control over close behavior |
| Manual IPC cleanup | Preload returns cleanup function | This project | Explicit cleanup prevents memory leaks |
| Promise-based dialog plugins | defineExpose pattern | Vue 3 + script setup | Simpler, type-safe, no plugin needed |
| Indeterminate progress only | Determinate with count | Modern UX | Users see actual progress, not just spinner |

**Deprecated/outdated:**
- Vuetify 2 v-dialog: Used different prop names (persistent worked differently)
- Vue 2 $refs: Required nextTick and lacked TypeScript support
- ipcRenderer.send/on: Modern pattern uses invoke/handle for request-response
- Custom debounce for progress: Backend throttling at 100ms is sufficient

## Open Questions

Things that couldn't be fully resolved:

1. **Total variant count for progress bar**
   - What we know: Backend emits count of variants processed so far
   - What's unclear: Backend doesn't emit total count upfront (would require pre-scan)
   - Recommendation: Use indeterminate mode OR estimate from file size, switch to determinate once count known

2. **File size for default case name**
   - What we know: import:selectFile returns filePath string
   - What's unclear: Should IPC also return extracted filename for default case name?
   - Recommendation: Add defaultName to selectFile return value - cleaner than parsing in renderer

3. **Import button location**
   - What we know: Context says "+ Import" button in sidebar header
   - What's unclear: CaseList.vue currently shows cases, doesn't have action buttons
   - Recommendation: Add button to AppSidebar header (similar to DeleteCaseDialog trigger in CaseList)

4. **Snackbar integration**
   - What we know: AppSnackbar.vue exists with show(msg, type) method
   - What's unclear: How to access from ImportDialog to trigger post-import toast
   - Recommendation: Emit event from ImportDialog, parent (App.vue) triggers snackbar

## Sources

### Primary (HIGH confidence)
- Vuetify 3.11.7 - Project package.json, existing component usage patterns
- Vue 3.5.27 Composition API - Project package.json, existing component patterns
- Electron 40.0.0 IPC - Project codebase: src/preload/index.ts, src/main/ipc/handlers/import.ts
- Existing dialog pattern - src/renderer/src/components/DeleteCaseDialog.vue
- Error handling - src/main/ipc/errorHandler.ts, src/shared/types/errors.ts
- Import service - src/main/import/ImportService.ts (lines 104-113 rollback pattern)

### Secondary (MEDIUM confidence)
- [Vuetify File Upload example - BezKoder](https://www.bezkoder.com/vuetify-file-upload/)
- [Implement a Reusable File Selector Dialog with Vue 3 Composables | by Gabriele Fazio | Medium](https://gabriele-fazio.medium.com/implement-a-reusable-file-selector-dialog-with-vue-3-composables-c74fe08fd148)
- [Progress linear component — Vuetify](https://vuetifyjs.com/en/components/progress-linear/)
- [Using vuetify 2/3 native validation rules - the right way | by Carlos Henrique Sa Filho | Medium](https://medium.com/@carlos.henrique.sa.filho/using-vuetify-2-3-native-validation-rules-the-right-way-138f9a974a49)
- [Exposing Methods From Child Components in Vue 3 - Codecourse](https://codecourse.com/articles/exposing-methods-from-child-components-in-vue-3)
- [Expose Child Component Methods to Parent Components with Vue 3 defineExpose - DEV Community](https://dev.to/cn-2k/expose-child-component-methods-to-parent-components-with-vue-3-script-setup-defineexpose-4ghl)
- [Inter-Process Communication | Electron](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Node.js path.basename() Method - W3Schools](https://www.w3schools.com/nodejs/met_path_basename.asp)
- [Electron dialog API](https://www.electronjs.org/docs/latest/api/dialog)

### Tertiary (LOW confidence - WebSearch findings)
- [Dialog component — Vuetify](https://vuetifyjs.com/en/components/dialogs/) - Could not fetch content, using existing codebase patterns instead
- [File input component — Vuetify](https://vuetifyjs.com/en/components/file-inputs/) - Could not fetch content
- [Diagnosing and Fixing Memory Leaks in Electron Applications - Mindful Chase](https://www.mindfulchase.com/explore/troubleshooting-tips/frameworks-and-libraries/diagnosing-and-fixing-memory-leaks-in-electron-applications.html)
- [Memory leak when passing IPC events over contextBridge · Issue #27039 · electron/electron](https://github.com/electron/electron/issues/27039)
- [Composition API: Lifecycle Hooks | Vue.js](https://vuejs.org/api/composition-api-lifecycle)
- [SQLite Transaction](https://www.sqlite.org/lang_transaction.html)
- [Convert Bytes To KB, MB, GB Using JavaScript & PHP](https://www.html-code-generator.com/javascript/byte-converter)
- [Number.prototype.toLocaleString() - JavaScript | MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toLocaleString)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies already in package.json, patterns exist in codebase
- Architecture: HIGH - Existing DeleteCaseDialog.vue provides exact pattern to follow
- Pitfalls: HIGH - Based on documented Electron IPC memory leak issues and project code review
- Progress tracking: MEDIUM - Backend provides events but not total count upfront
- File name extraction: HIGH - Standard Node.js path module functionality

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days - Vue/Vuetify stable, Electron IPC patterns well-established)
