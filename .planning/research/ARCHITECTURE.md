# Architecture Patterns

**Domain:** Electron desktop app for genetic variant analysis (v0.3.0 features)
**Researched:** 2026-01-27
**Overall confidence:** HIGH

## Executive Summary

This document maps how v0.3.0 features -- cohort analysis, SQLCipher encryption, batch import, database selection, external links, and OMIM data extraction -- integrate with the existing Varlens architecture. The existing codebase has a clean three-layer architecture (main process database/IPC, preload bridge, renderer Vue SPA) that accommodates these features through well-defined extension points. The most architecturally disruptive change is the SQLCipher migration, which replaces the core `better-sqlite3` dependency and affects the database singleton lifecycle. All other features are additive extensions to existing patterns.

---

## Current Architecture (v0.2.0)

### Component Map

```
Renderer (Vue 3 + Vuetify 3)
  App.vue
    +-- AppSidebar > CaseList
    +-- FilterToolbar
    +-- VariantTable (v-data-table-server)
    +-- ImportDialog
    +-- EmptyState
    +-- AppFooter, DisclaimerDialog, FaqDialog, LogViewer

Preload (contextBridge)
  api.cases.{list, delete}
  api.variants.{query, getFilterOptions, search}
  api.import.{selectFile, start, onProgress, cancel}
  api.export.{variants}
  api.system.{getVersion, getUserDataPath}
  api.shell.{openExternal}

Main Process
  index.ts                 -- App lifecycle, BrowserWindow, global error handlers
  database/
    index.ts               -- Singleton DatabaseService factory (hardcoded path)
    DatabaseService.ts     -- SQLite operations, prepared statement cache, transactions
    schema.ts              -- DDL (cases, variants, FTS5, triggers, migrations)
    types.ts               -- Case, Variant, VariantFilter, PaginationCursor interfaces
    errors.ts              -- DatabaseError, NotFoundError, UniqueConstraintError
  import/
    ImportService.ts       -- Streaming gzip JSON pipeline
    transforms/            -- FieldMapper, BatchAccumulator (Transform streams)
    config/fieldMapping.ts -- Column indices, dictionaries, static mappings
  ipc/
    index.ts               -- Handler registration (dynamic import)
    errorHandler.ts        -- wrapHandler, toSerializableError
    handlers/              -- cases.ts, variants.ts, import.ts, export.ts, shell.ts, system.ts
```

### Key Architectural Characteristics

1. **Database singleton**: `getDatabaseService()` creates one `DatabaseService` at `app.getPath('userData')/varlens.db`. No mechanism to close and reopen with a different path.
2. **IPC channel convention**: `domain:action` naming (e.g., `cases:list`, `variants:query`).
3. **Error handling**: All IPC handlers wrapped with `wrapHandler()` converting to `SerializableError`.
4. **Import pipeline**: Streaming Transform pipeline (readStream -> gunzip -> parser -> pick -> streamArray -> FieldMapper -> BatchAccumulator). Single-file processing with AbortController cancellation.
5. **Security**: Context isolation enabled, sandbox=true, `shell:openExternal` whitelist restricted to `github.com` and `opensource.org`.
6. **Progress**: Main -> renderer via `webContents.send('import:progress', ...)` with 100ms throttle.

---

## Recommended Architecture for v0.3.0

### Overview of Changes

| Feature | Layer Affected | Change Type |
|---------|---------------|-------------|
| SQLCipher | Main (database) | **Replace** better-sqlite3 with better-sqlite3-multiple-ciphers |
| Database selection | Main (database, ipc) + Preload + Renderer | **New** lifecycle management, file dialogs, UI |
| Batch import | Main (import, ipc) + Preload + Renderer | **Extend** existing import pipeline |
| ZIP extraction | Main (import) | **New** pre-processing step before existing pipeline |
| Cohort analysis | Main (database, ipc) + Preload + Renderer | **New** queries, IPC channels, Vue views |
| External links | Renderer + Main (shell) | **Extend** shell handler whitelist, renderer URL builders |
| OMIM extraction | Main (import) + database schema | **Extend** field mapping, schema |

### Component Boundaries

