# Phase 16: Batch Import & ZIP Extraction - Research

**Researched:** 2026-01-27
**Domain:** File batch processing, ZIP extraction with password protection, Electron file dialogs, sequential import orchestration
**Confidence:** HIGH

## Summary

This phase adds batch import capabilities on top of the existing single-file import system. The technical requirements span four main areas: Electron file dialog APIs for multi-file/folder selection, ZIP extraction with password support and security validation, temporary directory management for extracted files, and sequential batch processing with per-file error isolation.

**Key findings:**
- Electron's dialog API supports multi-file selection but has platform limitations (Windows/Linux cannot select files and folders simultaneously)
- adm-zip (v0.5.16) is the standard pure-JavaScript ZIP library with password support and Zip Slip fixes, no native dependencies
- Node.js fs.mkdtemp() with os.tmpdir() provides secure temporary directory creation; cleanup requires try-finally pattern with fs.rm()
- Batch processing should use sequential for-loop pattern for error isolation; parallel processing would complicate cancellation and duplicate handling
- Vuetify 3 v-dialog with v-progress-linear and v-expansion-panels provides UI patterns for progress and summary display

**Primary recommendation:** Use adm-zip for ZIP extraction (pure JS, no rebuild issues), implement sequential batch processing with AbortSignal support, use fs.mkdtemp() for temp directories with guaranteed cleanup, and separate file dialogs for multi-file vs folder selection due to Electron platform limitations.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| adm-zip | 0.5.16+ | ZIP extraction with password support | Pure JavaScript (no native rebuild), handles password-protected archives, Zip Slip vulnerability fixed in 0.5.2+ |
| Electron dialog API | Built-in | Multi-file and folder selection | Native system file picker with platform-specific capabilities |
| Node.js fs.mkdtemp() | Built-in (Node 16+) | Secure temporary directory creation | Creates unique temp dirs with cryptographically random names |
| Node.js fs.rm() | Built-in (Node 14.14+) | Recursive directory cleanup | Modern replacement for rimraf, supports recursive and force options |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vuetify v-expansion-panels | 3.11+ | Collapsible error/success details in summary | Showing expandable per-file results in batch summary report |
| Vuetify v-progress-linear | 3.11+ | Visual progress indication | Overall batch progress and per-file progress display |
| AbortController | Built-in | Batch cancellation | Propagate cancellation signal through sequential import loop |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| adm-zip | unzipper | unzipper has streaming API and password support, but less clear on Zip Slip status and documentation is sparse; adm-zip has simpler API for random access |
| adm-zip | yauzl/extract-zip | No password support; would need separate solution for encrypted archives |
| Sequential processing | Parallel with concurrency limit | More complex error isolation, harder to implement user-choice for duplicates, complicates cancellation mid-batch |

**Installation:**
```bash
npm install adm-zip
```

## Architecture Patterns

### Recommended Project Structure
```
src/main/
├── import/
│   ├── ImportService.ts           # Existing single-file import
│   ├── BatchImportService.ts      # NEW: Sequential batch orchestrator
│   └── ZipExtractor.ts            # NEW: ZIP extraction with password
├── ipc/handlers/
│   ├── import.ts                  # Existing single-file handlers
│   └── batch-import.ts            # NEW: Batch & ZIP handlers
└── services/
    └── TempDirectoryManager.ts    # NEW: Temp dir lifecycle

src/renderer/src/components/
├── ImportDialog.vue               # Existing single-file dialog
└── BatchImportDialog.vue          # NEW: Batch import modal with progress
```

### Pattern 1: Sequential Batch Processing with Error Isolation
**What:** Process files one-by-one in a for-loop, catching and recording errors per file without aborting the batch.

**When to use:** When each file's success/failure is independent, user needs detailed per-file feedback, and duplicate resolution requires sequential user prompts.

**Example:**
```typescript
// Source: Informed by existing ImportService pattern
interface BatchResult {
  succeeded: number
  failed: number
  skipped: number
  details: Array<{ file: string; status: 'success' | 'failed' | 'skipped'; error?: string }>
}

async function processBatch(
  files: string[],
  onProgress: (current: number, total: number) => void,
  signal?: AbortSignal
): Promise<BatchResult> {
  const result: BatchResult = { succeeded: 0, failed: 0, skipped: 0, details: [] }

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) break

    const file = files[i]
    onProgress(i + 1, files.length)

    try {
      await importService.importVariants(file, { caseName: extractName(file), signal })
      result.succeeded++
      result.details.push({ file, status: 'success' })
    } catch (error) {
      result.failed++
      result.details.push({ file, status: 'failed', error: error.message })
      // Continue to next file - do not throw
    }
  }

  return result
}
```

