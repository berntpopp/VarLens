# Architecture Research

**Domain:** Variant annotation, classification, API enrichment, case metadata for Electron desktop app
**Researched:** 2026-01-28
**Confidence:** HIGH

## Executive Summary

This architecture integrates variant annotation (comments, flags, ACMG classifications, tags) and case metadata (status, cohort groups, HPO terms) into Varlens' existing Electron + Vue 3 + SQLite stack. The core pattern follows existing conventions: HTTP API calls in main process via dedicated service layer, new SQLite tables with foreign keys, new IPC handlers following `domain:action` naming, Pinia stores for state management, and Vue components for UI.

**Key architectural decisions:**
1. **API Proxy in Main Process**: HTTP calls (VEP, HPO) live in new `ApiService` class in main process with offline caching
2. **Side Panel as Vuetify Drawer**: Right-side v-navigation-drawer with persistent state in Pinia store
3. **Annotation Storage**: New SQLite tables (`variant_annotations`, `case_metadata`, `cohort_groups`) with foreign keys and triggers
4. **Graceful Degradation**: API failures fall back to cache or show "offline" UI states
5. **Schema Migration**: Existing `migrateVariantsTable` pattern extended for new tables with column-existence checks

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RENDERER PROCESS                              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Vue 3 Components                                              │   │
│  │  - VariantTable (existing, enhanced with flag/class icons)   │   │
│  │  - VariantDetailsPanel (NEW: side drawer)                    │   │
│  │  - CaseMetadataDialog (NEW: case status/cohort/HPO editor)   │   │
│  │  - AnnotationEditor (NEW: comments/flags/tags/ACMG)          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Pinia Stores                                                  │   │
│  │  - annotationsStore (NEW: variant annotations state)         │   │
│  │  - caseMetadataStore (NEW: case metadata state)              │   │
│  │  - sidePanelStore (NEW: drawer visibility, selected variant) │   │
│  │  - databaseStore (existing)                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              │ IPC (via contextBridge)                │
└──────────────────────────────┼────────────────────────────────────────┘
                               │
┌──────────────────────────────┼────────────────────────────────────────┐
│                         MAIN PROCESS                                  │
│  ┌──────────────────────────▼────────────────────────────────────┐   │
│  │ IPC Handlers (src/main/ipc/handlers/)                         │   │
│  │  - annotations.ts (NEW: CRUD for annotations)                 │   │
│  │  - api-proxy.ts (NEW: VEP/HPO API calls)                      │   │
│  │  - case-metadata.ts (NEW: case metadata CRUD)                 │   │
│  └───────────┬────────────────────────────────┬──────────────────┘   │
│              │                                │                       │
│  ┌───────────▼────────────────┐   ┌──────────▼──────────────────┐   │
│  │ DatabaseService (existing) │   │ ApiService (NEW)             │   │
│  │  - New methods for          │   │  - VEP client                │   │
│  │    annotation CRUD          │   │  - HPO client                │   │
│  │  - New methods for          │   │  - SQLite cache (api_cache)  │   │
│  │    case metadata CRUD       │   │  - Offline degradation logic │   │
│  └───────────┬────────────────┘   └─────────────────────────────┘   │
│              │                                                        │
│  ┌───────────▼────────────────────────────────────────────────────┐ │
│  │ SQLite Database (better-sqlite3-multiple-ciphers)              │ │
│  │  - cases (existing)                                            │ │
│  │  - variants (existing)                                         │ │
│  │  - variant_annotations (NEW)                                   │ │
│  │  - case_metadata (NEW)                                         │ │
│  │  - cohort_groups (NEW)                                         │ │
│  │  - api_cache (NEW)                                             │ │
│  └────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘

