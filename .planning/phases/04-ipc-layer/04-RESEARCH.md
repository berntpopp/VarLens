# Phase 4: IPC Layer - Research

**Researched:** 2026-01-26
**Domain:** Electron IPC with TypeScript
**Confidence:** HIGH

## Summary

The IPC layer in Electron connects the main process (with access to Node.js APIs and services) to the renderer process (running the UI). The standard approach uses three components: **preload scripts with contextBridge** to expose a limited API, **ipcRenderer.invoke() with ipcMain.handle()** for request-response patterns, and **webContents.send() with ipcRenderer.on()** for main-to-renderer event streaming.

Type safety is achieved through shared TypeScript interfaces defining the exposed API shape, with declaration files augmenting the `Window` interface for renderer-side type checking. The project uses electron-vite which treats preload scripts as a distinct build target with automatic discovery at `src/preload/index.ts`.

**Primary recommendation:** Use the invoke/handle pattern for all request-response operations (file selection, queries, mutations), and webContents.send() for streaming progress events from main to renderer with client-side throttling (100-250ms).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Electron | 40.0.0+ | Desktop framework | Required - provides IPC primitives (ipcMain, ipcRenderer, contextBridge) |
| TypeScript | 5.9+ | Type safety | Already in use - enables compile-time IPC contract verification |
| @electron-toolkit/preload | ^3.0.2 | API exposure helpers | Already installed - simplifies contextBridge boilerplate |
| electron-vite | ^5.0.0 | Build system | Already in use - handles preload script building and HMR |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| AbortController/AbortSignal | native | Cancellation | Standard Web API - already used in ImportService for cancellation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual typing | electron-typescript-ipc | Third-party library adds dependency; manual typing gives full control and matches existing pattern |
| electron-promise-ipc | Built-in invoke/handle | Third-party wrapper adds overhead; native invoke/handle is standard since Electron 7 |
| MessagePort for streaming | webContents.send | MessagePort enables renderer-to-renderer; overkill for main-to-renderer progress updates |

**Installation:**
All dependencies already installed. No additional packages required.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── main/
│   ├── ipc/
│   │   ├── handlers/        # IPC handler modules (cases, variants, import, system)
│   │   │   ├── cases.ts
│   │   │   ├── variants.ts
│   │   │   ├── import.ts
│   │   │   └── system.ts
│   │   └── index.ts         # Register all handlers
│   ├── database/
│   └── import/
├── preload/
│   ├── index.ts             # contextBridge exposure
│   └── index.d.ts           # Window interface declaration
├── renderer/
│   └── src/
│       └── composables/     # Vue composables for IPC calls
└── shared/
    └── types/
        ├── api.ts           # Window.api type definitions
        ├── ipc.ts           # Request/response types
        └── errors.ts        # Serializable error types
```

### Pattern 1: Request-Response (Invoke/Handle)
**What:** Async request from renderer, promise-based response from main
**When to use:** All operations that return a value (queries, file dialogs, CRUD operations)
**Example:**
```typescript
// Source: https://www.electronjs.org/docs/latest/tutorial/ipc

// Main process (src/main/ipc/handlers/cases.ts)
import { ipcMain } from 'electron'
import { databaseService } from '../database'

ipcMain.handle('cases:list', async () => {
  return await databaseService.listCases()
})

// Preload script (src/preload/index.ts)
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  cases: {
    list: () => ipcRenderer.invoke('cases:list')
  }
})

// Renderer (TypeScript with autocomplete)
const cases = await window.api.cases.list()
```

### Pattern 2: Main-to-Renderer Events (Progress Streaming)
**What:** Push events from main to renderer for progress updates
**When to use:** Long-running operations that emit progress (import, export)
**Example:**
```typescript
// Source: https://www.electronjs.org/docs/latest/tutorial/ipc

// Main process - send events to renderer
import { BrowserWindow } from 'electron'

function emitProgress(progress: ProgressUpdate) {
  const mainWindow = BrowserWindow.getAllWindows()[0]
  mainWindow?.webContents.send('import:progress', progress)
}

// Preload - expose listener (NOT raw ipcRenderer)
contextBridge.exposeInMainWorld('api', {
  import: {
    onProgress: (callback: (progress: ProgressUpdate) => void) =>
      ipcRenderer.on('import:progress', (_event, progress) => callback(progress))
  }
})

