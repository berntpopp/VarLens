# Phase 3: Frontend Type Tabs + Cohort Build Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add variant type tabs (SNV/Indel | SV | CNV | STR) to case view, type-specific column sets, and genome build selector to cohort view.

**Architecture:** Extend existing CaseView with v-tabs (following CohortView's tab pattern). Add variant_type filter parameter to backend variant queries. Cohort view gets a genome_build dropdown that filters all queries.

**Tech Stack:** Vue 3 + Vuetify 3, TypeScript, Pinia, existing IPC variant query infrastructure.

**Depends on:** Phase 1-2 backend (already implemented on `feature/multi-variant-type-import` branch).

**Design Spec:** `.planning/specs/2026-04-09-multi-variant-type-import-design.md` — Sections 7.1, 7.2

---

## File Inventory

### New Files

| File | Responsibility |
|---|---|
| `src/renderer/src/components/variant-table/sv-columns.ts` | SV-specific column definitions |
| `src/renderer/src/components/variant-table/cnv-columns.ts` | CNV-specific column definitions |
| `src/renderer/src/components/variant-table/str-columns.ts` | STR-specific column definitions |

### Modified Files

| File | Change |
|---|---|
| `src/renderer/src/views/CaseView.vue` | Add v-tabs for variant types with badge counts |
| `src/renderer/src/components/VariantTable.vue` | Accept variant_type prop, use type-specific columns |
| `src/renderer/src/components/variant-table/columns.ts` | Export type-based column selector |
| `src/renderer/src/components/variant-table/useVariantData.ts` | Pass variant_type to IPC query |
| `src/main/ipc/handlers/variants-logic.ts` | Add variant_type to filter |
| `src/main/database/VariantFilterBuilder.ts` | Add variant_type WHERE clause |
| `src/main/database/VariantRepository.ts` | Add variant type count query |
| `src/renderer/src/components/CohortView.vue` | Add genome_build selector dropdown |
| `src/renderer/src/composables/useCohortData.ts` | Add genomeBuild ref, pass to IPC |
| `src/main/ipc/handlers/cohort-logic.ts` | Parameterize genome_build (remove hardcoded 'GRCh38') |
| `src/renderer/src/components/VariantDetailsPanel.vue` | Show SV/CNV/STR extension data |

---

## Task 1: Backend — Add variant_type to Variant Query Filter

**Files:**
- Modify: `src/main/database/VariantFilterBuilder.ts`
- Modify: `src/main/ipc/handlers/variants-logic.ts`
- Modify: `src/main/database/VariantRepository.ts`

- [ ] **Step 1: Read VariantFilterBuilder.ts and understand filter construction**

Read `src/main/database/VariantFilterBuilder.ts`. Find the `buildWhere()` or equivalent method that constructs the SQL WHERE clause from filter parameters. Understand the pattern for adding new filter conditions.

- [ ] **Step 2: Add variant_type filter to VariantFilterBuilder**

Add a `variant_type` field to the filter interface/type used by the builder. In the WHERE clause builder, add:
```sql
AND v.variant_type = @variant_type
```
Only when `variant_type` is provided (default to no filter = show all types for backward compatibility).

- [ ] **Step 3: Add variant_type to variants-logic.ts filter resolution**

In `src/main/ipc/handlers/variants-logic.ts`, the `buildVariantFilter()` function constructs the filter object. Pass `variant_type` from the IPC params through to the filter.

- [ ] **Step 4: Add variant type count query to VariantRepository**

Add a method to `VariantRepository`:
```typescript
getVariantTypeCounts(caseId: number): Record<string, number>
```
Query: `SELECT variant_type, COUNT(*) as count FROM variants WHERE case_id = ? GROUP BY variant_type`

Add IPC handler: `variants:typeCounts` channel.

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `npx vitest run tests/main/`
Expected: All pass (the new filter is optional, so existing queries are unchanged)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add variant_type filter to variant query pipeline"
```

---

## Task 2: Type-Specific Column Definitions

**Files:**
- Create: `src/renderer/src/components/variant-table/sv-columns.ts`
- Create: `src/renderer/src/components/variant-table/cnv-columns.ts`
- Create: `src/renderer/src/components/variant-table/str-columns.ts`
- Modify: `src/renderer/src/components/variant-table/columns.ts`

- [ ] **Step 1: Create SV column definitions**

```typescript
// src/renderer/src/components/variant-table/sv-columns.ts
import type { ColumnDef } from './columns'

export const svHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'End', key: 'end_pos', sortable: true, align: 'end' },
  { title: 'SV Type', key: 'sv_type', sortable: true },
  { title: 'Length', key: 'sv_length', sortable: true, align: 'end' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'QUAL', key: 'qual', sortable: true, align: 'end' },
  { title: 'Filter', key: 'filter', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
]
```

- [ ] **Step 2: Create CNV column definitions**

```typescript
// src/renderer/src/components/variant-table/cnv-columns.ts
import type { ColumnDef } from './columns'

