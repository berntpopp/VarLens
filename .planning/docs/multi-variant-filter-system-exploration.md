# Filter system adaptation for multi-variant-type tables

## Summary

VarLens PR #147 introduced multi-variant-type import (SNV, indel, SV, CNV, STR) with a discriminator column on `variants` and three extension tables (`variant_sv`, `variant_cnv`, `variant_str`), but the filter pipeline only absorbs the bare minimum — the type discriminator, the five promoted columns on `variants` (`variant_type`, `end_pos`, `sv_type`, `sv_length`, `caller`), and nothing else. Users on the SV/CNV/STR tabs can sort and per-column-filter on the columns already living on the `variants` table, but the joined `variant_sv.support`, `variant_cnv.copy_number`, `variant_str.repeat_count`, etc. are unreachable — the backend `getColumnMeta` aggregate scans `variants` only, `SORTABLE_COLUMNS` deliberately excludes them, and there is no global filter drawer section for type-specific properties. A "DELs longer than 10kb" query is possible only because `sv_type` and `sv_length` were promoted onto `variants`; "CNVs with copy number ≥ 3" has no code path at all today. The recommended direction is **Option A (extend `VariantFilterBuilder` with conditional LEFT JOINs + a per-type column-metadata resolver)** because it builds on what already exists in `VariantFilterBuilder.build()` lines 114–153, keeps write cost unchanged, and naturally composes with the existing per-column-filter UI and the unified `column_filters` IPC payload.

## Current state

### Filter pipeline map

End-to-end flow of a filter change, with file paths and critical line numbers.

1. **Case tab selection** — `src/renderer/src/views/CaseView.vue:36` holds `selectedVariantType` (default `'snv'`). `CaseView.vue:82-85` merges `variant_type` into `effectiveFilters` as it is passed to `VariantTable`. This is the **only place** `variant_type` enters the filter pipeline — it is intentionally *not* part of `FilterState` in `src/renderer/src/composables/useFilterState.ts:68-88` and is *not* emitted by `buildFilterFromState` in `src/renderer/src/composables/filter-types.ts:97-169`.

2. **Filter drawer state** — `src/renderer/src/components/FilterDrawer.vue` hosts a global drawer with 12 filter panels (search, gene, panels, impact, function, clinvar, frequency, internal-frequency, cadd, tags, annotations, inheritance). None of these 12 panels expose any SV/CNV/STR fields. The drawer's shape is the shared `FilterDrawerState` interface in `src/renderer/src/components/filterDrawerTypes.ts`.

3. **Filter emission** — `useFilterState` watches a serialized `filterEmitKey` (`useFilterState.ts:131-134`) and calls `onFiltersUpdate(buildFilterFromState(...))` with a debounced `emitFilters`. The payload is `Omit<VariantFilter, 'case_id'>` — a plain shape that supports only the fields listed in `src/shared/types/database.ts:152-207`.

4. **Per-column header filter** — In parallel, `src/renderer/src/components/variant-table/VariantColumnHeader.vue` renders a filter menu per column header. User selections go to `useColumnFilters` (`src/renderer/src/composables/useColumnFilters.ts:18-33`). `VariantTable.vue:27-48` only renders the header-filter menu for columns in `filterableColumns` — see `src/renderer/src/components/variant-table/columns.ts:110-114` — which excludes everything with `sortable: false`, and **every extension-table column (`_sv_*`, `_cnv_*`, `_str_*`) in `sv-columns.ts:22-25`, `cnv-columns.ts:18-23`, and `str-columns.ts:12-25` is declared `sortable: false`**, so those header filter menus never appear.

5. **IPC merge** — In `src/renderer/src/components/variant-table/useVariantData.ts:74-87`, the per-column header filters (`colFilters`) are merged into the global filter as `column_filters`, and the whole object is serialized and sent via `api.variants.query(...)`.

6. **Main-process dispatch** — The IPC handler calls `VariantRepository.getVariants` (`src/main/database/VariantRepository.ts:307-355`) which delegates filter/sort to `VariantFilterBuilder`.

7. **Query build** — `src/main/database/VariantFilterBuilder.ts:69-559` builds a Kysely SELECT:
   - Line 71–84: base SELECT from `variants` + LEFT JOIN `variant_frequency as vf` + computed `internal_af`.
   - Line 101–111: variant-type discriminator (`'snv'` expands to `snv OR indel`).
   - Line 113–153: **conditional LEFT JOINs for SV/CNV/STR, one-shot** — the join is added only if `filter.variant_type` is `'sv'`, `'cnv'`, or `'str'`. Each branch selects a hardcoded subset of extension columns with `_sv_*`, `_cnv_*`, `_str_*` aliases so the UI's detail panel can read them. **No `WHERE` filter is ever applied against these joined tables.**
   - Line 155–204: the rest of the SNV-era filter composition (`gene_symbol`, `consequences`, `gnomad_af_max`, `cadd_min`, internal AF).
   - Line 377–416: generic per-column filter loop — skipped if the key isn't in `SORTABLE_COLUMNS` (line 379). Operators: `in`, `like`, `=/!=`, `</</<=/>=`.
   - Line 422–556: inheritance modes (SNV-only).

