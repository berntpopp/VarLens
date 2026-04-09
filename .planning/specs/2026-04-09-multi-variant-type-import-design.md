# Multi-Variant Type Import: ONT & DRAGEN Support

**Date:** 2026-04-09
**Scope:** Issue [#94](https://github.com/berntpopp/VarLens/issues/94) — Multi-variant type support (CNV, SV, STR)
**Primary target:** ONT wf-human-variation pipeline output (Clair3, Sniffles2, Spectre, Straglr)
**Secondary target (future):** Illumina DRAGEN NovaSeq output (germline, SV, CNV, STR, Nirvana JSON)
**Test data:** `/home/bernt-popp/Downloads/OneDrive_1_4-9-2026/` — ONT P2 adaptive sampling run

---

## 1. Executive Summary

Extend VarLens to import, store, and display structural variants (SV), copy number variants (CNV), and short tandem repeats (STR) alongside existing SNV/indel support. The design uses a hybrid schema (base `variants` table + type-specific extension tables), import-time filtering (BED regions + quality gates), automatic caller/format/build detection, and a tabbed frontend display.

The architecture is designed for ONT first (with real test data) but prepared for DRAGEN/NovaSeq expansion with no structural changes — only new caller patterns, field extractors, and the Nirvana JSON companion parser.

---

## 2. Requirements

### Functional

1. Import VCF files containing SV, CNV, and STR variants (symbolic ALT alleles, breakend notation)
2. Auto-detect variant type from VCF content (symbolic ALTs, SVTYPE, caller header)
3. Auto-detect caller from `##source=` header line, set smart quality defaults
4. Auto-detect reference genome from contig lengths / `##reference=` header
5. Import-time BED region filtering with configurable padding (default 50bp)
6. Import-time quality pre-filters: PASS-only, min QUAL, min GQ, min DP
7. Import multiple files for one case (one per variant type), all files must share reference genome
8. Parse SnpEff ANN + ClinVar annotations on SV/CNV VCFs (existing parser)
9. Parse STR disease catalog fields (STR_STATUS, pathologic thresholds, disease, inheritance)
10. Store type-specific fields in extension tables (variant_sv, variant_cnv, variant_str)
11. Display variants in type-specific tabs in case view (SNV/Indel | SV | CNV | STR)
12. Support variant_type and genome_build filtering in cohort mode
13. Genome build selector in cohort view with per-build aggregation
14. All existing import formats (JSON columnar/object/simple, annotated VCF) continue to work unchanged

### Future (DRAGEN/NovaSeq — not in initial implementation)

15. Nirvana JSON companion file parser (paired with VCF import)
16. Illumina Connected Annotations VCF CSQ format (handled by existing dynamic CSQ parser)
17. DRAGEN-specific INFO/FORMAT fields (DRAGstrInfo, F1R2/F2R1, SPL, ICNT, DN/DQ)
18. DRAGEN SV (Manta-based PR/SR fields), CNV (SM, BC, ASCN), STR (ExpansionHunter)
19. Folder/batch import UX (auto-discover DRAGEN output directory)

### Non-Functional

- Import-time filtering must operate at streaming level (constant memory, no full-file scan)
- BED interval lookup must be O(log n) per variant (sorted array + binary search)
- Extension table JOINs only when relevant tab is active (no performance impact on SNV queries)
- Backward compatible: existing databases migrate cleanly, existing import flows unchanged

---

## 3. Schema Evolution

### 3.1 Variants Table — New Columns

```sql
ALTER TABLE variants ADD COLUMN variant_type TEXT NOT NULL DEFAULT 'snv';
  -- values: 'snv', 'indel', 'sv', 'cnv', 'str'
ALTER TABLE variants ADD COLUMN end_pos INTEGER;
ALTER TABLE variants ADD COLUMN sv_type TEXT;       -- DEL, DUP, INV, INS, BND, CNV, STR
ALTER TABLE variants ADD COLUMN sv_length INTEGER;  -- SVLEN
ALTER TABLE variants ADD COLUMN caller TEXT;         -- Detected caller name

CREATE INDEX idx_variants_type ON variants(variant_type);
CREATE INDEX idx_variants_type_case ON variants(variant_type, case_id);
CREATE INDEX idx_variants_end_pos ON variants(chr, end_pos) WHERE end_pos IS NOT NULL;
```

### 3.2 SV Extension Table

```sql
CREATE TABLE variant_sv (
  variant_id INTEGER PRIMARY KEY,
  sv_is_precise INTEGER,
  cipos_left INTEGER,
  cipos_right INTEGER,
  ciend_left INTEGER,
  ciend_right INTEGER,
  support INTEGER,           -- SUPPORT (Sniffles2)
  coverage TEXT,             -- COVERAGE array as JSON string
  strand TEXT,
  stdev_len REAL,
  stdev_pos REAL,
  vaf REAL,
  dr INTEGER,                -- FORMAT/DR (ref reads)
  dv INTEGER,                -- FORMAT/DV (variant reads)
  pe_support INTEGER,        -- PR[1] (DRAGEN/Manta, future)
  sr_support INTEGER,        -- SR[1] (DRAGEN/Manta, future)
  event_id TEXT,
  mate_id TEXT,
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
);
```

### 3.3 CNV Extension Table

```sql
CREATE TABLE variant_cnv (
  variant_id INTEGER PRIMARY KEY,
  copy_number INTEGER,        -- CN
  copy_number_quality INTEGER, -- GQ
  homozygosity_ref REAL,      -- HO[0] (Spectre)
  homozygosity_alt REAL,      -- HO[1] (Spectre)
  sm REAL,                    -- SM (DRAGEN, future)
  bin_count INTEGER,          -- BC (DRAGEN, future)
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
);

CREATE INDEX idx_cnv_copy_number ON variant_cnv(copy_number);
```

### 3.4 STR Extension Table

```sql
CREATE TABLE variant_str (
  variant_id INTEGER PRIMARY KEY,
  repeat_id TEXT,              -- REPID (e.g., 'ATXN3')
  variant_catalog_id TEXT,     -- VARID
  repeat_unit TEXT,            -- RU (e.g., 'CAG')
  display_repeat_unit TEXT,    -- DisplayRU
  ref_copies REAL,             -- REF
  alt_copies TEXT,             -- REPCN (e.g., '24/15')
  repeat_length INTEGER,       -- RL (bp)
  str_status TEXT,             -- STR_STATUS (normal/pre_mutation/full_mutation)
  normal_max INTEGER,          -- STR_NORMAL_MAX
  pathologic_min INTEGER,      -- STR_PATHOLOGIC_MIN
  disease TEXT,                -- Disease
  inheritance_mode TEXT,       -- InheritanceMode
  source_display TEXT,         -- SourceDisplay
  rank_score TEXT,             -- RankScore
  locus_coverage REAL,         -- LC (FORMAT)
  support_type TEXT,           -- SO (SPANNING/FLANKING/INREPEAT)
  confidence_interval TEXT,    -- REPCI
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
);

CREATE INDEX idx_str_repeat_id ON variant_str(repeat_id);
CREATE INDEX idx_str_disease ON variant_str(disease);
```

### 3.5 Case Provenance — Multi-File Import Model

The current `cases` table stores a single `file_path` and `file_size` set at case creation (`CaseRepository.createCase()`). Multi-file import requires tracking provenance for each imported file.

**New child table:**

```sql
CREATE TABLE case_import_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  variant_type TEXT NOT NULL,    -- 'snv', 'indel', 'sv', 'cnv', 'str'
  caller TEXT,                   -- Detected caller name
  variant_count INTEGER NOT NULL DEFAULT 0,
  annotation_format TEXT,        -- 'csq', 'ann', 'nirvana', 'none'
  imported_at INTEGER NOT NULL,  -- Unix timestamp
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX idx_case_import_files_case ON case_import_files(case_id);
```

**How existing columns are handled:**
- `cases.file_path` and `cases.file_size` remain for backward compatibility and store the **first** imported file (the "canonical" file that created the case)
- `cases.variant_count` remains as the **total** across all imported files for the case
- New imports for an existing case add rows to `case_import_files` and increment `cases.variant_count`
- The import dialog shows `case_import_files` to indicate which files have already been imported for a case

**Import flow:**
1. User creates a new case → `CaseRepository.createCase()` sets `file_path` and `file_size` from the first file (unchanged API)
2. `case_import_files` row inserted for each file in the import session
3. For subsequent imports to the same case, `cases.file_path`/`file_size` are NOT updated — they remain as original provenance

### 3.6 Cohort Summary Table Updates

```sql
-- Add to cohort_variant_summary composite key
ALTER TABLE cohort_variant_summary ADD COLUMN variant_type TEXT NOT NULL DEFAULT 'snv';
ALTER TABLE cohort_variant_summary ADD COLUMN genome_build TEXT NOT NULL DEFAULT 'GRCh38';

-- gene_burden_summary
ALTER TABLE gene_burden_summary ADD COLUMN genome_build TEXT NOT NULL DEFAULT 'GRCh38';
```

### 3.7 Migration Strategy

```sql
-- Step 1: Add new columns to variants table (with defaults)
ALTER TABLE variants ADD COLUMN variant_type TEXT NOT NULL DEFAULT 'snv';
-- ... other ALTER TABLE statements for end_pos, sv_type, sv_length, caller

-- Step 2: Classify existing variants by REF/ALT lengths
UPDATE variants SET variant_type = 
  CASE 
    WHEN length(ref) = 1 AND length(alt) = 1 THEN 'snv'
    ELSE 'indel'
  END;

-- Step 3: Create extension tables (empty — populated only by new imports)
-- CREATE TABLE variant_sv (...), variant_cnv (...), variant_str (...)

-- Step 4: Create case_import_files table (empty)

-- Step 5: Add columns to cohort summary tables
ALTER TABLE cohort_variant_summary ADD COLUMN variant_type TEXT NOT NULL DEFAULT 'snv';
ALTER TABLE cohort_variant_summary ADD COLUMN genome_build TEXT NOT NULL DEFAULT 'GRCh38';

-- Step 6: FULL REBUILD of cohort_variant_summary and gene_burden_summary
-- Do NOT backfill summary rows with defaults — the rebuild SQL will
-- derive variant_type and genome_build from the variants and cases tables,
-- producing correct per-type and per-build aggregation.
-- This avoids silently misclassifying existing indels as 'snv'.
```

---

## 4. Import Pipeline

### 4.1 Import-Time Filtering

**BED Region Filter** — new module `src/main/import/vcf/bed-filter.ts`:
- Parses `.bed` / `.bed.gz` into sorted interval array per chromosome
- Each interval expanded by ±padding before storage
- O(log n) binary search per variant lookup
- For SV/CNV: checks overlap using both POS and END
- Auto-suggests sibling `.bed.gz` files found in same directory as selected VCFs

**Quality Pre-Filters** — new type `src/main/import/vcf/import-filters.ts`:

```typescript
interface ImportFilters {
  bedFilter?: BedFilter;
  bedPadding: number;        // Default 50bp
  passOnly: boolean;         // Default true (caller-dependent)
  minQual: number | null;
  minGq: number | null;
  minDp: number | null;
}
```

**Filter evaluation point** — in VcfStrategy streaming loop, before mapVcfRecord:

1. `parseVcfLine()` → raw record (cheap tab-split)
2. FILTER check: `passOnly && filter !== 'PASS'` → skip
3. QUAL check: `qual < minQual` → skip
4. BED check: `!bedFilter.contains(chr, pos)` → skip (for SV/CNV: `containsRange(chr, pos, end)`)
5. Only if passed: full mapping + genotype parsing
6. GQ/DP check: after genotype parse, before batch add

### 4.2 Variant Type Detection

New module `src/main/import/vcf/variant-type-detector.ts`:

```
Detection logic (per record):
  ALT starts with '<'?
    → <STR*> or SVTYPE=STR         → 'str'
    → <CNV*> or SVTYPE=CNV         → 'cnv'
    → <DEL>/<DUP> + caller=Spectre → 'cnv'  (caller disambiguates)
    → <DEL>/<DUP>/<INS>/<INV>/<BND> → 'sv'
  ALT contains '[' or ']'?         → 'sv'  (breakend notation)
  REF.len == 1 && ALT.len == 1?    → 'snv'
  Otherwise                        → 'indel'
```

### 4.3 Caller Detection

New module `src/main/import/vcf/caller-detector.ts`:

Parses `##source=` header line against known patterns:

| Pattern | Caller | Default Type | Default Filters |
|---|---|---|---|
| `Clair3` | Clair3 | snv | passOnly=true, minQual=2 |
| `Sniffles2` | Sniffles2 | sv | passOnly=true |
| `Spectre` | Spectre | cnv | passOnly=false (no QUAL used) |
| `strglr` | Straglr | str | passOnly=true |
| `DeepVariant` | DeepVariant | snv | passOnly=true |
| `DRAGEN` | DRAGEN | snv | passOnly=true |
| `Manta` | Manta | sv | passOnly=true |
| `ExpansionHunter` | ExpansionHunter | str | passOnly=false |

Extensible: add new entries to `CALLER_PATTERNS` array.

### 4.4 Type-Specific Field Extraction

New module `src/main/import/vcf/extension-parsers.ts`:

Three functions dispatched by variant_type after mapVcfRecord:

- `extractSvFields(record, genotype)` → `SvExtensionRow` — SUPPORT, COVERAGE, DR/DV, STRAND, STDEV_*, VAF, PRECISE/IMPRECISE, CIPOS/CIEND, EVENT, MATEID
- `extractCnvFields(record, genotype)` → `CnvExtensionRow` — CN, HO, GQ
- `extractStrFields(record, genotype)` → `StrExtensionRow` — REPID, VARID, RU, REF, REPCN, STR_STATUS, thresholds, disease, inheritance, LC, SO, REPCI

### 4.5 Database Insert Extension

`VariantRepository.insertBatch()` extended:

```
For each variant:
  1. INSERT INTO variants (..., variant_type, end_pos, sv_type, sv_length, caller)
  2. lastInsertRowid → variant_id
  3. Switch on variant._sv / _cnv / _str:
     → INSERT INTO variant_sv/cnv/str (variant_id, ...)
  4. If variant._transcripts → INSERT INTO variant_transcripts (existing)
```

All within existing prepared-statement batch + transaction pattern.

### 4.6 Multi-File Import

Sequential processing of multiple files into one case as a single import session:

1. All files validated for reference genome match (case-level lock)
2. Each file processed independently through VcfStrategy, inserting into the same case_id
3. A `case_import_files` row is created for each file with its variant_type, caller, and count
4. Cohort summary updated **once after the entire session completes**, not after each file — this avoids incorrect incremental carrier counts when multiple files contribute to the same case (the existing `INCREMENTAL_ADD_SQL` assumes one case = one carrier increment per coordinate, which breaks if we increment mid-session)
5. If any file fails, variants from already-processed files remain (partial import is acceptable — user can delete the case and retry)
6. Progress tracked per file with running totals

---

## 5. Reference Genome Handling

### 5.1 Detection

Enhanced `detectGenomeBuild()` in `vcf-header-parser.ts`:

1. Check `##reference=` line for GRCh38/hg38/GRCh37/hg19
2. Check contig lengths (chr1: 248956422 = GRCh38, 249250621 = GRCh37)
3. Fallback: chr prefix heuristic
4. If unknown: user must select manually in import dialog

### 5.2 Case-Level Lock

- `cases.genome_build` already exists in the schema (migration v19, `database-schema.ts:17`, `CaseRepository.ts:46`) with default `'GRCh38'`
- For a **newly created case**, the first imported file's detected build is passed to `createCase()` which already accepts a `genomeBuild` parameter
- For subsequent files imported into an **existing case**: detected build must match `cases.genome_build` or import is rejected
- Error message: "Reference mismatch: this file is GRCh37 but case X uses GRCh38"

### 5.3 Cohort-Level Enforcement

- `cohort_variant_summary` includes `genome_build` in composite key
- All cohort queries filter by `WHERE genome_build = ?`
- `cohort_frequency` denominator is per-build: `COUNT(*) FROM cases WHERE genome_build = ?`
- Association testing filters cases by genome_build
- Gene panel interval computation uses selected build

### 5.4 Frontend Build Selector

- Dropdown in CohortViewComponent header showing available builds with case counts
- Default: build with most cases
- Switching triggers data refetch (no rebuild — just WHERE filter change)
- `useCohortData` composable: `genomeBuild` ref passed to all IPC calls
- `cohort-logic.ts`: parameterized instead of hardcoded 'GRCh38'

---

## 6. Annotation Format Support

### 6.1 Existing Parsers (No Changes)

- **VEP CSQ**: Dynamic field-order parsing from header Description. Works with both VEP and Illumina Connected Annotations VCF CSQ format (same parser, different field positions).
- **SnpEff ANN**: Fixed 16-field format. Already works with the ONT test data (CNV and SV VCFs annotated with SnpEff + ClinVar via SnpSift).
- **Info field registry**: Existing mappings for gnomAD_AF, CADD, CLNSIG. Unmapped fields → `info_json`.

### 6.2 STR Built-In Annotations

Straglr STR VCFs contain disease catalog annotations as INFO fields (Disease, InheritanceMode, STR_STATUS, STR_NORMAL_MAX, STR_PATHOLOGIC_MIN). These are extracted by the STR extension parser, not the annotation parser — no ANN/CSQ involved.

### 6.3 Future: Nirvana JSON Companion Parser

New module `src/main/import/nirvana/nirvana-parser.ts` (DRAGEN expansion):

- Streaming line-by-line parser (bgzip-compressed, one position per JSON line)
- Matched to VCF variants by (chr, pos, refAllele, altAllele)
- Extracts: transcripts (hgnc, consequence, impact, hgvsc, hgvsp, isCanonical, isManeSelect, sift, polyPhen), gnomad frequencies, ClinVar significance, REVEL, SpliceAI
- Priority: Nirvana JSON > VEP CSQ > SnpEff ANN > INFO registry > info_json

### 6.4 Annotation Detection

`detectAnnotationType()` in header parser:
- `##INFO=<ID=CSQ` → 'csq' (VEP or ICA)
- `##INFO=<ID=ANN` → 'ann' (SnpEff)
- `##INFO=<ID=EFF` → 'eff' (legacy SnpEff, future)
- None → 'none'
- Nirvana JSON detected by companion file selection, not header

---

## 7. Frontend Design

### 7.1 Case View — Type Tabs

```
SNV/Indel (12,500) │ SV (319) │ CNV (101) │ STR (16)
```

- Tab badges from `SELECT variant_type, COUNT(*) FROM variants WHERE case_id = ? GROUP BY variant_type`
- Each tab renders type-specific columns via `useVariantColumns(variantType)`
- Extension table data LEFT JOINed only for active tab
- Shared features across all tabs: ACMG classification, comments, starring, external links

**Type-specific columns:**

| SNV/Indel | SV | CNV | STR |
|---|---|---|---|
| Gene | Gene | Gene | Gene (REPID) |
| Chr:Pos | Chr:Pos–End | Chr:Pos–End | Locus |
| REF/ALT | SV Type + Length | Type (DEL/DUP) | Repeat Unit |
| Transcript | Support (DR/DV) | Copy Number | Alt Copies |
| cDNA / AA | VAF | Homozygosity | Status |
| Consequence | Precise/Imprecise | Size | Disease |
| gnomAD AF | Strand | ANN annotation | Pathologic Threshold |
| CADD | Filter | ClinVar | Inheritance |
| ClinVar | Phase Set | Filter | Rank Score |

### 7.2 Cohort View — Build + Type Selectors

```
Cohort Analysis  [GRCh38 ▼]  [SNV/Indel ▼]
```

- Two dropdowns: genome build (with case counts) + variant type (with variant counts)
- All queries scoped by both selectors
- Association testing inherits both filters

**SV/CNV/STR cohort semantics — exact-match only (initial scope):**

The existing cohort summary keys by exact `(chr, pos, ref, alt)` identity. This works for SNVs/indels but will fragment equivalent SV/CNV events across callers and samples — the same deletion may be reported at slightly different breakpoints by Sniffles2 in different samples, producing separate summary rows instead of a single aggregated event.

For the initial implementation, SV/CNV/STR cohort support uses **exact-match browsing only**: users can browse and filter SV/CNV/STR variants in cohort mode, but `carrier_count` and `cohort_frequency` reflect exact coordinate matches, not overlapping events. This is clearly labeled in the UI (e.g., "Exact match — 3 carriers" rather than implying fuzzy aggregation).

True SV/CNV frequency analysis with overlap-based clustering (reciprocal overlap thresholds, breakpoint tolerance windows) is deferred to a future enhancement. This requires a fundamentally different aggregation strategy (e.g., bedtools-style interval clustering at rebuild time, or a separate `sv_cohort_summary` table with overlap-merged events).

### 7.3 Import Dialog — Smart Wizard

**Step 1:** Drag & drop or browse for VCF files (+ optional Nirvana JSON)

**Step 2:** Auto-detection summary showing per-file: variant type, caller, build, variant count. Contextual warnings for large files with BED filter suggestion. Auto-suggest sibling BED files.

**Advanced options** (collapsed): quality filters with caller-aware defaults, BED region with padding, per-file type/caller overrides.

**Progress:** Per-file status with counts of imported/filtered variants.

**Post-import summary:** Total counts per type, filters applied, annotations detected, callers identified.

**Key UX principles:**
- Case name auto-derived from VCF sample ID
- Pipeline detection from caller combination (Clair3+Sniffles2+Spectre+Straglr = "ONT wf-human-variation")
- Smart defaults require zero configuration for typical use
- Warnings are actionable (suggest BED filter, not just "file is large")

---

## 8. Backward Compatibility

### 8.1 Existing Formats

- JSON import (columnar, object, simple): completely unchanged, different strategy
- VEP/SnpEff annotated VCF: unchanged, variant_type defaults to snv/indel
- Multi-sample VCF: unchanged, variant_type added per record
- VEP REST API annotation: unchanged, post-import feature

### 8.2 Migration

- Existing variants classified as snv/indel by REF/ALT length
- Cohort summary tables (`cohort_variant_summary`, `gene_burden_summary`) get new columns then are **fully rebuilt** from the `variants` and `cases` tables — no backfill defaults that could misclassify existing indels as 'snv'
- Extension tables and `case_import_files` created empty — populated only by new imports
- No data loss, no re-import required

### 8.3 Strategy Registry

Existing strategies untouched. New strategies added additively:

```typescript
registry.register(new NirvanaJsonStrategy());  // Future
// Future: GvcfStrategy, BedpeStrategy, TsvStrategy, CsvCnvStrategy
```

Format detection enhanced but backward compatible — existing JSON/VCF patterns checked first, new formats added after.

---

## 9. New Files

| File | Purpose |
|---|---|
| `src/main/import/vcf/bed-filter.ts` | BED region interval tree + overlap check |
| `src/main/import/vcf/import-filters.ts` | ImportFilters type + filter evaluation |
| `src/main/import/vcf/variant-type-detector.ts` | Auto-detect variant type from VCF record |
| `src/main/import/vcf/caller-detector.ts` | Auto-detect caller from header, smart defaults |
| `src/main/import/vcf/extension-parsers.ts` | Extract SV/CNV/STR fields into extension rows |
| `src/main/import/nirvana/nirvana-parser.ts` | Nirvana JSON companion parser (future) |
| `src/renderer/src/components/VariantTypeTabs.vue` | Tab switcher for variant types |
| `src/renderer/src/components/variant/SvDetailsSection.vue` | SV detail panel section |
| `src/renderer/src/components/variant/CnvDetailsSection.vue` | CNV detail panel section |
| `src/renderer/src/components/variant/StrDetailsSection.vue` | STR detail panel section |

### Modified Files

| File | Change |
|---|---|
| `src/main/database/migrations.ts` | New migration: extension tables, case_import_files, variant columns, cohort summary columns, full cohort rebuild |
| `src/main/database/schema.ts` | Extension table + case_import_files CREATE statements |
| `src/main/database/VariantRepository.ts` | Extended insertBatch, queryVariants with type filter + extension JOINs |
| `src/main/database/CaseRepository.ts` | Multi-file provenance: case_import_files insert, query import history |
| `src/main/database/cohort.ts` | genome_build + variant_type filters on all queries |
| `src/main/database/CohortSummaryService.ts` | Rebuild SQL with variant_type + genome_build grouping |
| `src/shared/sql/cohort-summary-rebuild.ts` | GROUP BY variant_type, genome_build; per-build frequency denominator |
| `src/main/import/vcf/VcfStrategy.ts` | Import filter gates, variant type routing, extension field extraction |
| `src/main/import/vcf/vcf-header-parser.ts` | Enhanced genome build detection, caller detection |
| `src/main/import/vcf/VcfMapper.ts` | Extended VcfMappedVariant with variant_type + extension rows |
| `src/main/import/vcf/types.ts` | New types: ImportFilters, SvExtensionRow, CnvExtensionRow, StrExtensionRow |
| `src/main/import/ImportService.ts` | Multi-file session: sequential import, single cohort update at end |
| `src/shared/types/database.ts` | Variant type, extension table, CaseImportFile interfaces |
| `src/shared/types/database-schema.ts` | Kysely types for new tables (variant_sv, variant_cnv, variant_str, case_import_files) |
| `src/shared/types/cohort.ts` | genome_build + variant_type in CohortSearchParams |
| `src/main/ipc/handlers/cohort-logic.ts` | Parameterized genome_build (remove hardcoded 'GRCh38') |
| `src/main/ipc/handlers/panelIntervalHelper.ts` | Use selected genome_build from params |
| `src/main/statistics/AssociationEngine.ts` | Filter cases by genome_build |
| `src/renderer/src/components/CohortView.vue` (or wrapper) | Build selector dropdown |
| `src/renderer/src/composables/useCohortData.ts` | genomeBuild ref, pass to IPC |
| `src/renderer/src/components/cohort/useCohortColumns.ts` | Type-aware column sets |
| Import dialog components | Multi-file, type/caller display, BED filter, quality filters |

---

## 10. Implementation Phases

### Phase 1: Schema + Import Filtering (foundation)
- Database migration: extension tables, case_import_files, variant columns, cohort summary columns
- Existing variant migration (snv/indel classification by REF/ALT length)
- Full rebuild of cohort_variant_summary and gene_burden_summary (not backfill defaults)
- BED region filter module
- Quality pre-filter module
- Import filter integration in VcfStrategy streaming loop

### Phase 2: SV/CNV/STR Import (ONT callers)
- Variant type detector
- Caller detector (Clair3, Sniffles2, Spectre, Straglr)
- Extension field extractors (SV, CNV, STR)
- Extended VariantRepository.insertBatch with extension table inserts
- Multi-file import session: sequential files, case_import_files provenance, single cohort update at session end
- Reference genome detection + case-level lock enforcement

### Phase 3: Frontend — Type Tabs + Cohort Build Selector
- VariantTypeTabs component in case view
- Type-specific column definitions
- SV/CNV/STR detail panel sections
- Cohort genome_build selector
- Cohort variant_type filter
- Cohort summary rebuild with genome_build + variant_type

### Phase 4: Import UX — Smart Wizard
- Drag & drop multi-file selection
- Auto-detection summary (type, caller, build, count)
- Caller-aware default filters
- BED auto-suggestion from sibling files
- Contextual warnings (large file, missing annotations)
- Per-file progress tracking
- Post-import summary

### Phase 5: DRAGEN Expansion (when test data available)
- Nirvana JSON companion parser
- DRAGEN caller patterns + field extractors
- DRAGEN-specific extension fields (SM, BC, PR/SR, DRAGstrInfo)
- Folder/batch import UX

---

## 11. Test Strategy

### Unit Tests

1. BED filter: interval loading, padding, overlap check, edge cases (chr boundaries, empty BED)
2. Variant type detector: symbolic ALTs, breakend notation, SNV vs indel, caller disambiguation
3. Caller detector: all known patterns, unknown caller fallback, version extraction
4. Extension field extractors: Sniffles2 SV fields, Spectre CNV fields, Straglr STR fields
5. Reference genome detection: contig lengths, ##reference= parsing, unknown fallback
6. Import filters: PASS check, QUAL/GQ/DP thresholds, BED + quality combined

### Integration Tests

1. ONT SV VCF import (Sniffles2): 319 variants → variants + variant_sv tables
2. ONT CNV VCF import (Spectre): 101 variants → variants + variant_cnv tables
3. ONT STR VCF import (Straglr): 16 variants → variants + variant_str tables
4. Multi-file import: all 4 ONT files → one case with correct type distribution
5. BED filtered SNP import: large VCF → only variants in BED regions imported
6. Case-level lock: reject mismatched genome build on second file
7. Cohort rebuild with genome_build grouping
8. Backward compatibility: existing JSON/VCF import unchanged

### Test Data

- ONT P2 adaptive sampling run: `wf_sv.vcf.gz` (319 SVs), `wf_cnv.vcf.gz` (101 CNVs), `wf_str.vcf.gz` (16 STRs)
- Existing synthetic VCF: `tests/test-data/vcf/synthetic-unit-test.vcf`
- New synthetic VCFs needed: small SV/CNV/STR VCFs with known fields for unit tests

---

## 12. ONT wf-human-variation Output Reference

Real file structure from test data:

| File | Caller | Count | Annotation | VCF Version |
|---|---|---|---|---|
| `*.wf_snp.vcf.gz` | Clair3 | ~4.2M | None (user annotates) | 4.2 |
| `*.wf_sv.vcf.gz` | Sniffles2 v2.6.3 | 319 | SnpEff ANN + ClinVar | 4.2 |
| `*.wf_cnv.vcf.gz` | Spectre | 101 | SnpEff ANN + ClinVar | 4.2 |
| `*.wf_str.vcf.gz` | Straglr v1.4.5 | 16 | Built-in disease catalog | 4.1 |
| `*.regions.bed.gz` | — | — | 25kb bins with coverage | — |
| `*.wf_str.straglr.tsv` | Straglr | Per-read | STR read-level evidence | — |
| `*.wf_sv.snf` | Sniffles2 | — | Binary SNF (population SV) | — |
| `*.wf-human-*-report.html` | — | — | QC reports | — |

### Key Fields by Caller

**Sniffles2 SV** — FORMAT: GT, GQ, DR, DV, PS, ID. INFO: SVTYPE, SVLEN, END, PRECISE/IMPRECISE, SUPPORT, COVERAGE, STRAND, STDEV_LEN, STDEV_POS, VAF, RNAMES. FILTER: PASS plus 15+ specific filters (COV_MIN, STRAND, SUPPORT_MIN, etc.)

**Spectre CNV** — FORMAT: GT, HO, GQ, CN, ID. INFO: SVTYPE, SVLEN, END, CN, ANN (SnpEff), CLNSIG (ClinVar). ALT: `<DEL>`, `<DUP>`. Karyotype in header (`##PredictedSexChromosomeKaryotype=XX`).

**Straglr STR** — FORMAT: GT, SO, REPCN, REPCI, ADSP, ADFL, ADIR, LC. INFO: SVTYPE, END, REF, RL, RU, REPID, VARID, STR_STATUS, STR_NORMAL_MAX, STR_PATHOLOGIC_MIN, Disease, InheritanceMode, DisplayRU, HGNCId, RankScore, Source, SourceId, SourceDisplay, SweGenMean, SweGenStd. ALT: `<STRn>` symbolic alleles.

---

## 13. DRAGEN Output Reference (Future)

Prepared for but not implemented in initial phases.

**Files:** `*.hard-filtered.vcf.gz` (SNV/indel), `*.sv.vcf.gz` (Manta SV), `*.cnv.vcf.gz` (CNV), `*.repeats.vcf.gz` (ExpansionHunter STR), `*.json.gz` (Nirvana annotation companion).

**DRAGEN-specific fields:** DRAGstrInfo/DRAGstrParams (INFO), F1R2/F2R1/SPL/ICNT (FORMAT), DN/DQ (de novo, FORMAT), SQ (somatic quality), PR/SR (SV read support).

**Nirvana JSON:** Line-by-line streaming, one position per line. Key fields: transcripts (hgnc, consequence, impact, hgvsc, hgvsp, isCanonical, isManeSelect, sift, polyPhen), gnomad (allAf + population breakdown), clinvar (significance array), revel, spliceAI, phylopScore. Schema version 6. Booleans only serialized when true.

---

## 14. References

- [VarLens Issue #94](https://github.com/berntpopp/VarLens/issues/94) — Multi-variant type support
- [VCF v4.2 Specification](https://samtools.github.io/hts-specs/VCFv4.2.pdf)
- [Sniffles2 GitHub](https://github.com/fritzsedlazeck/Sniffles) — SV caller
- [Spectre GitHub](https://github.com/fritzsedlazeck/Spectre) — CNV caller
- [Straglr GitHub](https://github.com/bcgsc/straglr) — STR caller
- [Clair3 GitHub](https://github.com/HKU-BAL/Clair3) — SNV/indel caller
- [Nirvana JSON Format](https://illumina.github.io/NirvanaDocumentation/file-formats/nirvana-json-file-format/)
- [ICA VCF Format](https://illumina.github.io/IlluminaConnectedAnnotationsDocumentation/file-formats/illumina-annotator-vcf-file-format/)
- [DRAGEN Documentation](https://help.dragen.illumina.com/)
- [VarLens VCF Import Plan](.planning/docs/VCF-IMPORT-AND-ANNOTATION-PLAN.md)