### Pattern 2: Temporary Directory Lifecycle with Guaranteed Cleanup
**What:** Create unique temporary directory, extract files into it, use try-finally to ensure cleanup even if import fails.

**When to use:** Any operation requiring temporary file storage with automatic cleanup on completion or error.

**Example:**
```typescript
// Source: Node.js documentation patterns
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function extractAndImport(zipPath: string, password?: string): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'varlens-zip-'))

  try {
    // Extract ZIP to temp directory
    const extractor = new ZipExtractor(tempDir)
    const files = await extractor.extract(zipPath, password)

    // Process extracted files
    await processBatch(files, ...)
  } finally {
    // Cleanup always runs, even if import throws
    rmSync(tempDir, { recursive: true, force: true })
  }
}
```

### Pattern 3: Electron Dialog Properties for File Selection
**What:** Use separate dialogs for multi-file vs folder selection due to platform limitations.

**When to use:** Always - Windows/Linux cannot combine openFile and openDirectory in same dialog.

**Example:**
```typescript
// Source: Electron official documentation
import { dialog } from 'electron'

// Multi-file selection
async function selectFiles(): Promise<string[]> {
  const result = await dialog.showOpenDialog({
    title: 'Select Files to Import',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'JSON Files', extensions: ['json', 'gz', 'json.gz'] }]
  })
  return result.filePaths
}

// Folder selection
async function selectFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select Folder to Import',
    properties: ['openDirectory']
  })
  return result.filePaths[0] ?? null
}

// ZIP file selection
async function selectZip(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select ZIP Archive',
    properties: ['openFile'],
    filters: [{ name: 'ZIP Archives', extensions: ['zip'] }]
  })
  return result.filePaths[0] ?? null
}
```

### Pattern 4: Zip Slip Path Traversal Prevention
**What:** Validate all extracted file paths to ensure they remain within the target directory.

**When to use:** Before writing any file from a ZIP archive to disk.

**Example:**
```typescript
// Source: Snyk Zip Slip vulnerability guidance
import { resolve, normalize, relative } from 'node:path'

function validateExtractPath(targetDir: string, entryPath: string): boolean {
  // Normalize and resolve to absolute paths
  const normalizedTarget = resolve(targetDir)
  const normalizedEntry = resolve(normalizedTarget, entryPath)

  // Check if entry path is within target directory
  const relativePath = relative(normalizedTarget, normalizedEntry)

  // Reject if path escapes target directory
  if (relativePath.startsWith('..') || resolve(normalizedEntry) !== normalizedEntry) {
    return false
  }

  // Reject absolute paths and UNC paths (Windows)
  if (entryPath.startsWith('/') || entryPath.startsWith('\\') || /^[a-zA-Z]:/.test(entryPath)) {
    return false
  }

  return true
}
```

### Anti-Patterns to Avoid
- **Parallel batch processing with complex state:** Harder to implement duplicate resolution prompts, cancellation is race-prone, progress reporting becomes complex
- **Using rimraf or del packages:** Node.js fs.rm() with recursive option is built-in since Node 14.14, no dependency needed
- **Opening file+folder dialog on Windows/Linux:** Will only show folder picker, files become unselectable
- **Skipping Zip Slip validation:** adm-zip includes fixes but validation adds defense-in-depth for malicious archives

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP extraction | Custom unzip with zlib | adm-zip library | Handles password encryption, ZIP64, various compression methods, and edge cases |
| Temporary directory names | Random string generator + mkdir | fs.mkdtemp() | Cryptographically random, atomic creation, platform-aware temp location |
| Path traversal validation | String .includes('..') check | Full validation with resolve/relative | Catches UNC paths, absolute paths, symlink attacks, platform-specific edge cases |
| Recursive directory deletion | Manual readdir + unlink loop | fs.rm({ recursive: true }) | Handles permissions, symlinks, concurrent access, platform differences |
| Password input masking | Custom show/hide toggle | Existing PasswordDialog.vue pattern | Already implements eye icon toggle, autofocus, error display |

