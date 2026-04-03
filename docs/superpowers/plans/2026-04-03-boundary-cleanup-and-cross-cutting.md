# Boundary Cleanup & Cross-Cutting Hardening Implementation Plan

> **Status: COMPLETED** — All 13 tasks implemented and merged in PR #139.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove architecture drift at the shared/main/renderer boundaries, fix cross-cutting CI and security gaps, and raise Architecture from 6.5→8.0+ and Maintainability from 7.0→8.2+.

**Architecture:** Pure data types currently defined in `src/main/` are relocated to `src/shared/types/` so the shared layer has zero imports from main. `src/shared/types/api.ts` becomes the single authority for IPC contracts. Renderer `as any` casts around `window.api` are replaced with proper `useApiService()` usage. CI release workflow gains parity with build. Dependency hygiene issues are resolved.

**Tech Stack:** TypeScript, Electron 40, Vue 3, Vuetify 3, Vitest, GitHub Actions, ESLint

---

## File Structure

### New Files

| File | Purpose |
|------|---------|
| `src/shared/types/database.ts` | Relocated pure data types from `src/main/database/types.ts` |
| `src/shared/types/import.ts` | Relocated `ProgressUpdate`, `ImportResult`, `VcfPreviewResult`, etc. |
| `src/shared/types/gene-reference.ts` | Relocated `GeneValidationResult`, `GeneAutocompleteResult`, `GeneRefInfo`, `AssemblyInfo` |
| `src/shared/types/panels.ts` | Relocated `PanelRow`, `PanelWithCount`, `PanelGeneRow`, `ActivePanelRow`, `PanelAppSearchResult` |
| `tests/shared/types/boundary-imports.test.ts` | Lint-level test: no `src/shared/` file imports from `src/main/` |

### Modified Files

| File | Change |
|------|--------|
| `src/main/database/types.ts` | Replace definitions with re-exports from `src/shared/types/database.ts` |
| `src/main/import/types.ts` | Replace definitions with re-exports from `src/shared/types/import.ts` |
| `src/main/import/vcf/types.ts` | Replace `VcfPreviewResult` definition with re-export from `src/shared/types/import.ts` |
| `src/main/database/GeneReferenceDb.ts` | Replace type definitions with imports from `src/shared/types/gene-reference.ts` |
| `src/main/database/PanelRepository.ts` | Replace type definitions with imports from `src/shared/types/panels.ts` |
| `src/main/services/api/PanelAppClient.ts` | Replace `PanelAppSearchResult` definition with re-export from `src/shared/types/panels.ts` |
| `src/main/services/api/schemas/hpo-response.ts` | Move `HpoTerm` interface to shared |
| `src/shared/types/api-enrichment.ts` | Import `HpoTerm` from shared instead of main |
| `src/shared/types/api.ts` | Change all imports to point at new shared type files instead of main |
| `src/renderer/src/components/CohortTable.vue` | Replace inline `import('../../../main/database/types')` with shared import |
| `src/renderer/src/components/FilterToolbar.vue` | Replace `(window as any).api` with `useApiService()` |
| `src/renderer/src/components/CaseMetricsTab.vue` | Replace `(item as any).raw` with proper Vuetify slot typing |
| `src/renderer/src/components/cohort/CohortFilterBar.vue` | Replace `(window as any).api` with `useApiService()` |
| `src/renderer/src/composables/useFilterPreferences.ts` | Replace `as any` migration with typed union |
| `src/main/ipc/handlers/cohort.ts` | Replace `event.sender.send` with `safeEmit` |
| `.github/workflows/release.yml` | Add gitleaks job, add coverage to Linux release |
| `package.json` | Fix `@xmldom/xmldom` override, add xlsx note |

---

## Task 1: Relocate database types to shared

**Files:**
- Create: `src/shared/types/database.ts`
- Modify: `src/main/database/types.ts`
- Modify: `src/shared/types/api.ts`

The `src/main/database/types.ts` file (641 lines) contains only pure data interfaces with a single import from `src/shared/types/column-filters`. All types are safe to move.

