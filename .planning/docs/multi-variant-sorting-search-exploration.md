# Sorting and search extensions for multi-variant-type tables

Exploration notes for extending the sort and FTS infrastructure to cover the
`variant_sv`, `variant_cnv`, and `variant_str` extension tables introduced in
migration v25 (PR #147).

## Summary

VarLens now stores SV, CNV, and STR variants with a `variant_type` discriminator
on `variants` and type-specific fields on three extension tables. The sort
pipeline only knows about physical columns on `variants` (`SORTABLE_COLUMNS`
in `VariantFilterBuilder.ts`), and the FTS5 index only covers three text
columns on `variants` (`gene_symbol`, `consequence`, `omim_mim_number`). As a
result, several columns shown in the SV/CNV/STR tabs are marked
`sortable: false` in the renderer's column definitions, and users cannot
search for extension-table text fields like `repeat_unit` or `disease`.

This document maps the current pipeline, pinpoints the gap, and evaluates four
designs (A: JOIN expansion, B: flat search index, C: per-type FTS5 + federation,
D: hybrid). The recommended path is **Option D (hybrid)** rolled out in three
incremental phases.

## Current state

### Sort pipeline (SORTABLE_COLUMNS to ORDER BY)

Primary source:
`src/main/database/VariantFilterBuilder.ts:16-50` (SORTABLE_COLUMNS) and
`:565-590` (`applySort`).

```
SORTABLE_COLUMNS: Record<string, string> = {
  chr, pos, gene_symbol, omim_mim_number, func, consequence,
  transcript, cdna, aa_change, gt_num, gnomad_af, cadd, qual,
  hpo_sim_score, clinvar, moi,
  variant_type, end_pos, sv_type, sv_length, caller
}
```

Every entry maps a key to a *bare column name* (no table qualifier). The
`applySort` method builds one `orderBy` per sort item via
`sql`${sql.ref(sqlColumn)} ${dir} ${nulls}``
and always appends `id ASC` for stable pagination. Unknown keys are silently
dropped with a `mainLogger.warn`.

Key consumer:
- `VariantRepository.getVariants()` (`VariantRepository.ts:307-355`) calls
  `filterBuilder.build(filter)` to assemble the SELECT, then
  `filterBuilder.applySort(dataQuery, sortBy)` before pagination.
- The **count query** is created by compiling `filterBuilder.build(filter)` and
  wrapping it in `SELECT count(*) as count FROM (...)` at `VariantRepository.ts:323`.
  Since the count wraps the outer SELECT, any column referenced by ORDER BY
  must be present in the compiled SELECT list — SQLite accepts references to
  derived columns only when they appear in the wrapped subquery.

### Extension-table JOINs (present but sort-hostile)

`VariantFilterBuilder.build()` *already* LEFT JOINs the extension table when
`filter.variant_type` is one of `sv`, `cnv`, or `str`
(`VariantFilterBuilder.ts:114-153`). The JOIN-qualified columns are
selected with aliases like `sv.support as _sv_support` so the renderer can
read them by that key. However:

1. The aliases are underscore-prefixed and **not** listed in `SORTABLE_COLUMNS`.
2. `getColumnMeta()` (`VariantRepository.ts:437-517`) runs a COUNT(DISTINCT)
   aggregate directly against the `variants` table with no JOINs:
   ```sql
   SELECT COUNT(DISTINCT "<sqlCol>") AS "cnt_<key>", ...
   FROM variants WHERE case_id = ?
   ```
   If `SORTABLE_COLUMNS` contained `_cnv_copy_number: 'cnv.copy_number'` the
   aggregate would reference a table alias that is not in the FROM clause,
   breaking filter-options loading.
3. The `column_filters` loop at `VariantFilterBuilder.ts:377-416` uses
   `sqlColumn as keyof Variant` for Kysely's `where()` overload, which would
   also fail for dotted `cnv.xxx` values.

So the present design has **two conflicting consumers of `SORTABLE_COLUMNS`**
— the query builder (which could tolerate JOIN-qualified names) and the
metadata scanner (which cannot). That is the crux of the gap.

### FTS5 index and trigger maintenance

Primary source: `src/main/database/schema.ts:90-164` and the companion
`migrateVariantsTable`/`initializeSchema` functions.

```sql
CREATE VIRTUAL TABLE variants_fts USING fts5(
  gene_symbol, consequence, omim_mim_number,
  content='variants',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1',
  prefix='2 3'
);
```

External-content FTS5 table over `variants`. Indexed columns are exactly
three: `gene_symbol`, `consequence`, `omim_mim_number`.

Triggers (`schema.ts:108-125`) — `variants_fts_ai`, `variants_fts_ad`,
`variants_fts_au` — keep the index in sync with insert/delete/update on
`variants`. The "legacy" trigger set at `:147-163` omits `omim_mim_number`
for old databases that predate that column; `initializeSchema` detects schema
drift by comparing `variants_fts` pragma vs. `PRAGMA table_info(variants)`
and rebuilds when they mismatch.

Bulk-insert performance pattern:
- `VariantRepository.beginBulkInsert()` (`VariantRepository.ts:60-66`)
  drops all three FTS triggers.
- Inserts happen with no per-row index updates.
- `finishBulkInsertNoCount()` (`:180-207`) calls
  `INSERT INTO variants_fts(variants_fts) VALUES('rebuild')`,
  recreates triggers via `createFTSTriggers`, runs `ANALYZE`, then
  `VALUES('optimize')`.
- The same pattern is duplicated in
  `src/main/workers/worker-db.ts:19-96` (`DROP_FTS_TRIGGERS` + `rebuildFts`)
  for import/delete/export worker threads.

Query path:
- Single-token search — `VariantSearchService.applySingleSearchToken()`
  (`VariantSearchService.ts:68-79`):
  ```
  id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH '"token"*')
  ```
  With an HGVS fallback (`c.` or `p.` prefix) that uses LIKE on
  `cdna` / `aa_change` instead.
- Boolean search — parsed to AST by
  `src/shared/utils/boolean-search.ts`, emitted via
  `fts5-search-emitter.ts` which wraps every term in the same `id IN (...)`
  subquery joined by AND/OR/NOT operators. (Not a true FTS5 MATCH expression
  boolean — each term is its own subquery. That matters for Option C below.)
- Dedicated search RPC — `VariantSearchService.searchVariants()`
  (`VariantSearchService.ts:84-98`) joins `variants v` to
  `variants_fts fts ON v.id = fts.rowid` and orders by `bm25(variants_fts)`.

UI surface: there is no per-column search box. A single global
`v-text-field` bound to `filters.searchQuery` lives in
`src/renderer/src/components/FilterDrawer.vue:37-46`, wrapped by a DSL search
bar (`DslSearchBar`) when DSL mode is active. The input flows into
`VariantFilter.search_query` which is then picked up by the search service.

### Aggregate query gotcha (why extension columns are sortable:false)

Three contributing facts:

1. `getColumnMeta()` runs directly against `variants` (no JOINs). Adding
   `vs.xyz` entries to `SORTABLE_COLUMNS` would produce
   `COUNT(DISTINCT "sv.support")` — which SQLite interprets as a literal
   column name "sv.support" on `variants`, not a qualified reference, and
   either errors or returns zero.
2. The count query in `getVariants()` wraps `filterBuilder.build()` with
   `SELECT count(*) FROM (...)`. If the inner query doesn't JOIN the extension
   table (i.e. the user is on the SNV tab), any ORDER BY referencing `sv.*`
   would blow up. Because sort is applied *after* build but ORDER BY
   is evaluated against the compiled SELECT, sort keys must always be
   resolvable on the current FROM shape.
3. `filterBuilder.build()` only JOINs the extension table when
   `filter.variant_type` is set to that specific type. Sorting SNV variants by
   `copy_number` is therefore non-sensical as well as technically impossible.

The current workaround at `sv-columns.ts:22-25`, `cnv-columns.ts:18-23`,
`str-columns.ts:12-23` is to mark every `_sv_*` / `_cnv_*` / `_str_*` column
`sortable: false` so Vuetify never sends those sort keys to the backend.

## Gap analysis

### Sortable extension columns we need

User asked for four scenarios — here is how each resolves against the current
code:

| Scenario | Column | Status | Where the block lives |
|---|---|---|---|
| Sort SV list by length descending | `sv_length` | **Already works** | `SORTABLE_COLUMNS` line 48; the v25 migration made this a real column on `variants` |
| Sort SV list by `end_pos` | `end_pos` | **Already works** | Same; line 46 |
| Sort SV list by `sv_type` | `sv_type` | **Already works** | Same; line 47 |
| Sort CNV list by `copy_number` | `variant_cnv.copy_number` | **Blocked** | Column is on extension table; `cnv-columns.ts:18` marks `sortable: false` |
| Sort SV list by `sv.support` | `variant_sv.support` | **Blocked** | `sv-columns.ts:22` marks `sortable: false` |
| Sort STR list by `alt_copies` / `ref_copies` | `variant_str.alt_copies` | **Blocked** | `str-columns.ts:17-18` |
| Sort STR list by `normal_max` / `pathologic_min` | Extension columns | **Blocked** | `str-columns.ts:20-21` |

The `sv_length` / `end_pos` / `sv_type` cases are already satisfied because
migration v25 promoted those to real columns on `variants` (they are
cross-cutting enough to benefit every type). Confirmed in
`migrations.ts:1407-1413`.

### Searchable extension columns we need

Current FTS index: `gene_symbol`, `consequence`, `omim_mim_number`.

Missing coverage (grouped by table):

| Table | Column | Why we want it searchable |
|---|---|---|
| `variant_sv` | `event_id`, `mate_id` | SV breakend IDs are user-visible and cross-referenced in VCFs |
| `variant_cnv` | — | CNV extension has no text fields that warrant FTS (all numeric) |
| `variant_str` | `repeat_id`, `repeat_unit`, `display_repeat_unit` | `repeat_id` is the ExpansionHunter locus label; `repeat_unit` is the DNA motif users search for (e.g. "CAG", "TCAG") |
| `variant_str` | `disease` | Users often search by disease name ("Huntington", "SCA3") |
| `variant_str` | `inheritance_mode` | Low cardinality but worth including |
| `variants` (existing, not in FTS yet) | `transcript`, `cdna`, `aa_change` | Already sortable, and HGVS search currently uses LIKE via a hardcoded fallback — moving them into FTS would unify the path |

Specific example from the task — searching "TCAG" in STR repeat units:
`VariantSearchService.applySingleSearchToken` at line 75 builds
`'"TCAG"*'` and queries `variants_fts MATCH ?`, but `variants_fts` does not
contain `repeat_unit`, so the match returns zero rows regardless of how many
STR variants actually have that motif.

## Design options

### Option A — Expand the JOIN and qualify SORTABLE_COLUMNS

**Shape.** Always LEFT JOIN all three extension tables in
`VariantFilterBuilder.build()`, not just when `variant_type` matches. Expand
`SORTABLE_COLUMNS` with JOIN-qualified entries like
`cnv_copy_number: 'variant_cnv.copy_number'`. Fix the aggregate gotcha by
splitting `SORTABLE_COLUMNS` into two maps: `BASE_SORTABLE_COLUMNS` (used by
`getColumnMeta`) and `EXTENDED_SORTABLE_COLUMNS` (used by `applySort`).

**Query shape** (sketch):
```sql
SELECT variants.*, sv.support AS _sv_support, cnv.copy_number AS _cnv_copy_number, ...
FROM variants
LEFT JOIN variant_frequency vf ON ...
LEFT JOIN variant_sv sv  ON sv.variant_id  = variants.id
LEFT JOIN variant_cnv cnv ON cnv.variant_id = variants.id
LEFT JOIN variant_str str ON str.variant_id = variants.id
WHERE variants.case_id = ?
ORDER BY cnv.copy_number DESC NULLS LAST, id ASC
```

**Count query**: `SELECT count(*) FROM (SELECT ... above ...)`. Because every
join is a `LEFT JOIN` with a 1:1 relation on `variant_id` (the extension
tables use `variant_id` as primary key per migration v25), row counts are
unchanged — no GROUP BY or subquery trickery needed.

**Column filters**: The `column_filters` loop at
`VariantFilterBuilder.ts:377-416` currently uses
`sqlColumn as keyof Variant` for Kysely's `where()`. Dotted strings break
that cast, so the loop would need to use `sql.ref(sqlColumn)` for extended
entries. The same treatment is already used for ORDER BY at line 581, so
the pattern is established.

**Aggregate queries**: `getColumnMeta()` keeps using `BASE_SORTABLE_COLUMNS`
only. Extension-column meta (distinct values, min/max) could be populated on
demand by a separate path that runs per-extension-type queries keyed by
`variant_type`. Those can be lazy — populated only when the user actually
expands the SV/CNV/STR tab.

**FTS**: Not addressed by this option.

**Write cost**: Zero. The extension tables are already maintained by
`insertBatch()`; this option only changes reads.

**Migration**: None. Ship as a code-only change.

**Pros**:
- Minimal surface area, no schema changes.
- Preserves existing bulk-insert drop/rebuild pattern unchanged.
- Every extension column immediately becomes sortable and filterable for free.

**Cons**:
- SNV/Indel queries now carry three pointless LEFT JOINs per query (one per
  extension table). Not expensive on indexed PKs (`variant_id` is the PK of
  each extension table) but adds four rows of plan steps in EXPLAIN.
- Doesn't solve the FTS gap at all.
- `getColumnMeta()` needs a parallel code path to aggregate extension columns.
- Search in extension fields still impossible.

### Option B — Flat `variant_search_index` table maintained by triggers

**Shape.** A single denormalized index table populated by triggers on
`variants` plus each extension table. It holds everything the UI needs for
sort and search in one row per variant.

```sql
CREATE TABLE variant_search_index (
  variant_id INTEGER PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL,
  variant_type TEXT NOT NULL,
  -- denormalized sortable fields
  sv_support INTEGER,
  sv_vaf REAL,
  sv_event_id TEXT,
  cnv_copy_number INTEGER,
  cnv_quality INTEGER,
  str_ref_copies REAL,
  str_alt_copies TEXT,  -- free text because STR alt can be e.g. "22,40"
  str_normal_max INTEGER,
  str_pathologic_min INTEGER,
  str_rank_score TEXT,
  -- denormalized searchable text (space-separated for FTS tokenization)
  search_text TEXT
);

CREATE INDEX idx_vsi_case_type ON variant_search_index(case_id, variant_type);
CREATE INDEX idx_vsi_cnv_cn ON variant_search_index(cnv_copy_number);
-- ... etc
```

FTS5 is rebuilt as an external-content index over **this** table instead of
`variants`:

```sql
CREATE VIRTUAL TABLE variants_fts USING fts5(
  search_text,
  content='variant_search_index',
  content_rowid='variant_id',
  tokenize='unicode61 remove_diacritics 1',
  prefix='2 3'
);
```

The `search_text` column is a space-joined concatenation of every searchable
field: `gene_symbol consequence omim_mim_number transcript cdna aa_change
repeat_unit disease event_id mate_id ...`.

Triggers on every source table (`variants`, `variant_sv`, `variant_cnv`,
`variant_str`) upsert into `variant_search_index` and then the existing
external-content FTS trigger chain fires on `variant_search_index`.

**Write cost**: Significant.
- Each variant insert triggers one `variants` row write + one
  `variant_search_index` row write + one FTS5 update.
- Each extension-row insert triggers an UPDATE to
  `variant_search_index.<col>` + an FTS5 delete/insert.
- That is 3x the current write volume for SV/CNV/STR variants.
- On a 6,000-variant STR file this is still sub-second but doubles on
  300k-variant SV files.
- The existing bulk-insert drop/rebuild trick can be extended: drop the
  `variant_search_index` triggers *and* the FTS triggers during import,
  rebuild `variant_search_index` from a single INSERT ... SELECT at the end,
  then run `VALUES('rebuild')` on the FTS5 index. One-pass rebuild is
  O(n + m) where n is variants and m is extension rows — roughly equivalent
  to the current FTS rebuild.

**Migration**: v26 adds the table, triggers, and re-creates the FTS5 table.
Re-populating from existing databases requires a full scan — a one-time
cost. The `initializeSchema` drift detector at `schema.ts:258-318` would
need to learn about the new table; the cleanest path is to move all FTS
setup into `migrations.ts` and have `schema.ts` only ensure the base tables.

**Pros**:
- Sort and search unified into one index table — ORDER BY never needs a JOIN,
  and FTS covers everything in one index.
- Query complexity stays exactly the same as today: single LEFT JOIN from
  `variants` to `variant_search_index`.
- Filter/sort/search scale identically — no per-type dispatching in the query
  layer.

**Cons**:
- Write amplification (roughly 3x for extension-table imports).
- Non-trivial migration and a new table to keep in lock-step with source
  tables forever.
- `search_text` denormalization means every update to `variants.gene_symbol`
  must also update `variant_search_index.search_text` — a second trigger path
  to maintain.
- Schema drift risk: if a new extension column is added in v27, three places
  must be updated (extension table, `variant_search_index`, trigger).

### Option C — Per-extension FTS5 virtual tables with federated search

**Shape.** Keep `variants_fts` as-is. Add three more external-content FTS5
tables:

```sql
CREATE VIRTUAL TABLE variant_sv_fts USING fts5(
  event_id, mate_id,
  content='variant_sv', content_rowid='variant_id', ...
);
CREATE VIRTUAL TABLE variant_str_fts USING fts5(
  repeat_id, repeat_unit, display_repeat_unit, disease, inheritance_mode,
  content='variant_str', content_rowid='variant_id', ...
);
-- variant_cnv has no text fields worth indexing
```

Each gets its own ai/ad/au trigger set on its source extension table.

Search becomes a UNION at query time:
```sql
id IN (
  SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?
  UNION
  SELECT rowid FROM variant_sv_fts WHERE variant_sv_fts MATCH ?
  UNION
  SELECT rowid FROM variant_str_fts WHERE variant_str_fts MATCH ?
)
```

Sort is **not solved** by this option — we still need Option A or similar
for ORDER BY against extension columns.

**Write cost**: Modest. One extra FTS5 insert per extension-row write.
The bulk-insert teardown pattern generalizes cleanly — just add the new
trigger names to `DROP_FTS_TRIGGERS` and `createFTSTriggers`.

**Migration**: v26 adds three new virtual tables and trigger sets. Existing
databases get a one-time populate via `INSERT INTO variant_sv_fts SELECT ...`.

**Pros**:
- Natural modular fit for SQLite FTS5's per-table content model.
- BM25 ranking per source; easy to attribute a hit to a specific field.
- Each extension table owns its own FTS lifecycle — no central coordinator.
- Adding a new variant type (e.g. MEI, mobile-element insertions) is a
  pure additive change: new extension table + new FTS5 + UNION slot.

**Cons**:
- Search becomes a 3-way UNION at query time. The existing boolean AST
  emitter (`fts5-search-emitter.ts`) already wraps each term in a subquery,
  so the change there is mechanical — but the combinatorics grow with
  variant-type count.
- Search across multiple extension tables in one query (e.g. "find anything
  matching TCAG") is fine, but *also* needs a `variant_type` filter to not
  pollute SNV search results — query planner has no way to know "TCAG is an
  STR-only concern". That is a UX question, not a DB one.
- Still need a sort solution — Option C is necessarily combined with Option A
  or its equivalent.
- `variants_fts` still lacks `transcript`/`cdna`/`aa_change` unless we
  separately extend it (which is orthogonal but worth doing in the same pass).

### Option D — Hybrid: Option A for sort, Option C for search

Combine the cheapest sort extension (always-on LEFT JOINs + split
`SORTABLE_COLUMNS`) with the most modular search extension (per-extension
FTS5 tables + UNION).

**Shape**:
1. Split `SORTABLE_COLUMNS` into `BASE_SORTABLE_COLUMNS` (for `getColumnMeta`)
   and a combined `ALL_SORTABLE_COLUMNS` (for `applySort` + `column_filters`).
2. Always LEFT JOIN `variant_sv`, `variant_cnv`, `variant_str` in `build()`.
3. Add per-extension FTS5 tables with their own triggers.
4. Extend `fts5-search-emitter.ts` to emit UNIONs for cross-table search.
5. Extend `variants_fts` to include `transcript`, `cdna`, `aa_change` so
   the HGVS fallback LIKE can be retired (orthogonal improvement, but
   cheap to include now).

**Query shape for a cross-table search**:
```sql
SELECT variants.*, sv.support AS _sv_support, cnv.copy_number AS _cnv_copy_number, ...
FROM variants
LEFT JOIN variant_sv sv ON sv.variant_id = variants.id
LEFT JOIN variant_cnv cnv ON cnv.variant_id = variants.id
LEFT JOIN variant_str str ON str.variant_id = variants.id
WHERE variants.case_id = ?
  AND variants.id IN (
    SELECT rowid FROM variants_fts WHERE variants_fts MATCH '"TCAG"*'
    UNION
    SELECT rowid FROM variant_str_fts WHERE variant_str_fts MATCH '"TCAG"*'
    UNION
    SELECT rowid FROM variant_sv_fts WHERE variant_sv_fts MATCH '"TCAG"*'
  )
ORDER BY cnv.copy_number DESC NULLS LAST, id ASC
```

**Trade-offs vs. pure options**:
- Sort: same as Option A (always-on LEFT JOINs, negligible cost for indexed
  PK joins).
- Search: same as Option C (modular per-table FTS, UNION at query time).
- Write cost: extension-table inserts trigger one extra FTS5 insert each
  (not three like Option B).
- Migration: add three extension FTS5 tables + optionally extend
  `variants_fts` schema → v26 migration.
- Bulk-insert teardown needs to drop and recreate the extended trigger set
  but otherwise uses the same rebuild pattern.

**Pros**:
- Solves both problems.
- Minimal write amplification — extension tables were rarely written compared
  to `variants` anyway.
- Stays close to the SQLite idiom (content-linked FTS5 tables).
- Can roll out sort and search independently.

**Cons**:
- Two interconnected pieces of work to land, though they can ship in separate
  PRs.
- `fts5-search-emitter.ts` becomes slightly smarter — emits a templated
  UNION body rather than a single MATCH subquery.

## Recommendation

**Adopt Option D (hybrid).**

Reasoning:
- The sort problem is strictly a query-time concern and benefits from
  Option A's always-on LEFT JOINs without any schema changes. The risk is
  low because v25 already made every extension table have `variant_id` as a
  primary key, so LEFT JOIN costs are bounded.
- The search problem is strictly a write-time / schema concern and benefits
  from Option C's modular per-table FTS5 tables. The write amplification is
  one extra FTS row per extension-row insert — far cheaper than Option B's
  denormalized flat table.
- Option B's flat `variant_search_index` table is tempting but introduces
  schema drift risk (three places to keep in sync on any new column) and
  triples write volume for a benefit that Option D achieves with a simple
  UNION.
- Option A alone leaves search broken; Option C alone leaves sort broken.
  Doing both together is strictly better than either alone and only costs
  one migration.

## Incremental rollout plan

### Phase 1 — Sort extension (Option A, pure code change)

1. `src/main/database/VariantFilterBuilder.ts`:
   - Introduce `BASE_SORTABLE_COLUMNS` (current map) and
     `EXTENSION_SORTABLE_COLUMNS` (new map with `variant_sv.*`,
     `variant_cnv.*`, `variant_str.*`).
   - Export `ALL_SORTABLE_COLUMNS` as the union for `applySort` +
     `column_filters`.
   - Change `build()` to LEFT JOIN all three extension tables
     unconditionally, instead of dispatching on `filter.variant_type`.
2. `src/main/database/VariantRepository.ts`:
   - `getColumnMeta()` uses `BASE_SORTABLE_COLUMNS` (unchanged shape, just
     a rename).
   - Add an opt-in second pass for extension-column metadata per
     `variant_type` (only runs when the tab is active).
3. `src/renderer/src/components/variant-table/sv-columns.ts`,
   `cnv-columns.ts`, `str-columns.ts`: flip the relevant
   `sortable: false` entries to `true`. Rename renderer keys from
   `_sv_support` to `sv_support` (or keep the underscore alias — either
   works as long as they match `ALL_SORTABLE_COLUMNS`).
4. Tests: extend `tests/main/database/variants.test.ts` with sort-by-extension
   cases for each variant type.

Ship as a single PR. No migration, no schema changes, reversible by a revert.

### Phase 2 — Search extension over extension tables (Option C)

1. Migration v26 in `src/main/database/migrations.ts`:
   - `CREATE VIRTUAL TABLE variant_sv_fts USING fts5(event_id, mate_id, content='variant_sv', content_rowid='variant_id', ...)`
   - `CREATE VIRTUAL TABLE variant_str_fts USING fts5(repeat_id, repeat_unit, display_repeat_unit, disease, inheritance_mode, content='variant_str', content_rowid='variant_id', ...)`
   - Populate with `INSERT INTO ... SELECT FROM variant_sv/variant_str`.
   - Install ai/ad/au triggers for both.
2. `src/main/database/schema.ts`: add the new `CREATE TRIGGER` SQL
   constants (`createSvFtsTriggers`, `createStrFtsTriggers`). Move ownership
   of FTS table creation into migrations so `initializeSchema` only ensures
   the base physical tables.
3. `src/main/database/VariantRepository.ts` and
   `src/main/workers/worker-db.ts`:
   - `beginBulkInsert()` and `DROP_FTS_TRIGGERS` drop all six triggers
     (three per FTS table, one table per extension for now plus the
     existing variants triggers).
   - `finishBulkInsertNoCount()` and `rebuildFts()` rebuild all three FTS
     tables with `VALUES('rebuild')` + `VALUES('optimize')`, then
     re-install all triggers.
4. `src/main/database/search/fts5-search-emitter.ts`: emit
   `id IN (SELECT rowid FROM variants_fts WHERE ... MATCH ? UNION SELECT rowid FROM variant_sv_fts ... UNION SELECT rowid FROM variant_str_fts ...)`.
   Keep the HGVS LIKE fallback in place for now.
5. Tests: extend `tests/main/database/search.test.ts` with repeat_unit +
   disease + event_id search cases.

Ship as a second PR after Phase 1 lands and has been validated.

### Phase 3 — Optional polish

- Extend `variants_fts` to cover `transcript`, `cdna`, `aa_change` in a later
  migration; retire the HGVS LIKE fallback at
  `VariantSearchService.ts:68-79` and `fts5-search-emitter.ts:30-34`.
- Add a DSL mode hint: `repeat_unit:TCAG` → targeted search against
  `variant_str_fts` only. The existing DSL search bar
  (`DslSearchBar.vue`) has room for this.
- Per-column filter UI: once extension columns are sortable, the existing
  column-filter drawer (`CategoricalColumnFilter.vue`) naturally picks them
  up via `getColumnMeta()`.

## Dependencies on other exploration topics

- **Multi-build support** (from `MEMORY.md` → "multi-material" project vision):
  `cohort_variant_summary` gained `genome_build` in v25. If the flat-index
  table of Option B were ever adopted, it would need a `genome_build` column
  too. Option D is unaffected — the LEFT JOINs + per-table FTS5 design is
  orthogonal to build labels.
- **Multi-material / RNA-seq** (project vision doc): long-term, RNA expression
  and allele-specific data may live in yet another extension table. Option D's
  modular per-table FTS5 scales naturally to that case (add
  `variant_rna_fts`), whereas Option B would require re-plumbing the flat
  index schema every time a new modality lands.
- **Transcript-level sort** (see `TranscriptSection.vue` — it already has
  `sortable: false` columns): `variant_transcripts` is a 1:N relation, not
  1:1, so the LEFT JOIN pattern from Option A would inflate row counts.
  That is a separate design problem and should not be bundled with this
  effort.
- **Panel interval temp tables** (`VariantFilterBuilder.ts:596-633`): the
  LEFT JOIN expansion in Phase 1 interacts with the `_panel_intervals` temp
  table only at the WHERE clause level, not in the FROM list, so no conflict.
