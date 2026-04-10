# Unified variant view + configurable prioritization ranking

_Research track 4 of 4. Status: exploration, not yet a plan._

## Summary

VarLens now imports SNV, indel, SV, CNV and STR variants into a single `variants`
table (discriminated by `variant_type`) plus three extension tables
(`variant_sv`, `variant_cnv`, `variant_str`). The CaseView surfaces this as
per-type tabs, which forces users to hop between tables to find the variants
most likely to be causal. Users want an **aggregated, ranked shortlist** spanning
all types, driven by a **configurable filter+sort preset**, with drill-down back
into the per-type views. The MVP is explicitly a "dumb" prioritizer (no phenotype
model) but must leave a clean plug-in point for a future phenotype-driven ranker
(Exomiser-style).

The good news: the `filter_presets` table, `FilterPresetRepository`, the
`useFilterPresetStore` composable, the `PresetBar`/`PresetSaveDialog`/
`PresetManageDialog` UI and a set of built-in presets already exist. The MVP can
be built as a thin layer over them rather than a parallel system.

## Problem statement + user intent

User, verbatim: _"ideally this would be a ranking based short list of variants
best matching the individual. As we do not yet have implemented a own ranker
based on phenotypes and variants, this should initially be a configurable filter
set that aggregates important variants throughout the subtables for SNV indel
and CNV, SV, STR and also has a sorting system that's configurable, to allow
getting and checking the most important variants on a glance and then navigating
to the subtables as needed."_

Requirements extracted:

1. One shortlist that spans **all** variant types in a case.
2. Configurable filter set — user-savable, named.
3. Configurable sort order — potentially multi-column.
4. Top-N display with a score (or rank derived from sort).
5. Drill-down from shortlist row into the existing per-type detail view.
6. Extensible toward a real phenotype ranker later.

## Current state

### Query infrastructure inventory

- `src/main/database/VariantRepository.ts` — `getVariants(filter, limit, offset, sortBy)` is
  the single entry point. It delegates to `VariantFilterBuilder.build()` for the
  WHERE clause and `applySort()` for ORDER BY. Today it returns `Variant[]`,
  always filtered by a single `case_id` and optionally by `variant_type`.
- `src/main/database/VariantFilterBuilder.ts` — implements all WHERE logic via
  Kysely `$if` chains. **Critical for this design**: when
  `filter.variant_type === 'sv'` it adds `LEFT JOIN variant_sv`, `'cnv'` adds
  `variant_cnv`, `'str'` adds `variant_str`. The select list is type-specific
  (`_sv_support`, `_cnv_copy_number`, `_str_rank_score`, etc.). This is why the
  CaseView has a tab per type: a single query cannot currently LEFT JOIN all
  three extension tables without column collisions (they share no common
  schema).
- `SORTABLE_COLUMNS` in `VariantFilterBuilder.ts` — allowlist for `ORDER BY`.
  Extension-table columns (`sv.support`, `cnv.copy_number`, `str.rank_score`)
  are **deliberately excluded** with a clear comment: sorting on them would
  break `getColumnMeta`. Any new cross-type sort has to route around this.
- `src/main/database/cohort.ts` — has the reference pattern for SNV/indel
  collapsing: `cvs.variant_type IN ('snv', 'indel')` (line ~190). The shortlist
  query must apply the same semantics.
- Migration v25 (`migrations.ts` line 1403ff) — created the extension tables
  plus `case_import_files(id, case_id, file_path, file_size, variant_type,
  caller, variant_count, annotation_format, imported_at)`.
- `variants.caller` is a real column (added in v25). **The shortlist cannot
  link a variant row to a specific `case_import_files.id` directly** — the
  linkage is only by `(case_id, variant_type, caller)`. For "source" display in
  the shortlist that is good enough (we show the file the caller belongs to),
  but it is a gotcha for anyone expecting a FK.

### Existing prior art in the repo (this is the big one)

**There is already a full filter-preset system.** Do not build a parallel one.

- `src/main/database/FilterPresetRepository.ts` — CRUD over `filter_presets`
  table. Presets store `filter_json: Partial<FilterState>`, `is_built_in`,
  `is_visible`, `sort_order`.
