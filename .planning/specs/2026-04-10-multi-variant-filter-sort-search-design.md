# Multi-variant-type filter, sort, and search — design

**Status:** Draft — revision 3, awaiting review
**Date:** 2026-04-10
**Author:** Claude (with Bernt)
**Branch target:** `feature/multi-variant-type-import` (inside PR #147)
**Related:** PR #147 (multi-variant-type import), topic #3 canonical columns (future), topic #4 unified shortlist (future)

**Revision history:**
- r1: introduced a parallel `{ op: 'range' | ... }` filter DSL, claimed Path 3 extension support was "automatic" from the refactor, proposed an ID-prefetch search pattern, used placeholder column names. Rejected.
- r2: reused existing `ColumnFilter` contract, extended `VariantFilters` type explicitly, kept search at query-build level, pinned real v25 schema columns, dropped CNV FTS5 table. Flagged three remaining issues in review.
- r3 (this): acknowledges that `emitFts5Search` is NOT reusable across UNION arms and requires a targeted refactor; corrects the Path 3 renderer caller chain to include the `AssociationConfigPanel.vue` migration to shared `FilterState`; corrects the Path 3 off-main-thread handoff description (filters flow via `association:build` DbPool dispatch, NOT via the statistical `WorkerRequest` which only carries pre-built `GeneContingencyData[]`).

## Goal

Enable filter, sort, and (where applicable) search on the relevant v25 extension-table columns across **all three** variant-query paths — single-case variant view, cohort cross-case variant listing, and cohort gene-burden analysis — reusing the existing `ColumnFilter` contract, without schema churn to `cohort_variant_summary`, with an architecture that stays extensible as new variant sources are ingested (DRAGEN somatic, Spectre, etc.) and accommodates the canonical-column refactor (topic #3) without a second rewrite.

## The three query paths

| Path | Backend module | Source SQL | Filter contract today | Search today | Output granularity |
|---|---|---|---|---|---|
| **1. Single-case variant view** | `VariantFilterBuilder` (+ `VariantSearchService.applySearchFilter` composed in) | `FROM variants` + optional extension LEFT JOINs | `FilterIpcParams` with `column_filters: ColumnFiltersParam` | Composed Kysely clauses via `applySingleSearchToken` / `applySearchFilter`, which internally call `emitFts5Search` for boolean AST (emitter produces row predicates tied to `variants_fts` + base-table LIKE for HGVS) | per-variant rows for one case |
| **2. Cohort cross-case variant listing** | `cohort.ts::CohortSearch.buildWhereClause` | `FROM cohort_variant_summary cvs` (no extension columns materialized) | `CohortSearchParams` with `column_filters: ColumnFiltersParam` (already uses the existing shape) | LIKE-based via `buildSingleTermCondition` / `buildBooleanSearchCondition` | per-variant aggregate across all cases |
| **3. Burden analysis** | `AssociationDataBuilder` + `AssociationEngine` (via `association:build` DbPool dispatch) | `FROM variants` + hand-rolled WHERE (4 filters) | `VariantFilters` in `statistics/types.ts:22-28` — ONLY 4 fields, **no `column_filters` field**. Renderer (`AssociationConfigPanel.vue:259-276`) emits a bespoke filters object independently of `FilterState`. | **none** (statistical test) | per-gene contingency rows |

**Cohort parity across all three paths** is mandatory per project rule (`feedback_cohort_parity.md`). This spec delivers it by converging all three paths on a shared `variant-where-builder` for base filter translation, extension helpers for WHERE composition, and the same `ColumnFilter` contract from `src/shared/types/column-filters.ts`.

## Architecture summary

A new declarative `VARIANT_EXTENSION_REGISTRY` becomes the single source of truth for every extension table — its real v25 schema, which columns are text-searchable, its join alias, and its discriminator value. Six consumers derive from the registry: the shared filter-to-SQL base translator, the per-path extension filter emitters, the migration generator, the FTS trigger manager, the column-metadata query path, and the renderer column definitions. Base filter translation is extracted into a shared `variant-where-builder.ts` module consumed by all three paths. Extension filter translation has two modes: **direct JOIN** for paths that query `variants` (single-case and burden), and **EXISTS subquery** for paths that query `cohort_variant_summary` (cohort listing). Both modes use the existing `ColumnFilter = { operator, value, includeEmpty? }` shape from `src/shared/types/column-filters.ts` — no parallel filter DSL. `FilterState` gains a `columnFilters: ColumnFiltersParam` field alongside existing typed fields. `VariantFilters` in `statistics/types.ts` is explicitly extended with `column_filters?: ColumnFiltersParam` plus the base fields already exposed to the other two paths (`clinvars`, `funcs`, `acmg_classifications`, `max_internal_af`). Two new FTS5 virtual tables (`variant_sv_fts`, `variant_str_fts`) ship in migration v26 — CNV is excluded because `variant_cnv` has zero text columns.

**Path 1 search requires a targeted emitter refactor.** The current `fts5-search-emitter.ts` produces full row predicates tied to `variants_fts` and HGVS-fallback base-table LIKE clauses at the same level. These cannot be replayed across UNION arms without rewriting. This spec replaces `emitFts5Search` with a new `emitBooleanSearchClauses(ast, ftsTables)` that returns a structured walk of the AST: each FTS term leaf expands into a UNION across all present FTS tables; each HGVS term leaf emits the base-table LIKE it emits today; AND/OR/NOT combinators are preserved at the outer level. `applySearchFilter` composes the result into the Kysely query. No ID prefetch, no parameter duplication hacks — the new emitter knows about the UNION shape and emits it directly.

**Path 3 requires both a contract extension AND a renderer refactor.** The `VariantFilters` type extension, IPC schema update, and `AssociationDataBuilder` refactor cover the backend. The renderer side is NOT a one-line change: `AssociationConfigPanel.vue` currently emits a bespoke filters object with only 4 fields and does not use `FilterState` or `buildIpcParams`. Shipping burden-analysis parity with the case and cohort views requires migrating the panel to consume the shared `useFilters()` composable, wire `columnFilters` through the emit payload, and mount the `ExtensionColumnFilters` + `FilterTypeNarrowingChip` components the other two views use.

**Path 3 off-main-thread handoff.** The `association:build` DbPool dispatch (`AssociationEngine.ts:47-50`) already passes `filters` as `params[2]`; once `VariantFilters` is extended, the dispatch automatically carries the new fields because it's typed. The `db-worker-dispatch.ts:258-266` handler casts `params[2] as VariantFilters` and calls `AssociationDataBuilder.build(...)`. No explicit change to the DbPool dispatch or handler is required. Critically, the statistical `WorkerRequest` type (`statistics/types.ts:94-99`) carries only `{ type: 'run', genes: GeneContingencyData[], weight_scheme }` — it is NOT in the filter caller chain and is NOT touched by this spec.

The renderer gains lazy per-column metadata loading with Pinia session caching, a type-narrowing chip, and auto-hide for filter sections whose variant type is absent.

## Tech stack

- **Database:** better-sqlite3-multiple-ciphers with SQLite 3.46+ (FTS5 external-content mode)
- **Query layer:** Kysely typed query builder over better-sqlite3 (for Path 1)
- **Backend:** TypeScript, main process module pattern
- **IPC:** Electron typed context bridge via preload + Zod-validated schemas in `src/shared/types/ipc-schemas.ts`
- **Renderer:** Vue 3 Composition API, Pinia stores, Vuetify 3 components
- **Testing:** Vitest for unit/integration, Playwright `_electron` for E2E

---

## Problem statement

PR #147 introduced multi-variant-type import (SNV, indel, SV, CNV, STR) and added extension tables `variant_sv`, `variant_cnv`, `variant_str`. Despite this structural work, filter, sort, and search cannot reach the extension tables on any of the three query paths:

1. **Path 1 (single-case) filter gap.** `VariantFilterBuilder.build()` LEFT-JOINs extension tables for SELECT but never emits WHERE clauses against them.
2. **Path 1 (single-case) sort gap.** `SORTABLE_COLUMNS` is variants-only because `getColumnMeta` aggregate queries would break on dotted keys. Extension columns are `sortable: false` in renderer.
3. **Path 1 (single-case) search gap.** `variants_fts` indexes only 3 base-table text columns. Extension tables have zero FTS coverage.
4. **Path 1 (single-case) search-emitter gap.** Even if we ADD extension FTS tables, the current `emitFts5Search` encodes the shape `id IN (SELECT rowid FROM variants_fts …)` directly into its output. It also mixes in base-table LIKE predicates for HGVS tokens. The emitter is not reusable as "a MATCH expression" — it's already a full WHERE fragment targeted at `variants_fts`. Adding extension search requires refactoring the emitter into a shape-neutral form that a composer can expand across multiple FTS tables while keeping HGVS LIKE at the outer level.
5. **Path 2 (cohort listing) filter gap.** `cohort_variant_summary` has no extension columns. `CohortSearch.buildWhereClause` already speaks `ColumnFiltersParam` for cvs-native columns but has no mechanism to reach extension fields.
6. **Path 3 (burden) filter gap — backend contract.** `AssociationDataBuilder` hand-rolls 4 filter branches. Its input type `VariantFilters` has only those 4 fields. Extension filter support requires extending the type, the IPC schema, and the builder.
7. **Path 3 (burden) filter gap — renderer.** `AssociationConfigPanel.vue` does not use `FilterState` or `buildIpcParams` at all. It has its own local refs, its own preset logic, and its own inline filter emit shape with only the 4 original fields. Path 3 renderer parity is NOT a one-line change — it's a real UI refactor.
8. **Triple duplication.** Base filter translation lives in three files with three slightly different implementations. Drift is inevitable.
9. **Extensibility debt.** Knowledge about extension tables is starting to leak into multiple files.

## Non-goals

- **Canonical column rename** (topic #3) — deferred.
- **Unified cross-type shortlist / ranking** (topic #4) — deferred.
- **Phenotype-driven ranker** — deferred.
- **Cross-type OR filter expressions** — flat AND with warning chip in v1.
- **Down-migration for v26** — VarLens has no down-migration policy.
- **`AssociationEngine` statistical logic changes** — only data retrieval path of `AssociationDataBuilder` changes.
- **JSON import mapping changes** — out of scope.
- **Adding extension columns to `cohort_variant_summary`** — Path 2 uses EXISTS subqueries.
- **Cohort variant listing FTS5 search for extension text columns** — Path 2 keeps LIKE-based search.
- **Extension column sorting in Path 2 (cohort listing)** — aggregate-function choice deferred.
- **A new parallel filter DSL.** Existing `ColumnFilter = { operator, value, includeEmpty? }` shape is the single contract.
- **FTS5 virtual table for `variant_cnv`.** Zero text columns in variant_cnv.
- **Changes to `WorkerRequest` or the statistical `WorkerPool`.** Filters are consumed before the statistical worker pool runs; `WorkerRequest` carries pre-built `GeneContingencyData[]` and is outside the filter flow.
- **Reusing `emitFts5Search` verbatim across UNION arms.** The current emitter is not shape-neutral. This spec replaces it with a new emitter that is.

## Current state (verified against codebase)

### Shared filter contract — `src/shared/types/column-filters.ts`

```typescript
export type ColumnFilterOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'like' | 'in'

export interface ColumnFilter {
  operator: ColumnFilterOperator
  value: string | number | string[]
  /** Whether to include NULL/empty values (default: true for range operators) */
  includeEmpty?: boolean
}

export type ColumnFiltersParam = Record<string, ColumnFilter>

export interface ColumnFilterMeta {
  key: string
  dataType: 'numeric' | 'text'
  distinctCount: number
  distinctValues?: string[]
  min?: number
  max?: number
}
```

Validated at the IPC boundary via Zod in `src/shared/types/ipc-schemas.ts:52`. Consumed by `VariantFilterBuilder` (Path 1) and `cohort.ts::CohortSearch` (Path 2). Path 3 does not use it yet.

### Path 1 — VariantFilterBuilder + VariantSearchService + emitter

`src/main/database/VariantSearchService.ts:27-63`:

```typescript
applySearchFilter(query: VariantQueryBuilder, searchQuery: string): VariantQueryBuilder {
  const term = searchQuery.trim()
  const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)
  if (!hasBooleanOps) return this.applySingleSearchToken(query, term)
  const tokens = tokenize(term)
  if (tokens.length === 0) return query
  let ast
  try { ast = parse(tokens) } catch (e) { /* fallback */ }
  const { sql: boolExpr, params } = emitFts5Search(ast)
  // ... composes boolExpr into query.where(sql.raw(...))
  return query.where(rawExpr)
}

applySingleSearchToken(query, token) {
  if (/^[cp]\./.test(token)) {
    return query.where(({or, eb}) => or([eb('cdna', 'like', `%${token}%`), eb('aa_change', 'like', `%${token}%`)]))
  }
  const ftsQuery = `"${token.replace(/"/g, '""')}"*`
  return query.where(sql<boolean>`id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ${ftsQuery})`)
}
```

`src/main/database/search/fts5-search-emitter.ts` (full source, 42 lines):

```typescript
export function emitFts5Search(ast: AstNode): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = []
  function emit(node: AstNode): string {
    switch (node.type) {
      case 'term': return emitTerm(node.value, params)
      case 'and':  return `(${emit(node.left)} AND ${emit(node.right)})`
      case 'or':   return `(${emit(node.left)} OR ${emit(node.right)})`
      case 'not':  return `(NOT (${emit(node.operand)}))`
    }
  }
  return { sql: emit(ast), params }
}