// Renderer - listen for events
window.api.import.onProgress((progress) => {
  console.log(`Phase: ${progress.phase}, Count: ${progress.count}`)
})
```

### Pattern 3: Shared Type Definitions
**What:** Common TypeScript interfaces imported by main, preload, and renderer
**When to use:** All IPC operations - ensures compile-time contract verification
**Example:**
```typescript
// Source: https://www.xjavascript.com/blog/electron-preload-typescript/

// src/shared/types/api.ts
export interface CasesAPI {
  list: () => Promise<Case[]>
  delete: (id: number) => Promise<void>
}

export interface ImportAPI {
  start: (filePath: string, caseName: string) => Promise<ImportResult>
  onProgress: (callback: (progress: ProgressUpdate) => void) => void
  cancel: () => Promise<void>
}

export interface WindowAPI {
  cases: CasesAPI
  variants: VariantsAPI
  import: ImportAPI
  system: SystemAPI
}

// src/preload/index.d.ts
declare global {
  interface Window {
    api: WindowAPI
  }
}
```

### Pattern 4: Error Serialization Wrapper
**What:** Centralized error handling that serializes custom errors for IPC
**When to use:** All ipcMain.handle calls - errors lose prototype and stack across IPC
**Example:**
```typescript
// Source: https://github.com/electron/electron/issues/7956
// Note: ipcMain.handle only serializes error.message, not custom properties

// src/shared/types/errors.ts
export interface SerializableError {
  code: string
  message: string
  userMessage: string
  details?: Record<string, unknown>
}

// src/main/ipc/errorHandler.ts
export function wrapHandler<T>(
  handler: () => Promise<T>
): Promise<T | SerializableError> {
  try {
    return await handler()
  } catch (error) {
    // Convert to serializable format
    if (error instanceof DatabaseError) {
      return {
        code: error.name,
        message: error.message,
        userMessage: getUserFriendlyMessage(error),
        details: { cause: error.cause?.message }
      }
    }
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
      userMessage: 'An unexpected error occurred'
    }
  }
}

// Main handler usage
ipcMain.handle('cases:delete', async (_event, id: number) => {
  return wrapHandler(() => databaseService.deleteCase(id))
})
```

### Pattern 5: Channel Naming Convention
**What:** Consistent naming scheme for IPC channels
**When to use:** All IPC operations
**Format:** `domain:action` (e.g., `cases:list`, `variants:query`, `import:start`)
**Why:** Easy to trace in DevTools, groups related operations, prevents naming collisions

### Pattern 6: Client-Side Throttling for Progress Events
**What:** Throttle progress callback invocations to prevent UI flooding
**When to use:** Any high-frequency event stream (import progress, download progress)
**Example:**
```typescript
// Source: https://medium.com/@fibianmejia/javascript-performance-tuning-implementing-throttling-in-typescript-ef5a5622c462

// Simple throttle implementation
function throttle<T extends (...args: unknown[]) => void>(
  func: T,
  delay: number
): T {
  let lastRun = 0
  return ((...args: Parameters<T>) => {
    const now = Date.now()
    if (now - lastRun >= delay) {
      lastRun = now
      func(...args)
    }
  }) as T
}

// Renderer usage
const throttledUpdate = throttle((progress: ProgressUpdate) => {
  // Update UI
  progressBar.value = progress.count
  phaseText.value = progress.phase
}, 100) // 100ms throttle