- `src/main/database/built-in-presets.ts` — ships 8 built-ins: "Rare
  Pathogenic", "Rare HIGH", "Rare HIGH+MOD", "Ultra Rare HIGH", "ClinVar P/LP",
  "HIGH Impact", "Rare (1%)", "CADD >= 20". Concrete thresholds:
  `maxGnomadAf: 0.01`, `CLINVAR_PATHOGENIC = ['Pathogenic', 'Likely_pathogenic',
  'Pathogenic/Likely_pathogenic']`, `minCadd: 20`.
- `src/main/ipc/handlers/filter-presets.ts` — IPC channels
  `presets:list|create|update|delete|reorder`.
- `src/renderer/src/composables/useFilterPresetStore.ts` — already merges
  multiple active presets: scalar fields "last wins", array fields concat +
  dedupe.
- `src/renderer/src/components/PresetBar.vue`, `PresetSaveDialog.vue`,
  `PresetManageDialog.vue` — UI for togglable preset chips, save, manage.
- Migration versions 15/16 handled preset seeding and a later rework. Any new
  built-ins go through a v26+ migration.

What the existing system is missing for the shortlist MVP:

- No **sort** stored in a preset (only filter_json — `sortBy` is a UI-side concept).
- No **variant_type scope** stored (presets implicitly apply to whatever tab is
  active — they don't encode "apply across all types").
- No **ranking score** — presets are binary filters, not a score.
- No **cross-type query**. The preset bar sets filter state that the current
  tab applies; there is no "shortlist" view that ignores the tab.
- No **per-type thresholds** (a single `maxGnomadAf` can't say "SNV <= 1%, SV
  <= 5%", which matches Exomiser's recommendations).
- No **row-cap** / "top N" semantics.

### Per-type extension table fields relevant to ranking

| Field | Table | Shortlist use |
|---|---|---|
| `cadd` | variants | SNV pathogenicity proxy |
| `gnomad_af` | variants | SNV rarity |
| `consequence` (HIGH/MOD/LOW/MOD) | variants | SNV impact |
| `clinvar` | variants | Pre-scored pathogenicity (strong signal) |
| `hpo_sim_score` | variants | **Pre-existing HPO match column, phenotype-ready** |
| `acmg_best` / ACMG classification | variant_annotations + case_variant_annotations | Curated pathogenicity |
| `sv_length` | variants | SV "size" proxy (very rough) |
| `variant_sv.support`, `dr/dv`, `vaf` | variant_sv | SV call quality |
| `variant_sv.sv_is_precise` | variant_sv | SV confidence |
| `variant_cnv.copy_number` | variant_cnv | CNV deletion (<=1) or amplification (>=3) |
| `variant_cnv.copy_number_quality` | variant_cnv | CNV confidence |
| `variant_str.str_status` | variant_str | Already pre-classified (normal/intermediate/pathologic) |
| `variant_str.rank_score` | variant_str | **Already has a score string from the caller** |
| `variant_str.pathologic_min` / `alt_copies` | variant_str | Derive "over threshold" flag |
| `variant_str.disease` | variant_str | Known association — strong signal |

Notable: **STR already has a `rank_score` field** (imported from the VCF caller
— currently stored as TEXT). And **`variants.hpo_sim_score` already exists** —
the phenotype ranker will not need a new column, just a populated one.

## External tools researched

### Exomiser (including v15 / 2025 recommendations)

- **Frequency filter**: retain variants with allele frequency < 0.1% (0.001)
  under dominant/de-novo models, < 2% (0.02) for compound heterozygotes, <
  0.2% (0.002) for mitochondrial, across 1000G, ESP, TOPMed, UK10K, ExAC and
  gnomAD (excluding ASJ). BA1 cut-off at >= 5%, auto-fail at >= 2%.
- **Pathogenicity sources (2025 recommended set)**: REVEL, MVP, AM
  (AlphaMissense), SpliceAI — replacing the older Polyphen2/SIFT/MutationTaster
  stack. CADD and REMM are still selectable.
- **Scoring formula**: `variant_score = frequency_score * pathogenicity_score`,
  each on [0,1]. The gene-level score combines variant score with a phenotype
  match score via a logistic regression. In a phenotype-free MVP we can use
  `variant_score` alone and ignore the gene-level step.
- **SVs (Exomiser v13+)**: for each SV, (1) predict variant effect per
  overlapping transcript, (2) assign to all overlapping genes, (3) pathogenicity
  from variant effect + similar ClinVar SVs, (4) frequency from gnomAD-SV /
  DECIPHER / dbVar / DGV / GoNL. Symbolic ALTs (`<DEL>`) or variants >= 50 bp
  qualify as SV.
- **UI convention**: ranked list, top-30 target, text + HTML + JSON output. Not
  a table — it is a report.
- Docs: https://exomiser.readthedocs.io/en/stable/ and the 2025 Genome Medicine
  paper with updated thresholds: https://doi.org/10.1186/s13073-025-01546-1.

### LIRICAL

- Likelihood-ratio framework: computes an LR per observed HPO term + a
  variant-genotype LR; product gives posterior probability per candidate
  disease. **The only HPO-based algorithm that leverages excluded phenotypes**
  (can be a useful feature for VarLens later).
- No scoring useful in a phenotype-free MVP — the entire design is phenotype-driven.
- Singleton only (no trio).
- Docs: https://lirical.readthedocs.io/.

### Phen2Gene

- HPO-only (no variant input). Produces a ranked gene list in < 1 s via a
  precomputed H2GKB. Useful as a phenotype -> gene-weighting service that could
  plug into VarLens's rank formula as a multiplier per gene.
- Docs: https://github.com/WGLab/Phen2Gene.

### Default filter conventions (synthesis)

Across Exomiser, the rare-disease variant-filtering literature, and ACMG/AMP
BA1 conventions, the "dumb" defaults for rare-disease triage converge on:

1. **Allele frequency**: gnomAD AF <= 0.01 (generic) / 0.001 (dominant/de novo)
   / 0.02 (recessive comp-het) / 0.05 (ACMG BA1 cutoff — anything above is
   auto-benign).
2. **Consequence class**: keep HIGH and MODERATE (missense, splice, LoF);
   usually drop LOW and MODIFIER for triage, but keep them filterable.
3. **Pathogenicity threshold**: CADD >= 20 (top 1%) or >= 25 for missense;
   REVEL/AlphaMissense if available.
4. **Quality**: FILTER = PASS (VCF FILTER column), GQ >= 20, DP >= 10.
5. **ClinVar override**: any variant with ClinVar P/LP bypasses frequency and
   pathogenicity cutoffs (a common-but-pathogenic "escape hatch").
6. **Gene panel**: restrict to a phenotype-derived panel if available.
7. **Region**: coding + splice region + UTR (noncoding separate pass).
8. **Internal cohort frequency**: exclude variants present in > N internal
   samples (common artifact heuristic).
9. **Inheritance mode compatibility**: keep only variants consistent with a
   selected MOI.
10. **Segregation**: for trios, keep de novo / recessive / X-linked hits.

### Default scoring conventions (synthesis)

Phenotype-free composite scores in the wild usually look like:

- `score = w_impact * impact + w_path * pathogenicity + w_rare * rarity + w_cv * clinvar_boost`
- `impact` mapped 1.0 = HIGH, 0.66 = MODERATE, 0.33 = LOW, 0 = MODIFIER.
- `pathogenicity` = CADD normalized to [0,1] (CADD/40 capped at 1), or
  max(REVEL, AlphaMissense, SpliceAI).
- `rarity` = `1 - min(gnomad_af / 0.01, 1)`; NULL treated as 1 (absent = most rare).
- `clinvar_boost` = 1 if P/LP, 0.3 if VUS, 0 otherwise. Often implemented as an
  additive override rather than a multiplier.
- For SVs/CNVs/STRs, size and copy-number deviation and
  disease-list-membership replace CADD/REVEL.

## Design: the MVP prioritization preset

### Preset data model

**Extend `FilterPreset`, do not create a new `variant_presets` table.** The
existing table, IPC, and UI all already work. Add two JSON-encoded fields to
`filter_json` (no schema migration needed for those — it is a JSON blob) and
one column migration for `kind`:

```ts
// src/shared/types/filters.ts — extend FilterState
interface FilterState {
  // ... existing fields ...

  /** Sort specification for the shortlist (multi-column). Ignored in tab view. */
  shortlistSortBy?: SortItem[]

  /** Which variant types this preset aggregates over. Undefined = inherit from tab. */
  variantTypeScope?: ('snv' | 'sv' | 'cnv' | 'str')[]

  /** Max number of rows to return. Undefined = unlimited. */
  topN?: number

  /** Per-type filter overrides. Allows "SNV AF <= 0.1%, SV AF <= 5%" semantics. */
  perTypeOverrides?: {
    snv?: Partial<FilterState>
    sv?: Partial<FilterState>
    cnv?: Partial<FilterState>
    str?: Partial<FilterState>
  }

  /** Ranking configuration. If omitted, rank = order of multi-column sort. */
  rankConfig?: {
    weights: {
      impact?: number     // 0-1, applied to consequence class
      pathogenicity?: number  // 0-1, applied to normalized CADD/REVEL
      rarity?: number     // 0-1, applied to 1 - gnomAD AF
      clinvar?: number    // 0-1, applied to ClinVar P/LP boost
      phenotype?: number  // 0-1, applied to hpo_sim_score (future)
    }
    /** If true, variants with ClinVar P/LP always rank first regardless of score. */
    clinvarPinTop?: boolean
  }
}
```

And a single DB column addition (migration v26):

```sql
ALTER TABLE filter_presets ADD COLUMN kind TEXT NOT NULL DEFAULT 'filter';
-- kind IN ('filter', 'shortlist')
```

`kind = 'filter'` preserves today's preset behaviour (filter-only, applied to
the active tab). `kind = 'shortlist'` means "this preset is a cross-type ranked
view" and is rendered in a new Shortlist tab rather than the Preset bar.

### Built-in presets (concrete thresholds)

Append these via migration v26, `kind = 'shortlist'`:

**1. "Tier 1 candidates" (strict)**
```json
{
  "kind": "shortlist",
  "variantTypeScope": ["snv", "sv", "cnv", "str"],
  "topN": 50,
  "clinvars": ["Pathogenic", "Likely_pathogenic", "Pathogenic/Likely_pathogenic"],
  "consequences": ["HIGH", "MODERATE"],
  "maxGnomadAf": 0.001,
  "minCadd": 20,
  "perTypeOverrides": {
    "sv":  { "maxGnomadAf": 0.01 },
    "cnv": { "maxGnomadAf": 0.01 },
    "str": {}
  },
  "rankConfig": {
    "weights": { "impact": 0.25, "pathogenicity": 0.25, "rarity": 0.25, "clinvar": 0.25 },
    "clinvarPinTop": true
  },
  "shortlistSortBy": [
    { "key": "rank_score", "order": "desc" },
    { "key": "cadd", "order": "desc" }
  ]
}
```

**2. "All rare damaging" (broad)**
```json
{
  "kind": "shortlist",
  "variantTypeScope": ["snv", "sv", "cnv", "str"],
  "topN": 200,
  "consequences": ["HIGH", "MODERATE"],
  "maxGnomadAf": 0.01,
  "minCadd": 15,
  "rankConfig": {
    "weights": { "impact": 0.4, "pathogenicity": 0.3, "rarity": 0.3, "clinvar": 0.0 }
  },
  "shortlistSortBy": [{ "key": "rank_score", "order": "desc" }]
}
```

**3. "Recessive candidates"**
```json
{
  "kind": "shortlist",
  "variantTypeScope": ["snv"],
  "topN": 100,
  "inheritanceModes": ["homozygous", "candidate_compound_het", "autosomal_recessive"],
  "consequences": ["HIGH", "MODERATE"],
  "maxGnomadAf": 0.02,
  "rankConfig": {
    "weights": { "impact": 0.3, "pathogenicity": 0.2, "rarity": 0.3, "clinvar": 0.2 }
  },
  "shortlistSortBy": [
    { "key": "gene_symbol", "order": "asc" },
    { "key": "rank_score", "order": "desc" }
  ]
}
```

### Query strategies (3 options + recommendation)

**Option A — UNION ALL across types, per-type LEFT JOINs**

```sql
SELECT v.*, NULL AS _sv_support, NULL AS _cnv_cn, NULL AS _str_rank, <score> AS rank_score
  FROM variants v
 WHERE case_id = ? AND variant_type IN ('snv','indel') AND <snv_filters>
UNION ALL
SELECT v.*, sv.support, NULL, NULL, <score>
  FROM variants v LEFT JOIN variant_sv sv ON sv.variant_id = v.id
 WHERE case_id = ? AND variant_type = 'sv' AND <sv_filters>
UNION ALL
... (cnv, str)
ORDER BY rank_score DESC, ...
LIMIT ?
```

Pros: Each subquery uses the type-specific JOIN exactly like today's tab
queries — no column collisions; `VariantFilterBuilder.build()` can be reused
almost verbatim per branch. Per-type filter overrides fit naturally. The final
`ORDER BY` sees a unified score column.

Cons: SQL is long; weight changes require re-compiling all branches. Column
count must match across all branches (use `NULL AS ...` padding).

**Option B — Single query, LEFT JOIN all three extension tables**

```sql
SELECT v.*, sv.*, cnv.*, str.*, <score>
  FROM variants v
  LEFT JOIN variant_sv  sv  ON sv.variant_id = v.id
  LEFT JOIN variant_cnv cnv ON cnv.variant_id = v.id
  LEFT JOIN variant_str str ON str.variant_id = v.id
 WHERE case_id = ?
   AND (variant_type IN ('snv','indel') AND <snv_filters>)
    OR (variant_type = 'sv'  AND <sv_filters>)
    OR (variant_type = 'cnv' AND <cnv_filters>)
    OR (variant_type = 'str' AND <str_filters>)
 ORDER BY <score> DESC LIMIT ?
```

Pros: One query, one sort, simplest code.

Cons: Must alias every extension column (they share no names today — good —
but it is still noisy). The 3 LEFT JOINs touch unused rows for every variant,
and there is no way today to push down the type-specific subquery. Filter
pushdown into the OR chain is hard — SQLite will not always use the
`idx_variants_type_case` index. **Likely slower on large cases.**

**Option C — Two-pass: per-type query + JS merge**

Query each type independently with the existing `VariantRepository.getVariants`,
compute score in JS, merge, top-N slice.

Pros: Zero SQL change. Reuses the existing builder with no modifications.
Easiest to unit test.

Cons: Over-fetches (each type has to return more than `topN` rows because the
final top-N may be uneven across types) — how many? Unknown in advance.
Cross-type sort moves from DB to JS, which is fine at 10³ but not 10⁶. For a
shortlist capped at 500 it is acceptable.

**Recommendation**: **Option A** for correctness + performance at scale, with
**Option C as the first implementation** while the score formula stabilizes.
Ship C behind a `shortlistService` interface, then swap to A later without
touching the UI. Explicitly not B — the all-LEFT-JOIN approach loses the per-
type index use and complicates filter pushdown.

### Rank score formula sketch

All terms in [0, 1], summed with preset weights. Each variant type has its own
per-term calculation:

**SNV / indel**
```
impact        = { HIGH: 1.0, MODERATE: 0.66, LOW: 0.33, MODIFIER: 0.0 }[consequence]
pathogenicity = min(cadd / 40, 1.0)                 // NULL -> 0
rarity        = NULL_AF ? 1.0 : 1.0 - min(gnomad_af / 0.01, 1.0)
clinvar       = { P: 1.0, LP: 0.9, "P/LP": 0.95, VUS: 0.3, LB: 0.0, B: 0.0 }[clinvar] || 0
```

**SV**
```
impact        = HIGH if sv_length >= 1000 && overlaps coding, else MODERATE
pathogenicity = (sv.vaf || 0.5) * (sv.sv_is_precise ? 1.0 : 0.7)
rarity        = 1.0 (no SV frequency source in DB yet — treat as rare until populated)
clinvar       = same as SNV
```

**CNV**
```
impact        = copy_number <= 0 ? 1.0 : (copy_number == 1 || copy_number >= 3) ? 0.66 : 0
pathogenicity = min((cnv.copy_number_quality || 0) / 100, 1.0)
rarity        = 1.0 (same caveat as SV)
clinvar       = same as SNV
```

**STR**
```
impact        = str_status == 'pathologic' ? 1.0 : str_status == 'intermediate' ? 0.66 : 0
pathogenicity = str.disease IS NOT NULL ? 1.0 : 0.5
rarity        = 1.0
clinvar       = 1.0 if str.disease IS NOT NULL (known locus), else 0
```

Final score: `score = Σ weights[term] * term_value[term]`, clamped to [0,1].

Ties broken by the preset's `shortlistSortBy`. If `clinvarPinTop` is set, any
ClinVar P/LP gets `score += 1` (so they always sort to the top regardless of
weights). The phenotype term is 0 in MVP; when populated it becomes
`hpo_sim_score` (normalized).

**Computed at query time** via SQL `CASE` expressions (SQLite supports CASE and
basic arithmetic — no need for a stored computed column). Example:

```sql
SELECT v.*, (
  :w_impact * CASE v.consequence
    WHEN 'HIGH' THEN 1.0 WHEN 'MODERATE' THEN 0.66
    WHEN 'LOW' THEN 0.33 ELSE 0.0 END
  + :w_path * COALESCE(MIN(v.cadd / 40.0, 1.0), 0)
  + :w_rare * (1.0 - COALESCE(MIN(v.gnomad_af / 0.01, 1.0), 0))
  + :w_clin * CASE
    WHEN v.clinvar IN ('Pathogenic','Likely_pathogenic','Pathogenic/Likely_pathogenic') THEN 1.0
    WHEN v.clinvar = 'Uncertain_significance' THEN 0.3 ELSE 0 END
) AS rank_score
FROM variants v WHERE ...
```

### UI integration options

```
┌─ Case: P-001 / Trio_42 ─────────────────────────────────────────────┐
│  [Shortlist*]  [SNV/Indel 5231]  [SV 34]  [CNV 6]  [STR 2]         │
├─────────────────────────────────────────────────────────────────────┤
│  Preset: [Tier 1 candidates ▾]   Top N: [50 ▾]   [Edit] [Save new] │
├─────────────────────────────────────────────────────────────────────┤
│ Rnk│Score│Type │ Gene    │ Variant         │ Cons. │ AF   │ ClinVar│
│  1 │ 0.97│ snv │ COL4A5  │ c.1234G>A p.V412M│ HIGH  │ 0    │ P      │
│  2 │ 0.92│ sv  │ DMD     │ DEL 12kb        │ HIGH  │ -    │ -      │
│  3 │ 0.88│ str │ HTT     │ CAG x 45 (path) │ -     │ -    │ -      │
│  4 │ 0.81│ cnv │ MLH1    │ CN=1 (3.2 Mb)   │ MOD   │ -    │ -      │
│ ...                                                                 │
└─────────────────────────────────────────────────────────────────────┘
Click row -> opens VariantDetailsPanel; "Open in tab" links to SNV/SV/CNV/STR view
```

**Option 1 — new "Shortlist" tab prepended to the existing per-type tabs.**
The new tab renders a new `ShortlistTable.vue` component with a preset picker
above the table. The existing tabs are untouched. Drill-down: clicking a row
opens `VariantDetailsPanel` as today; an "Open in [SV] tab" button switches the
active tab to the variant's type and scrolls/filters to it.

Pros: Additive, zero impact on existing per-type workflows. Natural home for
preset-bar-incompatible controls (top N, per-type overrides).
Cons: Yet another tab. If a case has only SNVs, the user sees two tabs that
look almost identical.

**Option 2 — dedicated "Prioritized" view in the sidebar, parallel to Case /
Cohort.** Routes like `/cases/:id/shortlist`.

Pros: Feels like a real feature. Keeps the case view focused on per-type browsing.
Cons: Discovery problem — users have to know it exists. Duplicates sidebar/
navigation plumbing.

**Option 3 — integrate into existing VariantTable via a "Cross-type shortlist"
mode on the current tab.** The tab tabs get a "+ Shortlist" toggle.

Pros: Minimum surface change.
Cons: Confusing semantics (what does "sort by CADD" mean when half the rows
are SVs?). Mixing type-specific columns (sv_length, copy_number) with the SNV
column set breaks the existing column system.

**Recommendation**: **Option 1**. The Shortlist tab becomes the default
landing tab when a case has more than one variant type, and the user drills
down to per-type tabs as needed. Same mental model as the user's ask.

## Future-proofing

### Phenotype ranker plug-in point

The score formula already has a `phenotype` weight term wired to
`hpo_sim_score`. When a phenotype ranker is added:

1. A new `PhenotypeRankerService` populates `variants.hpo_sim_score` per
   variant for the case, given a set of HPO terms stored on the case (or a
   new `case_hpo_terms` table — already exists from v0.4.0 annotation work).
2. The shortlist query starts honoring `weights.phenotype` (currently the
   weights exist but hpo_sim_score is 0 for most variants).
3. The UI adds an "HPO terms" chip input above the preset picker.
4. Exomiser/LIRICAL-style gene-level combination can layer on top by
   aggregating rank_score per gene symbol in a second pass.

No schema change is required in the shortlist preset model when the phenotype
ranker arrives. Drop the phenotype weight from 0 to a sensible default (e.g.
0.3) in a new built-in "Phenotype-weighted tier 1" preset.

### Canonical column compatibility

Research track #3 (canonical columns) will abstract `gnomad_af` and `cadd`
behind logical keys. The rank formula **must** express its inputs against those
keys, not the physical column names. Concretely:

- The `rankConfig.weights` object keys (`impact`, `pathogenicity`, `rarity`,
  `clinvar`, `phenotype`) are abstract. The mapping from each key to the
  underlying column lives in a small `RANK_INPUTS` registry:
  ```ts
  RANK_INPUTS = {
    rarity:        { column: 'gnomad_af',   normalize: 'rarityFromAf', nullValue: 1.0 },
    pathogenicity: { column: 'cadd',        normalize: 'caddToFraction', nullValue: 0 },
    impact:        { column: 'consequence', normalize: 'impactClass',  nullValue: 0 },
    clinvar:       { column: 'clinvar',     normalize: 'clinvarBoost', nullValue: 0 },
    phenotype:     { column: 'hpo_sim_score', normalize: 'identity',   nullValue: 0 }
  }
  ```
- Track #3 replaces `column: 'gnomad_af'` with `column: POP_FREQUENCY` where
  `POP_FREQUENCY` is the canonical column key — one-line change.
- Same treatment for the filter conditions (`maxGnomadAf`, `minCadd`): the
  preset stores the semantic filter ("max pop AF", "min pathogenicity score"),
  and the query builder resolves which physical column to compare against.

## Open questions

1. **Score magnitude across types.** Even with weight-sum normalization, the
   SNV score distribution will bunch differently from the SV score distribution
   (SNVs have 4 populated terms, SVs have 3). Do we leave the cross-type
   ranking to the user's weights, or apply a per-type z-score normalization
   before the final sort? — **Biggest open question.**
2. **Per-type overrides UX.** Does the preset editor show four tabs (one per
   type), or a single form with "(SNV)", "(SV)", "(CNV)", "(STR)" scope pickers
   per field? Matters for whether users will actually use overrides.
3. **ClinVar "escape hatch"** — always pinned to top, or just a big additive
   boost? Pinning breaks the "top-N" cap if there are 200 P/LP variants in the
   case.
4. **How to display variants that match multiple types' sub-filters** (e.g. a
   deletion that could be both an SV and a CNV depending on caller)? We already
   dedupe via `(chr,pos,ref,alt)` in `cohort_variant_summary` — same approach
   should apply here, preferring the highest-scored record.
