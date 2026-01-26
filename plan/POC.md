# Varlens POC Implementation Plan

> Proof of Concept: Import functionality + Table view with basic filters

## Overview

This POC demonstrates core Varlens functionality:
1. **Import**: Load gzipped JSON variant data into SQLite
2. **Table View**: Display variants with server-side pagination
3. **Basic Filters**: Gene, consequence type, allele frequency

**Principles**: DRY, KISS, SOLID, modular architecture, no anti-patterns.

---

## 1. Project Setup

### 1.1 Scaffold with electron-vite

```bash
npm create @quick-start/electron@latest varlens -- --template vue-ts
cd varlens
```

This creates the recommended structure:
```
varlens/
├── electron.vite.config.ts
├── src/
│   ├── main/           # Electron main process
│   │   └── index.ts
│   ├── preload/        # Context bridge
│   │   └── index.ts
│   └── renderer/       # Vue 3 app
│       ├── src/
│       │   ├── App.vue
│       │   ├── main.ts
│       │   ├── components/
│       │   ├── composables/
│       │   ├── stores/
│       │   ├── services/
│       │   └── types/
│       └── index.html
├── resources/          # App icons
├── package.json
└── tsconfig.json
```

### 1.2 Dependencies

```bash
# Core
npm install vuetify @mdi/font pinia better-sqlite3

# Dev dependencies
npm install -D @types/better-sqlite3 electron-rebuild
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-vue
npm install -D vitest @vue/test-utils happy-dom
npm install -D @vitest/coverage-v8

# Rebuild native module for Electron
npx electron-rebuild -f -w better-sqlite3
```

### 1.3 Makefile

```makefile
.PHONY: dev build lint lint-fix test test-cov typecheck clean rebuild-native

# Development
dev:
	npm run dev

# Build
build:
	npm run build

# Linting
lint:
	npx eslint src/ --ext .ts,.vue

lint-fix:
	npx eslint src/ --ext .ts,.vue --fix

# Testing
test:
	npx vitest run

test-watch:
	npx vitest

test-cov:
	npx vitest run --coverage

# Type checking
typecheck:
	npx vue-tsc --noEmit

# Clean
clean:
	rm -rf dist out node_modules/.vite

# Native module rebuild (after Electron upgrade)
rebuild-native:
	npx electron-rebuild -f -w better-sqlite3

# All checks (CI)
ci: lint typecheck test
```

---

## 2. Architecture

### 2.1 Layer Separation (SOLID)

```
┌─────────────────────────────────────────────────────────┐
│  Renderer Process (Vue 3)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Components  │──│   Stores    │──│  IPC Client     │  │
│  │ (UI Layer)  │  │  (Pinia)    │  │  (preload API)  │  │
│  └─────────────┘  └─────────────┘  └────────┬────────┘  │
└─────────────────────────────────────────────┼───────────┘
                                              │ IPC
┌─────────────────────────────────────────────┼───────────┐
│  Main Process (Electron)                    │           │
│  ┌─────────────────┐  ┌─────────────────────▼─────────┐ │
│  │  IPC Handlers   │──│      Services                 │ │
│  │  (Controllers)  │  │  ┌──────────┐ ┌────────────┐  │ │
│  └─────────────────┘  │  │ Database │ │   Import   │  │ │
│                       │  │ Service  │ │   Service  │  │ │
│                       │  └──────────┘ └────────────┘  │ │
│                       └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

1. User clicks "Import" → Vue component emits action
2. Pinia store calls IPC → `window.api.importFile(path)`
3. Main process ImportService reads gzipped JSON
4. DatabaseService inserts variants in transaction
5. IPC returns success → Store updates state
6. Component re-renders with new data

---

## 3. Database Layer

### 3.1 Schema (SQLite)

```sql
-- src/main/database/schema.sql

-- Cases table
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  variant_count INTEGER DEFAULT 0
);

-- Variants table (denormalized for query performance)
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,

  -- Core fields (indexed)
  chr TEXT NOT NULL,
  pos INTEGER NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,

  -- Gene info
  gene_id INTEGER,
  gene_symbol TEXT,

  -- Consequence
  consequence TEXT,
  impact TEXT,

  -- Frequency (stored as float for filtering)
  gnomad_af REAL,
  gnomad_af_max REAL,

  -- Pathogenicity
  cadd_phred REAL,
  clinvar_sig TEXT,

  -- HPO matching
  hpo_sim_score REAL,

  -- Full JSON for detail view
  raw_json TEXT,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

-- Indexes for common filters
CREATE INDEX IF NOT EXISTS idx_variants_case ON variants(case_id);
CREATE INDEX IF NOT EXISTS idx_variants_chr_pos ON variants(chr, pos);
CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_variants_gnomad ON variants(gnomad_af_max);
CREATE INDEX IF NOT EXISTS idx_variants_consequence ON variants(consequence);