```
Renderer (MODIFIED)
  App.vue (add routing or tab switching for cohort view)
    +-- [existing components]
    +-- NEW: CohortView
    |     +-- CohortSummary (stats cards)
    |     +-- CohortVariantTable (aggregated v-data-table-server)
    |     +-- CohortSearch (gene/variant search across all cases)
    +-- NEW: DatabaseSelector (toolbar or dialog)
    +-- MODIFIED: ImportDialog -> BatchImportDialog (multi-file + ZIP)
    +-- MODIFIED: VariantTable (add external link icons per row)

Preload (EXTENDED)
  api.cases.{list, delete}                          -- existing
  api.variants.{query, getFilterOptions, search}    -- existing
  api.import.{selectFile, start, onProgress, cancel} -- MODIFIED (batch)
  api.export.{variants}                             -- existing
  api.system.{getVersion, getUserDataPath}           -- existing
  api.shell.{openExternal}                          -- existing (expanded whitelist)
  NEW: api.database.{select, create, getCurrent, open, close}
  NEW: api.import.{selectFiles, selectFolder, startBatch, batchProgress}
  NEW: api.cohort.{summary, variants, search, geneAggregation}

Main Process (MODIFIED + EXTENDED)
  database/
    index.ts               -- MODIFIED: Lifecycle manager (open/close/switch)
    DatabaseService.ts     -- MODIFIED: Constructor accepts key parameter
    schema.ts              -- MODIFIED: Add OMIM columns, cohort views
    types.ts               -- MODIFIED: Add CohortVariant, CohortSummary types
    errors.ts              -- MODIFIED: Add EncryptionError
  import/
    ImportService.ts       -- MODIFIED: Accept file list, orchestrate batch
    NEW: ZipExtractor.ts   -- ZIP password extraction to temp directory
    transforms/            -- Existing (no changes needed)
    config/fieldMapping.ts -- MODIFIED: Add OMIM column indices
  ipc/handlers/
    NEW: database.ts       -- database:select, database:create, database:open, database:close
    NEW: cohort.ts         -- cohort:summary, cohort:variants, cohort:search
    MODIFIED: import.ts    -- import:selectFiles, import:startBatch, import:batchProgress
    MODIFIED: shell.ts     -- Expand ALLOWED_DOMAINS
```

---

## Feature Integration Details

### 1. SQLCipher: Replacing better-sqlite3

**Confidence: HIGH** -- `better-sqlite3-multiple-ciphers@12.6.2` has Electron 40 prebuilt binaries (verified via GitHub releases page).

**The migration:**

The package `better-sqlite3-multiple-ciphers` is a drop-in fork of `better-sqlite3` with identical API plus two additional methods: `.key(Buffer)` and `.rekey(Buffer)`. The migration is:

1. Replace `better-sqlite3` with `better-sqlite3-multiple-ciphers` in `package.json`
2. Update all import statements: `import Database from 'better-sqlite3-multiple-ciphers'`
3. Update `electron.vite.config.ts` external: `['better-sqlite3-multiple-ciphers']`
4. Update `electron-builder` config: `asarUnpack` and `files` patterns
5. Update `@electron/rebuild` target: `-w better-sqlite3-multiple-ciphers`
6. Update Makefile rebuild targets

**Encryption lifecycle in DatabaseService constructor:**

```typescript
// New constructor signature
constructor(dbPath: string = ':memory:', key?: string) {
  this.db = new Database(dbPath)

  if (key) {
    // MUST be set before ANY SQL operations
    this.db.pragma(`cipher='sqlcipher'`)
    this.db.pragma(`legacy=4`)
    this.db.pragma(`key='${key}'`)
  }

  // Enable WAL mode, foreign keys, initialize schema (AFTER key)
  this.db.pragma('journal_mode = WAL')
  this.db.pragma('foreign_keys = ON')
  initializeSchema(this.db)
}
```

**Critical constraint:** The `PRAGMA key` must be the very first operation after opening the database connection, before any other PRAGMA or SQL statement. This means the encryption key must be provided at construction time, not after.

**Migrating existing unencrypted databases:** Use `PRAGMA rekey='newpassword'` after opening without a key. To decrypt, use `PRAGMA rekey=''`.

**Build system changes:**

| File | Current | New |
|------|---------|-----|
| `package.json` dependencies | `"better-sqlite3": "^12.6.2"` | `"better-sqlite3-multiple-ciphers": "^12.6.2"` |
| `package.json` devDependencies | `"@types/better-sqlite3": "^7.6.13"` | Same (types are compatible) |
| `package.json` postinstall | `npx @electron/rebuild -f -w better-sqlite3` | `npx @electron/rebuild -f -w better-sqlite3-multiple-ciphers` |
| `package.json` build.asarUnpack | `["**/*.node"]` or `["node_modules/better-sqlite3/**/*"]` | `["node_modules/better-sqlite3-multiple-ciphers/**/*"]` |
| `electron.vite.config.ts` | `external: ['better-sqlite3']` | `external: ['better-sqlite3-multiple-ciphers']` |
| `Makefile` rebuild targets | References better-sqlite3 | References better-sqlite3-multiple-ciphers |