External Services (main process HTTP only):
  - Ensembl VEP REST API (https://rest.ensembl.org)
  - HPO API (https://clinicaltables.nlm.nih.gov)
```

## New Components

### 1. API Client Layer (Main Process)

**Location:** `src/main/services/ApiService.ts`

**Responsibilities:**
- HTTP API calls to Ensembl VEP and HPO ontology API
- SQLite-based response caching with TTL
- Offline degradation (return cached data or null)
- Rate limiting to respect API quotas

**Why main process?**
- Security: Renderer process is sandboxed and untrusted
- Node.js access: Built-in `https` module for requests
- SQLite access: Direct cache storage in database
- Following Electron best practices (see [Security | Electron](https://www.electronjs.org/docs/latest/tutorial/security))

**Implementation pattern:**
```typescript
export class ApiService {
  constructor(private db: DatabaseType) {}

  async fetchVepAnnotation(chr: string, pos: number, ref: string, alt: string): Promise<VepAnnotation | null> {
    // 1. Check cache first
    const cached = this.getCachedVep(chr, pos, ref, alt)
    if (cached && !this.isCacheExpired(cached.timestamp)) {
      return cached.data
    }

    // 2. Make API call with error handling
    try {
      const response = await this.httpRequest('https://rest.ensembl.org/vep/...')
      // 3. Store in cache
      this.cacheVepResponse(chr, pos, ref, alt, response)
      return response
    } catch (error) {
      // 4. Offline degradation: return stale cache or null
      return cached?.data ?? null
    }
  }
}
```

### 2. Annotation Storage (Main Process)

**Location:** `src/main/database/annotations.ts`

**Responsibilities:**
- CRUD operations for variant annotations
- CRUD operations for case metadata
- Join queries for variant table enhancement

**Methods to add to DatabaseService:**
```typescript
// Variant annotations
getAnnotationsForVariant(variantId: number): VariantAnnotation | null
createOrUpdateAnnotation(variantId: number, annotation: AnnotationInput): void
deleteAnnotation(variantId: number): void
listAnnotationsForCase(caseId: number): VariantAnnotation[]

// Case metadata
getCaseMetadata(caseId: number): CaseMetadata | null
updateCaseMetadata(caseId: number, metadata: CaseMetadataInput): void
addCohortGroup(name: string): number
listCohortGroups(): CohortGroup[]
linkCaseToGroups(caseId: number, groupIds: number[]): void
```

### 3. Side Panel Component (Renderer)

**Location:** `src/renderer/src/components/VariantDetailsPanel.vue`

**Responsibilities:**
- Display variant details with API enrichment (VEP, HPO)
- Show/edit annotations (comments, flags, ACMG, tags)
- Loading states for API calls
- Offline fallback UI

**Component architecture:**
- Vuetify `v-navigation-drawer` with `permanent` prop for persistent visibility
- State managed in `sidePanelStore` (selected variant ID, drawer open/closed)
- Tabs for "Details" / "Annotations" / "API Data"
- Form inputs for annotation editing with Pinia action calls

**Pattern from search:** [Navigation drawer component — Vuetify](https://vuetifyjs.com/en/components/navigation-drawers/)

### 4. Case Metadata UI (Renderer)

**Location:** `src/renderer/src/components/CaseMetadataDialog.vue`

**Responsibilities:**
- Edit case status (e.g., "In Progress", "Complete", "Archived")
- Assign case to cohort groups (multi-select)
- Add/remove HPO terms for phenotype annotation

**UI Pattern:**
- v-dialog triggered from case list actions
- Form with v-select (status), v-autocomplete (cohort groups), v-combobox (HPO terms)
- HPO autocomplete uses API proxy for term search

### 5. Annotation Indicators (Renderer Enhancement)

**Location:** `src/renderer/src/components/VariantTable.vue` (modify existing)

**Enhancement:**
- Add icon columns for star/flag/classification status
- Join annotation data in variant query
- Click handlers open side panel

**Visual pattern:**
```
| Chr | Pos | ... | Gene | ⭐ | 🚩 | ACMG | ... |
|  1  | 123 | ... | BRCA1| ⭐ | 🚩 |  P   | ... |
```

## Component Responsibilities

| Component | Layer | Responsibility |
|-----------|-------|----------------|
| `ApiService` | Main | HTTP API calls, caching, offline degradation |
| `DatabaseService` (extended) | Main | Annotation CRUD, case metadata CRUD |
| `annotations.ts` (handler) | Main IPC | IPC handlers for annotation operations |
| `api-proxy.ts` (handler) | Main IPC | IPC handlers for VEP/HPO requests |
| `case-metadata.ts` (handler) | Main IPC | IPC handlers for case metadata |
| `annotationsStore` | Renderer Pinia | Annotation state, optimistic updates |
| `caseMetadataStore` | Renderer Pinia | Case metadata state |
| `sidePanelStore` | Renderer Pinia | Drawer visibility, selected variant |
| `VariantDetailsPanel.vue` | Renderer | Side drawer with variant details + API data |
| `AnnotationEditor.vue` | Renderer | Form for comments/flags/tags/ACMG |
| `CaseMetadataDialog.vue` | Renderer | Dialog for case status/cohort/HPO |
| `VariantTable.vue` (modified) | Renderer | Add annotation indicator columns |

## Recommended Project Structure

```
src/
├── main/
│   ├── services/
│   │   ├── ApiService.ts                 (NEW: VEP + HPO API client)
│   │   ├── DatabaseManager.ts             (existing)
│   │   └── RecentDatabasesService.ts      (existing)
│   ├── database/
│   │   ├── DatabaseService.ts             (extend: annotation methods)
│   │   ├── schema.ts                      (extend: new tables)
│   │   ├── annotations.ts                 (NEW: annotation queries)
│   │   └── types.ts                       (extend: new types)
│   ├── ipc/
│   │   └── handlers/
│   │       ├── annotations.ts             (NEW: annotation IPC)
│   │       ├── api-proxy.ts               (NEW: API proxy IPC)
│   │       └── case-metadata.ts           (NEW: metadata IPC)
│   └── index.ts                           (register new handlers)
├── renderer/
│   ├── src/
│   │   ├── components/
│   │   │   ├── VariantDetailsPanel.vue    (NEW: side drawer)
│   │   │   ├── AnnotationEditor.vue       (NEW: annotation form)
│   │   │   ├── CaseMetadataDialog.vue     (NEW: metadata editor)
│   │   │   ├── AcmgClassificationForm.vue (NEW: ACMG criteria form)
│   │   │   └── VariantTable.vue           (modify: add indicators)
│   │   ├── stores/
│   │   │   ├── annotationsStore.ts        (NEW)
│   │   │   ├── caseMetadataStore.ts       (NEW)
│   │   │   └── sidePanelStore.ts          (NEW)
│   │   └── composables/
│   │       └── useApiData.ts              (NEW: API fetch composable)
└── shared/
    └── types/
        ├── annotations.ts                  (NEW: annotation types)
        ├── case-metadata.ts                (NEW: metadata types)
        └── api.ts                          (extend: VEP/HPO types)
```

## Architectural Patterns

### API Proxy Pattern (Main Process)

**Pattern:** All HTTP API calls originate from main process via dedicated service

**Rationale:**
- Security: Renderer is sandboxed with no direct network access
- Centralized caching: Single SQLite cache for all API responses
- Offline support: Main process controls degradation logic
- Rate limiting: Centralized control over API request frequency

**Implementation:**
```typescript
// src/main/services/ApiService.ts
export class ApiService {
  private cacheDb: Database.Database
  private vepBaseUrl = 'https://rest.ensembl.org'
  private hpoBaseUrl = 'https://clinicaltables.nlm.nih.gov'

  constructor(db: Database.Database) {
    this.cacheDb = db
    this.initializeCacheTable()
  }

  private initializeCacheTable(): void {
    this.cacheDb.exec(`
      CREATE TABLE IF NOT EXISTS api_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service TEXT NOT NULL,  -- 'vep' or 'hpo'
        cache_key TEXT NOT NULL UNIQUE,
        response_data TEXT NOT NULL,  -- JSON blob
        cached_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cache_lookup
        ON api_cache(service, cache_key);
      CREATE INDEX IF NOT EXISTS idx_cache_expiry
        ON api_cache(expires_at);
    `)
  }

  async fetchVepAnnotation(
    chr: string, pos: number, ref: string, alt: string
  ): Promise<VepResponse | null> {
    const cacheKey = `${chr}:${pos}:${ref}:${alt}`

    // Check cache
    const cached = this.getCached('vep', cacheKey)
    if (cached && Date.now() < cached.expires_at) {
      return JSON.parse(cached.response_data)
    }

    // Fetch from API
    try {
      const url = `${this.vepBaseUrl}/vep/human/region/${chr}:${pos}-${pos}/${alt}`
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        throw new Error(`VEP API returned ${response.status}`)
      }

      const data = await response.json()

      // Cache for 30 days
      this.cacheResponse('vep', cacheKey, data, 30 * 24 * 60 * 60 * 1000)

      return data
    } catch (error) {
      console.warn('VEP API failed, using stale cache:', error)
      // Return stale cache if available
      return cached ? JSON.parse(cached.response_data) : null
    }
  }

  async searchHpoTerms(query: string): Promise<HpoTerm[]> {
    const cacheKey = `search:${query}`

    const cached = this.getCached('hpo', cacheKey)
    if (cached && Date.now() < cached.expires_at) {
      return JSON.parse(cached.response_data)
    }

    try {
      const url = `${this.hpoBaseUrl}/api/hpo/v3/search?terms=${encodeURIComponent(query)}`
      const response = await fetch(url)
      const data = await response.json()

      // Cache for 7 days (ontology is relatively stable)
      this.cacheResponse('hpo', cacheKey, data, 7 * 24 * 60 * 60 * 1000)

      return data
    } catch (error) {
      console.warn('HPO API failed, using stale cache:', error)
      return cached ? JSON.parse(cached.response_data) : []
    }
  }

  private getCached(service: string, cacheKey: string) {
    return this.cacheDb
      .prepare('SELECT * FROM api_cache WHERE service = ? AND cache_key = ?')
      .get(service, cacheKey) as CachedResponse | undefined
  }

  private cacheResponse(
    service: string,
    cacheKey: string,
    data: any,
    ttlMs: number
  ): void {
    const now = Date.now()
    this.cacheDb
      .prepare(`
        INSERT OR REPLACE INTO api_cache
          (service, cache_key, response_data, cached_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(service, cacheKey, JSON.stringify(data), now, now + ttlMs)
  }
}
```

**IPC Handler:**
```typescript
// src/main/ipc/handlers/api-proxy.ts
import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getApiService } from '../../services/ApiService'

ipcMain.handle(
  'api:vep',
  async (_event, chr: string, pos: number, ref: string, alt: string) => {
    return wrapHandler(async () => {
      const api = getApiService()
      return await api.fetchVepAnnotation(chr, pos, ref, alt)
    })
  }
)

ipcMain.handle('api:hpoSearch', async (_event, query: string) => {
  return wrapHandler(async () => {
    const api = getApiService()
    return await api.searchHpoTerms(query)
  })
})
```

**Pattern sources:**
- [Security | Electron](https://www.electronjs.org/docs/latest/tutorial/security): "It is paramount that you do not enable Node.js integration in any renderer"
- [Advanced Electron.js architecture - LogRocket Blog](https://blog.logrocket.com/advanced-electron-js-architecture/): Backend in separate process for long-running operations

### Offline Degradation Pattern

**Pattern:** Three-tier fallback for API-dependent features

**Tiers:**
1. **Fresh data**: API call succeeds, cache updated, full features enabled
2. **Stale cache**: API call fails, return cached data with timestamp, show "Last updated: X days ago"
3. **No data**: No cache available, show "Offline — feature unavailable" with explanation

**Implementation:**
```typescript
// Renderer composable
export function useApiData(variantId: number) {
  const data = ref<VepAnnotation | null>(null)
  const status = ref<'fresh' | 'stale' | 'offline'>('offline')
  const cachedAt = ref<number | null>(null)

  async function fetch() {
    const result = await window.api.vep.fetch(variantId)
    if (result) {
      data.value = result.data
      status.value = result.isCached ? 'stale' : 'fresh'
      cachedAt.value = result.cachedAt
    } else {
      status.value = 'offline'
    }
  }

  return { data, status, cachedAt, fetch }
}
```

**UI pattern:**
```vue
<v-alert v-if="status === 'stale'" type="info" dense>
  Using cached data from {{ formatDate(cachedAt) }}
</v-alert>
<v-alert v-else-if="status === 'offline'" type="warning" dense>
  Variant annotation unavailable (offline)
</v-alert>
```

**Pattern source:** [Graceful Degradation: Keeping Your App Functional When Things Go South - DEV Community](https://dev.to/lovestaco/graceful-degradation-keeping-your-app-functional-when-things-go-south-jgj)

### Annotation Storage Pattern

**Pattern:** Separate annotation table with variant_id foreign key, optimistic UI updates

**Schema design:**
- Global annotations apply to variant across all cases
- Per-case annotations reference both case_id and variant_id
- UNIQUE constraint on (case_id, variant_id) for per-case annotations

**Implementation:**
```typescript
// Mixed model: some annotations are global, some are per-case
export interface VariantAnnotation {
  id: number
  variant_id: number  // FK to variants.id
  case_id: number | null  // NULL = global, non-NULL = per-case

  // User annotations
  comment: string | null
  starred: boolean
  flagged: boolean
  tags: string | null  // JSON array

  // ACMG classification
  acmg_classification: 'pathogenic' | 'likely_pathogenic' | 'uncertain' | 'likely_benign' | 'benign' | null
  acmg_criteria: string | null  // JSON object with criteria codes

  // Metadata
  created_at: number
  updated_at: number
}
```

**Pinia store pattern (Elm Architecture inspired):**
```typescript
// src/renderer/src/stores/annotationsStore.ts
export const useAnnotationsStore = defineStore('annotations', () => {
  // State
  const annotations = ref<Map<number, VariantAnnotation>>(new Map())
  const loading = ref(false)

  // Actions
  async function loadForCase(caseId: number) {
    loading.value = true
    try {
      const list = await window.api.annotations.listForCase(caseId)
      for (const ann of list) {
        annotations.value.set(ann.variant_id, ann)
      }
    } finally {
      loading.value = false
    }
  }

  async function updateAnnotation(variantId: number, updates: Partial<AnnotationInput>) {
    // Optimistic update
    const current = annotations.value.get(variantId)
    const optimistic = { ...current, ...updates }
    annotations.value.set(variantId, optimistic)

    try {
      const saved = await window.api.annotations.update(variantId, updates)
      annotations.value.set(variantId, saved)
    } catch (error) {
      // Rollback on failure
      if (current) {
        annotations.value.set(variantId, current)
      }
      throw error
    }
  }

  // Getters
  function getForVariant(variantId: number) {
    return annotations.value.get(variantId) ?? null
  }

  return { annotations, loading, loadForCase, updateAnnotation, getForVariant }
})
```

**Pattern source:** [How to Write Better Pinia Stores with the Elm Pattern | alexop.dev](https://alexop.dev/posts/tea-architecture-pinia-private-store-pattern/)

### Side Panel Architecture

**Pattern:** Vuetify v-navigation-drawer with persistent state in Pinia store

**Component structure:**
```vue
<template>
  <v-navigation-drawer
    v-model="sidePanelStore.isOpen"
    :width="600"
    location="right"
    temporary
  >
    <v-toolbar color="secondary" density="compact">
      <v-toolbar-title>Variant Details</v-toolbar-title>
      <v-spacer />
      <v-btn icon @click="sidePanelStore.close()">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </v-toolbar>

    <v-tabs v-model="activeTab">
      <v-tab value="details">Details</v-tab>
      <v-tab value="annotations">Annotations</v-tab>
      <v-tab value="api">API Data</v-tab>
    </v-tabs>

    <v-window v-model="activeTab">
      <v-window-item value="details">
        <variant-details-view :variant="selectedVariant" />
      </v-window-item>
      <v-window-item value="annotations">
        <annotation-editor :variant-id="selectedVariant.id" />
      </v-window-item>
      <v-window-item value="api">
        <api-enrichment-view :variant="selectedVariant" />
      </v-window-item>
    </v-window>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSidePanelStore } from '@/stores/sidePanelStore'

const sidePanelStore = useSidePanelStore()
const activeTab = ref('details')

const selectedVariant = computed(() => sidePanelStore.selectedVariant)
</script>
```

**Store pattern:**
```typescript
export const useSidePanelStore = defineStore('sidePanel', () => {
  const isOpen = ref(false)
  const selectedVariantId = ref<number | null>(null)

  function open(variantId: number) {
    selectedVariantId.value = variantId
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
    // Keep selectedVariantId for reopen
  }

  return { isOpen, selectedVariantId, open, close }
})
```

**Pattern source:** [Navigation drawer component — Vuetify](https://vuetifyjs.com/en/components/navigation-drawers/)

## Data Flow

### Annotation Flow

```
User clicks star icon in VariantTable
  ↓
VariantTable emits 'toggle-star' event with variant ID
  ↓
Parent component calls annotationsStore.toggleStar(variantId)
  ↓
Pinia action performs optimistic update (star immediately)
  ↓
IPC call: window.api.annotations.update(variantId, { starred: true })
  ↓
Main process: annotations handler receives request
  ↓
DatabaseService.updateAnnotation() writes to SQLite
  ↓
IPC returns updated annotation
  ↓
Pinia action confirms optimistic update or rolls back
  ↓
VariantTable reactively updates star icon
```

### API Enrichment Flow

```
User clicks variant row in VariantTable
  ↓
VariantTable calls sidePanelStore.open(variant.id)
  ↓
VariantDetailsPanel becomes visible
  ↓
Component lifecycle hook calls useApiData(variant.id).fetch()
  ↓
IPC call: window.api.vep.fetch(chr, pos, ref, alt)
  ↓
Main process: ApiService.fetchVepAnnotation()
  ↓
ApiService checks SQLite cache first
  ↓
If cache miss or expired: HTTP request to rest.ensembl.org
  ↓
Response cached in SQLite with TTL
  ↓
IPC returns { data, isCached, cachedAt }
  ↓
Component updates UI:
  - Fresh data: show full annotation
  - Stale cache: show annotation + "cached" badge
  - No data: show "offline" message
```

### Case Metadata Flow

```
User opens case list, clicks "Edit Metadata" on case
  ↓
CaseList opens CaseMetadataDialog(caseId)
  ↓
Dialog loads: caseMetadataStore.loadForCase(caseId)
  ↓
IPC call: window.api.caseMetadata.get(caseId)
  ↓
Main process: DatabaseService.getCaseMetadata(caseId)
  ↓
SQLite query joins case_metadata + cohort_groups
  ↓
Dialog displays form with current status/cohorts/HPO terms
  ↓
User edits, clicks Save
  ↓
Store action: caseMetadataStore.update(caseId, updates)
  ↓
IPC call: window.api.caseMetadata.update(caseId, updates)
  ↓
Main process: DatabaseService.updateCaseMetadata()
  ↓
SQLite transaction updates case_metadata + links
  ↓
IPC returns success
  ↓
Store updates local state, dialog closes
```

## Schema Design

### Variant Annotations Schema

```sql
-- Annotations can be global (case_id = NULL) or per-case (case_id = non-NULL)
-- UNIQUE constraint ensures one annotation per variant per case
CREATE TABLE IF NOT EXISTS variant_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL,
  case_id INTEGER,  -- NULL = global annotation

  -- User annotations
  comment TEXT,
  starred BOOLEAN NOT NULL DEFAULT 0,
  flagged BOOLEAN NOT NULL DEFAULT 0,
  tags TEXT,  -- JSON array: ["candidate", "reviewed"]

  -- ACMG classification
  acmg_classification TEXT CHECK(acmg_classification IN (
    'pathogenic', 'likely_pathogenic', 'uncertain_significance',
    'likely_benign', 'benign'
  )),
  acmg_criteria TEXT,  -- JSON object: {"PVS1": true, "PM2": true, ...}

  -- Metadata
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  UNIQUE(variant_id, case_id)  -- One annotation per variant per case
);

CREATE INDEX IF NOT EXISTS idx_annotations_variant
  ON variant_annotations(variant_id);
CREATE INDEX IF NOT EXISTS idx_annotations_case
  ON variant_annotations(case_id);
CREATE INDEX IF NOT EXISTS idx_annotations_starred
  ON variant_annotations(starred) WHERE starred = 1;
CREATE INDEX IF NOT EXISTS idx_annotations_flagged
  ON variant_annotations(flagged) WHERE flagged = 1;
CREATE INDEX IF NOT EXISTS idx_annotations_classification
  ON variant_annotations(acmg_classification)
  WHERE acmg_classification IS NOT NULL;
```

**Design rationale:**
- `variant_id` required, `case_id` nullable → supports both global and per-case annotations
- Boolean flags (starred, flagged) → simple, indexable for filtering
- JSON columns (tags, acmg_criteria) → flexible storage for lists/objects
- CHECK constraint on acmg_classification → enforces valid ACMG terms
- ON DELETE CASCADE → annotations auto-deleted when variant/case deleted
- Partial indexes on flags/classification → efficient filtering queries

**ACMG criteria storage example:**
```json
{
  "PVS1": { "applied": true, "note": "Predicted null variant" },
  "PM2": { "applied": true, "note": "Absent from gnomAD" },
  "PP3": { "applied": true, "note": "CADD 28.4" },
  "classification_date": "2026-01-28",
  "classified_by": "user@example.com"
}
```

### Case Metadata Schema

```sql
-- Case-level metadata for status tracking and phenotype annotation
CREATE TABLE IF NOT EXISTS case_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL UNIQUE,

  -- Case status
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN (
    'active', 'in_progress', 'complete', 'archived', 'on_hold'
  )),

  -- Phenotype annotation (HPO terms)
  hpo_terms TEXT,  -- JSON array: ["HP:0000001", "HP:0000002"]

  -- Metadata
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_metadata_status
  ON case_metadata(status);

-- Cohort groups (user-defined arbitrary groupings)
CREATE TABLE IF NOT EXISTS cohort_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at INTEGER NOT NULL
);

-- Many-to-many: cases can belong to multiple cohort groups
CREATE TABLE IF NOT EXISTS case_cohort_links (
  case_id INTEGER NOT NULL,
  cohort_group_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,

  PRIMARY KEY (case_id, cohort_group_id),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (cohort_group_id) REFERENCES cohort_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cohort_links_group
  ON case_cohort_links(cohort_group_id);
```

**Design rationale:**
- `case_metadata` 1:1 with cases → separate table keeps cases table clean
- `status` CHECK constraint → enforces valid status values
- `hpo_terms` JSON array → stores HPO IDs (resolved to labels via API)
- `cohort_groups` separate table → user-defined groups with descriptions
- `case_cohort_links` junction table → many-to-many relationship
- Arbitrary cohort naming → user can create "Family A", "Cardiac Cases", etc.

**HPO terms storage example:**
```json
["HP:0001250", "HP:0002104", "HP:0001252"]
```
(Resolved via HPO API to labels like "Seizure", "Apnea", "Hypotonia")

### API Cache Schema

```sql
CREATE TABLE IF NOT EXISTS api_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,  -- 'vep' or 'hpo'
  cache_key TEXT NOT NULL,
  response_data TEXT NOT NULL,  -- JSON blob
  cached_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,

  UNIQUE(service, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_cache_lookup
  ON api_cache(service, cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_expiry
  ON api_cache(expires_at);

-- Cleanup trigger for expired cache (optional, can also be manual)
CREATE TRIGGER IF NOT EXISTS cleanup_expired_cache
AFTER INSERT ON api_cache
BEGIN
  DELETE FROM api_cache WHERE expires_at < unixepoch() * 1000;
END;
```

**Design rationale:**
- Generic cache for multiple services (VEP, HPO)
- `cache_key` varies by service (e.g., "chr:pos:ref:alt" for VEP, "search:term" for HPO)
- `response_data` as JSON TEXT → flexible storage, no schema changes needed
- TTL-based expiration → stale cache detection
- Trigger auto-cleanup → prevents unbounded growth

### Migration Strategy

**Pattern:** Extend existing `migrateVariantsTable` pattern in `schema.ts`

**Implementation:**
```typescript
// src/main/database/schema.ts

/**
 * Migration: Add annotation tables if they don't exist
 */
const migrateAnnotationTables = (db: Database.Database): void => {
  // Check if tables exist
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all() as { name: string }[]
  const existingTables = new Set(tables.map(t => t.name))

  // Create variant_annotations if missing
  if (!existingTables.has('variant_annotations')) {
    db.exec(`
      CREATE TABLE variant_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        variant_id INTEGER NOT NULL,
        case_id INTEGER,
        comment TEXT,
        starred BOOLEAN NOT NULL DEFAULT 0,
        flagged BOOLEAN NOT NULL DEFAULT 0,
        tags TEXT,
        acmg_classification TEXT CHECK(acmg_classification IN (
          'pathogenic', 'likely_pathogenic', 'uncertain_significance',
          'likely_benign', 'benign'
        )),
        acmg_criteria TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        UNIQUE(variant_id, case_id)
      );

      CREATE INDEX idx_annotations_variant ON variant_annotations(variant_id);
      CREATE INDEX idx_annotations_case ON variant_annotations(case_id);
      CREATE INDEX idx_annotations_starred ON variant_annotations(starred) WHERE starred = 1;
      CREATE INDEX idx_annotations_flagged ON variant_annotations(flagged) WHERE flagged = 1;
    `)
    console.log('Created variant_annotations table')
  }

  // Create case_metadata if missing
  if (!existingTables.has('case_metadata')) {
    db.exec(`
      CREATE TABLE case_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN (
          'active', 'in_progress', 'complete', 'archived', 'on_hold'
        )),
        hpo_terms TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_case_metadata_status ON case_metadata(status);
    `)
    console.log('Created case_metadata table')
  }

  // Create cohort_groups if missing
  if (!existingTables.has('cohort_groups')) {
    db.exec(`
      CREATE TABLE cohort_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE case_cohort_links (
        case_id INTEGER NOT NULL,
        cohort_group_id INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (case_id, cohort_group_id),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (cohort_group_id) REFERENCES cohort_groups(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_cohort_links_group ON case_cohort_links(cohort_group_id);
    `)
    console.log('Created cohort_groups and case_cohort_links tables')
  }

  // Create api_cache if missing
  if (!existingTables.has('api_cache')) {
    db.exec(`
      CREATE TABLE api_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        response_data TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        UNIQUE(service, cache_key)
      );

      CREATE INDEX idx_cache_lookup ON api_cache(service, cache_key);
      CREATE INDEX idx_cache_expiry ON api_cache(expires_at);
    `)
    console.log('Created api_cache table')
  }
}

export function initializeSchema(db: Database.Database): void {
  db.exec(createTables)
  migrateVariantsTable(db)
  migrateAnnotationTables(db)  // NEW: Add annotation tables
  db.exec(createIndexes)
  // ... rest of existing schema init
}
```

**Migration strategy:**
1. **Table existence check**: Query `sqlite_master` before creating tables
2. **Additive only**: New tables/columns added, never removed (backwards compatible)
3. **Foreign key constraints**: Enforce referential integrity
4. **Safe for existing databases**: Opening old database auto-upgrades schema
5. **No data loss**: Existing cases/variants unaffected

**Pattern source:** [SQLite Versioning and Migration Strategies for Evolving Applications](https://www.sqliteforum.com/p/sqlite-versioning-and-migration-strategies)

## Integration Points

### External Services

| Service | Base URL | Purpose | Rate Limit | Cache TTL |
|---------|----------|---------|------------|-----------|
| Ensembl VEP | `https://rest.ensembl.org` | Variant consequence prediction | 15 req/sec | 30 days |
| HPO API | `https://clinicaltables.nlm.nih.gov` | Phenotype term search | No published limit | 7 days |

**VEP API documentation:** [Ensembl Rest API - POST vep/:species/region](https://rest.ensembl.org/documentation/info/vep_region_post)

**HPO API documentation:** [API for HPO (The Human Phenotype Ontology)](https://clinicaltables.nlm.nih.gov/apidoc/hpo/v3/doc.html)

**Rate limiting implementation:**
```typescript
export class ApiService {
  private lastVepRequest = 0
  private readonly VEP_MIN_INTERVAL = 1000 / 15  // 15 req/sec = 66ms between requests

  async fetchVepAnnotation(...): Promise<VepResponse | null> {
    // Rate limiting
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastVepRequest
    if (timeSinceLastRequest < this.VEP_MIN_INTERVAL) {
      await sleep(this.VEP_MIN_INTERVAL - timeSinceLastRequest)
    }
    this.lastVepRequest = Date.now()

    // ... rest of fetch logic
  }
}
```

### Internal Boundaries

**Component communication:**
```
VariantTable.vue
  ├─> annotationsStore (read: display indicators)
  ├─> sidePanelStore (write: open panel on click)
  └─> IPC: window.api.variants.query (existing)

VariantDetailsPanel.vue
  ├─> sidePanelStore (read: selected variant)
  ├─> annotationsStore (read/write: edit annotations)
  └─> IPC: window.api.vep.fetch, window.api.hpo.search

CaseMetadataDialog.vue
  ├─> caseMetadataStore (read/write: edit metadata)
  └─> IPC: window.api.caseMetadata.*

AnnotationEditor.vue
  ├─> annotationsStore (write: save annotations)
  └─> IPC: window.api.annotations.update
```

**IPC channel naming (extends existing `domain:action` pattern):**
```
annotations:list
annotations:get
annotations:create
annotations:update
annotations:delete

api:vep
api:hpoSearch
api:hpoGetTerm

case-metadata:get
case-metadata:update
case-metadata:listCohortGroups
case-metadata:createCohortGroup
case-metadata:linkToCohorts
```

**Preload API extension:**
```typescript
// src/preload/index.ts (extend existing API object)

const api = {
  // ... existing APIs

  annotations: {
    list: (caseId: number) => ipcRenderer.invoke('annotations:list', caseId),
    get: (variantId: number, caseId: number) =>
      ipcRenderer.invoke('annotations:get', variantId, caseId),
    update: (variantId: number, caseId: number, data: AnnotationInput) =>
      ipcRenderer.invoke('annotations:update', variantId, caseId, data),
    delete: (variantId: number, caseId: number) =>
      ipcRenderer.invoke('annotations:delete', variantId, caseId)
  },

  apiProxy: {
    vep: (chr: string, pos: number, ref: string, alt: string) =>
      ipcRenderer.invoke('api:vep', chr, pos, ref, alt),
    hpoSearch: (query: string) =>
      ipcRenderer.invoke('api:hpoSearch', query),
    hpoGetTerm: (hpoId: string) =>
      ipcRenderer.invoke('api:hpoGetTerm', hpoId)
  },

  caseMetadata: {
    get: (caseId: number) => ipcRenderer.invoke('case-metadata:get', caseId),
    update: (caseId: number, data: CaseMetadataInput) =>
      ipcRenderer.invoke('case-metadata:update', caseId, data),
    listCohortGroups: () => ipcRenderer.invoke('case-metadata:listCohortGroups'),
    createCohortGroup: (name: string, description: string) =>
      ipcRenderer.invoke('case-metadata:createCohortGroup', name, description),
    linkToCohorts: (caseId: number, groupIds: number[]) =>
      ipcRenderer.invoke('case-metadata:linkToCohorts', caseId, groupIds)
  }
}
```

## Build Order

**Recommended implementation sequence (informed by dependencies):**

### Phase 1: Database Foundation
1. Extend `schema.ts` with annotation tables
2. Add `migrateAnnotationTables()` function
3. Add annotation CRUD methods to `DatabaseService`
4. Test migration on existing database

**Why first:** All other features depend on database schema

### Phase 2: API Service Layer
1. Create `ApiService.ts` with VEP + HPO clients
2. Implement cache table and cache logic
3. Add rate limiting
4. Create IPC handlers in `api-proxy.ts`
5. Extend preload API

**Why second:** Side panel needs API data before it can be useful

### Phase 3: Annotation Storage
1. Create IPC handlers in `annotations.ts`
2. Add annotation methods to `DatabaseService`
3. Extend preload API with annotation methods
4. Create shared types in `src/shared/types/annotations.ts`

**Why third:** UI components need backend endpoints

### Phase 4: Pinia Stores
1. Create `annotationsStore.ts`
2. Create `caseMetadataStore.ts`
3. Create `sidePanelStore.ts`

**Why fourth:** Components bind to stores, so stores must exist first

### Phase 5: UI Components (Parallel)
1. **VariantDetailsPanel.vue** - Side drawer with tabs
2. **AnnotationEditor.vue** - Comment/flag/tag/ACMG form
3. **AcmgClassificationForm.vue** - ACMG criteria checklist
4. **CaseMetadataDialog.vue** - Case status/cohort/HPO editor
5. **ApiEnrichmentView.vue** - VEP/HPO data display

**Why fifth:** Components can be built in parallel once stores exist

### Phase 6: VariantTable Integration
1. Modify `VariantTable.vue` to join annotation data
2. Add indicator columns (star, flag, classification)
3. Add click handlers to open side panel
4. Update IPC query to include annotation join

**Why last:** Requires all other pieces to be functional

### Phase 7: Case Metadata Integration
1. Create `case-metadata.ts` IPC handlers
2. Add case metadata CRUD to `DatabaseService`
3. Add cohort group management UI in case list
4. Add HPO term autocomplete in metadata dialog

**Dependencies:**
- Phase 2 → Phase 1 (API needs cache tables)
- Phase 3 → Phase 1 (Annotations need schema)
- Phase 4 → Phase 2, 3 (Stores need IPC endpoints)
- Phase 5 → Phase 4 (Components need stores)
- Phase 6 → Phase 5 (Table integration needs side panel)
- Phase 7 → Phase 2, 3 (Metadata needs API + storage)

## Architectural Trade-offs

### Decision: API Calls in Main Process

**Alternatives considered:**
1. Renderer-side fetch (rejected: violates sandbox security)
2. External proxy server (rejected: offline requirement)
3. Main process with SQLite cache (chosen)

**Trade-offs:**
- **Pro:** Secure, offline-capable, centralized caching
- **Pro:** Follows Electron best practices
- **Con:** Additional IPC overhead for API calls
- **Con:** Main process must handle HTTP errors

**Mitigation:** Cache aggressively (30-day TTL for VEP, 7-day for HPO), graceful degradation UI

### Decision: Side Panel as Vuetify Drawer

**Alternatives considered:**
1. Modal dialog (rejected: blocks workflow)
2. Split pane (rejected: complex resize logic)
3. Right drawer (chosen)

**Trade-offs:**
- **Pro:** Non-blocking, standard Vuetify pattern
- **Pro:** Persistent during navigation (stays open)
- **Con:** Reduces table width when open
- **Con:** Mobile support requires different layout

**Mitigation:** Temporary drawer (overlays table), responsive breakpoints for mobile

### Decision: Global + Per-Case Annotations

**Alternatives considered:**
1. Global only (rejected: can't track per-case status)
2. Per-case only (rejected: duplicates work across cases)
3. Hybrid (chosen)

**Trade-offs:**
- **Pro:** Flexibility (global for reference, per-case for analysis)
- **Pro:** Avoids duplication of common annotations
- **Con:** More complex query logic (need to merge global + per-case)
- **Con:** UI must expose both annotation levels

**Mitigation:** UI defaults to per-case, shows global as read-only context

### Decision: JSON Storage for Tags and ACMG Criteria

**Alternatives considered:**
1. Separate tables (rejected: over-normalized for variable data)
2. JSON columns (chosen)

**Trade-offs:**
- **Pro:** Flexible schema (tags/criteria can evolve)
- **Pro:** Simpler queries (single row fetch)
- **Con:** Cannot efficiently query/filter by specific tag
- **Con:** JSON parsing overhead

**Mitigation:** Partial indexes on boolean flags (starred, flagged), filter UI in renderer

## Sources

**Electron Security:**
- [Security | Electron](https://www.electronjs.org/docs/latest/tutorial/security)
- [Advanced Electron.js architecture - LogRocket Blog](https://blog.logrocket.com/advanced-electron-js-architecture/)
- [Inter-Process Communication | Electron](https://www.electronjs.org/docs/latest/tutorial/ipc)

**API Integration:**
- [Ensembl Rest API - POST vep/:species/region](https://rest.ensembl.org/documentation/info/vep_region_post)
- [API for HPO (The Human Phenotype Ontology)](https://clinicaltables.nlm.nih.gov/apidoc/hpo/v3/doc.html)
- [Standards and Guidelines for the Interpretation of Sequence Variants: A Joint Consensus Recommendation of the American College of Medical Genetics and Genomics and the Association for Molecular Pathology - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/)

**UI Patterns:**
- [Navigation drawer component — Vuetify](https://vuetifyjs.com/en/components/navigation-drawers/)
- [How to Write Better Pinia Stores with the Elm Pattern | alexop.dev](https://alexop.dev/posts/tea-architecture-pinia-private-store-pattern/)
- [Leveraging Pinia to simplify complex Vue state management - LogRocket Blog](https://blog.logrocket.com/complex-vue-3-state-management-pinia/)

**Database Design:**
- [SQLite Foreign Key Support](https://sqlite.org/foreignkeys.html)
- [SQLite Versioning and Migration Strategies for Evolving Applications](https://www.sqliteforum.com/p/sqlite-versioning-and-migration-strategies)
- [ALTER TABLE](https://sqlite.org/lang_altertable.html)

**Offline Architecture:**
- [Graceful Degradation: Keeping Your App Functional When Things Go South - DEV Community](https://dev.to/lovestaco/graceful-degradation-keeping-your-app-functional-when-things-go-south-jgj)
- [Cache Dynamic Assets Offline in Electron Apps | by Julian Rubisch | Better Programming](https://betterprogramming.pub/caching-dynamic-assets-offline-in-electron-apps-797232f18ec8)