function emitTerm(term: string, params: (string | number)[]): string {
  if (/^[cp]\./.test(term)) {
    params.push(`%${term}%`, `%${term}%`)
    return '(cdna LIKE ? OR aa_change LIKE ?)'
  }
  const ftsQuery = `"${term.replace(/"/g, '""')}"*`
  params.push(ftsQuery)
  return 'id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)'
}
```

**Two critical observations:**
1. FTS term leaves emit full row predicates hardcoded to `variants_fts`. Not a MATCH expression — a WHERE fragment.
2. HGVS term leaves emit base-table LIKE predicates that have nothing to do with FTS5. These don't belong inside a UNION of FTS tables; they belong as outer WHERE clauses.

### Path 2 — CohortSearch

- `cohort.ts::CohortSearch.buildWhereClause` (lines 87-270+) builds WHERE for `cohort_variant_summary cvs`
- Already handles `ColumnFiltersParam` at lines 208-235 for cvs-native columns
- Already handles `variant_type` narrowing (lines 189-196) with SNV/indel collapse
- Search is LIKE-based via `buildSingleTermCondition` / `buildBooleanSearchCondition`

### Path 3 — backend

`src/main/statistics/types.ts:22-28`:

```typescript
export interface VariantFilters {
  gnomad_af_max?: number
  cadd_min?: number
  consequences?: string[]
  gene_list?: string[]
}
```

`src/main/statistics/types.ts:94-99` (for reference — the statistical worker request, NOT part of the filter chain):

```typescript
export interface WorkerRequest {
  type: 'run'
  genes: GeneContingencyData[]
  weight_scheme: WeightScheme
}
```

`src/main/statistics/AssociationEngine.ts:39-54`:

```typescript
async run(config: AssociationConfig): Promise<AssociationResults> {
  // ... 
  let genes: GeneContingencyData[]
  if (this.dbPool) {
    genes = await this.dbPool.run<GeneContingencyData[]>({
      type: 'association:build',
      params: [config.groupA_ids, config.groupB_ids, config.filters, config.covariates]
    })
  } else {
    const builder = new AssociationDataBuilder(this.db)
    genes = builder.build(config.groupA_ids, config.groupB_ids, config.filters, config.covariates)
  }
  // ... later: this.pool.run(genes, config.weight_scheme, this.onProgress)
}
```

`src/main/workers/db-worker-dispatch.ts:258-266`:

```typescript
case 'association:build': {
  const builder = new AssociationDataBuilder(db)
  return builder.build(
    params[0] as number[],
    params[1] as number[],
    params[2] as VariantFilters,   // ← the filters cast
    params[3] as string[]
  )
}
```

**Filter flow:** Renderer → IPC `statistics:run` → `AssociationEngine.run(config)` → `dbPool.run({ type: 'association:build', params: [..., filters, ...] })` → `db-worker-dispatch` → `AssociationDataBuilder.build(..., filters, ...)`. Then `AssociationDataBuilder` returns `GeneContingencyData[]` to the main thread, and the main thread passes it to the statistical `WorkerPool.run(genes, ...)`. At that handoff, filters are already applied.

**What this means for commit scope:**
- Extending `VariantFilters` → the `association:build` dispatch automatically picks up the new fields (it passes filters as `params[2]` and the worker dispatch re-casts the same type)
- `WorkerRequest` / statistical `WorkerPool` → unchanged
- `AssociationConfig` (`statistics/types.ts:12`) has `filters: VariantFilters` → automatically carries the extension

### Path 3 — renderer

`src/renderer/src/components/association/AssociationConfigPanel.vue:259-276`:

```typescript
const emit = defineEmits<{
  run: [config: {
    groupA_ids: number[]
    groupB_ids: number[]
    primary_test: string
    weight_scheme: string
    covariates: string[]
    filters: {
      gnomad_af_max?: number
      cadd_min?: number
      consequences?: string[]
      gene_list?: string[]
    }
    max_threads: number
  }]
}>()
```

Local refs at lines 279-287: `groupAIds`, `groupBIds`, `primaryTest`, `weightScheme`, `selectedCovariates`, `gnomadAfMax`, `caddMin`, `selectedConsequences`, `geneListText`. Does **not** import `useFilters`, does **not** use `FilterState`, does **not** call `buildIpcParams`. The presets (impact, AF) are local to this panel and parallel the ones in `useFilters.ts` but are not shared.

**Consequence:** shipping Path 3 renderer parity requires a meaningful refactor of `AssociationConfigPanel.vue` — not a one-line change. See §13g below.

### v25 extension table schemas (verified from `migrations.ts:1431-1473`)

**`variant_sv`** (17 columns):

| Column | Type | Notes |
|---|---|---|
| `variant_id` | INTEGER PK | FK to variants.id |
| `sv_is_precise` | INTEGER | 0/1 |
| `cipos_left`, `cipos_right` | INTEGER | CI around POS |
| `ciend_left`, `ciend_right` | INTEGER | CI around END |
| `support` | INTEGER | Total supporting reads |
| `coverage` | TEXT | Caller-specific string |
| `strand` | TEXT | `+`/`-`/`.` |
| `stdev_len`, `stdev_pos` | REAL | Quality metrics |
| `vaf` | REAL | Variant allele frequency |
| `dr`, `dv` | INTEGER | Ref/variant reads (Sniffles) |
| `pe_support`, `sr_support` | INTEGER | Paired-end + split-read support |
| `event_id`, `mate_id` | TEXT | Breakend linking |

**`variant_cnv`** (6 columns, all numeric — **no FTS**):

| Column | Type | Notes |
|---|---|---|
| `variant_id` | INTEGER PK | FK to variants.id |
| `copy_number` | INTEGER | Primary metric |
| `copy_number_quality` | INTEGER | Quality |
| `homozygosity_ref`, `homozygosity_alt` | REAL | Homozygosity ratios |
| `sm` | REAL | Segment mean (Spectre) |
| `bin_count` | INTEGER | Bin count |

**`variant_str`** (17 columns):

| Column | Type | Notes |
|---|---|---|
| `variant_id` | INTEGER PK | FK to variants.id |
| `repeat_id` | TEXT | Locus identifier |
| `variant_catalog_id` | TEXT | ExpansionHunter catalog ID |
| `repeat_unit` | TEXT | e.g. "CAG" |
| `display_repeat_unit` | TEXT | Normalized |
| `ref_copies` | REAL | Reference copies |
| `alt_copies` | TEXT | Biallelic "10/12" — not numerically sortable |
| `repeat_length` | INTEGER | Total length |
| `str_status` | TEXT | "normal"/"premutation"/"full_mutation" |
| `normal_max`, `pathologic_min` | INTEGER | Reference thresholds |
| `disease` | TEXT | Disease association |
| `inheritance_mode` | TEXT | MOI |
| `source_display` | TEXT | Source DB label |
| `rank_score` | TEXT | Caller-specific label, TEXT despite name |
| `locus_coverage` | REAL | Coverage |
| `support_type` | TEXT | Support label |
| `confidence_interval` | TEXT | CI as string |

### FTS5 infrastructure

`variants_fts` external-content FTS5 over `variants` indexing `gene_symbol`, `consequence`, `omim_mim_number`. Triggers `variants_ai`, `variants_au`, `variants_ad`. `VariantRepository.beginBulkInsert` and `worker-db.ts` each have their own teardown/restore logic.

### Extension indexes

- `idx_variants_type_case` — `migrations.ts:1426`
- `idx_variants_coord_case` — `migrations.ts:1292`
- `idx_cnv_copy_number` — `migrations.ts:1457`
- `idx_str_repeat_id`, `idx_str_disease` — `migrations.ts:1474-1475`

### Renderer filter state

`src/shared/types/filters.ts` exposes shared `FilterState` consumed by `useFilters.ts`, `CohortTable.vue`, `CohortFilterBar.vue`, `FilterToolbar.vue`. 8 seeded presets use this shape. **`AssociationConfigPanel.vue` does NOT consume `FilterState` today** — this is the gap §13g addresses.

---

## Design

### 1. Single source of truth: `VARIANT_EXTENSION_REGISTRY`

New file: `src/main/database/variant-extension-registry.ts` (~180 lines, pure module). Uses REAL v25 column names.

```typescript
import type { ColumnFilter, ColumnFiltersParam } from '../../shared/types/column-filters'