**Risk assessment:** LOW risk. The fork is API-compatible with better-sqlite3, has prebuilt binaries for Electron 40, and the same @types/better-sqlite3 types work. The main risk is the native module compilation pipeline -- must verify CI/CD builds pass on all three platforms.

### 2. Database Selection and Switching

**Confidence: HIGH** -- Follows patterns from sqlite-search reference project.

**Current state:** `getDatabaseService()` in `src/main/database/index.ts` is a singleton with hardcoded path `app.getPath('userData')/varlens.db`. No ability to switch databases.

**Required changes to database/index.ts:**

```typescript
// Transform from simple singleton to lifecycle manager
let databaseService: DatabaseService | null = null
let currentDbPath: string | null = null
let currentDbKey: string | undefined = undefined

export function getDatabaseService(): DatabaseService {
  if (!databaseService) {
    throw new Error('No database is open. Call openDatabase() first.')
  }
  return databaseService
}

export function openDatabase(dbPath: string, key?: string): DatabaseService {
  // Close existing connection if open
  if (databaseService) {
    closeDatabaseService()
  }

  databaseService = new DatabaseService(dbPath, key)
  currentDbPath = dbPath
  currentDbKey = key
  return databaseService
}

export function closeDatabaseService(): void {
  if (databaseService) {
    databaseService.close()
    databaseService = null
    currentDbPath = null
    currentDbKey = undefined
  }
}

export function getCurrentDbPath(): string | null {
  return currentDbPath
}
```

**New IPC channels:**

| Channel | Direction | Signature | Purpose |
|---------|-----------|-----------|---------|
| `database:select` | invoke | `() => string \| null` | Show file picker for .db/.sqlite files |
| `database:create` | invoke | `(path?: string) => string` | Create new database (optional save dialog) |
| `database:open` | invoke | `(path: string, key?: string) => { success: boolean }` | Open database with optional key |
| `database:close` | invoke | `() => void` | Close current database |
| `database:getCurrent` | invoke | `() => { path: string \| null, encrypted: boolean }` | Get current database info |
| `database:rekey` | invoke | `(currentKey?: string, newKey?: string) => { success: boolean }` | Change/add/remove encryption |

**Renderer impact:** The `App.vue` needs awareness of database connection state. Recommend a Pinia store (`databaseStore`) that tracks:
- `isOpen: boolean`
- `path: string | null`
- `isEncrypted: boolean`
- `lastOpened: string[]` (recent files list)

**File dialog filter:**
```typescript
filters: [
  { name: 'VarLens Database', extensions: ['db', 'sqlite', 'sqlite3'] },
  { name: 'All Files', extensions: ['*'] }
]
```

**Settings persistence:** Extend the existing `settings.json` (already used for `lastImportDirectory`) to include:
- `lastDatabasePath`: Last opened database path
- `recentDatabases`: Array of recently opened database paths

### 3. ZIP Extraction

**Confidence: HIGH** -- `unzipper` npm package supports password-protected ZIP extraction.

**Architecture decision:** ZIP extraction is a pre-processing step before the existing import pipeline. It extracts `.json.gz` files from a password-protected ZIP to a temp directory, then the existing `ImportService` processes each file normally.

**New component: `ZipExtractor`**

```
Location: src/main/import/ZipExtractor.ts

Responsibilities:
  - Accept ZIP file path and password
  - Extract all .json.gz files to temp directory (app.getPath('temp'))
  - Return list of extracted file paths
  - Clean up temp files after import completes (or on error)
  - Report extraction progress

Dependencies:
  - unzipper (npm package) -- supports password-protected ZIPs
  - fs/promises for temp directory management
  - path for path resolution
```

**Data flow:**

```
User selects .zip file
  -> IPC: import:selectFile (modified to accept .zip extension)
  -> User provides ZIP password (dialog in renderer)
  -> IPC: import:startBatch or import:start
  -> ZipExtractor.extract(zipPath, password) -> tempDir with .json.gz files
  -> ImportService.importVariants(each file) -> sequential processing
  -> ZipExtractor.cleanup(tempDir) -> remove temp files
```