-- FTS5 for text search (gene symbols, cDNA, etc.)
CREATE VIRTUAL TABLE IF NOT EXISTS variants_fts USING fts5(
  gene_symbol,
  consequence,
  cdna,
  aa_change,
  content='variants',
  content_rowid='id'
);

-- Trigger to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS variants_ai AFTER INSERT ON variants BEGIN
  INSERT INTO variants_fts(rowid, gene_symbol, consequence, cdna, aa_change)
  VALUES (new.id, new.gene_symbol, new.consequence,
          json_extract(new.raw_json, '$.cDNA'),
          json_extract(new.raw_json, '$.AAChange'));
END;
```

### 3.2 Database Service

```typescript
// src/main/services/database.service.ts

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export interface QueryOptions {
  page: number;
  itemsPerPage: number;
  sortBy?: { key: string; order: 'asc' | 'desc' }[];
  filters?: FilterOptions;
}

export interface FilterOptions {
  geneSymbol?: string;
  consequence?: string;
  maxGnomadAf?: number;
  minCadd?: number;
  search?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

class DatabaseService {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'varlens.db');
  }

  initialize(): void {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Run schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  // Transaction wrapper for bulk operations
  transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.transaction(fn)();
  }

  // Prepared statement cache for performance
  private stmtCache = new Map<string, Database.Statement>();

  private prepare(sql: string): Database.Statement {
    if (!this.db) throw new Error('Database not initialized');

    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  // Case operations
  createCase(name: string): number {
    const stmt = this.prepare('INSERT INTO cases (name) VALUES (?)');
    const result = stmt.run(name);
    return result.lastInsertRowid as number;
  }

  getCases(): { id: number; name: string; variantCount: number; createdAt: string }[] {
    const stmt = this.prepare(`
      SELECT id, name, variant_count as variantCount, created_at as createdAt
      FROM cases ORDER BY created_at DESC
    `);
    return stmt.all() as any[];
  }

  deleteCase(caseId: number): void {
    const stmt = this.prepare('DELETE FROM cases WHERE id = ?');
    stmt.run(caseId);
  }

  // Variant operations
  insertVariantsBatch(caseId: number, variants: any[]): void {
    const insertStmt = this.prepare(`
      INSERT INTO variants (
        case_id, chr, pos, ref, alt, gene_id, gene_symbol,
        consequence, impact, gnomad_af, gnomad_af_max,
        cadd_phred, clinvar_sig, hpo_sim_score, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateCountStmt = this.prepare(`
      UPDATE cases SET variant_count = variant_count + ? WHERE id = ?
    `);

    this.transaction(() => {
      for (const v of variants) {
        insertStmt.run(
          caseId,
          this.extractFirst(v.Chr),
          this.extractFirst(v.Pos),
          this.extractFirst(v.Ref),
          this.extractFirst(v.Alt),
          this.extractFirst(v.Gene),
          v.GeneSymbol || null, // May need gene ID lookup
          v.Consequence || null,
          v.Impact || null,
          v.GnomAF || null,
          v.GnomPMaxFiltAF || null,
          v.CADDPhredScore || null,
          v.ClinVSig || null,
          v.HpoSimScore || null,
          JSON.stringify(v)
        );
      }
      updateCountStmt.run(variants.length, caseId);
    });
  }

  // Handle array fields (multi-transcript variants have arrays)
  private extractFirst(value: any): any {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  // Paginated query with filters
  queryVariants(caseId: number, options: QueryOptions): PaginatedResult<any> {
    const { page, itemsPerPage, sortBy, filters } = options;
    const offset = (page - 1) * itemsPerPage;

    // Build WHERE clause
    const conditions: string[] = ['case_id = ?'];
    const params: any[] = [caseId];

    if (filters?.geneSymbol) {
      conditions.push('gene_symbol LIKE ?');
      params.push(`%${filters.geneSymbol}%`);
    }

    if (filters?.consequence) {
      conditions.push('consequence = ?');
      params.push(filters.consequence);
    }

    if (filters?.maxGnomadAf !== undefined) {
      conditions.push('(gnomad_af_max IS NULL OR gnomad_af_max <= ?)');
      params.push(filters.maxGnomadAf);
    }

    if (filters?.minCadd !== undefined) {
      conditions.push('cadd_phred >= ?');
      params.push(filters.minCadd);
    }

    if (filters?.search) {
      // Use FTS5 for text search
      conditions.push('id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)');
      params.push(filters.search);
    }

    const whereClause = conditions.join(' AND ');

    // Build ORDER BY
    let orderClause = 'id ASC';
    if (sortBy && sortBy.length > 0) {
      orderClause = sortBy
        .map(s => `${this.sanitizeColumn(s.key)} ${s.order.toUpperCase()}`)
        .join(', ');
    }

    // Count query
    const countSql = `SELECT COUNT(*) as total FROM variants WHERE ${whereClause}`;
    const countResult = this.db!.prepare(countSql).get(...params) as { total: number };

    // Data query
    const dataSql = `
      SELECT id, chr, pos, ref, alt, gene_symbol, consequence, impact,
             gnomad_af_max, cadd_phred, clinvar_sig, hpo_sim_score, raw_json
      FROM variants
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
    `;
    const items = this.db!.prepare(dataSql).all(...params, itemsPerPage, offset);

    return {
      items: items as any[],
      total: countResult.total
    };
  }

  // Whitelist columns to prevent SQL injection
  private sanitizeColumn(col: string): string {
    const allowed = ['id', 'chr', 'pos', 'gene_symbol', 'consequence',
                     'gnomad_af_max', 'cadd_phred', 'clinvar_sig', 'hpo_sim_score'];
    if (allowed.includes(col)) return col;
    return 'id';
  }

  // Get distinct values for filter dropdowns
  getDistinctValues(caseId: number, column: string): string[] {
    const col = this.sanitizeColumn(column);
    const sql = `SELECT DISTINCT ${col} FROM variants WHERE case_id = ? AND ${col} IS NOT NULL ORDER BY ${col}`;
    const rows = this.db!.prepare(sql).all(caseId) as any[];
    return rows.map(r => r[col]);
  }
}

export const databaseService = new DatabaseService();
```

---

## 4. Import Service

### 4.1 JSON Import with Streaming

```typescript
// src/main/services/import.service.ts

import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { databaseService } from './database.service';

const BATCH_SIZE = 1000;

export interface ImportProgress {
  phase: 'reading' | 'parsing' | 'inserting' | 'complete';
  processed: number;
  total?: number;
}

export type ProgressCallback = (progress: ImportProgress) => void;

class ImportService {
  async importJsonGz(
    filePath: string,
    caseName: string,
    onProgress?: ProgressCallback
  ): Promise<{ caseId: number; variantCount: number }> {

    // Create case first
    const caseId = databaseService.createCase(caseName);

    let buffer = '';
    let variants: any[] = [];
    let totalInserted = 0;
    let inArray = false;
    let depth = 0;

    const reportProgress = (phase: ImportProgress['phase'], processed: number) => {
      onProgress?.({ phase, processed });
    };

    // Streaming JSON array parser (memory efficient)
    const jsonParser = new Transform({
      readableObjectMode: true,
      transform(chunk, encoding, callback) {
        buffer += chunk.toString();

        // Simple streaming JSON array parser
        // Assumes format: [{"field": ...}, {"field": ...}, ...]
        while (buffer.length > 0) {
          if (!inArray) {
            const startIdx = buffer.indexOf('[');
            if (startIdx === -1) break;
            buffer = buffer.slice(startIdx + 1);
            inArray = true;
            continue;
          }

          // Find complete object
          let objStart = -1;
          let objEnd = -1;
          depth = 0;

          for (let i = 0; i < buffer.length; i++) {
            const char = buffer[i];
            if (char === '{') {
              if (depth === 0) objStart = i;
              depth++;
            } else if (char === '}') {
              depth--;
              if (depth === 0 && objStart !== -1) {
                objEnd = i;
                break;
              }
            }
          }

          if (objEnd === -1) break; // Need more data

          const objStr = buffer.slice(objStart, objEnd + 1);
          buffer = buffer.slice(objEnd + 1);

          try {
            const variant = JSON.parse(objStr);
            this.push(variant);
          } catch (e) {
            // Skip malformed objects
            console.warn('Failed to parse variant:', e);
          }
        }

        callback();
      }
    });

    // Batch inserter
    const batchInserter = new Transform({
      objectMode: true,
      transform(variant, encoding, callback) {
        variants.push(variant);

        if (variants.length >= BATCH_SIZE) {
          databaseService.insertVariantsBatch(caseId, variants);
          totalInserted += variants.length;
          reportProgress('inserting', totalInserted);
          variants = [];
        }

        callback();
      },
      flush(callback) {
        // Insert remaining variants
        if (variants.length > 0) {
          databaseService.insertVariantsBatch(caseId, variants);
          totalInserted += variants.length;
        }
        callback();
      }
    });

    // Create pipeline
    const readStream = createReadStream(filePath);
    const gunzip = createGunzip();

    reportProgress('reading', 0);

    await pipeline(
      readStream,
      gunzip,
      jsonParser,
      batchInserter
    );

    reportProgress('complete', totalInserted);

    return {
      caseId,
      variantCount: totalInserted
    };
  }
}

export const importService = new ImportService();
```

---

## 5. IPC Layer

### 5.1 Preload Script (Context Bridge)

```typescript
// src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron';

export type IpcApi = typeof api;

const api = {
  // File operations
  selectFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectFile'),

  // Import
  importVariants: (filePath: string, caseName: string): Promise<{ caseId: number; variantCount: number }> =>
    ipcRenderer.invoke('import:variants', filePath, caseName),

  onImportProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('import:progress', (_, progress) => callback(progress));
    return () => ipcRenderer.removeAllListeners('import:progress');
  },

  // Cases
  getCases: (): Promise<any[]> =>
    ipcRenderer.invoke('cases:list'),

  deleteCase: (caseId: number): Promise<void> =>
    ipcRenderer.invoke('cases:delete', caseId),

  // Variants
  queryVariants: (caseId: number, options: any): Promise<any> =>
    ipcRenderer.invoke('variants:query', caseId, options),

  getFilterOptions: (caseId: number, column: string): Promise<string[]> =>
    ipcRenderer.invoke('variants:filterOptions', caseId, column),
};

contextBridge.exposeInMainWorld('api', api);
```

### 5.2 Main Process Handlers

```typescript
// src/main/ipc/handlers.ts

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { databaseService } from '../services/database.service';
import { importService } from '../services/import.service';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // File selection dialog
  ipcMain.handle('dialog:selectFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'JSON Files', extensions: ['json', 'json.gz'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Import variants
  ipcMain.handle('import:variants', async (_, filePath: string, caseName: string) => {
    return importService.importJsonGz(filePath, caseName, (progress) => {
      mainWindow.webContents.send('import:progress', progress);
    });
  });

  // Case operations
  ipcMain.handle('cases:list', () => databaseService.getCases());
  ipcMain.handle('cases:delete', (_, caseId: number) => databaseService.deleteCase(caseId));

  // Variant queries
  ipcMain.handle('variants:query', (_, caseId: number, options: any) =>
    databaseService.queryVariants(caseId, options)
  );

  ipcMain.handle('variants:filterOptions', (_, caseId: number, column: string) =>
    databaseService.getDistinctValues(caseId, column)
  );
}
```

---

## 6. Frontend (Vue 3 + Vuetify)

### 6.1 Pinia Store

```typescript
// src/renderer/src/stores/variants.store.ts

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface Variant {
  id: number;
  chr: string;
  pos: number;
  ref: string;
  alt: string;
  geneSymbol: string | null;
  consequence: string | null;
  gnomadAfMax: number | null;
  caddPhred: number | null;
  clinvarSig: string | null;
  hpoSimScore: number | null;
}

export interface FilterState {
  geneSymbol: string;
  consequence: string;
  maxGnomadAf: number | null;
  minCadd: number | null;
  search: string;
}

export const useVariantsStore = defineStore('variants', () => {
  // State
  const currentCaseId = ref<number | null>(null);
  const variants = ref<Variant[]>([]);
  const totalVariants = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Pagination
  const page = ref(1);
  const itemsPerPage = ref(50);
  const sortBy = ref<{ key: string; order: 'asc' | 'desc' }[]>([]);

  // Filters
  const filters = ref<FilterState>({
    geneSymbol: '',
    consequence: '',
    maxGnomadAf: null,
    minCadd: null,
    search: ''
  });

  // Filter options (populated from DB)
  const consequenceOptions = ref<string[]>([]);

  // Computed
  const hasActiveFilters = computed(() => {
    return filters.value.geneSymbol !== '' ||
           filters.value.consequence !== '' ||
           filters.value.maxGnomadAf !== null ||
           filters.value.minCadd !== null ||
           filters.value.search !== '';
  });

  // Actions
  async function loadVariants() {
    if (!currentCaseId.value) return;

    loading.value = true;
    error.value = null;

    try {
      const result = await window.api.queryVariants(currentCaseId.value, {
        page: page.value,
        itemsPerPage: itemsPerPage.value,
        sortBy: sortBy.value,
        filters: {
          geneSymbol: filters.value.geneSymbol || undefined,
          consequence: filters.value.consequence || undefined,
          maxGnomadAf: filters.value.maxGnomadAf ?? undefined,
          minCadd: filters.value.minCadd ?? undefined,
          search: filters.value.search || undefined
        }
      });

      variants.value = result.items.map(mapVariant);
      totalVariants.value = result.total;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load variants';
    } finally {
      loading.value = false;
    }
  }

  async function loadFilterOptions() {
    if (!currentCaseId.value) return;
    consequenceOptions.value = await window.api.getFilterOptions(
      currentCaseId.value,
      'consequence'
    );
  }

  function setCase(caseId: number) {
    currentCaseId.value = caseId;
    page.value = 1;
    resetFilters();
    loadFilterOptions();
    loadVariants();
  }

  function setPage(newPage: number) {
    page.value = newPage;
    loadVariants();
  }

  function setItemsPerPage(count: number) {
    itemsPerPage.value = count;
    page.value = 1;
    loadVariants();
  }

  function setSortBy(sort: { key: string; order: 'asc' | 'desc' }[]) {
    sortBy.value = sort;
    loadVariants();
  }

  function applyFilters(newFilters: Partial<FilterState>) {
    Object.assign(filters.value, newFilters);
    page.value = 1;
    loadVariants();
  }

  function resetFilters() {
    filters.value = {
      geneSymbol: '',
      consequence: '',
      maxGnomadAf: null,
      minCadd: null,
      search: ''
    };
    page.value = 1;
    loadVariants();
  }

  // Map DB row to frontend model
  function mapVariant(row: any): Variant {
    return {
      id: row.id,
      chr: row.chr,
      pos: row.pos,
      ref: row.ref,
      alt: row.alt,
      geneSymbol: row.gene_symbol,
      consequence: row.consequence,
      gnomadAfMax: row.gnomad_af_max,
      caddPhred: row.cadd_phred,
      clinvarSig: row.clinvar_sig,
      hpoSimScore: row.hpo_sim_score
    };
  }

  return {
    // State
    currentCaseId,
    variants,
    totalVariants,
    loading,
    error,
    page,
    itemsPerPage,
    sortBy,
    filters,
    consequenceOptions,
    // Computed
    hasActiveFilters,
    // Actions
    loadVariants,
    setCase,
    setPage,
    setItemsPerPage,
    setSortBy,
    applyFilters,
    resetFilters
  };
});
```

### 6.2 Variant Table Component

```vue
<!-- src/renderer/src/components/VariantTable.vue -->

<template>
  <v-card>
    <!-- Toolbar with filters -->
    <v-toolbar density="compact" color="surface">
      <v-text-field
        v-model="localFilters.geneSymbol"
        label="Gene"
        density="compact"
        hide-details
        clearable
        class="mx-2"
        style="max-width: 150px"
        @update:model-value="debouncedApplyFilters"
      />

      <v-select
        v-model="localFilters.consequence"
        :items="store.consequenceOptions"
        label="Consequence"
        density="compact"
        hide-details
        clearable
        class="mx-2"
        style="max-width: 200px"
        @update:model-value="applyFilters"
      />

      <v-text-field
        v-model.number="localFilters.maxGnomadAf"
        label="Max gnomAD AF"
        type="number"
        step="0.001"
        density="compact"
        hide-details
        clearable
        class="mx-2"
        style="max-width: 130px"
        @update:model-value="debouncedApplyFilters"
      />

      <v-text-field
        v-model.number="localFilters.minCadd"
        label="Min CADD"
        type="number"
        density="compact"
        hide-details
        clearable
        class="mx-2"
        style="max-width: 100px"
        @update:model-value="debouncedApplyFilters"
      />

      <v-spacer />

      <v-btn
        v-if="store.hasActiveFilters"
        variant="text"
        size="small"
        @click="store.resetFilters"
      >
        Clear Filters
      </v-btn>
    </v-toolbar>

    <!-- Data table -->
    <v-data-table-server
      v-model:items-per-page="itemsPerPage"
      v-model:page="page"
      v-model:sort-by="sortBy"
      :headers="headers"
      :items="store.variants"
      :items-length="store.totalVariants"
      :loading="store.loading"
      density="compact"
      hover
      fixed-header
      height="calc(100vh - 200px)"
      @update:options="onOptionsUpdate"
    >
      <!-- Chromosome column -->
      <template #item.chr="{ value }">
        <v-chip size="x-small" label>{{ value }}</v-chip>
      </template>

      <!-- Position column (formatted) -->
      <template #item.pos="{ value }">
        {{ formatPosition(value) }}
      </template>

      <!-- Gene column -->
      <template #item.geneSymbol="{ value }">
        <span class="font-weight-medium">{{ value || '-' }}</span>
      </template>

      <!-- gnomAD AF column -->
      <template #item.gnomadAfMax="{ value }">
        <span :class="getAfClass(value)">
          {{ formatAf(value) }}
        </span>
      </template>

      <!-- CADD column -->
      <template #item.caddPhred="{ value }">
        <span :class="getCaddClass(value)">
          {{ value?.toFixed(1) || '-' }}
        </span>
      </template>

      <!-- ClinVar column -->
      <template #item.clinvarSig="{ value }">
        <v-chip
          v-if="value"
          :color="getClinvarColor(value)"
          size="x-small"
          label
        >
          {{ formatClinvar(value) }}
        </v-chip>
        <span v-else>-</span>
      </template>
    </v-data-table-server>
  </v-card>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { useVariantsStore } from '../stores/variants.store';
import { useDebounceFn } from '@vueuse/core';

const store = useVariantsStore();

// Local filter state for controlled inputs
const localFilters = reactive({
  geneSymbol: '',
  consequence: '',
  maxGnomadAf: null as number | null,
  minCadd: null as number | null
});

// Sync with store on case change
watch(() => store.filters, (newFilters) => {
  Object.assign(localFilters, newFilters);
}, { immediate: true, deep: true });

// Table state
const page = ref(1);
const itemsPerPage = ref(50);
const sortBy = ref<{ key: string; order: 'asc' | 'desc' }[]>([]);

// Column definitions
const headers = [
  { title: 'Chr', key: 'chr', width: 70, sortable: true },
  { title: 'Position', key: 'pos', width: 120, sortable: true },
  { title: 'Ref', key: 'ref', width: 80 },
  { title: 'Alt', key: 'alt', width: 80 },
  { title: 'Gene', key: 'geneSymbol', width: 120, sortable: true },
  { title: 'Consequence', key: 'consequence', width: 180, sortable: true },
  { title: 'gnomAD AF', key: 'gnomadAfMax', width: 100, sortable: true },
  { title: 'CADD', key: 'caddPhred', width: 80, sortable: true },
  { title: 'ClinVar', key: 'clinvarSig', width: 120, sortable: true },
  { title: 'HPO Score', key: 'hpoSimScore', width: 100, sortable: true }
];

// Debounced filter application for text inputs
const debouncedApplyFilters = useDebounceFn(() => {
  applyFilters();
}, 300);

function applyFilters() {
  store.applyFilters(localFilters);
}

function onOptionsUpdate(options: any) {
  if (options.page !== store.page) {
    store.setPage(options.page);
  }
  if (options.itemsPerPage !== store.itemsPerPage) {
    store.setItemsPerPage(options.itemsPerPage);
  }
  if (JSON.stringify(options.sortBy) !== JSON.stringify(store.sortBy)) {
    store.setSortBy(options.sortBy);
  }
}

// Formatting helpers
function formatPosition(pos: number): string {
  return pos?.toLocaleString() || '-';
}

function formatAf(af: number | null): string {
  if (af === null || af === undefined) return '-';
  if (af === 0) return '0';
  if (af < 0.0001) return af.toExponential(2);
  return af.toFixed(4);
}

function formatClinvar(sig: string): string {
  return sig?.replace(/_/g, ' ').toLowerCase() || '';
}

// Styling helpers
function getAfClass(af: number | null): string {
  if (af === null) return '';
  if (af <= 0.0001) return 'text-success';
  if (af <= 0.01) return 'text-warning';
  return 'text-error';
}

function getCaddClass(cadd: number | null): string {
  if (cadd === null) return '';
  if (cadd >= 25) return 'text-error font-weight-bold';
  if (cadd >= 15) return 'text-warning';
  return '';
}

function getClinvarColor(sig: string): string {
  const lower = sig?.toLowerCase() || '';
  if (lower.includes('pathogenic')) return 'error';
  if (lower.includes('likely_pathogenic')) return 'warning';
  if (lower.includes('benign')) return 'success';
  if (lower.includes('uncertain')) return 'grey';
  return 'default';
}
</script>

<style scoped>
:deep(.v-data-table) {
  font-size: 0.85rem;
}
</style>
```

### 6.3 Import Dialog Component

```vue
<!-- src/renderer/src/components/ImportDialog.vue -->

<template>
  <v-dialog v-model="dialog" max-width="500" persistent>
    <template #activator="{ props }">
      <v-btn v-bind="props" color="primary" prepend-icon="mdi-import">
        Import Variants
      </v-btn>
    </template>

    <v-card>
      <v-card-title>Import Variant Data</v-card-title>

      <v-card-text>
        <v-text-field
          v-model="caseName"
          label="Case Name"
          :rules="[v => !!v || 'Required']"
          :disabled="importing"
        />

        <v-file-input
          v-model="selectedFile"
          label="Select JSON file"
          accept=".json,.json.gz"
          :disabled="importing"
          prepend-icon="mdi-file-document"
          show-size
        />

        <v-alert
          v-if="error"
          type="error"
          density="compact"
          class="mt-2"
        >
          {{ error }}
        </v-alert>

        <v-progress-linear
          v-if="importing"
          :model-value="progress"
          :indeterminate="progress === 0"
          color="primary"
          class="mt-4"
        />

        <p v-if="importing" class="text-center text-caption mt-2">
          {{ progressText }}
        </p>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="importing"
          @click="dialog = false"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :loading="importing"
          :disabled="!canImport"
          @click="startImport"
        >
          Import
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

const emit = defineEmits<{
  imported: [caseId: number]
}>();

const dialog = ref(false);
const caseName = ref('');
const selectedFile = ref<File[]>([]);
const importing = ref(false);
const error = ref<string | null>(null);
const progress = ref(0);
const progressText = ref('');

const canImport = computed(() =>
  caseName.value.trim() !== '' && selectedFile.value.length > 0 && !importing.value
);

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = window.api.onImportProgress((p) => {
    switch (p.phase) {
      case 'reading':
        progress.value = 10;
        progressText.value = 'Reading file...';
        break;
      case 'parsing':
        progress.value = 30;
        progressText.value = 'Parsing JSON...';
        break;
      case 'inserting':
        progress.value = Math.min(90, 30 + (p.processed / 1000));
        progressText.value = `Inserting variants: ${p.processed.toLocaleString()}`;
        break;
      case 'complete':
        progress.value = 100;
        progressText.value = `Complete: ${p.processed.toLocaleString()} variants`;
        break;
    }
  });
});

onUnmounted(() => {
  unsubscribe?.();
});

async function startImport() {
  if (!canImport.value) return;

  importing.value = true;
  error.value = null;
  progress.value = 0;

  try {
    // For Electron file input, we need to get the path
    const file = selectedFile.value[0];
    const filePath = (file as any).path; // Electron adds path property

    const result = await window.api.importVariants(filePath, caseName.value.trim());

    emit('imported', result.caseId);
    dialog.value = false;

    // Reset form
    caseName.value = '';
    selectedFile.value = [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Import failed';
  } finally {
    importing.value = false;
  }
}
</script>
```

---

## 7. Configuration Files

### 7.1 ESLint Flat Config

```javascript
// eslint.config.js

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

export default [
  // Base JS rules
  js.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // Vue rules
  ...pluginVue.configs['flat/recommended'],

  // Custom rules
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Vue
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',

      // General
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error'
    }
  },

  // Ignore patterns
  {
    ignores: ['dist/', 'out/', 'node_modules/', '*.config.js']
  }
];
```

### 7.2 Vitest Config

```typescript
// vitest.config.ts

import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{ts,js}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts']
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@main': resolve(__dirname, 'src/main')
    }
  }
});
```

### 7.3 TypeScript Config

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/renderer/src/*"],
      "@main/*": ["src/main/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.vue"],
  "exclude": ["node_modules", "dist", "out"]
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

```typescript
// src/main/services/__tests__/database.service.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseService } from '../database.service';

describe('DatabaseService', () => {
  let db: DatabaseService;

  beforeEach(() => {
    // Use in-memory database for tests
    db = new DatabaseService(':memory:');
    db.initialize();
  });

  afterEach(() => {
    db.close();
  });

  describe('cases', () => {
    it('should create and retrieve a case', () => {
      const caseId = db.createCase('Test Case');
      const cases = db.getCases();

      expect(cases).toHaveLength(1);
      expect(cases[0].id).toBe(caseId);
      expect(cases[0].name).toBe('Test Case');
    });

    it('should delete a case and cascade variants', () => {
      const caseId = db.createCase('Test Case');
      db.insertVariantsBatch(caseId, [mockVariant()]);

      db.deleteCase(caseId);

      const cases = db.getCases();
      expect(cases).toHaveLength(0);
    });
  });

  describe('variants', () => {
    it('should insert and query variants', () => {
      const caseId = db.createCase('Test');
      db.insertVariantsBatch(caseId, [
        mockVariant({ Chr: '1', Pos: 100 }),
        mockVariant({ Chr: '2', Pos: 200 })
      ]);

      const result = db.queryVariants(caseId, {
        page: 1,
        itemsPerPage: 10
      });

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
    });

    it('should filter by gene symbol', () => {
      const caseId = db.createCase('Test');
      db.insertVariantsBatch(caseId, [
        mockVariant({ GeneSymbol: 'BRCA1' }),
        mockVariant({ GeneSymbol: 'TP53' })
      ]);

      const result = db.queryVariants(caseId, {
        page: 1,
        itemsPerPage: 10,
        filters: { geneSymbol: 'BRCA1' }
      });

      expect(result.total).toBe(1);
      expect(result.items[0].gene_symbol).toBe('BRCA1');
    });

    it('should filter by gnomAD AF threshold', () => {
      const caseId = db.createCase('Test');
      db.insertVariantsBatch(caseId, [
        mockVariant({ GnomPMaxFiltAF: 0.001 }),
        mockVariant({ GnomPMaxFiltAF: 0.1 }),
        mockVariant({ GnomPMaxFiltAF: null })
      ]);

      const result = db.queryVariants(caseId, {
        page: 1,
        itemsPerPage: 10,
        filters: { maxGnomadAf: 0.01 }
      });

      expect(result.total).toBe(2); // 0.001 and null pass
    });
  });
});

function mockVariant(overrides: Partial<any> = {}): any {
  return {
    Chr: '1',
    Pos: 12345,
    Ref: 'A',
    Alt: 'G',
    Gene: 1,
    GeneSymbol: 'TEST',
    Consequence: 'missense_variant',
    GnomPMaxFiltAF: 0.001,
    CADDPhredScore: 20,
    ...overrides
  };
}
```

### 8.2 Component Tests

```typescript
// src/renderer/src/components/__tests__/VariantTable.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import { createPinia, setActivePinia } from 'pinia';
import VariantTable from '../VariantTable.vue';

const vuetify = createVuetify();

describe('VariantTable', () => {
  beforeEach(() => {
    setActivePinia(createPinia());

    // Mock window.api
    vi.stubGlobal('api', {
      queryVariants: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getFilterOptions: vi.fn().mockResolvedValue([])
    });
  });

  it('should render column headers', () => {
    const wrapper = mount(VariantTable, {
      global: {
        plugins: [vuetify]
      }
    });

    expect(wrapper.text()).toContain('Chr');
    expect(wrapper.text()).toContain('Position');
    expect(wrapper.text()).toContain('Gene');
  });

  it('should show filter inputs', () => {
    const wrapper = mount(VariantTable, {
      global: {
        plugins: [vuetify]
      }
    });

    expect(wrapper.find('input[label="Gene"]').exists()).toBe(true);
  });
});
```

---

## 9. Implementation Phases

### Phase 1: Project Scaffold (Day 1)
- [ ] Initialize electron-vite project with Vue + TypeScript template
- [ ] Install and configure Vuetify 3
- [ ] Install better-sqlite3, run electron-rebuild
- [ ] Set up Makefile with lint/test/build commands
- [ ] Configure ESLint flat config
- [ ] Configure Vitest

### Phase 2: Database Layer (Day 1-2)
- [ ] Implement schema.sql
- [ ] Implement DatabaseService with CRUD operations
- [ ] Write unit tests for DatabaseService
- [ ] Handle array fields from JSON (multi-transcript variants)

### Phase 3: Import Service (Day 2)
- [ ] Implement streaming JSON parser for gzipped files
- [ ] Implement batch inserts with transaction
- [ ] Add progress reporting via IPC
- [ ] Write unit tests for ImportService

### Phase 4: IPC Layer (Day 2-3)
- [ ] Set up preload script with type-safe API
- [ ] Register IPC handlers in main process
- [ ] Add file selection dialog handler

### Phase 5: Frontend Components (Day 3-4)
- [ ] Create Pinia store for variants
- [ ] Implement VariantTable with v-data-table-server
- [ ] Implement filter toolbar
- [ ] Implement ImportDialog
- [ ] Add case selection sidebar

### Phase 6: Integration & Polish (Day 4-5)
- [ ] End-to-end testing with test data
- [ ] Performance testing with 65k variants
- [ ] Error handling and loading states
- [ ] Basic styling and UX polish

---

## 10. File Structure (Final)

```
varlens/
├── Makefile
├── eslint.config.js
├── vitest.config.ts
├── tsconfig.json
├── electron.vite.config.ts
├── package.json
├── src/
│   ├── main/
│   │   ├── index.ts                    # Main process entry
│   │   ├── database/
│   │   │   └── schema.sql
│   │   ├── services/
│   │   │   ├── database.service.ts
│   │   │   ├── import.service.ts
│   │   │   └── __tests__/
│   │   │       └── database.service.test.ts
│   │   └── ipc/
│   │       └── handlers.ts
│   ├── preload/
│   │   ├── index.ts
│   │   └── index.d.ts                  # Type declarations
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── App.vue
│           ├── main.ts
│           ├── components/
│           │   ├── VariantTable.vue
│           │   ├── ImportDialog.vue
│           │   ├── CaseSidebar.vue
│           │   └── __tests__/
│           ├── stores/
│           │   ├── variants.store.ts
│           │   └── cases.store.ts
│           └── types/
│               └── api.d.ts
├── plan/
│   ├── PLAN.md
│   ├── POC.md
│   └── screenshots/
└── test-data/
    ├── case-892-snv-annotations.json.gz
    ├── case-892-snv-sample.json.gz
    └── snv-column-schema-minimal.json
```

---

## References

- [electron-vite documentation](https://electron-vite.org/)
- [Vuetify v-data-table-server](https://vuetifyjs.com/en/components/data-tables/server-side-tables/)
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [Pinia Setup Stores](https://pinia.vuejs.org/core-concepts/#setup-stores)
- [Vitest Configuration](https://vitest.dev/config/)
- [ESLint Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files-new)

---

## Success Criteria

1. **Import**: Successfully import 65k variants from gzipped JSON in <30 seconds
2. **Query**: Page through variants with <100ms response time
3. **Filter**: Apply gene/consequence/AF filters with instant feedback
4. **Tests**: >80% code coverage on services
5. **Lint**: Zero ESLint errors, zero TypeScript errors