export type FilterKind = 'number' | 'text' | 'enum'

export interface ExtensionColumnDef {
  kind: FilterKind
  label?: string
  fts: boolean
  sortable: boolean
}

export interface VariantExtensionDef {
  table: string
  variantTypeValue: 'sv' | 'cnv' | 'str'
  joinAlias: string
  variantIdColumn: 'variant_id'
  hasFts: boolean
  columns: Record<string, ExtensionColumnDef>
}

export const VARIANT_EXTENSION_REGISTRY = {
  sv: {
    table: 'variant_sv',
    variantTypeValue: 'sv',
    joinAlias: 'sv',
    variantIdColumn: 'variant_id',
    hasFts: true,
    columns: {
      sv_is_precise: { kind: 'enum',   fts: false, sortable: true,  label: 'Precise SV' },
      support:       { kind: 'number', fts: false, sortable: true,  label: 'Total support' },
      pe_support:    { kind: 'number', fts: false, sortable: true,  label: 'Paired-end support' },
      sr_support:    { kind: 'number', fts: false, sortable: true,  label: 'Split-read support' },
      dr:            { kind: 'number', fts: false, sortable: true,  label: 'Ref depth' },
      dv:            { kind: 'number', fts: false, sortable: true,  label: 'Alt depth' },
      vaf:           { kind: 'number', fts: false, sortable: true,  label: 'VAF' },
      strand:        { kind: 'enum',   fts: false, sortable: true,  label: 'Strand' },
      coverage:      { kind: 'text',   fts: false, sortable: false, label: 'Coverage' },
      cipos_left:    { kind: 'number', fts: false, sortable: false, label: 'CIPOS left' },
      cipos_right:   { kind: 'number', fts: false, sortable: false, label: 'CIPOS right' },
      ciend_left:    { kind: 'number', fts: false, sortable: false, label: 'CIEND left' },
      ciend_right:   { kind: 'number', fts: false, sortable: false, label: 'CIEND right' },
      stdev_len:     { kind: 'number', fts: false, sortable: false, label: 'Stdev length' },
      stdev_pos:     { kind: 'number', fts: false, sortable: false, label: 'Stdev pos' },
      event_id:      { kind: 'text',   fts: true,  sortable: false, label: 'Event ID' },
      mate_id:       { kind: 'text',   fts: true,  sortable: false, label: 'Mate ID' }
    }
  },
  cnv: {
    table: 'variant_cnv',
    variantTypeValue: 'cnv',
    joinAlias: 'cnv',
    variantIdColumn: 'variant_id',
    hasFts: false,  // variant_cnv has zero text columns
    columns: {
      copy_number:         { kind: 'number', fts: false, sortable: true, label: 'Copy number' },
      copy_number_quality: { kind: 'number', fts: false, sortable: true, label: 'CN quality' },
      homozygosity_ref:    { kind: 'number', fts: false, sortable: true, label: 'Homozygosity ref' },
      homozygosity_alt:    { kind: 'number', fts: false, sortable: true, label: 'Homozygosity alt' },
      sm:                  { kind: 'number', fts: false, sortable: true, label: 'Segment mean' },
      bin_count:           { kind: 'number', fts: false, sortable: true, label: 'Bin count' }
    }
  },
  str: {
    table: 'variant_str',
    variantTypeValue: 'str',
    joinAlias: 'str',
    variantIdColumn: 'variant_id',
    hasFts: true,
    columns: {
      repeat_id:           { kind: 'text',   fts: true,  sortable: true,  label: 'Repeat ID' },
      variant_catalog_id:  { kind: 'text',   fts: true,  sortable: true,  label: 'Catalog ID' },
      repeat_unit:         { kind: 'text',   fts: true,  sortable: true,  label: 'Repeat unit' },
      display_repeat_unit: { kind: 'text',   fts: true,  sortable: true,  label: 'Display repeat unit' },
      repeat_length:       { kind: 'number', fts: false, sortable: true,  label: 'Repeat length' },
      ref_copies:          { kind: 'number', fts: false, sortable: true,  label: 'Reference copies' },
      alt_copies:          { kind: 'text',   fts: false, sortable: false, label: 'Alt copies' },
      str_status:          { kind: 'enum',   fts: true,  sortable: true,  label: 'STR status' },
      disease:             { kind: 'text',   fts: true,  sortable: true,  label: 'Disease' },
      inheritance_mode:    { kind: 'enum',   fts: false, sortable: true,  label: 'Inheritance mode' },
      source_display:      { kind: 'text',   fts: false, sortable: true,  label: 'Source' },
      support_type:        { kind: 'text',   fts: false, sortable: true,  label: 'Support type' },
      normal_max:          { kind: 'number', fts: false, sortable: true,  label: 'Normal max' },
      pathologic_min:      { kind: 'number', fts: false, sortable: true,  label: 'Pathologic min' },
      locus_coverage:      { kind: 'number', fts: false, sortable: true,  label: 'Locus coverage' },
      rank_score:          { kind: 'text',   fts: false, sortable: false, label: 'Rank score' },
      confidence_interval: { kind: 'text',   fts: false, sortable: false, label: 'Confidence interval' }
    }
  }
} as const satisfies Record<string, VariantExtensionDef>