**Password handling:** The ZIP password is provided by the user in the renderer and passed to the main process via IPC. It is never stored -- only held in memory during the extraction operation. This is distinct from the SQLCipher database key.

**Temp directory strategy:**
```typescript
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'

const tempDir = await mkdtemp(join(app.getPath('temp'), 'varlens-import-'))
// ... extract and import ...
await rm(tempDir, { recursive: true, force: true })
```

### 4. Batch Import Orchestration

**Confidence: HIGH** -- Extends existing ImportService with sequential file processing.

**Decision: Sequential, not parallel.** SQLite is single-writer. Parallel imports would contend for write locks and provide no performance benefit. Sequential processing with aggregate progress reporting is the correct pattern.

**Modified import flow:**

```
Current (single file):
  selectFile -> start(filePath, caseName) -> progress events -> result

New (batch):
  selectFiles/selectFolder -> list of files
  startBatch(files[], caseNames[]) -> for each file:
    -> start(file, caseName)
    -> individual progress
    -> file complete
  -> batch complete with aggregate result
```

**New IPC channels:**

| Channel | Direction | Signature | Purpose |
|---------|-----------|-----------|---------|
| `import:selectFiles` | invoke | `() => string[] \| null` | Multi-file picker (JSON.gz files) |
| `import:selectFolder` | invoke | `() => string \| null` | Folder picker, scans for .json.gz files |
| `import:startBatch` | invoke | `(files: BatchImportFile[]) => BatchImportResult` | Sequential batch import |
| `import:batchProgress` | event | `(progress: BatchProgressUpdate) => void` | Aggregate batch progress |

**BatchImportFile type:**
```typescript
interface BatchImportFile {
  filePath: string
  caseName: string       // User-provided or auto-derived from filename
  isFromZip?: boolean    // If extracted from ZIP
}
```

**BatchProgressUpdate type:**
```typescript
interface BatchProgressUpdate {
  phase: 'extracting' | 'importing' | 'complete'
  currentFile: string
  currentFileIndex: number
  totalFiles: number
  currentFileProgress?: ProgressUpdate  // Reuse existing ProgressUpdate
  completedFiles: { caseName: string; variantCount: number }[]
  errors: { caseName: string; error: string }[]
}
```

**Orchestration in ImportService:**
```typescript
// New method in ImportService
async importBatch(
  files: BatchImportFile[],
  options: BatchImportOptions
): Promise<BatchImportResult> {
  const results: ImportResult[] = []
  const errors: { file: string; error: string }[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    options.onBatchProgress?.({
      phase: 'importing',
      currentFile: file.caseName,
      currentFileIndex: i,
      totalFiles: files.length,
      completedFiles: results.map(r => ({ caseName: r.caseName, variantCount: r.variantCount })),
      errors
    })

    try {
      const result = await this.importVariants(file.filePath, {
        caseName: file.caseName,
        onProgress: options.onFileProgress,
        signal: options.signal
      })
      results.push(result)
    } catch (error) {
      errors.push({ file: file.caseName, error: String(error) })
      // Continue with next file (don't abort batch on single failure)
    }
  }

  return { results, errors, totalFiles: files.length }
}
```

**Error handling for batch:** Individual file failures should NOT abort the entire batch. Each file import is independent. The batch result reports per-file success/failure.

**Case naming strategy for batch:**
- Auto-derive from filename: `case-892-snv-annotations.json.gz` -> `case-892-snv-annotations`
- Check for duplicates before starting batch
- Allow user to edit names in batch import dialog before starting

### 5. Cohort Analysis Queries

**Confidence: MEDIUM** -- SQL patterns are well-understood; specific query performance with large datasets needs validation.

**Core question:** Do we need new tables/views, or can we query the existing `variants` table with cross-case aggregation?

**Recommendation:** Use SQL views for cohort aggregation, not materialized tables. Views are automatically kept in sync and avoid data duplication. If performance becomes an issue with large cohorts, add indexes or consider materialized views as an optimization.

**New SQL views:**