8. **Column metadata** — `VariantRepository.getColumnMeta(caseId)` (`VariantRepository.ts:437-517`) runs a single aggregate scan **against `variants` only**:

   ```
   SELECT COUNT(DISTINCT "<col>") AS "cnt_<key>", MIN/MAX...
   FROM variants WHERE case_id = ?
   ```

   followed by a second `UNION ALL` sweep over low-cardinality columns. It iterates over `SORTABLE_COLUMNS` — so the only columns that can ever appear in the header filter UI (and thus in per-column chip filtering) are the ones in that map.

### SORTABLE_COLUMNS vs extension table columns

`VariantFilterBuilder.SORTABLE_COLUMNS` (`VariantFilterBuilder.ts:16-50`) currently contains 20 keys, all physical `variants` columns:

```
chr, pos, gene_symbol, omim_mim_number, func, consequence, transcript,
cdna, aa_change, gt_num, gnomad_af, cadd, qual, hpo_sim_score, clinvar,
moi, variant_type, end_pos, sv_type, sv_length, caller
```

The last five (`variant_type` → `caller`) were added in PR #147. **Anything that lives on `variant_sv`, `variant_cnv`, or `variant_str` is deliberately absent**, and the inline comment at lines 39-44 explains why: `getColumnMeta` runs the one-shot aggregate only against `variants`, so adding aliases from joined tables would error ("no such column: sv.support").

### Filter UI inventory

Listing every UI filter entry point and whether it accommodates SV/CNV/STR today:

| UI surface                                   | File                                         | SV/CNV/STR support |
| -------------------------------------------- | -------------------------------------------- | ------------------ |
| Variant type tabs (SNV / SV / CNV / STR)     | `CaseView.vue:192-204`                       | Yes — routes `variant_type` into filter  |
| Filter drawer — Search (FTS)                 | `FilterDrawer.vue:18-48`                     | Works on indexed `gene_symbol/consequence/omim_mim_number` only  |
| Filter drawer — Gene                         | `FilterDrawer.vue:93-116`                    | Works (variant-type agnostic)  |
| Filter drawer — Gene Panels (coords)         | `FilterDrawer.vue:119-136`                   | Works — but only the `chr/pos` anchor, **SVs that span a panel interval at `end_pos` are missed**  |
| Filter drawer — Impact / Consequence / Func  | `FilterDrawer.vue:139-212`                   | Works if the SV/CNV caller produced VEP-style consequence on the variant row |
| Filter drawer — gnomAD AF / CADD             | `FilterDrawer.vue:222-336`                   | Degenerate for SV/CNV (annotations rarely populated); UI still shown |
| Filter drawer — Tags / ACMG / Inheritance    | `FilterDrawer.vue:344-510`                   | Tags/ACMG agnostic; inheritance SNV-specific (`gt_num` hard-coded)  |
| Per-column header filter menu                | `VariantColumnHeader.vue` + `columns.ts`     | Only renders for columns flagged `sortable: true` — every `_sv_*`/`_cnv_*`/`_str_*` column is `sortable: false` → **zero header filter UI** for extension fields |
| DSL search bar                               | `DslSearchBar.vue`, `src/renderer/src/dsl/*` | Has zero references to `_sv_`, `_cnv_`, `_str_` or `variant_type` in `src/renderer/src/dsl/` — DSL is SNV-only |
| Variant details panel                        | `ExtensionDetailsSection.vue:111-339`        | **Read-only display** of SV/CNV/STR fields; no filter controls  |

## Extension table column inventory

Schemas below are drawn from `src/main/database/migrations.ts` migration `v25` (lines 1403-1492) and mirrored in the Kysely types at `src/shared/types/database-schema.ts:369-422`.

All three extension tables are joined by a single `variant_id` PK/FK back to `variants.id` (**not** by a `(case_id, chr, pos, ref, alt)` composite — the task brief hinted at this but the actual schema is PK-on-variant_id only; see `migrations.ts:1434`, `:1450`, `:1462`). `ON DELETE CASCADE` means removing a variant row cleans up extension rows automatically.