export type ExtensionTypeKey = keyof typeof VARIANT_EXTENSION_REGISTRY

// Derived helpers
export const EXTENSION_SORTABLE_DOTTED_KEYS: ReadonlySet<string>
export const EXTENSION_FILTERABLE_DOTTED_KEYS: ReadonlySet<string>
export const EXTENSION_FTS_TABLES: Array<{
  typeKey: ExtensionTypeKey
  ftsTable: string
  sourceTable: string
  variantTypeValue: 'sv' | 'str'
  ftsColumns: string[]
}>

export function isExtensionColumnKey(dottedKey: string): boolean
export function resolveExtensionColumnKey(dottedKey: string): ExtensionColumnResolution | null
```

### 2. Shared base filter translation: `variant-where-builder.ts`

New file: `src/main/database/variant-where-builder.ts` (~180 lines). **Consumes the existing `ColumnFilter` shape from `src/shared/types/column-filters.ts` verbatim** — no new types.

```typescript
import type { ColumnFilter, ColumnFiltersParam } from '../../shared/types/column-filters'
import { isExtensionColumnKey } from './variant-extension-registry'

export interface BuildBaseWhereContext {
  baseAlias: string  // 'v' for Path 1/3, 'cvs' for Path 2
  scope: 'case' | 'cohort-listing' | 'cohort-burden'
}

export interface BuildBaseWhereResult {
  sql: string
  params: (string | number)[]
}

export function buildBaseWhere(
  filters: BaseFilterInput,
  ctx: BuildBaseWhereContext
): BuildBaseWhereResult
```

Handles: typed stable fields (`gnomad_af_max`, `cadd_min`, `consequences`, `clinvars`, `funcs`, `gene_symbol`, `max_internal_af`, `starred_only`, `has_comment_only`, `acmg_classifications`, `carrier_count_min`, `panel_intervals`, …), bare-key `column_filters` entries (non-dotted keys for base-table columns), scope-specific invariants (cohort-burden ANDs `gene_symbol IS NOT NULL`, cohort-listing applies SNV/indel collapse on `variant_type`).

Does NOT handle: dotted `column_filters` keys (extension columns — per-path helpers), search terms (path-specific).

### 3. Path-specific extension filter emitters

Both use the existing `ColumnFilter = { operator, value, includeEmpty? }` shape.

**3a. Direct JOIN mode — Path 1 + Path 3.**

```typescript
export function buildExtensionJoinClauses(
  columnFilters: ColumnFiltersParam,
  baseVariantAlias: string
): {
  joins: string
  whereClause: string
  params: (string | number)[]
  implicitTypeNarrowing: ExtensionTypeKey | null
  requiredJoinAliases: Set<ExtensionTypeKey>
}
```

For `column_filters['cnv.copy_number'] = { operator: '>=', value: 3 }`:

```sql
LEFT JOIN variant_cnv cnv ON cnv.variant_id = v.id
-- AND:
v.variant_type = 'cnv' AND cnv.copy_number >= ?
```

**3b. EXISTS subquery mode — Path 2.**

```typescript
export function buildExtensionExistsClauses(
  columnFilters: ColumnFiltersParam,
  cvsAlias: string
): {
  whereClause: string
  params: (string | number)[]
  implicitTypeNarrowing: ExtensionTypeKey | null
}
```

For the same filter:

```sql
cvs.variant_type = 'cnv'
AND EXISTS (
  SELECT 1 FROM variants v
  JOIN variant_cnv cnv ON cnv.variant_id = v.id
  WHERE v.chr = cvs.chr AND v.pos = cvs.pos
    AND v.ref = cvs.ref AND v.alt = cvs.alt
    AND v.variant_type = cvs.variant_type
    AND cnv.copy_number >= ?
)
```

### 4. `VariantFilterBuilder` refactor (Path 1)

```typescript
build(filters: FilterIpcParams): { sql: string; params: unknown[] } {
  const baseAlias = 'v'
  const { sql: baseWhere, params: baseParams } = buildBaseWhere(filters, {
    baseAlias, scope: 'case'
  })
  const { joins, whereClause: extWhere, params: extParams } =
    buildExtensionJoinClauses(filters.column_filters ?? {}, baseAlias)

  let query = this.baseQuery(filters)
  if (joins) query = this.addRawJoins(query, joins)
  if (baseWhere) query = query.where(sql.raw(baseWhere))
  if (extWhere) query = query.where(sql.raw(extWhere))
  return query
}
```

`SORTABLE_COLUMNS` → `BASE_SORTABLE_COLUMNS` + derived `EXTENSION_SORTABLE_DOTTED_KEYS`.

### 5. Path 3 backend refactor — contract extension + shared helpers + correct caller chain

This is the Path 3 backend slice. Section 13g handles the Path 3 renderer (`AssociationConfigPanel`) refactor separately.

**5a. Extend `src/main/statistics/types.ts` `VariantFilters`:**

```typescript
import type { ColumnFiltersParam } from '../../shared/types/column-filters'

export interface VariantFilters {
  gnomad_af_max?: number
  cadd_min?: number
  consequences?: string[]
  gene_list?: string[]
  // NEW: fields the other two paths already expose
  clinvars?: string[]
  funcs?: string[]
  acmg_classifications?: string[]
  max_internal_af?: number
  // NEW: flexible column filter map (extension dotted keys live here)
  column_filters?: ColumnFiltersParam
}
```

`AssociationConfig.filters` already has type `VariantFilters`, so it picks up the new fields automatically.

**5b. Caller chain (actual, verified):**

1. **Renderer:** `AssociationConfigPanel.vue` currently emits a bespoke filters object with only 4 fields. Until §13g refactors the panel, any extension filters set via the panel won't reach `VariantFilters`. For this backend slice, **the type extension is made first** so all downstream machinery accepts the new fields; the panel refactor is its own commit that populates them.
2. **IPC handler `statistics:run`** (in `src/main/ipc/handlers/statistics-*.ts` — exact path confirmed during implementation): receives the panel's emit as a plain object, passes it into `AssociationEngine.run(config)`. If the IPC schema is Zod-validated, that schema must be extended in `src/shared/types/ipc-schemas.ts` to accept the new fields. If it's a plain pass-through, no code change is needed beyond the type.
3. **`AssociationEngine.run(config)`** at `AssociationEngine.ts:39-54` — already calls `dbPool.run({ type: 'association:build', params: [config.groupA_ids, config.groupB_ids, config.filters, config.covariates] })`. The `config.filters` is typed as `VariantFilters` and the dispatch is type-generic over `params`. **No code change needed at this line** — extended fields flow through automatically.
4. **`db-worker-dispatch.ts:258-266`** — handles `association:build`. Line 263 casts `params[2] as VariantFilters`. The cast is identity after extension; extended fields are already present at runtime. **No code change needed at this line.**
5. **`AssociationDataBuilder.build(groupA_ids, groupB_ids, filters, covariateNames)`** — is where the actual refactor lands: replace hand-rolled WHERE (lines 25-52) with `buildBaseWhere` + `buildExtensionJoinClauses` calls. The rest of the method (gene/variant/case grouping, contingency math, covariate loading at lines 76+) is untouched.

**Explicit NOT in the caller chain:**
- `WorkerRequest` (`statistics/types.ts:94-99`) — the statistical worker request carries `{ type: 'run', genes: GeneContingencyData[], weight_scheme }`. Filters were already consumed by `AssociationDataBuilder.build()` before the statistical `WorkerPool.run(genes, weight_scheme)` call at `AssociationEngine.ts:81`. The statistical worker does NOT see filters. This spec does NOT touch `WorkerRequest` or the statistical `WorkerPool`.

**5c. `AssociationDataBuilder.build` refactor:**

```typescript
build(groupA_ids, groupB_ids, filters, covariateNames): GeneContingencyData[] {
  const allIds = [...groupA_ids, ...groupB_ids]
  if (allIds.length === 0) return []
  const groupASet = new Set(groupA_ids)

  const baseAlias = 'v'
  const { sql: baseWhere, params: baseParams } = buildBaseWhere(filters, {
    baseAlias, scope: 'cohort-burden'
  })
  const { joins, whereClause: extWhere, params: extParams } =
    buildExtensionJoinClauses(filters.column_filters ?? {}, baseAlias)

  const placeholders = sqlPlaceholders(allIds.length)
  const sql = `
    SELECT ${baseAlias}.gene_symbol,
           ${baseAlias}.case_id,
           ${baseAlias}.chr || ':' || ${baseAlias}.pos || ':' || ${baseAlias}.ref || ':' || ${baseAlias}.alt AS variant_key,
           ${GT_DOSAGE_SQL} AS dosage,
           ${baseAlias}.gnomad_af,
           ${baseAlias}.cadd
    FROM variants ${baseAlias}
    ${joins}
    WHERE ${baseAlias}.case_id IN (${placeholders})
      AND ${baseWhere}
      ${extWhere ? `AND ${extWhere}` : ''}
    ORDER BY gene_symbol, variant_key, case_id
  `
  const variantRows = this.db.prepare(sql).all(...allIds, ...baseParams, ...extParams)
  // ... rest unchanged
}
```

**5d. Regression tests:** pre-refactor burden results with only the 4 original filter fields set must be byte-identical (same Fisher's exact p-values, same carrier counts). Existing `association-data-builder.test.ts` fixtures cover this; they must pass unchanged.

### 6. `CohortSearch` refactor (Path 2)

1. Keep LIKE-based search (`buildSingleTermCondition`, `buildBooleanSearchCondition`) unchanged — Path 2 does NOT use FTS5.
2. Extract base-field translation into `buildBaseWhere` call with `baseAlias: 'cvs'`, `scope: 'cohort-listing'`.
3. Keep existing bare-key `column_filters` translation for cvs-native columns (routes through `buildBaseWhere`'s generic branch).
4. **Add** `buildExtensionExistsClauses` call for dotted `column_filters` keys.
5. Preserve SNV/indel collapsing via the `cohort-listing` scope in `buildBaseWhere`.

No schema change to `cohort_variant_summary`.

### 7. FilterState extensibility

```typescript
import type { ColumnFiltersParam } from './column-filters'