**Key insight:** File system operations have platform-specific edge cases (Windows path separators, symlinks, permissions, UNC paths). Built-in Node.js APIs and battle-tested libraries handle these better than custom implementations.

## Common Pitfalls

### Pitfall 1: Assuming ZIP Password Detection is Reliable
**What goes wrong:** Some ZIP libraries cannot determine if a file is password-protected without attempting extraction.

**Why it happens:** ZIP format stores encryption flags in file headers, but damaged archives or non-standard implementations may not set flags correctly.

**How to avoid:** Attempt to read ZIP entries first; if error indicates password required, prompt for password. Handle wrong password errors gracefully with retry loop.

**Warning signs:** User sees password prompt for unencrypted files, or extraction fails silently without password prompt for encrypted files.

### Pitfall 2: Forgetting fs.mkdtemp() Requires Trailing Path Separator
**What goes wrong:** Without trailing separator, mkdtemp creates directory at filesystem root instead of inside temp directory.

**Why it happens:** mkdtemp appends random chars directly to prefix string, so `os.tmpdir()` returning `/tmp` without separator creates `/tmpXXXXXX` instead of `/tmp/prefixXXXXXX`.

**How to avoid:** Always use `path.join(os.tmpdir(), 'prefix-')` which adds platform-correct separator automatically.

**Warning signs:** Permission errors creating temp directory, or temp directories appearing at root level instead of in OS temp folder.

### Pitfall 3: Cleanup Failures Leave Orphaned Temp Directories
**What goes wrong:** Temp directories remain on disk after import completes or fails, accumulating over time.

**Why it happens:** Cleanup code doesn't run if import throws error, or rmSync fails due to locked files but error is swallowed.

**How to avoid:** Use try-finally block to guarantee cleanup runs; use `{ force: true }` option to suppress "not found" errors; ensure no file handles remain open before cleanup.

**Warning signs:** OS temp directory grows unbounded; disk space usage increases over time; cleanup errors in logs.

### Pitfall 4: Race Conditions Between Duplicate Check and Import
**What goes wrong:** Two files with same case name in batch both pass duplicate check, then both fail with unique constraint error.

**Why it happens:** Sequential processing checks database for duplicates, but doesn't track duplicates within current batch that haven't been imported yet.

**How to avoid:** Maintain in-memory set of case names imported in current batch; check both database AND batch-level set before prompting user.

**Warning signs:** User chooses "overwrite" for duplicate but still sees error; multiple files fail with "duplicate case name" despite choosing skip.

### Pitfall 5: Progress Updates Block Import Pipeline
**What goes wrong:** Sending progress events to renderer on every variant slows down import dramatically.

**Why it happens:** IPC overhead accumulates when sending hundreds of progress updates per second during fast imports.

**How to avoid:** Throttle progress updates to reasonable interval (existing code uses 100ms); only emit when enough time has passed since last update.

**Warning signs:** Import speed degrades when dialog is open vs when canceled; progress updates appear choppy or frozen.

## Code Examples

Verified patterns from official sources and existing codebase:

### ZIP Extraction with Password (adm-zip)
```typescript
// Source: adm-zip documentation + Zip Slip prevention
import AdmZip from 'adm-zip'
import { resolve, relative } from 'node:path'

interface ExtractResult {
  files: string[]
  errors: string[]
}

class ZipExtractor {
  private targetDir: string

  constructor(targetDir: string) {
    this.targetDir = targetDir
  }

  async extract(zipPath: string, password?: string): Promise<ExtractResult> {
    const zip = new AdmZip(zipPath)
    const result: ExtractResult = { files: [], errors: [] }

    // Get all entries
    const entries = zip.getEntries()

    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory) continue

      // Validate path to prevent Zip Slip
      if (!this.validatePath(entry.entryName)) {
        result.errors.push(`Rejected malicious path: ${entry.entryName}`)
        continue
      }

      try {
        // Extract with password if provided
        zip.extractEntryTo(entry, this.targetDir, false, true, false, password)
        const extractedPath = resolve(this.targetDir, entry.entryName)
        result.files.push(extractedPath)
      } catch (error) {
        result.errors.push(`Failed to extract ${entry.entryName}: ${error.message}`)
      }
    }

    return result
  }

  private validatePath(entryPath: string): boolean {
    // Reject path traversal attempts
    if (entryPath.includes('..')) return false

    // Reject absolute paths
    if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return false

    // Reject UNC paths (Windows)
    if (/^[a-zA-Z]:/.test(entryPath)) return false

    // Additional validation: check resolved path is within target
    const resolved = resolve(this.targetDir, entryPath)
    const rel = relative(this.targetDir, resolved)
    if (rel.startsWith('..') || resolve(rel) !== rel) return false

    return true
  }

  // Check if ZIP is password-protected (heuristic)
  isEncrypted(zipPath: string): boolean {
    try {
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()
      // Check if any entry is encrypted
      return entries.some(entry => entry.header.encrypted)
    } catch {
      return false
    }
  }
}
```