Classification key:
- **FW-enum** — filter-worthy, discrete set (checkbox multi-select).
- **FW-range** — filter-worthy, numeric range (`>=`/`<=`/between).
- **FW-bool** — filter-worthy, 0/1 toggle.
- **FW-text** — filter-worthy text match (substring).
- **DO** — display-only (too high-cardinality or not actionable).
- **ST** — search-text (index into FTS or `like` only).

### variant_sv (table)

Migration definition: `migrations.ts:1433-1444`.

| Column            | SQLite type | Classification | Notes                                                                                           |
| ----------------- | ----------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `variant_id`      | INTEGER PK  | —              | FK only                                                                                         |
| `sv_is_precise`   | INTEGER     | FW-bool        | Very useful for filtering out imprecise breakpoints during review                               |
| `cipos_left`      | INTEGER     | DO             | Display as part of precision info; filtering by CIPOS width is rare                             |
| `cipos_right`     | INTEGER     | DO             | As above                                                                                        |
| `ciend_left`      | INTEGER     | DO             |                                                                                                 |
| `ciend_right`     | INTEGER     | DO             |                                                                                                 |
| `support`         | INTEGER     | FW-range       | "Show SVs with >= N supporting reads" — top clinician request                                   |
| `coverage`        | TEXT        | DO / FW-text   | Stored as string (per caller) — parseable into numeric later                                    |
| `strand`          | TEXT        | FW-enum        | Rare, but useful for BND analysis                                                               |
| `stdev_len`       | REAL        | FW-range       | Length uncertainty; useful for filtering unreliable calls                                       |
| `stdev_pos`       | REAL        | FW-range       | Position uncertainty                                                                            |
| `vaf`             | REAL        | FW-range       | "Filter by VAF >= 0.2" — common                                                                 |
| `dr`              | INTEGER     | FW-range       | Reference read count                                                                            |
| `dv`              | INTEGER     | FW-range       | Variant read count                                                                              |
| `pe_support`      | INTEGER     | FW-range       | Paired-end supporting reads (Delly/Manta specifically)                                          |
| `sr_support`      | INTEGER     | FW-range       | Split-read supporting reads                                                                     |
| `event_id`        | TEXT        | ST             | Only useful for joining breakends; not filterable per se                                        |
| `mate_id`         | TEXT        | ST             | Same as above                                                                                   |

> **Note:** `sv_type`, `sv_length`, and `end_pos` live on the `variants` table (promoted in migration v25 lines 1408-1412), so they are already in `SORTABLE_COLUMNS` and already filter-capable via the generic `column_filters` path. They are not listed above.

### variant_cnv (table)

Migration definition: `migrations.ts:1448-1456`.

| Column                | SQLite type | Classification | Notes                                                                           |
| --------------------- | ----------- | -------------- | ------------------------------------------------------------------------------- |
| `variant_id`          | INTEGER PK  | —              | FK only                                                                         |
| `copy_number`         | INTEGER     | FW-range + FW-enum | The primary filter ("CN ≥ 3 for gains", "CN ≤ 1 for losses"); indexed already (`idx_cnv_copy_number`) |
| `copy_number_quality` | INTEGER     | FW-range       | Genotype quality for CN call; useful for "high-confidence only"                 |
| `homozygosity_ref`    | REAL        | FW-range       | Fraction-of-reference-homozygous — niche but requested                          |
| `homozygosity_alt`    | REAL        | FW-range       | As above                                                                        |
| `sm`                  | REAL        | FW-range       | Signal-to-median — caller-specific quality metric                               |
| `bin_count`           | INTEGER     | FW-range       | Number of bins the CNV spans — proxy for confidence                             |

### variant_str (table)

Migration definition: `migrations.ts:1460-1472`.