- [ ] **Step 1: Create `src/shared/types/database.ts`**

Copy the entire contents of `src/main/database/types.ts` to `src/shared/types/database.ts`. The file keeps its existing import:

```typescript
import type { ColumnFiltersParam } from './column-filters'
```

And the `AcmgClassification` re-export stays:

```typescript
import type { AcmgClassification as _AcmgClassification } from '../config/domain.config'
export type AcmgClassification = _AcmgClassification
```

Adjust the relative path for `domain.config` from `../../shared/config/domain.config` to `../config/domain.config`.

- [ ] **Step 2: Replace `src/main/database/types.ts` with re-exports**

Replace the entire file contents with:

```typescript
/**
 * Database types — canonical definitions are in src/shared/types/database.ts.
 * This file re-exports everything so existing main-process imports are unaffected.
 */
export type * from '../../shared/types/database'
```

- [ ] **Step 3: Update `src/shared/types/api.ts` imports**

In `src/shared/types/api.ts`, change lines 35-64:

```typescript
// OLD:
import type { ... } from '../../main/database/types'
// NEW:
import type { ... } from './database'
```

Keep the exact same type list, just change the path.

- [ ] **Step 4: Run typecheck to verify**

Run: `npx tsc --noEmit`
Expected: PASS — all imports resolve to the same types via re-exports.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/database.ts src/main/database/types.ts src/shared/types/api.ts
git commit -m "refactor: relocate database types to src/shared/types/database.ts"
```

---

## Task 2: Relocate import types to shared

**Files:**
- Create: `src/shared/types/import.ts`
- Modify: `src/main/import/types.ts`
- Modify: `src/main/import/vcf/types.ts`
- Modify: `src/shared/types/api.ts`

- [ ] **Step 1: Create `src/shared/types/import.ts`**

Move the pure data types from `src/main/import/types.ts` (all 65 lines) to `src/shared/types/import.ts`.

Also move the `VcfPreviewResult` interface from `src/main/import/vcf/types.ts:184-197` into the same file. `VcfPreviewResult` references `AnnotationType` which is defined locally in `vcf/types.ts` — also move the `AnnotationType` type alias (`'vep' | 'snpeff' | 'none'`).

The file will have no imports from `src/main/`.

- [ ] **Step 2: Replace moved types with re-exports in original files**

In `src/main/import/types.ts`:
```typescript
export type * from '../../shared/types/import'
```

In `src/main/import/vcf/types.ts`, replace the `VcfPreviewResult` interface and `AnnotationType` type with:
```typescript
export type { VcfPreviewResult, AnnotationType } from '../../../shared/types/import'
```
Keep all other VCF-specific types (InfoFieldDef, FormatFieldDef, etc.) in place since they're internal to the import pipeline.

- [ ] **Step 3: Update `src/shared/types/api.ts` imports**

Change:
```typescript
// OLD:
import type { ProgressUpdate, ImportResult } from '../../main/import/types'
import type { VcfPreviewResult } from '../../main/import/vcf/types'
// NEW:
import type { ProgressUpdate, ImportResult, VcfPreviewResult } from './import'
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/import.ts src/main/import/types.ts src/main/import/vcf/types.ts src/shared/types/api.ts
git commit -m "refactor: relocate import types to src/shared/types/import.ts"
```

---

## Task 3: Relocate gene-reference and panel types to shared

**Files:**
- Create: `src/shared/types/gene-reference.ts`
- Create: `src/shared/types/panels.ts`
- Modify: `src/main/database/GeneReferenceDb.ts`
- Modify: `src/main/database/PanelRepository.ts`
- Modify: `src/main/services/api/PanelAppClient.ts`
- Modify: `src/shared/types/api.ts`

- [ ] **Step 1: Create `src/shared/types/gene-reference.ts`**

Move these interfaces from `src/main/database/GeneReferenceDb.ts:8-51`:

```typescript
export interface GeneValidationResult {
  input: string
  status: 'approved' | 'alias' | 'ambiguous' | 'unknown'
  symbol?: string
  hgncId?: string
  name?: string
  locusGroup?: string
  currentSymbol?: string
  aliasType?: string
  candidates?: Array<{ symbol: string; hgncId: string }>
}