```sql
-- Cohort variant aggregation: group by genomic position + alleles
CREATE VIEW IF NOT EXISTS cohort_variants AS
SELECT
  chr,
  pos,
  ref,
  alt,
  gene_symbol,
  consequence,
  gnomad_af,
  cadd,
  clinvar,
  COUNT(DISTINCT case_id) AS carrier_count,
  COUNT(*) AS total_observations,
  SUM(CASE WHEN gt_num = '1/1' OR gt_num = '1|1' THEN 1 ELSE 0 END) AS hom_count,
  SUM(CASE WHEN gt_num = '0/1' OR gt_num = '1/0' OR gt_num = '0|1' OR gt_num = '1|0' THEN 1 ELSE 0 END) AS het_count,
  GROUP_CONCAT(DISTINCT case_id) AS case_ids,
  func,
  transcript,
  cdna,
  aa_change
FROM variants
GROUP BY chr, pos, ref, alt;

-- Gene-level aggregation
CREATE VIEW IF NOT EXISTS cohort_genes AS
SELECT
  gene_symbol,
  COUNT(DISTINCT chr || ':' || pos || ':' || ref || ':' || alt) AS variant_count,
  COUNT(DISTINCT case_id) AS carrier_count,
  MAX(cadd) AS max_cadd,
  MIN(gnomad_af) AS min_gnomad_af,
  GROUP_CONCAT(DISTINCT consequence) AS consequences,
  GROUP_CONCAT(DISTINCT clinvar) AS clinvar_values
FROM variants
WHERE gene_symbol IS NOT NULL
GROUP BY gene_symbol;
```

**New IPC channels:**

| Channel | Direction | Signature | Purpose |
|---------|-----------|-----------|---------|
| `cohort:summary` | invoke | `() => CohortSummary` | Get aggregate cohort statistics |
| `cohort:variants` | invoke | `(filters, cursor, limit, sortBy) => PaginatedResult<CohortVariant>` | Paginated cohort variant query |
| `cohort:search` | invoke | `(query: string, limit?: number) => CohortVariant[]` | Search genes/variants across cohort |
| `cohort:geneAggregation` | invoke | `(filters, cursor, limit) => PaginatedResult<CohortGene>` | Gene-level summary |
| `cohort:caseBreakdown` | invoke | `(chr, pos, ref, alt) => CaseBreakdown[]` | Per-case details for a specific variant |

**New types:**

```typescript
interface CohortSummary {
  totalCases: number
  totalVariants: number
  uniqueVariants: number
  uniqueGenes: number
  // Distribution stats
  variantsPerCase: { min: number; max: number; median: number; mean: number }
}

interface CohortVariant {
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  carrier_count: number
  total_observations: number
  het_count: number
  hom_count: number
  case_ids: string  // Comma-separated
  func: string | null
  transcript: string | null
  cdna: string | null
  aa_change: string | null
}

interface CohortGene {
  gene_symbol: string
  variant_count: number
  carrier_count: number
  max_cadd: number | null
  min_gnomad_af: number | null
  consequences: string
  clinvar_values: string | null
}

interface CaseBreakdown {
  case_id: number
  case_name: string
  gt_num: string | null
  qual: number | null
  hpo_sim_score: number | null
}
```

**DatabaseService extensions:**
```typescript
// Add to DatabaseService class
getCohortSummary(): CohortSummary { ... }
getCohortVariants(filter, limit, cursor?, sortBy?): PaginatedResult<CohortVariant> { ... }
searchCohortVariants(query: string, limit?: number): CohortVariant[] { ... }
getCohortGeneAggregation(filter, limit, cursor?): PaginatedResult<CohortGene> { ... }
getCaseBreakdown(chr, pos, ref, alt): CaseBreakdown[] { ... }
```

**Performance considerations:**
- The `cohort_variants` view aggregates across ALL cases. With 10-20 cases of 65k variants each, this is 650k-1.3M rows. The GROUP BY on `(chr, pos, ref, alt)` should be efficient with the existing `idx_variants_pos` index.
- Add a composite index for cohort queries: `CREATE INDEX idx_variants_cohort ON variants(chr, pos, ref, alt, case_id)`
- Consider adding `CASE WHEN` for genotype classification in the view to avoid string pattern matching at query time.
- If views are too slow, materialize them as tables and rebuild after each import.

### 6. External Links

**Confidence: HIGH** -- URL patterns are well-documented and stable.

**Architecture decision:** URL generation belongs in the **renderer** (pure string formatting based on variant data already in memory). The main process `shell:openExternal` handler already exists but needs its domain whitelist expanded.

**URL builders (renderer-side utility):**