export interface FilterState {
  // ── Stable typed fields (unchanged) ──
  geneSymbol: string
  searchQuery: string
  consequences: string[]
  funcs: string[]
  clinvars: string[]
  maxGnomadAf: number | null
  minCadd: number | null
  minCarriers: number | null
  starredOnly: boolean
  hasCommentOnly: boolean
  acmgClassifications: string[]
  tagIds: number[]
  annotationScope: 'case' | 'all'
  activePanelIds: number[]
  panelPaddingBp: number
  maxInternalAf: number | null
  inheritanceModes: string[]
  analysisGroupId: number | null
  considerPhasing: boolean

  // ── NEW: column filters using the existing ColumnFilter contract ──
  columnFilters: ColumnFiltersParam
}
```

`FilterIpcParams`, `CohortQueryParams`, and `VariantFilters` (statistics) all gain `column_filters?: ColumnFiltersParam`. 8 seeded presets deserialize to `columnFilters: {}`.

### 8. Column metadata path

```typescript
getColumnMeta(
  scope: { caseId: number } | { caseIds: number[] },
  columnKey: string
): Promise<ColumnFilterMeta>
```

Returns the existing `ColumnFilterMeta` shape (same contract the renderer consumes today). Extension branch uses a scoped per-extension-table query; base branch uses existing aggregate query.

`getVariantTypesPresent(scope)` — new method for auto-hide logic.

### 9. FTS5 migration v26 (two tables)

Two new FTS5 virtual tables: `variant_sv_fts` (indexing `event_id`, `mate_id`) and `variant_str_fts` (indexing `repeat_id`, `variant_catalog_id`, `repeat_unit`, `display_repeat_unit`, `str_status`, `disease`). Six triggers total (ai/au/ad per table). No CNV FTS table. Registry-generated SQL wrapped in a transaction.

### 10. Shared FTS trigger management

New file: `src/main/database/fts-trigger-management.ts` (~80 lines). Defensive feature detection via `sqlite_master` — safe to run before v26 applies.

### 11. Path 1 search: emitter refactor + UNION composition

**This section is substantially different from r2.** The existing `fts5-search-emitter.ts` emits full row predicates hardcoded to `variants_fts` and mixes in base-table LIKE predicates for HGVS terms. It cannot be replayed across UNION arms — the shape of the emitted string would need to be rewritten per arm, and the HGVS branches would be nonsensical inside FTS subqueries.

The refactor has two parts:

**11a. New emitter — `src/main/database/search/search-clause-emitter.ts`** (replaces or wraps `fts5-search-emitter.ts`).

The new emitter walks the AST and returns a **structured result** that a composer can expand into SQL later. It distinguishes FTS term leaves from HGVS term leaves at the type level:

```typescript
import type { AstNode } from '../../../shared/utils/boolean-search'
import { EXTENSION_FTS_TABLES } from '../variant-extension-registry'

/**
 * Structured search clause tree that mirrors the boolean AST but separates
 * FTS-term leaves from HGVS-term leaves so a composer can expand them
 * appropriately. FTS terms become UNION-backed subqueries across all
 * present FTS tables; HGVS terms stay as base-table LIKE predicates.
 */
export type SearchClause =
  | { type: 'fts'; term: string }          // e.g. "BRCA1" → FTS5 MATCH expression
  | { type: 'hgvs'; term: string }          // e.g. "c.76A>T" → LIKE on cdna/aa_change
  | { type: 'and'; left: SearchClause; right: SearchClause }
  | { type: 'or';  left: SearchClause; right: SearchClause }
  | { type: 'not'; operand: SearchClause }

/** Walk the AST and classify each term leaf. */
export function classifySearchAst(ast: AstNode): SearchClause {
  switch (ast.type) {
    case 'term':
      return /^[cp]\./.test(ast.value)
        ? { type: 'hgvs', term: ast.value }
        : { type: 'fts',  term: ast.value }
    case 'and':
      return { type: 'and', left: classifySearchAst(ast.left), right: classifySearchAst(ast.right) }
    case 'or':
      return { type: 'or',  left: classifySearchAst(ast.left), right: classifySearchAst(ast.right) }
    case 'not':
      return { type: 'not', operand: classifySearchAst(ast.operand) }
  }
}

/** Compose the structured clauses into SQL ready for Kysely `sql.raw(...)`. */
export function composeSearchClauses(
  clause: SearchClause,
  present: { baseFts: 'variants_fts'; extensionFts: typeof EXTENSION_FTS_TABLES }
): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = []

  function compose(node: SearchClause): string {
    switch (node.type) {
      case 'fts':
        return composeFtsTermUnion(node.term, present, params)
      case 'hgvs':
        return composeHgvsTerm(node.term, params)
      case 'and':
        return `(${compose(node.left)} AND ${compose(node.right)})`
      case 'or':
        return `(${compose(node.left)} OR ${compose(node.right)})`
      case 'not':
        return `(NOT (${compose(node.operand)}))`
    }
  }

  return { sql: compose(clause), params }
}

/** Build `id IN (UNION over all present FTS tables)` for one FTS term. */
function composeFtsTermUnion(
  term: string,
  present: { baseFts: string; extensionFts: typeof EXTENSION_FTS_TABLES },
  params: (string | number)[]
): string {
  const ftsQuery = `"${term.replace(/"/g, '""')}"*`
  const arms: string[] = [
    `SELECT rowid FROM ${present.baseFts} WHERE ${present.baseFts} MATCH ?`
  ]
  params.push(ftsQuery)
  for (const entry of present.extensionFts) {
    arms.push(`SELECT rowid FROM ${entry.ftsTable} WHERE ${entry.ftsTable} MATCH ?`)
    params.push(ftsQuery)
  }
  return `id IN (${arms.join(' UNION ')})`
}