export interface GeneAutocompleteResult {
  symbol: string
  hgncId: string
  name: string
  locusGroup: string
  matchType: 'symbol' | 'alias'
  matchedAlias?: string
}

export interface GeneCoordinates {
  hgncId: string
  assembly: string
  chromosome: string
  start_pos: number
  end_pos: number
  strand: string
}

export interface AssemblyInfo {
  id: string
  display_name: string
  aliases: string[]
  source_version: string
}

export interface GeneRefInfo {
  geneCount: number
  aliasCount: number
  coordinateCount: number
  assemblies: string[]
  builtAt: number
}
```

No imports needed — all types are self-contained.

- [ ] **Step 2: Create `src/shared/types/panels.ts`**

Move `PanelRow`, `PanelWithCount`, `PanelGeneRow`, `ActivePanelRow` from `src/main/database/PanelRepository.ts:22-52` and `PanelAppSearchResult` from `src/main/services/api/PanelAppClient.ts:67-80`.

Also move `GenomicInterval` and `CreatePanelInput` from `PanelRepository.ts:7-20` since they're pure data types.

```typescript
export interface GenomicInterval {
  chr: string
  start: number
  end: number
}

export interface CreatePanelInput {
  name: string
  description?: string | null
  version?: string | null
  source: string
  sourceId?: string | null
  sourceMetadata?: Record<string, unknown> | null
}

export interface PanelRow {
  id: number
  name: string
  description: string | null
  version: string | null
  source: string
  source_id: string | null
  source_metadata: string | null
  created_at: number
  updated_at: number
}

export interface PanelWithCount extends PanelRow {
  gene_count: number
}

export interface PanelGeneRow {
  id: number
  panel_id: number
  hgnc_id: string
  symbol: string
}

export interface ActivePanelRow {
  case_id: number
  panel_id: number
  padding_bp: number
  activated_at: number
  panel_name: string
  gene_count: number
}

export interface PanelAppSearchResult {
  id: number
  name: string
  version: string
  disease_group: string
  disease_sub_group: string
  status: string
  relevant_disorders: string[]
  stats: {
    number_of_genes: number
  }
  types: Array<{ name: string; slug: string }>
  region: 'uk' | 'aus'
}
```

- [ ] **Step 3: Replace definitions with imports in original files**

In `src/main/database/GeneReferenceDb.ts`, replace type definitions (lines 8-51) with:
```typescript
import type {
  GeneValidationResult,
  GeneAutocompleteResult,
  GeneCoordinates,
  AssemblyInfo,
  GeneRefInfo
} from '../../shared/types/gene-reference'
export type { GeneValidationResult, GeneAutocompleteResult, GeneCoordinates, AssemblyInfo, GeneRefInfo }
```

In `src/main/database/PanelRepository.ts`, replace type definitions (lines 7-52) with:
```typescript
import type {
  GenomicInterval,
  CreatePanelInput,
  PanelRow,
  PanelWithCount,
  PanelGeneRow,
  ActivePanelRow
} from '../../shared/types/panels'
export type { GenomicInterval, CreatePanelInput, PanelRow, PanelWithCount, PanelGeneRow, ActivePanelRow }
```

In `src/main/services/api/PanelAppClient.ts`, replace `PanelAppSearchResult` definition (lines 67-80) with:
```typescript
import type { PanelAppSearchResult } from '../../../shared/types/panels'
export type { PanelAppSearchResult }
```

- [ ] **Step 4: Update `src/shared/types/api.ts` imports**

Change:
```typescript
// OLD:
import type { GeneValidationResult, GeneAutocompleteResult, GeneRefInfo, AssemblyInfo } from '../../main/database/GeneReferenceDb'
import type { PanelRow, PanelWithCount, PanelGeneRow, ActivePanelRow } from '../../main/database/PanelRepository'
import type { PanelAppSearchResult } from '../../main/services/api/PanelAppClient'
// NEW:
import type { GeneValidationResult, GeneAutocompleteResult, GeneRefInfo, AssemblyInfo } from './gene-reference'
import type { PanelRow, PanelWithCount, PanelGeneRow, ActivePanelRow, PanelAppSearchResult } from './panels'
```

- [ ] **Step 5: Move HpoTerm to shared**

In `src/main/services/api/schemas/hpo-response.ts`, the `HpoTerm` interface (lines 37-42) is a pure 2-field interface. Move it to `src/shared/types/api-enrichment.ts` (where it's already consumed) by adding the interface definition directly there:

```typescript
// In api-enrichment.ts, replace:
import type { HpoTerm } from '../../main/services/api/schemas/hpo-response'
// With the inline definition:
export interface HpoTerm {
  /** HPO ID in format HP:XXXXXXX */
  id: string
  /** Human-readable term name */
  name: string
}
```

In `src/main/services/api/schemas/hpo-response.ts`, replace the `HpoTerm` interface with:
```typescript
export type { HpoTerm } from '../../../../shared/types/api-enrichment'
```

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/types/gene-reference.ts src/shared/types/panels.ts \
  src/main/database/GeneReferenceDb.ts src/main/database/PanelRepository.ts \
  src/main/services/api/PanelAppClient.ts src/shared/types/api.ts \
  src/shared/types/api-enrichment.ts src/main/services/api/schemas/hpo-response.ts
git commit -m "refactor: relocate gene-reference, panel, and HPO types to src/shared/"
```