```typescript
// Location: src/renderer/src/utils/externalLinks.ts

export const externalLinks = {
  gnomAD: (chr: string, pos: number, ref: string, alt: string, dataset = 'gnomad_r4') =>
    `https://gnomad.broadinstitute.org/variant/${chr}-${pos}-${ref}-${alt}?dataset=${dataset}`,

  clinvar: (chr: string, pos: number, ref: string, alt: string) =>
    `https://www.ncbi.nlm.nih.gov/clinvar/?term=${chr}-${pos}-${ref}-${alt}`,

  omim: (mimNumber: string) =>
    `https://www.omim.org/entry/${mimNumber}`,

  omimSearch: (geneSymbol: string) =>
    `https://www.omim.org/search?search=${encodeURIComponent(geneSymbol)}`,

  ucscBrowser: (chr: string, pos: number) =>
    `https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=chr${chr}:${pos}-${pos}`
}
```

**Shell handler whitelist expansion:**

```typescript
// MODIFIED: src/main/ipc/handlers/shell.ts
const ALLOWED_DOMAINS = [
  'github.com',
  'opensource.org',
  // NEW for v0.3.0:
  'gnomad.broadinstitute.org',
  'ncbi.nlm.nih.gov',        // ClinVar
  'omim.org',                  // OMIM
  'genome.ucsc.edu'            // UCSC Genome Browser
]
```

**VariantTable integration:** Add icon buttons to each row for external links. Vuetify `v-btn` with `icon` prop and tooltip. Links open via `window.api.shell.openExternal(url)`.

```vue
<!-- New column in VariantTable headers -->
{ title: 'Links', key: 'actions', sortable: false, width: '100px' }

<!-- New slot in template -->
<template #[`item.actions`]="{ item }">
  <v-btn icon size="x-small" @click="openGnomAD(item)">
    <v-icon size="small">mdi-open-in-new</v-icon>
    <v-tooltip activator="parent">gnomAD</v-tooltip>
  </v-btn>
  <v-btn icon size="x-small" @click="openClinVar(item)">
    <v-icon size="small">mdi-hospital-box</v-icon>
    <v-tooltip activator="parent">ClinVar</v-tooltip>
  </v-btn>
</template>
```

### 7. OMIM Data Extraction

**Confidence: MEDIUM** -- Depends on what OMIM data exists in the source JSON annotation files.

**The question:** Where does OMIM data live in the source JSON? Looking at the existing `COLUMN_INDICES` in `fieldMapping.ts`, there is no OMIM-specific column currently mapped. The annotation data likely contains OMIM MIM numbers embedded in other annotation fields or in unmapped columns at higher indices.

**Two possible approaches:**

**Approach A: Extract at import time (recommended)**
- Add new column indices to `fieldMapping.ts` for OMIM data (MIM number, disease name)
- Add columns to variants table: `omim_mim TEXT`, `omim_disease TEXT`
- Extract during FieldMapper transform, same as gene_symbol and other dictionary-resolved fields
- This requires investigation of the actual JSON structure to identify which column index contains OMIM data

**Approach B: Parse from existing fields at query time**
- If OMIM MIM numbers are embedded in existing fields (e.g., in `hpo_match` or another annotation field), parse them out at query time
- Less clean but doesn't require re-importing existing data

**Schema changes for OMIM (Approach A):**

```sql
-- Migration: Add OMIM columns
ALTER TABLE variants ADD COLUMN omim_mim TEXT;
ALTER TABLE variants ADD COLUMN omim_disease TEXT;

-- Index for OMIM lookup
CREATE INDEX IF NOT EXISTS idx_variants_omim ON variants(omim_mim);
```

**Migration strategy:** The existing `migrateVariantsTable()` function in `schema.ts` already handles adding new columns to existing databases. Add `omim_mim` and `omim_disease` to the `newColumns` array. Existing imported cases will have NULL values for these columns.

**Phase-specific research needed:** Before implementation, must investigate the actual source JSON file format to determine the column index for OMIM data. This requires opening a test data file and examining the header to find OMIM-related fields.

---

## Data Flow Changes

### Current (v0.2.0) Data Flow

```
                    File System
                        |
                  [.json.gz file]
                        |
                  ImportService
                  (streaming pipeline)
                        |
                  DatabaseService
                  (varlens.db - hardcoded)
                        |
                  IPC Handler
                        |
                  contextBridge
                        |
                  Vue Components