| Column               | SQLite type | Classification | Notes                                                                                  |
| -------------------- | ----------- | -------------- | -------------------------------------------------------------------------------------- |
| `variant_id`         | INTEGER PK  | —              | FK only                                                                                |
| `repeat_id`          | TEXT        | FW-enum        | Locus name (e.g., `HTT`, `FMR1`) — very low cardinality; indexed (`idx_str_repeat_id`) |
| `variant_catalog_id` | TEXT        | FW-enum        | Catalog identifier alongside `repeat_id`                                               |
| `repeat_unit`        | TEXT        | ST             | Sequence motif (`CAG`, `CGG`) — text-search                                            |
| `display_repeat_unit`| TEXT        | DO             | UI display version of above                                                            |
| `ref_copies`         | REAL        | FW-range       | Reference repeat count — baseline                                                      |
| `alt_copies`         | TEXT        | DO             | Stored as text because STRs can be `N/M` pairs — filter-worthy only after parsing      |
| `repeat_length`      | INTEGER     | FW-range       | Physical length — useful for "big expansion" filter                                    |
| `str_status`         | TEXT        | FW-enum        | `normal` / `pre_mutation` / `full_mutation` — top clinical filter                      |
| `normal_max`         | INTEGER     | DO             | Threshold metadata; used by UI to compute status                                       |
| `pathologic_min`     | INTEGER     | DO             | Same                                                                                   |
| `disease`            | TEXT        | FW-enum / ST   | Indexed (`idx_str_disease`); useful filter when non-null                               |
| `inheritance_mode`   | TEXT        | FW-enum        | `AD`/`AR`/`XL` — low cardinality                                                       |
| `source_display`     | TEXT        | DO             | UI metadata                                                                            |
| `rank_score`         | TEXT        | FW-range       | Stored as text but numeric — needs coercion                                            |
| `locus_coverage`     | REAL        | FW-range       | QC metric                                                                              |
| `support_type`       | TEXT        | FW-enum        | `spanning`/`flanking`/`inrepeat`                                                       |
| `confidence_interval`| TEXT        | DO             | Display only                                                                           |

## Gap analysis (what fails today)

Two concrete "user wants to" scenarios and exactly where each hits the wall.

### Scenario 1: "Show only DELs longer than 10 kb"

This is the *good* case — it actually works today because both `sv_type` and `sv_length` were promoted to the `variants` table in migration v25. Let's trace why it works:

1. User selects the SV tab — `CaseView.vue:84` sets `filter.variant_type = 'sv'`.
2. User opens the per-column header filter on `sv_type` — the column has `sortable: true` in `sv-columns.ts:18`, so `VariantColumnHeader.vue:37-67` renders. `columnMetaMap['sv_type']` is populated because `getColumnMeta` iterates `SORTABLE_COLUMNS` which includes `sv_type` (added in v25, line 47 of `VariantFilterBuilder.ts`). Categorical filter with `['DEL']`.
3. User opens the per-column header filter on `sv_length`, uses numeric filter `>= 10000`.
4. Both filters are packed into `column_filters` by `useVariantData.ts:74-87`.
5. `VariantFilterBuilder.ts:378-416` applies them generically because both keys are in `SORTABLE_COLUMNS`. Success.

### Scenario 2: "Show only CNVs with copy number ≥ 3"

This is where we hit the wall. Trace:

1. User selects the CNV tab — `filter.variant_type = 'cnv'`. OK.
2. User looks for a `copy_number` column to filter. The CNV tab *does* have a "Copy Number" column — `cnv-columns.ts:18` — but it is `sortable: false`. This is intentional: the note at `cnv-columns.ts:4-9` explains that `_cnv_copy_number` is not in `SORTABLE_COLUMNS`, so the header filter menu is suppressed to "keep the UI honest".
3. `VariantTable.vue:27` only iterates `filterableColumns`, and `columns.ts:110-114` filters out `h.sortable === false`, so **no per-column filter menu renders for `_cnv_copy_number` at all**. The user has no UI affordance.
4. If the user tried to force the issue through the DSL bar, the DSL is SNV-only (zero references to extension fields in `src/renderer/src/dsl/`) and would parse `_cnv_copy_number` as an unknown token.
5. If an enterprising user hand-crafted a `column_filters: { _cnv_copy_number: { operator: '>=', value: 3 } }` payload, it would land in `VariantFilterBuilder.ts:378-380`, fail the `SORTABLE_COLUMNS[column] === undefined` gate, and be silently dropped.
6. If the gate were removed, the next attempt would fail because the generic `column_filters` code path does not know to LEFT JOIN `variant_cnv` — the JOIN only happens via the hardcoded branches at `VariantFilterBuilder.ts:114-153`, and those branches do not wire the joined aliases into the `column_filters` loop at all. The SQL would fail with "no such column: _cnv_copy_number" (because aliases only exist in the `SELECT` list, not in `WHERE`).

**Summary of the concrete gaps:**