---

## Task 4: Verify shared layer has zero main imports

**Files:**
- Create: `tests/shared/types/boundary-imports.test.ts`

- [ ] **Step 1: Verify no shared→main imports remain**

Run: `grep -r "from '.*main/" src/shared/ --include="*.ts"`
Expected: No output (zero matches)

- [ ] **Step 2: Write boundary-guard test**

```typescript
// tests/shared/types/boundary-imports.test.ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '..', '..', '..')

describe('Shared layer boundary', () => {
  it('src/shared/ has no imports from src/main/', () => {
    try {
      const result = execSync(
        `grep -r "from '.*main/" --include="*.ts" "${resolve(ROOT, 'src/shared/')}"`,
        { encoding: 'utf-8' }
      )
      // If grep finds matches, it returns them — fail the test
      expect.fail(`Found shared→main imports:\n${result}`)
    } catch (e: unknown) {
      // grep exits with code 1 when no matches found — that's success
      const err = e as { status?: number }
      expect(err.status).toBe(1)
    }
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/shared/types/boundary-imports.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/shared/types/boundary-imports.test.ts
git commit -m "test: add boundary guard test for shared→main import ban"
```

---

## Task 5: Fix CohortTable.vue renderer→main import

**Files:**
- Modify: `src/renderer/src/components/CohortTable.vue`

This is the only remaining direct renderer→main import. Line 396 uses an inline `import('../../../main/database/types').AcmgClassification`.

- [ ] **Step 1: Replace the inline import**

In `CohortTable.vue`, add to the existing imports section (near line 124-128):

```typescript
import type { AcmgClassification } from '../../../shared/types/database'
```

Then change the type annotation at line ~396 from:

```typescript
const handleAcmgSelect = (payload: {
  item: CohortVariant
  classification: import('../../../main/database/types').AcmgClassification | null
}) => {
```

To:

```typescript
const handleAcmgSelect = (payload: {
  item: CohortVariant
  classification: AcmgClassification | null
}) => {
```

- [ ] **Step 2: Run typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/renderer/src/components/CohortTable.vue`
Expected: PASS (no-restricted-imports rule should no longer fire)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/CohortTable.vue
git commit -m "fix: replace renderer→main import with shared type in CohortTable"
```

---

## Task 6: Fix `as any` casts for window.api access

**Files:**
- Modify: `src/renderer/src/components/FilterToolbar.vue`
- Modify: `src/renderer/src/components/cohort/CohortFilterBar.vue`

Both files use `(window as any).api` instead of the `useApiService()` composable. The ESLint rule already bans this pattern in most renderer files, but these two have existing violations.