```

### New (v0.3.0) Data Flow

```
                    File System
                        |
              +---------+---------+
              |                   |
        [.json.gz files]     [.zip file]
              |                   |
              |             ZipExtractor
              |             (password decrypt)
              |                   |
              |             [temp .json.gz files]
              |                   |
              +------- merge -----+
                        |
              BatchImportOrchestrator
              (sequential file processing)
                        |
              ImportService (per file)
              (existing streaming pipeline)
                        |
        +-------DatabaseService-------+
        |       (with SQLCipher key)  |
        |                             |
  Single-case queries          Cohort aggregation
  (existing IPC channels)     (new IPC channels)
        |                             |
  contextBridge              contextBridge
        |                             |
  VariantTable +              CohortView +
  ExternalLinks               CohortVariantTable
```

---

## Database Schema Changes

### New Columns

| Table | Column | Type | Purpose |
|-------|--------|------|---------|
| variants | omim_mim | TEXT | OMIM MIM number |
| variants | omim_disease | TEXT | OMIM disease name |

### New Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_variants_cohort ON variants(chr, pos, ref, alt, case_id);
CREATE INDEX IF NOT EXISTS idx_variants_omim ON variants(omim_mim);
CREATE INDEX IF NOT EXISTS idx_variants_gene_case ON variants(gene_symbol, case_id);
```

### New Views

```sql
-- cohort_variants view (see Section 5 above)
-- cohort_genes view (see Section 5 above)
```

### Schema Migration Strategy

The existing migration system in `schema.ts` uses `PRAGMA table_info` to detect missing columns and `ALTER TABLE ADD COLUMN` to add them. This pattern works for all v0.3.0 schema changes:

1. New columns added via existing `migrateVariantsTable()` pattern
2. New indexes added in `createIndexes` SQL (idempotent with `IF NOT EXISTS`)
3. New views added after indexes (idempotent with `IF NOT EXISTS`)
4. FTS triggers do NOT need modification (FTS still indexes gene_symbol + consequence)

---

## New IPC Channel Summary

Following the existing `domain:action` naming convention:

### database domain (new)

| Channel | Type | Signature |
|---------|------|-----------|
| `database:select` | invoke | `() => string \| null` |
| `database:create` | invoke | `(path?: string) => string` |
| `database:open` | invoke | `(path: string, key?: string) => { success, path, encrypted }` |
| `database:close` | invoke | `() => void` |
| `database:getCurrent` | invoke | `() => { path: string \| null, encrypted: boolean }` |
| `database:rekey` | invoke | `(currentKey?: string, newKey?: string) => { success }` |

### import domain (extended)

| Channel | Type | Signature | Status |
|---------|------|-----------|--------|
| `import:selectFile` | invoke | `() => string \| null` | Existing (modify filters) |
| `import:selectFiles` | invoke | `() => string[] \| null` | New |
| `import:selectFolder` | invoke | `() => string \| null` | New |
| `import:start` | invoke | `(filePath, caseName) => ImportResult` | Existing |
| `import:startBatch` | invoke | `(files: BatchImportFile[]) => BatchImportResult` | New |
| `import:progress` | event | `ProgressUpdate` | Existing |
| `import:batchProgress` | event | `BatchProgressUpdate` | New |
| `import:cancel` | invoke | `() => void` | Existing |

### cohort domain (new)

| Channel | Type | Signature |
|---------|------|-----------|
| `cohort:summary` | invoke | `() => CohortSummary` |
| `cohort:variants` | invoke | `(filters, cursor?, limit?, sortBy?) => PaginatedResult<CohortVariant>` |
| `cohort:search` | invoke | `(query: string, limit?) => CohortVariant[]` |
| `cohort:geneAggregation` | invoke | `(filters, cursor?, limit?) => PaginatedResult<CohortGene>` |
| `cohort:caseBreakdown` | invoke | `(chr, pos, ref, alt) => CaseBreakdown[]` |

---

## Suggested Build Order

Based on dependency analysis:

### Phase Order Rationale

```
1. SQLCipher migration       -- Foundation: everything else builds on this
2. Database selection         -- Depends on: SQLCipher (encryption-aware lifecycle)
3. External links             -- Independent: renderer-only + shell whitelist
4. OMIM data extraction       -- Depends on: understanding source data format
5. Batch import + ZIP         -- Depends on: database lifecycle (open/close)
6. Cohort analysis            -- Depends on: multiple cases in database (batch import)
7. Integration & polish       -- Depends on: all above
```

**Why this order:**