window.api.import.onProgress(throttledUpdate)
```

### Anti-Patterns to Avoid
- **Exposing ipcRenderer directly:** Security risk - untrusted code can send arbitrary messages
- **Synchronous IPC (sendSync):** Blocks UI thread - use invoke/handle instead
- **Passing non-serializable objects:** Functions, DOM elements, Node.js objects fail to serialize
- **Manual channel string constants:** Typos cause runtime failures - use shared types
- **Main process listener cleanup:** Memory leak if handlers aren't removed - use removeHandler()

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IPC type safety | Custom type assertion system | Shared TypeScript interfaces + declaration files | Standard pattern, compile-time checking, IDE autocomplete |
| Progress throttling | Custom debounce logic | Standard throttle function | Edge cases (leading/trailing calls), timing precision, memory management |
| Cancellation | Custom cancel flag + polling | AbortController/AbortSignal | Web standard, integrates with Promise.race, cleanup semantics |
| Preload boilerplate | Manual contextBridge calls | @electron-toolkit/preload | Already installed, handles context isolation check, standard exposure pattern |
| Error serialization | ad-hoc error.toJSON() | Centralized error wrapper | Only error.message crosses IPC, custom properties lost, consistent handling |

**Key insight:** Electron IPC has subtle serialization constraints (Structured Clone Algorithm) and security implications (context isolation). Use proven patterns from official docs rather than custom solutions.

## Common Pitfalls

### Pitfall 1: Error Objects Lose Custom Properties Across IPC
**What goes wrong:** Throwing custom error classes in ipcMain.handle only sends error.message to renderer - all other properties (code, stack, cause) are lost
**Why it happens:** Electron uses Structured Clone Algorithm which doesn't serialize error prototypes or custom properties
**How to avoid:** Return errors as plain objects `{ code, message, details }` instead of throwing, OR wrap all handlers to catch and serialize errors before returning
**Warning signs:** `error instanceof CustomError` fails in renderer, error.code is undefined
**Source:** [Electron GitHub Issue #7956](https://github.com/electron/electron/issues/7956), [Electron ipcMain docs](https://www.electronjs.org/docs/latest/api/ipc-main)

### Pitfall 2: Exposing ipcRenderer Directly to Renderer
**What goes wrong:** Passing raw ipcRenderer through contextBridge allows malicious code in renderer to send arbitrary IPC messages, bypassing security controls
**Why it happens:** Developers try to reduce boilerplate by exposing full ipcRenderer module instead of wrapping specific methods
**How to avoid:** Always wrap ipcRenderer calls in named functions that only accept specific arguments: `send: (title) => ipcRenderer.send('set-title', title)`
**Warning signs:** `contextBridge.exposeInMainWorld('ipcRenderer', ipcRenderer)` in preload script
**Source:** [Electron IPC Tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc), [Electron Security Guide](https://www.electronjs.org/docs/latest/tutorial/security)

### Pitfall 3: Not Removing Event Listeners in Renderer
**What goes wrong:** ipcRenderer.on() listeners persist across component unmounts, causing duplicate handlers and memory leaks
**Why it happens:** Renderer framework (Vue, React) unmounts components but IPC listeners aren't automatically cleaned up
**How to avoid:** Return cleanup function from event exposure: `onProgress: (cb) => { ipcRenderer.on('progress', cb); return () => ipcRenderer.removeListener('progress', cb) }`
**Warning signs:** Progress callback fires multiple times per event, memory usage grows on navigation

### Pitfall 4: Attempting to Cancel invoke() Calls
**What goes wrong:** Calling ipcRenderer.invoke() creates a promise that can't be cancelled - there's no native abort mechanism
**Why it happens:** Developers expect invoke() to support AbortSignal like fetch API
**How to avoid:** Implement cancellation as separate IPC channel (e.g., `import:cancel`) and coordinate in main process using AbortController internally
**Warning signs:** Trying to pass AbortSignal through invoke() parameters
**Source:** [Electron Feature Request #41025](https://github.com/electron/electron/issues/41025)

### Pitfall 5: Sending Non-Serializable Objects Across IPC
**What goes wrong:** Passing functions, Promises, WeakMaps, DOM elements, or Node.js objects throws "Failed to serialize arguments" error
**Why it happens:** IPC uses Structured Clone Algorithm which only supports JSON-like types plus Blob, ArrayBuffer, Error
**How to avoid:** Check all IPC arguments are POJOs, primitives, Arrays, or typed arrays - convert complex objects to serializable shape before sending
**Warning signs:** "object could not be cloned" error, "Failed to serialize" in console
**Source:** [Electron contextBridge docs](https://www.electronjs.org/docs/latest/api/context-bridge)

### Pitfall 6: Race Conditions in Progress Event Handlers
**What goes wrong:** Progress events arrive out of order or faster than UI can update, causing flickering or incorrect display
**Why it happens:** Main process sends events rapidly (every variant), renderer processes events asynchronously
**How to avoid:** Throttle progress updates on sender side (emit max every 100ms) AND/OR throttle callback invocation in renderer
**Warning signs:** Progress bar jumps erratically, phase text flickers between states

### Pitfall 7: Context Isolation Disabled Without Security Review
**What goes wrong:** Disabling context isolation (`contextIsolation: false`) exposes Node.js APIs to renderer, enabling XSS to execute arbitrary code
**Why it happens:** Legacy tutorials or quick fixes disable isolation to avoid preload script setup
**How to avoid:** Always keep context isolation enabled (default since Electron 12), use contextBridge to expose only needed APIs
**Warning signs:** `webPreferences: { contextIsolation: false }` in BrowserWindow config
**Source:** [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)

## Code Examples

Verified patterns from official sources:

### Complete Typed IPC Setup
```typescript
// Source: Synthesized from https://www.electronjs.org/docs/latest/tutorial/ipc
// and https://www.xjavascript.com/blog/electron-preload-typescript/