5. **Preset scope storage: per-DB or per-user?** Current `filter_presets` is
   per-DB — so shortlist presets travel with the database. That is probably
   right (shortlists are clinical workflows tied to a data set), but a "copy
   from built-in" flow is needed for users building a new DB.
6. **Row cap semantics**: `topN` enforced by the SQL (`LIMIT`), or by the UI
   pager? If SQL enforces it, the "filtered count" display becomes meaningless
   (it is always topN). Prefer `LIMIT topN` + a separate unfiltered count query
   (pattern already exists in `getVariants`).
7. **Does `case_import_files` source reporting matter for MVP?** The join path
   is `variants.variant_type + variants.caller -> case_import_files.variant_type
   + caller`, which is not 1:1 if the same caller produces multiple files.
   Might be fine to show "caller: DRAGEN" in the shortlist without pinning to a
   specific import file row, and add file-level linkage only if users ask.

## Incremental rollout plan

1. **Phase 1 (MVP, 1 sprint)**:
   - Migration v26: `ALTER TABLE filter_presets ADD COLUMN kind`; seed 3
     shortlist presets.
   - Extend `FilterState` with `shortlistSortBy`, `variantTypeScope`, `topN`,
     `rankConfig`.
   - New `ShortlistService` in `src/main/database/` implementing Option C
     (per-type queries + JS merge), exposing `getShortlist(caseId, presetId,
     overrides)` via IPC channel `variants:shortlist`.
   - New `ShortlistTab.vue` inside CaseView prepended to `tabItems` when
     `caseId has >1 variant type`; dropdown picks from
     `presets.filter(p => p.kind === 'shortlist')`.
   - Row click reuses existing `VariantDetailsPanel`.