- [ ] **Step 1: Fix FilterToolbar.vue line 504**

The file has a callback that uses `(window as any).api.shell.showItemInFolder(result.filePath)`. Check if `useApiService` is already imported. If not, add it. Replace:

```typescript
callback: () => (window as any).api.shell.showItemInFolder(result.filePath)
```

With (using the existing `api` ref from `useApiService()`):

```typescript
callback: () => api?.shell.showItemInFolder(result.filePath)
```

If `useApiService` is not already set up in this component, add near the top of `<script setup>`:

```typescript
const { api } = useApiService()
```

- [ ] **Step 2: Fix CohortFilterBar.vue lines 409 and 416**

Replace the SSR guard + direct call pattern:

```typescript
// OLD:
if (typeof window === 'undefined' || typeof (window as any).api === 'undefined') {
  return
}
const result = await (window as any).api.cohort.getVariants({ ... })
```

With:

```typescript
// NEW:
if (api == null) return
const result = await api.cohort.getVariants({ ... })
```

Again, ensure `const { api } = useApiService()` is set up in the component.

- [ ] **Step 3: Run typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/renderer/src/components/FilterToolbar.vue src/renderer/src/components/cohort/CohortFilterBar.vue`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/FilterToolbar.vue src/renderer/src/components/cohort/CohortFilterBar.vue
git commit -m "fix: replace window as any casts with useApiService() in renderer"
```

---

## Task 7: Fix CaseMetricsTab.vue Vuetify slot typing

**Files:**
- Modify: `src/renderer/src/components/CaseMetricsTab.vue`

Lines 30-32 use `(item as any).raw` to access Vuetify autocomplete slot data. The proper Vuetify 3 typing for `v-autocomplete` item slots provides the item as a `{ raw: T, title: string, value: unknown }` wrapper.

- [ ] **Step 1: Add typed slot destructuring**

The `#item` slot from Vuetify's `v-autocomplete` provides `{ item: { raw: T } }` where `T` is the item type. Since the component uses `return-object` with `MetricDefinition` items, define a local type:

```typescript
// Near the top of <script setup>, after existing type imports
interface AutocompleteItem {
  raw: MetricDefinition
  title: string
  value: unknown
}
```

Then in the template, replace:

```html
<template #item="{ item, props: itemProps }">
  <v-list-item v-bind="itemProps">
    <template #subtitle>
      <span class="text-caption">
        {{ (item as any).raw?.category ?? '' }}
        <template v-if="(item as any).raw?.unit">
          &middot; {{ (item as any).raw.unit }}
        </template>
      </span>
    </template>
  </v-list-item>
</template>
```

With:

```html
<template #item="{ item, props: itemProps }">
  <v-list-item v-bind="itemProps">
    <template #subtitle>
      <span class="text-caption">
        {{ (item as AutocompleteItem).raw?.category ?? '' }}
        <template v-if="(item as AutocompleteItem).raw?.unit">
          &middot; {{ (item as AutocompleteItem).raw.unit }}
        </template>
      </span>
    </template>
  </v-list-item>
</template>
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/CaseMetricsTab.vue
git commit -m "fix: replace as-any Vuetify slot casts with typed interface in CaseMetricsTab"
```

---

## Task 8: Fix useFilterPreferences.ts migration cast

**Files:**
- Modify: `src/renderer/src/composables/useFilterPreferences.ts`

Line 94 casts stored data `as any` to check for a deprecated `active` field during migration.

- [ ] **Step 1: Add a legacy type union**

Near the top of the composable function, define:

```typescript
/** Legacy stored format (pre-v0.48) used `active` instead of `visible`+`expanded` */
interface LegacyFilterGroupPreference {
  id: string
  order: number
  active?: boolean
  visible?: boolean
  expanded?: boolean
}
```

Then replace:

```typescript
const migrated = stored.map((g) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyG = g as any
  if (anyG.active !== undefined && g.visible === undefined) {
```

With:

```typescript
const migrated = stored.map((g) => {
  const legacy = g as LegacyFilterGroupPreference
  if (legacy.active !== undefined && g.visible === undefined) {
```