// ============ src/shared/types/api.ts ============
import { Case, Variant, PaginatedResult } from '../database/types'
import { ProgressUpdate, ImportResult } from '../import/types'

export interface CasesAPI {
  list: () => Promise<Case[]>
  delete: (id: number) => Promise<void>
}

export interface VariantsAPI {
  query: (
    caseId: number,
    filters: VariantFilter,
    cursor?: PaginationCursor,
    limit?: number
  ) => Promise<PaginatedResult<Variant>>
}

export interface ImportAPI {
  selectFile: () => Promise<string | null>
  start: (filePath: string, caseName: string) => Promise<ImportResult>
  onProgress: (callback: (progress: ProgressUpdate) => void) => () => void
  cancel: () => Promise<void>
}

export interface WindowAPI {
  cases: CasesAPI
  variants: VariantsAPI
  import: ImportAPI
}

// ============ src/preload/index.ts ============
import { contextBridge, ipcRenderer } from 'electron'
import type { ProgressUpdate } from '../shared/types'

const api = {
  cases: {
    list: () => ipcRenderer.invoke('cases:list'),
    delete: (id: number) => ipcRenderer.invoke('cases:delete', id)
  },
  variants: {
    query: (caseId, filters, cursor, limit) =>
      ipcRenderer.invoke('variants:query', caseId, filters, cursor, limit)
  },
  import: {
    selectFile: () => ipcRenderer.invoke('import:selectFile'),
    start: (filePath: string, caseName: string) =>
      ipcRenderer.invoke('import:start', filePath, caseName),
    onProgress: (callback: (progress: ProgressUpdate) => void) => {
      const handler = (_event: unknown, progress: ProgressUpdate) =>
        callback(progress)
      ipcRenderer.on('import:progress', handler)
      // Return cleanup function
      return () => ipcRenderer.removeListener('import:progress', handler)
    },
    cancel: () => ipcRenderer.invoke('import:cancel')
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error - fallback for non-isolated context
  window.api = api
}

// ============ src/preload/index.d.ts ============
import type { WindowAPI } from '../shared/types/api'

declare global {
  interface Window {
    api: WindowAPI
  }
}

// ============ src/main/ipc/handlers/import.ts ============
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { importService } from '../../import'

let currentAbortController: AbortController | null = null

// File selection
ipcMain.handle('import:selectFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json', 'gz'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return result.canceled ? null : result.filePaths[0]
})

// Start import with progress
ipcMain.handle('import:start', async (_event, filePath: string, caseName: string) => {
  currentAbortController = new AbortController()
  const mainWindow = BrowserWindow.getAllWindows()[0]

  // Throttled progress emitter
  let lastEmit = 0
  const THROTTLE_MS = 100

  const result = await importService.importVariants(filePath, {
    caseName,
    onProgress: (progress) => {
      const now = Date.now()
      if (now - lastEmit >= THROTTLE_MS) {
        mainWindow?.webContents.send('import:progress', progress)
        lastEmit = now
      }
    },
    signal: currentAbortController.signal
  })

  currentAbortController = null
  return result
})

// Cancel import
ipcMain.handle('import:cancel', async () => {
  currentAbortController?.abort()
  currentAbortController = null
})

// ============ src/main/ipc/index.ts ============
// Import all handler modules to register them
import './handlers/cases'
import './handlers/variants'
import './handlers/import'
import './handlers/system'
```

### Renderer Usage in Vue Component
```typescript
// Source: Pattern from Vue Composition API + Electron IPC

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'

const progress = ref<ProgressUpdate | null>(null)
const isImporting = ref(false)

// Register progress listener with cleanup
const removeProgressListener = window.api.import.onProgress((update) => {
  progress.value = update
})