### Multi-File Dialog with Last Directory Persistence
```typescript
// Source: Existing import.ts handler pattern
import { dialog, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

interface Settings {
  lastImportDirectory?: string
}

function loadSettings(): Settings {
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  try {
    if (existsSync(settingsPath)) {
      return JSON.parse(readFileSync(settingsPath, 'utf8'))
    }
  } catch {
    // Ignore parse errors
  }
  return {}
}

async function selectMultipleFiles(): Promise<string[]> {
  const settings = loadSettings()

  const result = await dialog.showOpenDialog({
    title: 'Select Files to Import',
    defaultPath: settings.lastImportDirectory,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'JSON Files', extensions: ['json', 'json.gz', 'gz'] },
      { name: 'ZIP Archives', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return []
  }

  // Save directory for next time
  const firstFile = result.filePaths[0]
  const directory = firstFile.substring(0, firstFile.lastIndexOf('/'))
  // ... save settings

  return result.filePaths
}
```

### Folder Enumeration for JSON.gz Files
```typescript
// Source: Node.js fs patterns
import { readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

function findJsonFiles(folderPath: string): string[] {
  const entries = readdirSync(folderPath, { withFileTypes: true })

  return entries
    .filter(entry => {
      if (!entry.isFile()) return false
      const name = entry.name.toLowerCase()
      // Match .json, .json.gz, or .gz
      return name.endsWith('.json') || name.endsWith('.json.gz') || name.endsWith('.gz')
    })
    .map(entry => join(folderPath, entry.name))
}
```