export const cnvHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'End', key: 'end_pos', sortable: true, align: 'end' },
  { title: 'Type', key: 'sv_type', sortable: true },
  { title: 'Length', key: 'sv_length', sortable: true, align: 'end' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'CN', key: '_cnv_copy_number', sortable: true, align: 'end' },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'Filter', key: 'filter', sortable: true },
]
```

- [ ] **Step 3: Create STR column definitions**

```typescript
// src/renderer/src/components/variant-table/str-columns.ts
import type { ColumnDef } from './columns'

export const strHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Locus', key: '_str_repeat_id', sortable: true },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'Repeat Unit', key: '_str_repeat_unit', sortable: false },
  { title: 'Copies', key: '_str_alt_copies', sortable: false },
  { title: 'Status', key: '_str_status', sortable: true },
  { title: 'Disease', key: '_str_disease', sortable: true },
  { title: 'Normal Max', key: '_str_normal_max', sortable: true, align: 'end' },
  { title: 'Pathologic Min', key: '_str_pathologic_min', sortable: true, align: 'end' },
  { title: 'Inheritance', key: '_str_inheritance_mode', sortable: true },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'Filter', key: 'filter', sortable: true },
]
```

- [ ] **Step 4: Add type-based column selector to columns.ts**

In `src/renderer/src/components/variant-table/columns.ts`, add:
```typescript
import { svHeaders } from './sv-columns'
import { cnvHeaders } from './cnv-columns'
import { strHeaders } from './str-columns'

export function getHeadersForType(variantType: string): ColumnDef[] {
  switch (variantType) {
    case 'sv': return svHeaders
    case 'cnv': return cnvHeaders
    case 'str': return strHeaders
    default: return baseHeaders  // snv + indel
  }
}
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add type-specific column definitions for SV/CNV/STR variant tables"
```

---

## Task 3: Variant Type Tabs in CaseView

**Files:**
- Modify: `src/renderer/src/views/CaseView.vue`
- Modify: `src/renderer/src/components/VariantTable.vue`
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts`

- [ ] **Step 1: Add variant type tabs to CaseView**

Read `src/renderer/src/views/CaseView.vue`. Add v-tabs above the VariantTable following the CohortView pattern (`src/renderer/src/components/CohortView.vue` lines 3-26).

Add a reactive `selectedVariantType` ref defaulting to `'snv'`. Fetch variant type counts via the new IPC channel `variants:typeCounts` when case changes. Display tabs with badge counts:

```vue
<v-tabs v-model="selectedVariantType" density="compact" color="primary">
  <v-tab value="snv">
    SNV/Indel
    <v-badge v-if="typeCounts.snv" :content="typeCounts.snv + (typeCounts.indel || 0)" inline />
  </v-tab>
  <v-tab v-if="typeCounts.sv" value="sv">
    SV <v-badge :content="typeCounts.sv" inline />
  </v-tab>
  <v-tab v-if="typeCounts.cnv" value="cnv">
    CNV <v-badge :content="typeCounts.cnv" inline />
  </v-tab>
  <v-tab v-if="typeCounts.str" value="str">
    STR <v-badge :content="typeCounts.str" inline />
  </v-tab>
</v-tabs>
```

Only show SV/CNV/STR tabs when the case has variants of that type. SNV/Indel tab always visible.

Pass `selectedVariantType` to VariantTable as a prop.

- [ ] **Step 2: Accept variant_type prop in VariantTable**

In `src/renderer/src/components/VariantTable.vue`, add prop:
```typescript
variantType: { type: String, default: 'snv' }
```

Use `getHeadersForType(props.variantType)` instead of the static `baseHeaders` to determine which columns to display.

Watch `variantType` and reload data when it changes.

- [ ] **Step 3: Pass variant_type through useVariantData**

In `src/renderer/src/components/variant-table/useVariantData.ts`, add `variant_type` to the filter object passed to `api.variants.query()`. When variant_type is 'snv', include both 'snv' and 'indel'.

- [ ] **Step 4: Handle extension fields in cell rendering**

For SV/CNV/STR columns that reference extension table data (like `_cnv_copy_number`, `_str_repeat_id`), the backend query needs to LEFT JOIN the extension table. Update `VariantRepository.queryVariants()` to JOIN the appropriate extension table when variant_type is 'sv', 'cnv', or 'str'.

Return extension fields as flattened properties on the variant row (e.g., `_sv_support`, `_cnv_copy_number`, `_str_disease`).

- [ ] **Step 5: Test tab switching in browser**

Build and run: `make dev`
- Verify SNV/Indel tab shows existing variants
- Import a synthetic SV VCF and verify the SV tab appears with correct count
- Switch between tabs and verify columns change

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add variant type tabs to case view with type-specific columns"
```

---

## Task 4: SV/CNV/STR Detail Sections in VariantDetailsPanel

**Files:**
- Modify: `src/renderer/src/components/VariantDetailsPanel.vue`

- [ ] **Step 1: Add conditional detail sections based on variant_type**

Read `src/renderer/src/components/VariantDetailsPanel.vue`. After the existing sections (TranscriptSection, AnnotationScoresSection), add conditional sections:

For SV variants (when `variant?.variant_type === 'sv'`):
- SV Type + Length
- Support count (DR/DV or PE/SR)
- VAF
- Precise/Imprecise
- Strand, CIPOS/CIEND
- Coverage

For CNV variants (when `variant?.variant_type === 'cnv'`):
- Copy Number
- CNV Type (DEL/DUP)
- Size
- Homozygosity

For STR variants (when `variant?.variant_type === 'str'`):
- Repeat Locus (REPID)
- Repeat Unit + Display
- Reference/Alt Copies
- Expansion Status (normal/pre_mutation/full_mutation) with color coding
- Pathologic thresholds
- Associated Disease
- Inheritance Mode
- Support Type + Coverage

Use simple `v-list` / `v-list-item` pattern matching existing sections. Color-code STR status: green=normal, orange=pre_mutation, red=full_mutation.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: add SV/CNV/STR detail sections to variant details panel"
```

---

## Task 5: Cohort View — Genome Build Selector

**Files:**
- Modify: `src/renderer/src/components/CohortView.vue`
- Modify: `src/renderer/src/composables/useCohortData.ts`
- Modify: `src/main/ipc/handlers/cohort-logic.ts`
- Modify: `src/main/database/cohort.ts`

- [ ] **Step 1: Add genome build IPC query**

Add a new IPC handler `cohort:availableBuilds` that returns:
```typescript
{ build: string; caseCount: number }[]
```
Query: `SELECT genome_build, COUNT(*) as count FROM cases GROUP BY genome_build`