onUnmounted(() => {
  removeProgressListener()
})

async function startImport() {
  // File selection
  const filePath = await window.api.import.selectFile()
  if (!filePath) return

  try {
    isImporting.value = true
    const result = await window.api.import.start(filePath, 'Case001')
    console.log(`Imported ${result.variantCount} variants`)
  } catch (error) {
    console.error('Import failed:', error)
  } finally {
    isImporting.value = false
    progress.value = null
  }
}

function cancelImport() {
  window.api.import.cancel()
}
</script>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| remote module | contextBridge + IPC | Electron 10 (deprecated), 14 (removed) | Must use explicit IPC instead of synchronous remote calls |
| send/sendSync + on | invoke/handle | Electron 7 (2019) | Promise-based, cleaner error handling, better TypeScript support |
| nodeIntegration: true | contextIsolation: true (default) | Electron 12 (2021) | Security hardening, requires preload script for Node.js access |
| Manual typing | Shared interfaces + declaration merging | TypeScript 2.0+ | Compile-time IPC contract verification |

**Deprecated/outdated:**
- `remote` module: Removed in Electron 14 - use explicit IPC handlers instead
- `sendSync`: Blocks UI thread - use async invoke/handle
- Disabling context isolation: Security anti-pattern - always use preload with contextBridge

## Open Questions

Things that couldn't be fully resolved:

1. **Native invoke() cancellation support**
   - What we know: Electron doesn't natively support AbortSignal with invoke() as of Electron 40
   - What's unclear: Timeline for [Feature Request #41025](https://github.com/electron/electron/issues/41025) implementation
   - Recommendation: Implement cancellation via separate IPC channel (`import:cancel`) with internal AbortController coordination

2. **Best practice for persisting last directory**
   - What we know: dialog.showOpenDialog accepts `defaultPath` option, can store path in app config
   - What's unclear: Whether to use electron-store, simple JSON file, or electron's app.getPath('userData')
   - Recommendation: Use simple JSON file in userData directory for POC, migrate to electron-store if more settings needed

3. **Optimal throttle interval for progress events**
   - What we know: Context says 100-250ms range
   - What's unclear: Whether to throttle in main process, renderer, or both
   - Recommendation: Throttle in main process (100ms) to reduce IPC overhead, optionally throttle in renderer if UI updates are expensive

## Sources

### Primary (HIGH confidence)
- [Electron IPC Tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc) - Official IPC patterns
- [Electron contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge) - API exposure security
- [Electron dialog API](https://www.electronjs.org/docs/latest/api/dialog) - File selection patterns
- [Electron ipcMain API](https://www.electronjs.org/docs/latest/api/ipc-main) - Main process handlers
- [electron-vite Development Guide](https://electron-vite.org/guide/dev) - Preload script handling

### Secondary (MEDIUM confidence)
- [Electron IPC with TypeScript (LogRocket)](https://blog.logrocket.com/electron-ipc-response-request-architecture-with-typescript/) - Request-response architecture
- [Mastering Electron Preload with TypeScript](https://www.xjavascript.com/blog/electron-preload-typescript/) - Shared type patterns
- [TypeScript Throttle Implementation](https://medium.com/@fibianmejia/javascript-performance-tuning-implementing-throttling-in-typescript-ef5a5622c462) - Throttling patterns
- [AbortController Guide (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) - Cancellation patterns
- [@electron-toolkit/preload (npm)](https://www.npmjs.com/package/@electron-toolkit/preload) - Preload utilities

### Tertiary (LOW confidence - community reports)
- [Electron Error Serialization (GitHub Issue #7956)](https://github.com/electron/electron/issues/7956) - Error handling limitations
- [Electron invoke() Cancellation (Feature Request #41025)](https://github.com/electron/electron/issues/41025) - Cancellation gaps
- [Adding TypeSafety to Electron IPC (Medium)](https://kishannirghin.medium.com/adding-typesafety-to-electron-ipc-with-typescript-d12ba589ea6a) - Community patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official Electron documentation, established patterns since Electron 7
- Architecture: HIGH - Patterns from official docs, verified with electron-vite integration
- Pitfalls: HIGH - Documented in GitHub issues and official security guides

**Research date:** 2026-01-26
**Valid until:** 2026-04-26 (90 days - stable domain with slow-moving patterns)