1. **No drawer UI** for any type-specific field (all 12 drawer panels are type-agnostic; none render conditionally on the active tab).
2. **No header filter UI** for any joined extension column (17 SV fields + 6 CNV fields + 17 STR fields = 40 columns with zero filter affordance).
3. **No backend WHERE** on extension tables. The SV/CNV/STR JOIN branches only add `SELECT` aliases (`VariantFilterBuilder.ts:117-152`). There is no `whereExt(filter.ext_filters, 'sv')` helper.
4. **No metadata aggregation** on extension tables. `getColumnMeta` scans `variants` only; extension columns have no min/max/distinctValues for UI auto-detection (`VariantRepository.ts:437-517`).
5. **`SORTABLE_COLUMNS` gate blocks extension keys** even if the UI sent them (`VariantFilterBuilder.ts:379`). This is load-bearing — it prevents SQL injection via `sql.ref(sqlColumn)` — so it cannot simply be relaxed.
6. **Panel-interval filter (`filter.panel_intervals`)** hardcodes `variants.pos BETWEEN start_pos AND end_pos` at `VariantFilterBuilder.ts:244-256` — it cannot currently detect an SV whose `pos` is outside the panel interval but whose `end_pos` spans it. This is an orthogonal but adjacent gap worth flagging.
7. **`variant_type` does not flow through the global filter drawer at all.** `buildFilterFromState` (`filter-types.ts:97-169`) doesn't emit it; only `CaseView.vue:82-85` tacks it on at IPC-time. This is fine for the current "tabs switch type" UX but blocks any future "filter across multiple types in one query" use case.
8. **DSL search has no vocabulary** for extension columns (`src/renderer/src/dsl/*` — zero references).

## Design options

### Option A: Extend `VariantFilterBuilder` with per-type LEFT JOIN and WHERE branches, and teach column metadata about extension tables

**Architecture sketch.**

1. Add a new static map `EXTENSION_SORTABLE_COLUMNS: Record<VariantType, Record<string, { table: string; column: string; dataType: 'numeric' | 'text' }>>`. Example entries:

   ```
   sv:  { _sv_support: { table: 'variant_sv', column: 'support', dataType: 'numeric' },
          _sv_is_precise: { table: 'variant_sv', column: 'sv_is_precise', dataType: 'numeric' },
          ... }
   cnv: { _cnv_copy_number: { table: 'variant_cnv', column: 'copy_number', dataType: 'numeric' },
          ... }
   str: { _str_repeat_id: { table: 'variant_str', column: 'repeat_id', dataType: 'text' },
          _str_status: { table: 'variant_str', column: 'str_status', dataType: 'text' },
          ... }
   ```

2. In `VariantFilterBuilder.build()`:
   - Keep the existing conditional LEFT JOIN (line 114-153) but flip its activation rule from "SELECT aliases when type is set" to "JOIN whenever any `column_filters` key is in `EXTENSION_SORTABLE_COLUMNS[filter.variant_type]` **or** when we need the SELECT aliases for the display path". Cheap guard: if `filter.variant_type === 'sv'` always JOIN, since the UI needs the SELECT aliases anyway.
   - Extend the generic `column_filters` loop (line 377-416) so that when `SORTABLE_COLUMNS[key]` is undefined, it looks up `EXTENSION_SORTABLE_COLUMNS[filter.variant_type]?.[key]` and builds a WHERE against the qualified `table.column`. The existing operators (`=`, `!=`, `<`, `>`, `<=`, `>=`, `in`, `like`) work unchanged because Kysely's `sql.ref` already handles table-qualified references.

3. In `VariantRepository.getColumnMeta()`:
   - Accept a new parameter `variantType?: string`.
   - Emit a second aggregate query against the extension table if the active type is SV/CNV/STR. This is a single scan: `SELECT COUNT(DISTINCT ...), MIN/MAX ... FROM variant_sv INNER JOIN variants ON variants.id = variant_sv.variant_id WHERE variants.case_id = ?`. The INNER JOIN keeps the scan small (only rows matching the case).
   - Merge the extension `ColumnFilterMeta[]` into the return array so the renderer sees a unified list.

4. On the renderer side:
   - Flip the `sortable: false` flag to `true` on extension columns in `sv-columns.ts`, `cnv-columns.ts`, `str-columns.ts`. (Actually, keep `sortable` and `filterable` as distinct concepts — introduce a `filterable?: boolean` opt-in or use `sortable: true` for both. The latter is simpler but forces supporting sort on those columns too; see the trade-off below.)
   - Teach `detectFilterMode` about the new `_sv_*`/`_cnv_*`/`_str_*` keys through `COLUMN_FILTER_OVERRIDES` in `src/renderer/src/config/columnFilterConfig.ts` (e.g. force `_cnv_copy_number` to numeric even if distinct count is low).
   - (Optional) Add conditional drawer panels: `v-if="selectedVariantType === 'sv'"` for "SV properties" with chip-select on `sv_type` / range input on `support` / VAF. These can be a new section "Type-specific properties" in `FilterDrawer.vue`.

**Pros.**