- [ ] **Step 2: Add genomeBuild ref to useCohortData**

In `src/renderer/src/composables/useCohortData.ts`:
- Add `genomeBuild` ref defaulting to 'GRCh38'
- Add `availableBuilds` ref
- Fetch available builds on mount
- Default to build with most cases
- Include `genome_build` in all IPC query params

- [ ] **Step 3: Remove hardcoded 'GRCh38' from cohort-logic.ts**

In `src/main/ipc/handlers/cohort-logic.ts`, find line 94:
```typescript
cohortParams.genome_build = 'GRCh38'
```
Replace with:
```typescript
cohortParams.genome_build = params.genome_build ?? 'GRCh38'
```

- [ ] **Step 4: Add build selector UI to CohortView**

In `src/renderer/src/components/CohortView.vue`, add a `v-select` dropdown next to the existing tabs:

```vue
<v-select
  v-model="genomeBuild"
  :items="availableBuilds"
  item-title="label"
  item-value="build"
  density="compact"
  variant="outlined"
  hide-details
  style="max-width: 180px"
/>
```

Where `label` formats as `"GRCh38 (142 cases)"`.

Switching build triggers refetch of cohort data (watch genomeBuild → re-query).

- [ ] **Step 5: Add variant_type selector to CohortView**

Add a second dropdown for variant type, similar pattern:
```vue
<v-select
  v-model="selectedVariantType"
  :items="variantTypeOptions"
  density="compact"
  variant="outlined"
  hide-details
  style="max-width: 160px"
/>
```

Pass both `genome_build` and `variant_type` to all cohort queries.

- [ ] **Step 6: Test in browser**

Build and run: `make dev`
- Verify genome build selector shows available builds with case counts
- Verify switching builds filters cohort data
- Verify variant type selector filters by type

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: add genome build and variant type selectors to cohort view"
```

---

## Task 6: Extension Table JOINs for Type-Specific Queries

**Files:**
- Modify: `src/main/database/VariantRepository.ts`
- Modify: `src/main/workers/db-worker-dispatch.ts` (if queries dispatched to worker)

- [ ] **Step 1: Add conditional LEFT JOIN for extension data**

When `variant_type` is 'sv', 'cnv', or 'str', the variant query should LEFT JOIN the corresponding extension table and return flattened fields.

In `VariantRepository.queryVariants()`, after building the base query, conditionally add:

For `sv`:
```sql
LEFT JOIN variant_sv sv ON sv.variant_id = v.id
```
Select: `sv.support AS _sv_support, sv.dr AS _sv_dr, sv.dv AS _sv_dv, sv.vaf AS _sv_vaf, sv.sv_is_precise AS _sv_is_precise, sv.strand AS _sv_strand`

For `cnv`:
```sql
LEFT JOIN variant_cnv cnv ON cnv.variant_id = v.id
```
Select: `cnv.copy_number AS _cnv_copy_number, cnv.homozygosity_ref AS _cnv_ho_ref, cnv.homozygosity_alt AS _cnv_ho_alt`

For `str`:
```sql
LEFT JOIN variant_str str ON str.variant_id = v.id
```
Select: `str.repeat_id AS _str_repeat_id, str.repeat_unit AS _str_repeat_unit, str.alt_copies AS _str_alt_copies, str.str_status AS _str_status, str.disease AS _str_disease, str.normal_max AS _str_normal_max, str.pathologic_min AS _str_pathologic_min, str.inheritance_mode AS _str_inheritance_mode`

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/main/`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add extension table LEFT JOINs for type-specific variant queries"
```

---

## Verification

After all tasks:
1. `make lint` — clean
2. `make typecheck` — clean
3. `make test` — all pass
4. `make dev` — app launches, tabs work, cohort selectors work
5. Import synthetic SV/CNV/STR VCFs from test data → verify tabs and columns