2. **Phase 2 (polish, 1 sprint)**:
   - Preset editor adds a "Ranking" section (weights + top-N + scope).
   - "Open in tab" drill-down button.
   - Per-type filter overrides in the editor.
   - Per-case "last used shortlist preset" remembered in user prefs.

3. **Phase 3 (perf)**: swap `ShortlistService` from Option C (JS merge) to
   Option A (UNION ALL) if profiling shows it matters. This is a pure backend
   change — no API or UI impact.

4. **Phase 4 (phenotype)**: add case-level HPO terms + `PhenotypeRankerService`
   that populates `hpo_sim_score`; flip the phenotype weight to a nonzero
   default in a new built-in preset.

5. **Phase 5 (canonical columns)**: after track #3 lands, rewrite `RANK_INPUTS`
   to use the canonical column registry. No user-visible change.

---

## Sources

- [Exomiser documentation (latest)](https://exomiser.readthedocs.io/en/stable/)
- [Exomiser structural variant prioritisation (v13)](https://exomiser.readthedocs.io/en/13.2.1/sv_prioritisation.html)
- [Exomiser ACMG assignment](https://exomiser.readthedocs.io/en/14.0.1/acmg_assignment.html)
- [Exomiser GitHub](https://github.com/Exomiser/Exomiser)
- [Smedley et al. 2025 — optimized variant prioritization process for rare disease diagnostics (Exomiser/Genomiser)](https://genomemedicine.biomedcentral.com/articles/10.1186/s13073-025-01546-1)
- [LIRICAL — Likelihood Ratio Interpretation of Clinical AbnormaLities](https://lirical.readthedocs.io/)
- [LIRICAL paper — Interpretable Clinical Genomics with a Likelihood Ratio Paradigm (AJHG 2020)](https://www.sciencedirect.com/science/article/pii/S0002929720302305)
- [Phen2Gene paper (NAR Genomics & Bioinformatics 2020)](https://academic.oup.com/nargab/article/2/2/lqaa032/5843800)
- [Phen2Gene GitHub](https://github.com/WGLab/Phen2Gene)
- [Critical assessment of variant prioritization methods for rare disease diagnosis (Rare Genomes Project 2023)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10418577/)
- [Effective variant filtering and expected candidate variant yield in studies of rare human disease (npj Genomic Medicine 2021)](https://www.nature.com/articles/s41525-021-00227-3)
- [Genome region aware CADD thresholds for noncoding variant prioritization (NAR Genomics & Bioinformatics)](https://academic.oup.com/nargab/article/7/4/lqaf157/8328387)
- [ACMG/AMP variant interpretation guidelines — Richards et al. 2015](https://www.nature.com/articles/gim201530)
- [Overview of specifications to the ACMG/AMP variant interpretation guidelines](https://pmc.ncbi.nlm.nih.gov/articles/PMC6885382/)