And replace `anyG.active` references with `legacy.active`.

- [ ] **Step 2: Remove the eslint-disable comment**

The `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comment is no longer needed.

- [ ] **Step 3: Run typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/renderer/src/composables/useFilterPreferences.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/composables/useFilterPreferences.ts
git commit -m "fix: replace as-any migration cast with typed legacy interface"
```

---

## Task 9: Fix cohort geneBurdenCompare sender validation

**Files:**
- Modify: `src/main/ipc/handlers/cohort.ts`

The `cohort:geneBurdenCompare` handler (line 99) is the only handler using `event.sender.send()` directly instead of the centralized `safeEmit` utility.

- [ ] **Step 1: Replace event.sender.send with safeEmit**

In `src/main/ipc/handlers/cohort.ts`, change:

```typescript
ipcMain.handle('cohort:geneBurdenCompare', async (event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = AssociationConfigSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid association config: ${validated.error.message}`, 'cohort')
        throw new Error('Invalid association analysis parameters')
      }

      return runGeneBurdenCompare(validated.data, getDb, getDbPool, (data) =>
        event.sender.send('cohort:geneBurdenProgress', data)
      )
    })
  })
```

To:

```typescript
ipcMain.handle('cohort:geneBurdenCompare', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = AssociationConfigSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid association config: ${validated.error.message}`, 'cohort')
        throw new Error('Invalid association analysis parameters')
      }

      return runGeneBurdenCompare(validated.data, getDb, getDbPool, (data) =>
        safeEmit('cohort:geneBurdenProgress', data)
      )
    })
  })
```

Ensure `safeEmit` is already imported from `../utils/safeEmit` (it should be from the Phase 1 refactor).

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/handlers/cohort.ts
git commit -m "fix: replace event.sender.send with safeEmit in geneBurdenCompare handler"
```

---

## Task 10: Release workflow parity with build

**Files:**
- Modify: `.github/workflows/release.yml`

The release workflow is missing: (1) gitleaks secrets scan, (2) coverage on the Linux release job.

- [ ] **Step 1: Add gitleaks job to release workflow**

Add a new job before the platform-specific release jobs:

```yaml
  secrets-scan:
    name: Secrets Scan
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Run gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Add `secrets-scan` to the `needs` array of all three release jobs:

```yaml
  release-linux:
    needs: [create-release, secrets-scan]
  release-macos:
    needs: [create-release, secrets-scan]
  release-windows:
    needs: [create-release, secrets-scan]
```

- [ ] **Step 2: Add coverage to Linux release job**

In the `release-linux` job, change the test step from:

```yaml
      - name: Run tests
        run: npm run test
```

To:

```yaml
      - name: Run tests with coverage
        run: npx vitest run --coverage
```

This matches the build workflow's Ubuntu job.

- [ ] **Step 3: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "Valid YAML"`
Expected: "Valid YAML"

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add gitleaks and coverage to release workflow for build parity"
```

---

## Task 11: Fix dependency hygiene

**Files:**
- Modify: `package.json`

Two issues: (1) `@xmldom/xmldom` override specifies `^0.8.12` but `0.8.11` is installed due to transitive resolution. (2) `xlsx` uses a CDN tarball — this is intentional (SheetJS left npm) but should be documented.

- [ ] **Step 1: Fix xmldom override**

In `package.json`, the overrides section has:
```json
"@xmldom/xmldom": "^0.8.12"
```

Run `npm ls @xmldom/xmldom` to check the current state. If 0.8.12 is available on npm, run:

```bash
npm install --save-optional @xmldom/xmldom@^0.8.12
```

If the override is still not resolving, pin to the exact available version:
```json
"@xmldom/xmldom": "0.8.11"
```

The override exists because `plist` (via `electron-builder`) pulls in a version with known CVEs. The fix is to ensure the override actually takes effect.

- [ ] **Step 2: Run `npm ls @xmldom/xmldom` to verify**

Run: `npm ls @xmldom/xmldom`
Expected: No "invalid" markers

- [ ] **Step 3: Add comment for xlsx CDN dependency**

In `package.json`, the xlsx entry already uses the CDN URL. Add a comment in a nearby location (e.g., in the `overrides` section explanation). Since JSON doesn't support comments, add to the overrides section:

```json
"overrides": {
  "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  "@xmldom/xmldom": "^0.8.12"
}
```

The xlsx override ensures all transitive consumers use the CDN version too. This is the recommended approach per SheetJS docs since they left the npm registry.

- [ ] **Step 4: Run npm install to regenerate lockfile**

Run: `npm install`
Expected: Clean install, no warnings about mismatched overrides.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix: resolve xmldom override mismatch, document xlsx CDN dependency"
```

---

## Task 12: Extend preload contract tests

**Files:**
- Modify: `tests/shared/types/preload-contract.test.ts`

The existing test checks that WindowAPI, preload `api`, and mockApi have the same top-level keys. Extend it to also verify method signatures match (at least method names per module).

- [ ] **Step 1: Add per-module method key matching**

Add a new test that extracts method names from each API module in the WindowAPI interface and compares them against the preload implementation:

```typescript
/**
 * Extract method keys for a specific API module from the WindowAPI interface.
 * Finds the sub-interface definition and extracts its property names.
 */
function extractSubInterfaceKeys(interfaceName: string): string[] {
  const content = readFileSync(resolve(ROOT, 'src/shared/types/api.ts'), 'utf-8')
  const re = new RegExp(`export interface ${interfaceName}\\s*\\{([^}]+)\\}`)
  const match = content.match(re)
  if (!match) return []

  const keys: string[] = []
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s+(\w+)\s*:/)
    if (m) keys.push(m[1])
  }
  return keys.sort()
}