/** HGVS term → base-table LIKE (identical to current behavior). */
function composeHgvsTerm(term: string, params: (string | number)[]): string {
  params.push(`%${term}%`, `%${term}%`)
  return '(cdna LIKE ? OR aa_change LIKE ?)'
}
```

**Key properties:**
- FTS term leaves expand into UNION subqueries that cover `variants_fts` plus every present extension FTS table. Each arm uses its own `?` parameter (the same FTS query string, repeated N times in params — standard prepared-statement pattern).
- HGVS term leaves stay at the outer level via base-table LIKE. They do NOT leak into FTS subqueries. `BRCA1 AND c.76A>T` produces exactly `(<fts-union> AND (cdna LIKE ? OR aa_change LIKE ?))` — correct semantically.
- AND/OR/NOT combinators are preserved at the outer level exactly as before.
- Defensive: if no extension FTS tables are present (rollback or pre-v26 state), `composeFtsTermUnion` falls back to just `variants_fts` — identical to current behavior.
- The old `emitFts5Search` is deleted. Its consumer (`VariantSearchService.applySearchFilter`) migrates to the new pair `classifySearchAst` + `composeSearchClauses`.

**11b. `VariantSearchService` wiring:**

```typescript
import { classifySearchAst, composeSearchClauses } from './search/search-clause-emitter'
import { EXTENSION_FTS_TABLES } from './variant-extension-registry'

applySearchFilter(query: VariantQueryBuilder, searchQuery: string): VariantQueryBuilder {
  const term = searchQuery.trim()
  const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)
  if (!hasBooleanOps) return this.applySingleSearchToken(query, term)

  const tokens = tokenize(term)
  if (tokens.length === 0) return query
  let ast
  try { ast = parse(tokens) } catch (e) {
    mainLogger.warn('Malformed boolean search, falling back to single-term', 'VariantSearchService')
    return this.applySingleSearchToken(query, term)
  }
  const clause = classifySearchAst(ast)
  const { sql: composedSql, params } = composeSearchClauses(clause, {
    baseFts: 'variants_fts',
    extensionFts: EXTENSION_FTS_TABLES
  })
  // Compose into Kysely query via sql template literal (same interpolation
  // pattern the current code uses at VariantSearchService.ts:52-62)
  return query.where(/* interpolated raw expression */)
}