### Vuetify Batch Progress Dialog with Summary
```vue
<!-- Source: Existing ImportDialog.vue pattern + Vuetify expansion panels -->
<template>
  <v-dialog v-model="dialog" max-width="600" :persistent="isImporting">
    <v-card>
      <v-card-title>Batch Import</v-card-title>

      <v-card-text>
        <!-- Progress view -->
        <div v-if="isImporting" class="mt-4">
          <div class="text-body-2 mb-2">
            Processing {{ currentFile }} ({{ currentIndex }} of {{ totalFiles }})
          </div>
          <v-progress-linear
            :model-value="overallProgress"
            color="primary"
            height="25"
            class="mb-2"
          >
            <template #default>{{ overallProgress }}%</template>
          </v-progress-linear>
          <div class="text-caption">{{ progressDetail }}</div>
        </div>

        <!-- Summary view -->
        <div v-if="showSummary">
          <v-alert type="info" class="mb-4">
            <div>Succeeded: {{ summary.succeeded }}</div>
            <div>Failed: {{ summary.failed }}</div>
            <div>Skipped: {{ summary.skipped }}</div>
          </v-alert>

          <v-expansion-panels v-if="summary.details.length > 0">
            <v-expansion-panel
              v-for="(detail, i) in summary.details"
              :key="i"
            >
              <v-expansion-panel-title>
                <v-icon :color="detail.status === 'success' ? 'success' : 'error'" class="mr-2">
                  {{ detail.status === 'success' ? 'mdi-check' : 'mdi-alert' }}
                </v-icon>
                {{ detail.file }}
              </v-expansion-panel-title>
              <v-expansion-panel-text v-if="detail.error">
                {{ detail.error }}
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="handleCancel">
          {{ isImporting ? 'Cancel' : 'Close' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| rimraf npm package for cleanup | fs.rm({ recursive: true }) | Node 14.14.0 (Oct 2020) | No external dependency, built-in support, better error handling |
| mkdirp for creating directories | fs.mkdir({ recursive: true }) | Node 10.12.0 (Oct 2018) | Built-in recursive mkdir, one less dependency |
| yauzl for ZIP extraction | adm-zip or unzipper | Ongoing | Password support, simpler API, actively maintained |
| String checks for path validation | path.resolve() + relative() | Security best practice (2018+) | Prevents all path traversal variants including UNC paths |
| Vuetify 2 v-expansion-panel-header | Vuetify 3 v-expansion-panel-title | Vuetify 3.0 (Nov 2022) | Component rename, API simplification |

**Deprecated/outdated:**
- adm-zip versions < 0.5.2: Vulnerable to Zip Slip (CVE-2018-1002204), upgrade to 0.5.16 or later
- Electron properties: ['openFile', 'openDirectory'] on Windows/Linux: Only shows folder picker, use separate dialogs
- node-temp with default settings: No automatic cleanup, use tmp library with graceful cleanup or built-in fs.mkdtemp
- rimraf, del, fs-extra packages for directory removal: Use built-in fs.rm({ recursive: true, force: true })

## Open Questions

Things that couldn't be fully resolved:

1. **adm-zip password detection reliability**
   - What we know: adm-zip can check entry.header.encrypted flag to detect password protection
   - What's unclear: Whether all ZIP tools set this flag correctly, or if some password-protected archives might be missed
   - Recommendation: Implement heuristic check plus try-catch during extraction; if "wrong password" error occurs, prompt user

2. **Performance of adm-zip vs unzipper for large archives**
   - What we know: adm-zip loads entire central directory into memory, unzipper has streaming API
   - What's unclear: At what archive size adm-zip becomes impractical (memory usage)
   - Recommendation: Start with adm-zip for simplicity; if users report issues with large archives (>100MB ZIP files), benchmark against unzipper

3. **Duplicate handling UX for "apply to all remaining" choice**
   - What we know: User can check "apply to all" on first duplicate prompt
   - What's unclear: Whether choice should persist across batch import sessions or reset each time
   - Recommendation: Reset choice per batch session for safety; prevents accidental overwrite in future imports

## Sources

### Primary (HIGH confidence)
- [Electron dialog API documentation](https://www.electronjs.org/docs/latest/api/dialog) - Dialog properties and platform limitations
- [Node.js File System documentation](https://nodejs.org/api/fs.html) - fs.mkdtemp, fs.rm APIs (verified current as of Node 25.x)
- [Snyk Zip Slip Vulnerability](https://security.snyk.io/research/zip-slip-vulnerability) - Path traversal prevention techniques
- [adm-zip Zip Slip fix](https://github.com/cthackers/adm-zip/pull/212) - Patch details for path traversal (0.5.2+)
- Existing Varlens codebase - ImportDialog.vue, import.ts handler, ImportService.ts patterns

### Secondary (MEDIUM confidence)
- [adm-zip npm package](https://www.npmjs.com/package/adm-zip) - Version 0.5.16, password support (verified via GitHub issues)
- [unzipper npm package](https://www.npmjs.com/package/unzipper) - Password support, streaming API
- [Vuetify 3 Components](https://vuetifyjs.com/en/components/dialogs/) - v-dialog, v-progress-linear, v-expansion-panels
- [Node.js temp directory best practices](https://blog.mastykarz.nl/create-temp-directory-app-node-js/) - mkdtemp patterns
- [Protecting Node.js from Zip Slip](https://medium.com/intrinsic-blog/protecting-node-js-applications-from-zip-slip-b24a37811c10) - Validation implementation

### Tertiary (LOW confidence)
- [adm-zip password support discussion](https://github.com/cthackers/adm-zip/issues/259) - Community questions about password features (not conclusive)
- npm library comparisons - extract-zip vs adm-zip vs unzipper (aggregate rankings, no technical detail)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - adm-zip is widely used, Electron dialog API is official, Node.js built-ins are stable
- Architecture: HIGH - Patterns verified from existing codebase and official documentation
- Pitfalls: MEDIUM-HIGH - Zip Slip and temp directory issues well-documented; duplicate race condition is inferred from database constraints

**Research date:** 2026-01-27
**Valid until:** 60 days for stable libraries; Electron/Node.js APIs are LTS-stable; adm-zip is mature (last updated 2023 but still standard)