- **Additive** — the existing SNV pipeline is untouched. The `SORTABLE_COLUMNS` safety gate becomes a two-step "is it in the base map OR the extension map for this type?" check that still closes the injection surface.
- **No schema migration.** Extension tables exist as-is; no new joins, no new triggers, no `ANALYZE` drift.
- **Natural DX.** The existing per-column header filter UI in `VariantColumnHeader.vue` already knows how to render numeric/categorical/text. Just flipping `sortable: true` on extension columns + feeding them `ColumnFilterMeta` from the backend wires everything up.
- **Incrementally shippable** — SV first, CNV next, STR third. Each is ~30 lines of new code in the builder + one extension column map entry.
- **Cohort view compatibility.** `useCohortData.ts` already passes `variant_type` through its own IPC path (`useCohortData.ts:297-299`), so the same backend changes benefit cohort queries automatically.

**Cons.**

- The `VariantFilterBuilder.build()` function grows — already 430 lines, would reach ~500. Needs careful extraction into a helper (e.g. `applyExtensionColumnFilters(query, filter)`).
- Two separate column-metadata queries per case load (one for `variants`, one for the active extension table). Cold-start cost: probably 5-20 ms per extension table for realistic case sizes (tens of thousands of SVs max). Mitigation: skip the extension meta query if the active tab is SNV.
- `getColumnMeta` currently returns one combined `ColumnFilterMeta[]`. Stitching extension meta in creates an implicit convention that the renderer must scope entries by active type (otherwise `_cnv_copy_number` could leak into the SV tab's column meta). Workaround: return `{ base: ColumnFilterMeta[], sv?: ..., cnv?: ..., str?: ... }` and have the renderer pick the right slice. Small API break.

**Feasibility.** 1-2 days of work per variant type (so ~4 days total), plus UI wiring. No schema changes, no new tables. Reversible.

### Option B: Per-variant-type query-builder routing

**Architecture sketch.**

Introduce `VariantSvFilterBuilder`, `VariantCnvFilterBuilder`, `VariantStrFilterBuilder` as sibling classes to the existing `VariantFilterBuilder`. `VariantRepository.getVariants` inspects `filter.variant_type` and dispatches:

```
if (filter.variant_type === 'sv') return this.svFilterBuilder.build(filter)
if (filter.variant_type === 'cnv') return this.cnvFilterBuilder.build(filter)
...
return this.snvFilterBuilder.build(filter)  // existing one, now renamed
```

Each builder has its own `SORTABLE_COLUMNS`, its own JOIN structure, its own `column_filters` loop. The SNV builder stays mostly as-is; the SV/CNV/STR builders subclass a common abstract base that handles the shared filters (gene_symbol, panel_intervals, tag_ids, etc.).

**Pros.**

- Cleaner separation — each type's filter logic lives in its own file. No more `if (filter.variant_type === 'sv') { ... }` branching in the main builder.
- Easier per-type optimization (e.g. SV queries can skip the `cadd`/`gnomad_af` WHERE branches entirely).
- Extension columns are first-class in each sub-builder's `SORTABLE_COLUMNS` — no aliases, no leakage concerns.

**Cons.**

- **Massive duplication** of the shared filter logic (gene, panel_intervals, tags, annotation_scope, FTS, internal AF, starred, has_comment, ACMG). Those 350+ lines are not trivially extractable because they reference `this.kysely` and the base `variants` table in ways that differ subtly between SNV and SV queries.
- Violates the project's DRY feedback — `feedback_dry_principles.md` says "never duplicate code". Each new filter added would need to be added in 4 places.
- Breaks the existing `column_filters` UX mental model: today a single `column_filters` map filters *anything the column comes from*. Under Option B, the same column names have different implementations per type.
- The cohort view (`CohortDataTable`) would need its own parallel per-type routing, compounding the duplication.
- Sort-by is also affected: `applySort` lives on the same class, so it'd also need per-type copies.

**Feasibility.** High initial cost (3-5 days including test rewrites) and high ongoing maintenance cost. Not recommended.

### Option C: Materialized flat view `variants_flat` with pre-joined extension columns

**Architecture sketch.**

Create a SQL view or a materialized table that pre-joins `variants` with all three extension tables:

```sql
CREATE VIEW variants_flat AS
SELECT
  v.*,
  sv.support AS sv_support,
  sv.vaf    AS sv_vaf,
  sv.sv_is_precise,
  cnv.copy_number AS cnv_copy_number,
  cnv.copy_number_quality AS cnv_gq,
  str.repeat_id AS str_repeat_id,
  str.str_status,
  ...
FROM variants v
LEFT JOIN variant_sv  sv  ON sv.variant_id  = v.id
LEFT JOIN variant_cnv cnv ON cnv.variant_id = v.id
LEFT JOIN variant_str str ON str.variant_id = v.id
```

`VariantFilterBuilder` changes `selectFrom('variants')` to `selectFrom('variants_flat')`. Every extension column becomes a first-class member of `SORTABLE_COLUMNS`. `getColumnMeta` runs a single aggregate scan against the view.

Variants for this option:
- **C.1: View** — SQLite is smart enough to push filter predicates into the underlying LEFT JOINs when filters reference the outer columns. Query plan is effectively the same as an explicit LEFT JOIN every time.
- **C.2: Materialized table** — A real table with the pre-joined columns, updated via triggers or on import. Query is faster (single-table scan) but writes are slower and schema-migration complexity grows.

**Pros.**

- **Simplest possible filter code.** Extension columns become regular columns. `column_filters`, sort, metadata aggregation, FTS, panel intervals — all work identically for SNV and SV.
- **One source of truth** for "what's a filterable column".
- **DSL integration is free** — DSL can reference `sv_support` without caring about tables.

**Cons.**

- **C.1 (view)**: Every query now has three LEFT JOINs even for SNV-only queries (99% of use). SQLite's query planner is usually good but this is a real cost. With 5k variants this is imperceptible; with 200k variants (whole-genome SNV case) we'd need to measure. `ANALYZE` plus per-extension-table indexes help.
- **C.2 (materialized)**: Doubles the storage footprint for the variants table (every SNV row gets null columns for 40 extension fields). Requires triggers on all three extension tables to keep the flat table in sync, or a full rebuild after import. Import pipeline changes.
- **FTS5 trigger maintenance**: `variants_fts` is anchored to `variants.id` via `content='variants'` (`schema.ts:90-100`). Adding a view on top doesn't break this, but if we go C.2 we need new triggers.
- **Cohort summary complexity**: `cohort_variant_summary` aggregates over `variants`; a flat view would need a parallel rebuild, or the aggregation would silently miss type-specific columns.
- **Biggest blast radius** — touches schema, FTS, import, migrations, and every repository that references `variants`. Highest risk.

**Feasibility.** C.1 is 1 day of work but needs a performance validation pass on large cases. C.2 is 4-5 days plus schema migration plus coverage across the import pipeline and cohort summary.

## Recommendation

**Pick Option A.**

Reasons:

1. **Matches the existing investment.** `VariantFilterBuilder.build()` already has conditional JOIN branches at lines 114-153. Option A just pushes those branches two steps further (also contribute to WHERE, not just SELECT). There is no architectural rethink.
2. **Minimum DRY violation.** The shared filter logic (gene, panels, tags, annotations, inheritance, FTS) is written once. Option B would duplicate all of it.
3. **Incremental rollout is trivial.** Ship CNV copy-number filter first (highest clinical value, 1 column), then SV support/vaf, then STR status. Each ships as a 30-line patch to `EXTENSION_SORTABLE_COLUMNS` + a matching drawer UI section. No migrations, no schema drift.
4. **Cohort view gets it for free.** Both `CohortDataTable` and the case-view `VariantTable` use the same `VariantFilterBuilder` indirectly (via `VariantRepository`), so teaching the builder once benefits both surfaces.
5. **Reversible.** If we later decide to migrate to Option C.2 (materialized table) for performance reasons, Option A's extension-map-driven resolver is exactly the translation layer we'd need anyway.
6. **Leaves hooks for canonical columns.** The forthcoming canonical-columns research topic (#3) presumably wants a unified column registry. Option A's `EXTENSION_SORTABLE_COLUMNS` is a stepping stone — merging the `variants`-side `SORTABLE_COLUMNS` and the per-type extension maps into a single canonical `COLUMN_REGISTRY` later is mechanical.

## Incremental rollout plan

Shippable in ~5 phases. Each phase produces a user-visible improvement without a big-bang migration.

1. **Phase 1 — Plumbing: per-type column metadata (no UI change).**
   Extend `getColumnMeta(caseId, variantType?)` to emit extension-table metadata for the active type. Introduce `EXTENSION_SORTABLE_COLUMNS` constant (initially empty map; just the scaffold + a type gate). Add unit tests for the two-step resolution. Ships as a no-op refactor.

2. **Phase 2 — CNV `copy_number` filter.**
   Add `_cnv_copy_number` to `EXTENSION_SORTABLE_COLUMNS.cnv`. Extend the `column_filters` loop in `VariantFilterBuilder.build()` to resolve against the extension map. Flip `sortable` to `true` on `cnv-columns.ts:18` (and sort logic now needs to be table-qualified — but `_cnv_copy_number` already has an alias that resolves; this is `cnv.copy_number`). Add a `COLUMN_FILTER_OVERRIDES['_cnv_copy_number'] = { forceMode: 'numeric' }`. **Ships user-facing: users can now filter "CN ≥ 3" via the CNV tab header filter.**

3. **Phase 3 — CNV other fields + SV `support`/`vaf`/`is_precise`.**
   Same pattern, additional entries in the extension map. No new infrastructure. **Ships:** SV header filters for support, VAF, precision.

4. **Phase 4 — STR `str_status` / `disease` / `repeat_id`.**
   Same pattern. Categorical columns use the `distinctValues` path of `getColumnMeta`. **Ships:** "show only full_mutation STRs" filter.

5. **Phase 5 — Drawer UI: conditional "Type properties" section.**
   Add a new `v-expansion-panel` in `FilterDrawer.vue` that renders only when `selectedVariantType !== 'snv'`. This gives the power user a dedicated SV/CNV/STR filter section rather than making them hunt through column header menus. Ties the per-type fields to `filters` via the shared `FilterDrawerState`. Requires extending `FilterState` with a `typeFilters: { sv?: {...}, cnv?: {...}, str?: {...} }` optional bag, and teaching `buildFilterFromState` to forward it as `column_filters` entries.

6. **Phase 6 (nice-to-have) — DSL vocabulary for extension columns.**
   Add `_cnv_copy_number`, `_sv_support`, etc. as recognized identifiers in `src/renderer/src/dsl/*`. Lower priority; power users who need this can already use the drawer or header filters from phases 2-5.

Each phase is independently testable, backwards-compatible, and can ship as its own PR. Phase 1 alone is mergeable as pure refactor.

## Open questions / dependencies on other exploration topics

1. **Canonical columns (research topic #3).** If #3 proposes a unified `COLUMN_REGISTRY` that registers `{ key, table, sqlColumn, dataType, sortable, filterable, variantType? }` as a single source of truth, Option A's `EXTENSION_SORTABLE_COLUMNS` folds into it directly. Coordinate so we don't ship a transient constant that gets renamed a month later. **Hook: make `EXTENSION_SORTABLE_COLUMNS` an exported constant from `VariantFilterBuilder.ts` so #3 can consume it during the unification pass.**

2. **Cohort view parity.** The cohort-level filter pipeline (`src/renderer/src/components/CohortTable.vue` + `useCohortData.ts:297-299`) already passes `variant_type` through its own path. Does it share `VariantFilterBuilder` or does it have its own builder? Quick audit: `AssociationDataBuilder.ts` and `CohortSummaryService.ts` may duplicate query construction. Any solution we pick must apply to both. **Recommendation:** verify that cohort queries route through the same builder before Phase 2 ships; if not, either unify them first or accept divergent behavior.

3. **Per-column sort on extension columns.** If we flip `sortable: true` on `_cnv_copy_number`, the existing `applySort` path (`VariantFilterBuilder.ts:565-590`) tries to resolve the key via `SORTABLE_COLUMNS[sort.key]`. We need to either (a) teach `applySort` about the extension map too, or (b) keep `sortable: false` and introduce a distinct `filterable: true` flag. Option (a) gives users both features at once and is cheap (`applySort` resolves the same way `build` does). **Recommendation:** (a).

4. **Panel-interval queries for SV spans.** The panel-intervals clause at `VariantFilterBuilder.ts:244-256` only checks `variants.pos`, so a 50 kb DEL whose left breakpoint lies before a panel's first gene is excluded from panel-scoped SV searches. Should be tracked as a separate bug but is in the same functional area. **Recommendation:** spin off into its own ticket; not in scope for the filter adaptation.

5. **Extension data absence under annotation_scope='all'.** Global annotations (`variant_annotations`) live on `(chr, pos, ref, alt)`. SVs with imprecise breakpoints may collide under that key even though they're different calls. This is pre-existing, but gets worse when extension filters are added because users will be querying across merged equivalence classes. Needs a policy decision: are global annotations scoped per variant type? (Today: no.) Flag for PM/clinical discussion.

6. **FTS inclusion of extension text fields.** `variants_fts` indexes `gene_symbol`, `consequence`, `omim_mim_number` (`schema.ts:90-100`). Should `variant_str.disease`, `variant_sv.event_id`, etc. also be FTS-searchable? Out of scope for this exploration but a follow-up question.

7. **The `variant_type` flag in `FilterState`.** Today `variant_type` flows via `CaseView.vue:82-85` only. If a future UX lets users "filter across multiple variant types in one table" (e.g. a unified overview), we'd need to add it to `FilterState` and `buildFilterFromState`. No impact on Option A — the extension map would key off `filter.variant_type` exactly as today.