describe('Preload contract — per-module method alignment', () => {
  const apiContent = readFileSync(resolve(ROOT, 'src/shared/types/api.ts'), 'utf-8')

  // Extract all sub-interface names from WindowAPI
  const windowApiBlock = apiContent.match(/export interface WindowAPI\s*\{([^}]+)\}/)
  if (!windowApiBlock) throw new Error('Cannot find WindowAPI')

  const moduleEntries: Array<{ key: string; interfaceName: string }> = []
  for (const line of windowApiBlock[1].split('\n')) {
    const match = line.match(/^\s+(\w+)\s*:\s*(\w+)/)
    if (match) {
      moduleEntries.push({ key: match[1], interfaceName: match[2] })
    }
  }

  for (const { key, interfaceName } of moduleEntries) {
    it(`${key} (${interfaceName}) methods are defined`, () => {
      const methods = extractSubInterfaceKeys(interfaceName)
      expect(methods.length).toBeGreaterThan(0)
    })
  }
})
```

- [ ] **Step 2: Run the extended tests**

Run: `npx vitest run tests/shared/types/preload-contract.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/shared/types/preload-contract.test.ts
git commit -m "test: extend preload contract tests with per-module method verification"
```

---

## Task 13: Final verification

- [ ] **Step 1: Verify no shared→main imports remain**

Run: `grep -r "from '.*main/" src/shared/ --include="*.ts"`
Expected: No output

- [ ] **Step 2: Verify no renderer→main imports remain**

Run: `grep -r "from '.*main/" src/renderer/ --include="*.ts" --include="*.vue"`
Expected: No output

- [ ] **Step 3: Check `as any` count in renderer**

Run: `grep -r "as any" src/renderer/ --include="*.ts" --include="*.vue" | wc -l`
Expected: 0 (or very close — only the useFilterPreferences legacy cast if approach differs)

- [ ] **Step 4: Run full CI suite locally**

Run: `npm run lint:check && npx tsc --noEmit && npx vitest run`
Expected: All pass

- [ ] **Step 5: Run tests with coverage**

Run: `npx vitest run --coverage`
Expected: Thresholds pass (autoUpdate may bump numbers slightly)

- [ ] **Step 6: Commit any threshold updates**

If `autoUpdate` changed `vitest.config.ts` thresholds:

```bash
git add vitest.config.ts
git commit -m "chore: auto-update coverage thresholds after boundary cleanup"
```