applySingleSearchToken(query: VariantQueryBuilder, token: string): VariantQueryBuilder {
  // HGVS fallback — unchanged
  if (/^[cp]\./.test(token)) {
    return query.where(({or, eb}) => or([
      eb('cdna', 'like', `%${token}%`),
      eb('aa_change', 'like', `%${token}%`)
    ]))
  }
  // Single FTS term: reuse composeFtsTermUnion for consistency (single-arm call
  // goes through the same helper, no special-casing)
  const ftsQuery = `"${token.replace(/"/g, '""')}"*`
  const arms: string[] = [sql`SELECT rowid FROM variants_fts WHERE variants_fts MATCH ${ftsQuery}`]
  for (const entry of EXTENSION_FTS_TABLES) {
    arms.push(sql`SELECT rowid FROM ${sql.ref(entry.ftsTable)} WHERE ${sql.ref(entry.ftsTable)} MATCH ${ftsQuery}`)
  }
  const unionSql = sql.join(arms, sql` UNION `)
  return query.where(sql<boolean>`id IN (${unionSql})`)
}
```

**Preserved properties:**
- HGVS tokens (`c.`, `p.`) → base-table LIKE (unchanged semantics)
- Boolean AST support (parsed by existing `tokenize` / `parse`)
- Query-level composition via Kysely `sql` template
- No ID prefetch, no JS-side IN list assembly
- Query planner sees native UNION across FTS tables
- HGVS + FTS mixed expressions like `BRCA1 AND c.76A>T` compose correctly

**NOT consumed by:**
- Path 2 (cohort listing) — `cohort.ts` keeps LIKE-based search
- Path 3 (burden) — no search path

### 12. IPC contract changes

- New handlers: `variants:columnMeta`, `variants:typesPresent`
- `FilterIpcParams` + `CohortQueryParams` Zod schemas: already include `column_filters: ColumnFiltersParam` — no structural change
- Statistics payload schema: extended for the new `VariantFilters` fields
- Typed preload wrappers

### 13. Renderer changes

#### 13a. Column definitions
Flip `sortable: true` in `sv-columns.ts`, `cnv-columns.ts`, `str-columns.ts` for columns where the registry says so.

#### 13b. Pinia filter store extensions
Session caches for `extensionColumnMeta` and `variantTypesPresent`, scope-keyed, invalidated on bulk import / case delete / cohort change.

#### 13c. Shared `<ExtensionColumnFilters>`
New component mounted in BOTH `FilterToolbar.vue` (case view) and `CohortFilterBar.vue` (cohort listing). Takes `scope` prop. Auto-hides type sections based on `ensureTypesPresent`. Lazy metadata per column. Two-way binds to `filterState.columnFilters[dottedKey]` using the existing `{ operator, value, includeEmpty }` shape.

#### 13d. `<FilterTypeNarrowingChip>`
New component mounted above variant table in both case and cohort listing views. Info chip for single-type narrowing, warning chip for multi-type.

#### 13e. Search box
- Path 1: no visible change, backend uses new UNION emitter
- Path 2: unchanged

#### 13f. `FilterState.columnFilters` + `useFilters.ts` `buildIpcParams` wiring
`buildIpcParams()` in `useFilters.ts` serializes `columnFilters` for the case and cohort-listing IPC paths. Adds one line per call site.

#### 13g. `AssociationConfigPanel.vue` migration to shared FilterState (Path 3 renderer parity)

**This is a real refactor, not a one-line change.** Current state (verified):
- `AssociationConfigPanel.vue:259-276` emits a custom inline filters shape with only 4 fields
- Local refs at lines 279-287: `gnomadAfMax`, `caddMin`, `selectedConsequences`, `geneListText`, etc.
- Local impact preset logic at lines 289-319 (parallel to but not sharing with `useFilters.ts`)
- Local AF preset logic at lines 321-328

**Refactor steps:**

1. **Import and instantiate `useFilters()`** from `src/renderer/src/composables/useFilters.ts`. The composable already provides `filters: FilterState`, `hasActiveFilters`, `activeFiltersList`, `clearAllFilters`, `buildIpcParams()`, and the preset sync logic (impact, AF) already centralized there.
2. **Replace local refs** with the composable's state: `filters.maxGnomadAf`, `filters.minCadd`, `filters.consequences`, etc. Delete `gnomadAfMax`, `caddMin`, `selectedConsequences`, `geneListText`, `selectedImpactPresets`, `selectedAfPreset`, and the associated `watch`/`computed` logic that's duplicated from the composable.
3. **Keep panel-specific state** outside the composable: `groupAIds`, `groupBIds`, `primaryTest`, `weightScheme`, `selectedCovariates`, `maxThreads`. These are burden-specific, not general filter state.
4. **Mount `<ExtensionColumnFilters>`** inside the panel's filter section, passing `scope` as the union of selected group A + group B case IDs. This gives the burden panel the same extension filter UI surface as the other two views.
5. **Mount `<FilterTypeNarrowingChip>`** above the group selectors to show when extension filters narrow the burden set to a specific type.
6. **Extend the emit payload** to include `filters: buildIpcParams(filters)` (replacing the inline `{ gnomad_af_max, cadd_min, consequences, gene_list }` shape). `buildIpcParams()` serializes all the base fields PLUS `column_filters` — the emit now carries extension filters through to the backend.
7. **Update the emit type declaration** at lines 259-276 to match the new shape: `filters: FilterIpcParams` (the full shape, not a 4-field subset).
8. **`gene_list` special handling** — currently the panel parses `geneListText` (a textarea) into an array. This is burden-specific (the panel has its own "gene list" textarea). Either keep it as burden-specific local state and merge into `buildIpcParams` output at emit time, OR migrate to `filters.geneSymbol` (though that's a single gene, not a list). The implementation plan picks the cleaner option after looking at how the cohort view handles gene lists.
9. **Regression:** all existing burden analysis tests and E2E scenarios that use the panel's 4 base filters must continue to pass. The migration preserves semantics for users who only set those 4 fields.

**Size estimate:** ~100-150 lines of panel code deleted (local refs + duplicated preset logic), ~50-80 lines added (composable wiring + new component mounts). Net decrease.

**Alternative considered and rejected:** a "parallel" Path 3 UI that keeps the current panel but adds an extension filter drawer as a separate tab. This would duplicate filter state across the panel's local refs and the drawer's `FilterState`, risking drift and violating the cohort parity rule (which exists precisely to avoid parallel filter systems).

#### 13h. What stays unchanged
- `FilterToolbar.vue` / `CohortFilterBar.vue` top-level structure (each gains a child component mount)
- Debouncing in `useVariantData.ts`
- 8 seeded filter presets
- Variant detail drawer
- Column pinning/reorder/resize
- `AssociationEngine` statistical math
- `WorkerRequest` / statistical `WorkerPool`

### 14. Lazy metadata loading

Extension columns load on first filter drawer open per column, cached per-scope, ~100ms skeleton.

---

## Testing strategy

### New test files

- **`tests/main/database/variant-extension-registry.test.ts`** — structural invariants, derivation helpers, mock-entry extensibility
- **`tests/main/database/variant-where-builder.test.ts`** — base translator isolation tests
- **`tests/main/database/variant-extension-filter-clauses.test.ts`** — direct JOIN and EXISTS mode emitters
- **`tests/main/database/fts-trigger-management.test.ts`** — defensive detection, tear/restore idempotency
- **`tests/main/database/search/search-clause-emitter.test.ts`** — NEW FOR r3: classifySearchAst + composeSearchClauses tests:
  - Single FTS term → UNION across present FTS tables
  - Single HGVS term → base-table LIKE (no UNION, no FTS)
  - `BRCA1 AND c.76A>T` → `(UNION over FTS tables) AND (cdna LIKE OR aa_change LIKE)`
  - `(BRCA1 OR TP53) AND NOT c.foo` → nested combinators preserved
  - No extension FTS present → fallback to just `variants_fts` in the UNION
- **`tests/main/database/extension-filter-bulk-insert-regression.test.ts`** — bulk-insert trigger teardown across all 3 FTS groups

### Modified test files

- **`tests/main/database/migrations.test.ts`** — v26 block (2 tables, 6 triggers, backfill, idempotency)
- **`tests/main/database/variant-filter-builder.test.ts`** — extension filter scenarios
- **`tests/main/database/cohort.test.ts`** — extension filter via EXISTS, SNV/indel collapse preserved
- **`tests/main/database/association-data-builder.test.ts`** — regression parity + extension filter narrowing
- **`tests/main/database/variant-search-service.test.ts`** — single FTS term, HGVS token, mixed `BRCA1 AND c.76A>T`, no-FTS fallback, boolean AST trees
- **`tests/main/database/variant-repository.test.ts`** — `getColumnMeta` scoped extension queries, `getVariantTypesPresent`
- **`tests/main/statistics/integration.test.ts`** — extended `VariantFilters` flows through `association:build` DbPool dispatch correctly

### IPC contract tests

- **`tests/main/handlers/statistics-handlers.test.ts`** — `VariantFilters` IPC schema accepts new fields, Zod validates, backward-compat with old payloads

### Renderer tests

- **`tests/renderer/components/filters/FilterTypeNarrowingChip.test.ts`** — no/single/multi chip rendering
- **`tests/renderer/components/filters/ExtensionColumnFilters.test.ts`** — scope prop, auto-hide, lazy metadata, two-way bind emitting `{ operator, value, includeEmpty }`
- **`tests/renderer/components/association/AssociationConfigPanel.test.ts`** — NEW FOR r3: verifies the panel now uses shared FilterState, emits extended filters via buildIpcParams, mounts the extension filter component, preserves burden-specific state (groups, covariates, max_threads)

### E2E Playwright smoke tests

- Case view filter: `cnv.copy_number` range + narrowing chip
- Case view search: "HTT" via `variant_str_fts` UNION
- Case view boolean search: `BRCA1 AND c.76A>T` — verifies emitter refactor handles mixed FTS + HGVS
- Cohort listing filter: `sv.support` range via EXISTS
- **Burden analysis with extension filter:** configure burden panel with `cnv.copy_number >= 3`, verify results reflect narrowed qualifying variants (end-to-end Path 3 parity test)

### Synthetic fixtures

- Existing: `synthetic-cnv-nocall.vcf`, `synthetic-sniffles-ins-nocall.vcf`
- New: `tests/test-data/vcf/synthetic-str-repeats.vcf` (~20 lines)

### Coverage targets

- `variant-extension-registry.ts` — 100%
- `variant-where-builder.ts` — 95%+
- `fts-trigger-management.ts` — 100%
- Extension filter helpers — 95%+
- **`search-clause-emitter.ts` — 95%+** (new)
- `VariantFilterBuilder.ts` / `AssociationDataBuilder.ts` / `cohort.ts` — maintain or exceed
- `VariantSearchService.ts` — 85%+
- **`AssociationConfigPanel.vue` — maintain or exceed after refactor** (migration must not lose test coverage)

---

## Rollout strategy — commit layout

**Fourteen atomic commits** landing in PR #147.

### Commit 1 — `feat(db): variant extension registry + helpers`
- `variant-extension-registry.ts`, `variant-where-builder.ts`, `fts-trigger-management.ts`
- Tests for all three
- No consumers yet

### Commit 2 — `refactor(db): extract FTS trigger management to shared module`
- `VariantRepository` + `worker-db.ts` use `fts-trigger-management`
- Defensive detection safe before v26

### Commit 3 — `feat(db): migration v26 — FTS5 for variant_sv + variant_str`
- 2 virtual tables, 6 triggers, no CNV FTS
- `synthetic-str-repeats.vcf` fixture
- Migration tests

### Commit 4 — `refactor(db): CohortSearch uses shared base helper (Path 2)`
- Replace base branches in `cohort.ts::CohortSearch.buildWhereClause` with `buildBaseWhere`
- LIKE search untouched
- Existing tests pass

### Commit 5 — `feat(db): VariantFilterBuilder extension support + metadata (Path 1 filter/sort)`
- Split `SORTABLE_COLUMNS`
- `VariantFilterBuilder.build` uses shared helpers
- `VariantRepository.getColumnMeta` extension path + `getVariantTypesPresent`
- Path 1 extension filter tests

### Commit 6 — `feat(db): CohortSearch extension filter via EXISTS (Path 2 extension)`
- Add `buildExtensionExistsClauses` call
- Path 2 extension tests

### Commit 7 — `feat(stats): extend VariantFilters contract + AssociationDataBuilder refactor (Path 3 backend)`
- **Extend `src/main/statistics/types.ts:23` `VariantFilters`** with `clinvars`, `funcs`, `acmg_classifications`, `max_internal_af`, `column_filters`
- Extend statistics IPC schema in `src/shared/types/ipc-schemas.ts` if present (confirm during implementation)
- Refactor `AssociationDataBuilder.build(25-52)` to use `buildBaseWhere` + `buildExtensionJoinClauses`
- **Do NOT change `AssociationEngine.run()` dispatch line (47-50)** — it passes `config.filters` as-is and the type extension flows through automatically
- **Do NOT change `db-worker-dispatch.ts:258-266`** — the `params[2] as VariantFilters` cast picks up new fields automatically
- **Do NOT change `WorkerRequest`** — statistical worker is outside the filter chain
- Regression: pre-refactor burden results byte-identical for original 4-filter inputs
- IPC contract test: extended `VariantFilters` flows through `statistics:run` end-to-end

### Commit 8 — `feat(ipc): variants:columnMeta + variants:typesPresent handlers`
- New IPC handlers + preload wrappers + Zod schemas

### Commit 9 — `feat(search): search-clause-emitter + UNION-backed applySearchFilter (Path 1 only)`
- **New `src/main/database/search/search-clause-emitter.ts`** with `classifySearchAst` + `composeSearchClauses`
- **Delete (or deprecate) `src/main/database/search/fts5-search-emitter.ts`**
- `VariantSearchService.applySearchFilter` + `applySingleSearchToken` migrate to the new emitter
- Single-term + boolean + HGVS + mixed tests
- Regression: existing search behavior on single FTS term and HGVS tokens unchanged

### Commit 10 — `feat(renderer): extension columns sortable + Pinia store caches`
- Flip `sortable: true` in sv/cnv/str column defs
- Filter store cache methods, bulk-import invalidation

### Commit 11 — `feat(renderer): ExtensionColumnFilters + narrowing chip components`
- New `ExtensionColumnFilters.vue` + `FilterTypeNarrowingChip.vue`
- Two-way binding to `columnFilters[dottedKey]` using the existing `{ operator, value }` shape
- Component tests

### Commit 12 — `feat(renderer): FilterState.columnFilters + useFilters.buildIpcParams wiring (case + cohort listing)`
- Add `columnFilters: ColumnFiltersParam` to `FilterState` in `src/shared/types/filters.ts`
- `useFilters.ts::buildIpcParams` serializes `columnFilters`
- `FilterToolbar.vue` mounts `ExtensionColumnFilters` (case view)
- `CohortFilterBar.vue` mounts `ExtensionColumnFilters` (cohort listing)
- Mount narrowing chip in both views

### Commit 13 — `refactor(renderer): AssociationConfigPanel migrates to shared FilterState (Path 3 UI parity)`
- Replace local filter refs (`gnomadAfMax`, `caddMin`, `selectedConsequences`, `geneListText`, local preset logic) with `useFilters()` composable
- Delete duplicated impact preset watch + AF preset logic (centralized in `useFilters`)
- Keep burden-specific state: `groupAIds`, `groupBIds`, `primaryTest`, `weightScheme`, `selectedCovariates`, `maxThreads`
- Mount `ExtensionColumnFilters` inside the panel with `scope: { caseIds: [...groupAIds, ...groupBIds] }`
- Mount `FilterTypeNarrowingChip` above group selectors
- Change the emit type at lines 259-276 from 4-field inline shape to `filters: FilterIpcParams` via `buildIpcParams(filters)`
- Update all consumers of the panel's `run` emit (the page hosting `<AssociationConfigPanel>`) to match the new type
- Regression: existing burden E2E + unit tests pass with only the 4 original filters set

### Commit 14 — `test(e2e): multi-type filter + search smoke tests + coverage recalibration`
- Playwright smokes: case filter, case search, case boolean search (BRCA1 AND c.76A>T), cohort filter, cohort search, **burden with extension filter**
- Coverage threshold recalibration in `vitest.config.ts` if needed

### PR #147 size impact

Backend: ~+750 lines added, ~−250 removed (includes deleting old fts5-search-emitter + extracting burden panel duplicated logic)
Tests: ~+900 lines added
Renderer: ~+450 lines added net (−150 from panel refactor, +600 for new components + panel migration + store)
Migration: ~+70 lines added
**Net PR delta:** ~+1800 lines on top of existing PR #147 scope.

### Rollback story

- Each commit individually revertable except commit 3 (v26 migration, forward-only)
- Commit 7 (Path 3 backend) is the contract-extension commit; regression tests are the guard
- Commit 9 (emitter refactor) is a full replacement of `emitFts5Search` → `classifySearchAst` + `composeSearchClauses`; the old emitter and its tests are deleted
- Commit 13 (Path 3 UI) is the biggest UI refactor; isolated to `AssociationConfigPanel.vue`

---

## Open questions (to resolve during implementation)

1. **Statistics IPC schema location** — confirm `src/shared/types/ipc-schemas.ts` block for the statistics/burden payload and extend it to include the new `VariantFilters` fields. If there's no explicit schema (plain pass-through), the type extension is enough.
2. **`statistics:run` handler location** — exact file path in `src/main/ipc/handlers/` confirmed during implementation.
3. **`AssociationConfigPanel` gene list handling** — the panel has a `geneListText` textarea that parses newline-separated gene symbols into `gene_list: string[]`. Decide in commit 13 whether to: (a) keep it as burden-specific local state merged into `buildIpcParams` output, or (b) add a `geneList: string[]` field to `FilterState` that's widely consumable. Option (a) is smaller scope; option (b) enables other views to use a gene list filter. Defaulting to (a).
4. **`synthetic-str-repeats.vcf`** — confirm no equivalent exists.
5. **Renderer Pinia store test scaffolding** — fallback to E2E-only acceptable if absent.
6. **Unknown dotted-key handling** — log + drop (matches existing Path 2 gate at `cohort.ts:210`).
7. **Path 2 extension column sort** — deferred to follow-up.
8. **Parameter binding for the UNION arms** — the new emitter pushes the FTS query once per arm, which matches SQLite's prepared-statement binding semantics. If a CTE-based single-bind alternative is cleaner during implementation, it's a zero-behavior-change optimization.
9. **`includeEmpty` semantics for extension columns** — matches base path: `includeEmpty: true` with a range operator adds an `IS NULL OR` branch when applicable.

## Out of scope (with rationale)

| Item | Rationale |
|---|---|
| Canonical column rename (topic #3) | Separate spec. |
| Unified shortlist / ranking (topic #4) | Separate spec. |
| Phenotype-driven ranker | Deferred. |
| Cross-type OR filter expressions | Flat AND + warning chip in v1. |
| Path 2 extension column SORT | Aggregate choice needs data. |
| Path 2 extension column FTS5 search | Cohort listing uses LIKE. |
| Adding extension columns to cohort_variant_summary | EXISTS approach chosen. |
| FTS5 virtual table for variant_cnv | Zero text columns. |
| Parallel filter DSL | Existing `ColumnFilter` contract is the single source. |
| **Changes to `WorkerRequest` or statistical `WorkerPool`** | Filters are consumed in `AssociationDataBuilder.build()` BEFORE the statistical worker runs. The statistical worker receives pre-built `GeneContingencyData[]`. |
| **Keeping `emitFts5Search` verbatim** | The old emitter is tied to `variants_fts` by shape and mixes HGVS LIKE at the term level. It is replaced by `search-clause-emitter.ts`. |
| Down-migration for v26 | No down-migration policy. |
| `AssociationEngine` statistical changes | Only data retrieval changes. |

## Assumptions (must hold)

1. Extension tables use `variant_id INTEGER PRIMARY KEY` FK (verified).
2. `idx_variants_type_case` exists (`migrations.ts:1426`).
3. `idx_variants_coord_case` exists (`migrations.ts:1292`).
4. FTS5 external-content mode supported.
5. `useVariantData.ts` debounces filter updates.
6. `ColumnFilter` contract in `src/shared/types/column-filters.ts` is stable — reused verbatim.
7. `VariantFilters` in `src/main/statistics/types.ts:23` can be extended without breaking consumers (regression tests are the guard).
8. **The boolean search AST produced by `tokenize`/`parse` from `src/shared/utils/boolean-search` is stable and well-defined** — the new `classifySearchAst` walks the same AST the old `emitFts5Search` walks. Any changes to the AST shape would break both.
9. **`emitFts5Search` has NO other callers besides `VariantSearchService.applySearchFilter`** — to be verified during commit 9 (a grep for `emitFts5Search` should return only the emitter file + VariantSearchService + tests).
10. 8 seeded filter presets deserialize to `columnFilters: {}` cleanly.
11. `cohort_variant_summary` rebuild requires zero changes.
12. `cvs.variant_type` exists (`cohort.ts:189-196`).
13. **`AssociationEngine.run` dispatches to `dbPool.run({ type: 'association:build', params: [..., filters, ...] })` without filter inspection** (verified `AssociationEngine.ts:47-50`). Extending `VariantFilters` does not require changing this line.
14. **`db-worker-dispatch.ts:258-266` casts `params[2] as VariantFilters` without filtering the shape** (verified). Extending `VariantFilters` flows through automatically.
15. **`AssociationConfigPanel.vue` is the ONLY renderer entry point for burden analysis** — if there's a secondary panel (e.g., in a different page/route), it needs the same treatment. Confirmed during commit 13 implementation.

---

## References

- `src/shared/types/column-filters.ts` — the `ColumnFilter` contract (reused verbatim)
- `src/shared/types/ipc-schemas.ts:52` — existing Zod validation for `ColumnFiltersParam`
- `src/shared/types/filters.ts` — shared `FilterState`
- `src/main/statistics/types.ts:22-28` — `VariantFilters` type (extended in commit 7)
- `src/main/statistics/types.ts:94-99` — `WorkerRequest` (NOT in filter chain, not touched)
- `src/main/statistics/AssociationEngine.ts:39-54` — `run()` + `association:build` dispatch
- `src/main/workers/db-worker-dispatch.ts:258-266` — `association:build` handler
- `src/main/database/VariantFilterBuilder.ts` — Path 1 backend
- `src/main/database/VariantSearchService.ts:27-98` — Path 1 search composition
- `src/main/database/search/fts5-search-emitter.ts` — current emitter (replaced in commit 9)
- `src/main/database/cohort.ts::CohortSearch` — Path 2 backend
- `src/main/database/AssociationDataBuilder.ts` — Path 3 backend
- `src/renderer/src/components/association/AssociationConfigPanel.vue:259-276` — Path 3 renderer (migrated in commit 13)
- `src/renderer/src/composables/useFilters.ts` — shared filter composable (consumed by commit 13)
- `src/renderer/src/utils/filters/filterSerialization.ts` — filter serialization helpers
- `src/main/database/migrations.ts:1431-1473` — verified v25 extension schemas
- `src/main/database/migrations.ts:1425-1426` — `idx_variants_type` / `idx_variants_type_case`
- `src/main/database/migrations.ts:1292` — `idx_variants_coord_case`
- `src/shared/utils/boolean-search` — `tokenize` / `parse` / AST types
- `.planning/docs/multi-variant-filter-system-exploration.md` — Agent 1 findings
- `.planning/docs/multi-variant-sorting-search-exploration.md` — Agent 2 findings
- SQLite FTS5 external content tables: https://www.sqlite.org/fts5.html#external_content_tables