- **SQLCipher first** because it replaces the core dependency. Every subsequent feature uses the database through this library. Get the foundation right.
- **Database selection second** because batch import and cohort analysis both need the ability to manage database lifecycle (open, close, switch).
- **External links third** because they are independent, renderer-focused, and provide immediate user value with minimal architectural risk.
- **OMIM fourth** because it requires investigating the source JSON format and modifying the import pipeline. Doing this before batch import means single-file import can validate OMIM extraction.
- **Batch import fifth** because it extends the existing import pipeline. The cohort analysis feature needs multiple cases imported to be testable.
- **Cohort analysis last** because it depends on having multiple cases in the database, which requires batch import to be convenient. It's the most complex new feature and benefits from all infrastructure being in place.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Parallel SQLite Writes

**What:** Trying to import multiple files in parallel to speed up batch import.
**Why bad:** SQLite is single-writer. Parallel writes cause `SQLITE_BUSY` errors and actually slow down due to lock contention.
**Instead:** Sequential import with aggregate progress reporting.

### Anti-Pattern 2: Storing Encryption Key

**What:** Persisting the database encryption key to disk (settings.json, localStorage).
**Why bad:** Defeats the purpose of encryption. Anyone with disk access can read the key.
**Instead:** Prompt user for key on each database open. Keep key only in memory during session.

### Anti-Pattern 3: Cohort Queries Without Indexes

**What:** Running GROUP BY across all variants without a covering index.
**Why bad:** With 1M+ rows, unindexed aggregation queries will take seconds.
**Instead:** Add `idx_variants_cohort` composite index before implementing cohort views.

### Anti-Pattern 4: Mounting Views on CohortVariantTable

**What:** Using the existing VariantTable component for cohort display.
**Why bad:** CohortVariant has different columns (carrier_count, het_count, hom_count) that VariantTable doesn't know about. Forcing it creates conditional complexity.
**Instead:** Create a separate `CohortVariantTable` component. Extract shared formatting helpers (formatScientific, getClinVarColor) into a composable.

### Anti-Pattern 5: ZIP Password in IPC Logs

**What:** Logging ZIP passwords in console.log during import.
**Why bad:** Passwords appear in DevTools and log files.
**Instead:** Never log passwords. Use placeholder strings in debug output.

---

## Scalability Considerations

| Concern | Current (1-3 cases) | At 20 cases | At 100 cases |
|---------|---------------------|-------------|--------------|
| Import time | ~20s per 65k file | Batch: ~7 min | Batch: ~35 min |
| DB size | ~50MB | ~500MB | ~2.5GB |
| Cohort query | N/A | <500ms with index | May need materialized views |
| FTS search | <50ms | <100ms | <200ms |
| Memory | ~200MB | ~300MB | ~500MB |

---

## Renderer Routing/Navigation

The current app has no routing -- it's a single view with sidebar case list + variant table. Adding cohort analysis requires navigation between views.

**Recommendation: Tab-based navigation, not vue-router.**

Cohort analysis is a second "mode" of the same app, not a separate page. Use a `v-tabs` component in the app bar or main content area:

```
[Cases]  [Cohort]
```

- **Cases tab**: Current UI (CaseList sidebar + VariantTable)
- **Cohort tab**: New CohortView (CohortSummary + CohortVariantTable)

This avoids adding vue-router as a dependency for just two views and keeps the single-window Electron architecture simple.

---

## Sources

- [better-sqlite3-multiple-ciphers GitHub](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) -- API-compatible fork with SQLCipher support
- [better-sqlite3-multiple-ciphers v12.6.2 release](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases) -- Electron 40 prebuilt binaries confirmed
- [SQLite3 Multiple Ciphers documentation](https://utelle.github.io/SQLite3MultipleCiphers/) -- PRAGMA key/rekey/cipher usage
- [better-sqlite3-multiple-ciphers API docs](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/api.md) -- key() and rekey() methods
- [unzipper npm package](https://www.npmjs.com/package/unzipper) -- Password-protected ZIP extraction
- [Electron dialog API](https://www.electronjs.org/docs/latest/api/dialog) -- showOpenDialog for file/folder selection
- [gnomAD browser](https://gnomad.broadinstitute.org/) -- Variant URL format: `/variant/{chr}-{pos}-{ref}-{alt}`
- [ClinVar search help](https://www.ncbi.nlm.nih.gov/clinvar/docs/help/) -- gnomAD-format search: `chr-pos-ref-alt`
- [OMIM external links](https://www.omim.org/help/external) -- Entry URL format: `/entry/{MIM_number}`
- [SQLite aggregate functions](https://www.sqlitetutorial.net/sqlite-aggregate-functions/) -- GROUP BY, COUNT, GROUP_CONCAT patterns
