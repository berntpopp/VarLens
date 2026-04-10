# Canonical column model for source-agnostic annotations

> Research track 3 of 4 — architectural exploration, no implementation. Written 2026-04-10.

## Summary

VarLens currently bakes a single concrete source into every annotation column on the `variants` table: `gnomad_af` **is** gnomAD, `cadd` **is** CADD, `clinvar` **is** ClinVar CLNSIG, `hpo_sim_score` **is** the Phen2Gene-style HPO similarity from VarVis exports. This model breaks in multi-centre use the moment Lab A annotates with gnomAD v3 but Lab B uses TOPMed, or when SpliceAI/REVEL/AlphaMissense compete for the same conceptual "missense pathogenicity" slot. The hook for a better model already exists: migration v25 added a `case_import_files` provenance table with `caller` and `annotation_format` columns but no per-column source tracking. External tools converge on two complementary patterns — **OpenCRAVAT's `annotator__column` namespacing** combined with metadata sidecar tables, and **GA4GH VA-Spec's Statement / Study Result objects** that wrap every annotation with explicit source + method provenance. My recommendation is **Proposal B: canonical column + annotations_meta sidecar**, keyed on `(case_import_file_id, canonical_column)`, with a per-column "extras JSON" escape valve for the long tail. This preserves the flat, fast SELECT VarLens relies on today, adds provenance without a full EAV rewrite, and extends cleanly to SV/CNV/STR extension tables.

## The problem (concrete examples)

1. **Population frequency from different databases.** A proband VCF from Lab A carries `CSQ` with `gnomADe_AF`; Lab B delivers a VCF whose only frequency field is `TOPMed_AF`; Lab C exports `InHouse_AF` from a 12k in-house cohort; Lab D attaches `UKB_AF` from UK Biobank. All four are conceptually "population frequency" and all four would currently be silently dropped onto `variants.gnomad_af` (or worse, lost to `info_json`) depending on what INFO IDs happen to match `DEFAULT_INFO_FIELD_MAPPINGS`. A clinician filtering `gnomad_af < 0.01` has no way to know which database, which version, or which subpopulation the number came from.

2. **Pathogenicity score chaos.** CADD is a generic "deleterious impact" score but is complemented (and increasingly displaced) by REVEL for missense, SpliceAI for splicing, AlphaMissense for missense again, and CADD-SV / ClassifyCNV / AnnotSV ranking score for structural variants. Exomiser's canonical order today is `REVEL, MVP, ALPHA_MISSENSE` for missense with separate tables per concept ([Exomiser advanced analysis docs](https://exomiser.readthedocs.io/en/latest/advanced_analysis.html)). VarLens collapses all of that to one `cadd REAL` column.

3. **Phenotype match score is hard-coded as "HPO sim".** `hpo_sim_score` only fits the VarVis-style Phen2Gene column. If VarLens ever imports Exomiser JSON, CADA rankings, or an LLM-based phenotype matcher, they must either overwrite that column or go into `info_json` where filters can't touch them. The concept is "phenotype match score", the source is variable.

4. **Clinical significance is a CLNSIG string.** The same variant can have ClinVar, VarSome, Franklin, GeneBe, and Mastermind verdicts — each with its own 5-tier enum and its own last-reviewed date.

5. **Gene / OMIM / MOI provenance is lost.** `gene_symbol` comes from either CSQ's `SYMBOL`, ANN's gene name, or a JSON column index — but which one, and at what Ensembl/RefSeq release, is nowhere recorded.

## Current state: annotation columns in VarLens

### Exhaustive column inventory table

The table below is drawn from [`src/main/database/schema.ts:23-46`](../../src/main/database/schema.ts), migrations v5/v9/v23/v25 in [`src/main/database/migrations.ts`](../../src/main/database/migrations.ts), [`src/main/import/vcf/info-field-registry.ts`](../../src/main/import/vcf/info-field-registry.ts), [`src/main/import/vcf/VcfMapper.ts`](../../src/main/import/vcf/VcfMapper.ts), [`src/main/import/config/fieldMapping.ts`](../../src/main/import/config/fieldMapping.ts), and [`src/main/import/transforms/ObjectFormatMapper.ts`](../../src/main/import/transforms/ObjectFormatMapper.ts).

| VarLens column (physical)   | Current meaning             | Proposed canonical concept       | VCF INFO sources populating it (today)                                                         | VCF CSQ subfields                              | JSON-columnar source                 | JSON-object source           | Provenance preserved?                                     |
| --------------------------- | --------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------ | ---------------------------- | --------------------------------------------------------- |
| `gene_symbol`               | HGNC gene symbol            | `gene_symbol`                    | from CSQ `SYMBOL` / ANN `Gene_Name`                                                            | `SYMBOL`                                       | `Gene` (col 24)                      | `gene_symbol`                | No — Ensembl/RefSeq release not tracked                   |
| `omim_mim_number`           | OMIM MIM ID                 | `omim_id`                        | never (VCF import leaves `null`)                                                               | —                                              | `Omim`/`OMIM` (col 25)               | `omim_mim_number`            | No                                                        |
| `consequence`               | IMPACT severity enum        | `impact_severity`                | CSQ `IMPACT` (HIGH/MODERATE/LOW/MODIFIER) or ANN impact                                        | `IMPACT`                                       | `Impact`/`Consequence` (col 21)      | `consequence`                | No — which predictor decided IMPACT is lost               |
| `func`                      | SO consequence term         | `so_consequence`                 | CSQ `Consequence` or ANN annotation field                                                      | `Consequence`                                  | `VarType`/`Func` (col 20)            | `func`                       | No                                                        |
| `gnomad_af`                 | Population AF (single num)  | **`population_freq`**            | `gnomADe_AF`, `gnomADg_AF`, `gnomAD_AF`, bare `AF` (!), via `DEFAULT_INFO_FIELD_MAPPINGS`      | `gnomADe_AF`, `gnomADg_AF`                     | `GnomPMaxFiltAF`, `GnomTotal` (108)  | `gnomad_af`                  | **No** — silent squash from 4+ different sources         |
| `cadd`                      | CADD phred                  | **`missense_pathogenicity` / generic deleteriousness** | `CADD_phred`, `dbNSFP_CADD_phred`, `CADD_PHRED`                                                | `CADD_PHRED`                                   | `CADDPhredScore` (col 46)            | `cadd`                       | **No** — no slot for REVEL, AlphaMissense, SpliceAI     |
| `clinvar`                   | CLNSIG string               | **`clinical_significance`**      | `CLNSIG`, `CLINVAR_CLNSIG`, `ClinVar_CLNSIG`                                                   | `ClinVar_CLNSIG`                               | `ClinVar`/`ClinVSig` (col 72)        | `clinvar`                    | **No** — no slot for VarSome / Franklin / date           |
| `hpo_sim_score`             | phenotype match             | **`phenotype_match_score`**      | never (VCF leaves `null`)                                                                      | —                                              | `HpoSimScore` (col 156)              | `hpo_sim_score`              | **No** — hard-coded to "HPO sim" semantics               |
| `moi`                       | mode of inheritance         | `mode_of_inheritance`            | never (VCF leaves `null`)                                                                      | —                                              | `MoI` (col 162) via dict             | `moi` (array of `MoiItem`)   | No                                                        |
| `transcript`                | selected transcript ID      | `transcript_id` (selected)       | CSQ `Feature` / ANN feature ID                                                                 | `Feature`                                      | `Transcript` (col 28)                | `transcript`                 | No — transcript version, source (MANE/Canonical) not carried to main row |
| `cdna`                      | HGVSc                       | `hgvs_c`                         | CSQ `HGVSc` / ANN                                                                              | `HGVSc`                                        | `HGVS_C`/`cDNA` (col 29)             | `cdna`                       | No                                                        |
| `aa_change`                 | HGVSp                       | `hgvs_p`                         | CSQ `HGVSp` / ANN                                                                              | `HGVSp`                                        | `HGVS_P`/`AAChange` (col 30)         | `aa_change`                  | No                                                        |
| `qual`                      | VCF QUAL                    | intrinsic (no provenance needed) | VCF line QUAL field                                                                            | —                                              | `Qual`/`Qual-Index`                  | `qual`                       | n/a                                                        |
| `gt_num` / `gq` / `dp` / `ad_*` / `ab` / `filter` | FORMAT fields   | intrinsic (sample data)          | FORMAT fields of selected sample                                                                | —                                              | `Genotype`/`GTNum-Index`             | `gt_num`                     | n/a                                                        |
| `info_json`                 | unmapped INFO blob          | **escape valve**                 | any INFO field not matched by `DEFAULT_INFO_FIELD_MAPPINGS`                                    | —                                              | unused (JSON import path lossy)      | unused                       | Partial — key preserved, source still anonymous          |
| `variant_type` / `end_pos` / `sv_type` / `sv_length` / `caller` | multi-variant-type discriminators (v25) | intrinsic                         | SVTYPE / END / SVLEN / detected caller name                                                     | —                                              | —                                    | —                            | Caller name is preserved on the variant row              |

**Extension tables** added by migration v25 (`variant_sv`, `variant_cnv`, `variant_str`): all columns are caller-specific or domain-specific (e.g. `support`, `copy_number`, `ref_copies`). None of them track source or version — they are treated as raw passthroughs from `extension-parsers.ts`. Notably, there is **no `annotsv_ranking_score`, `classifycnv_class`, `pathogenicity_score`, or `sv_frequency`** column on `variant_sv`, which means SV-specific annotation tools have nowhere to land today.

### How VCF imports populate annotation columns today

[`VcfMapper.mapVcfRecord`](../../src/main/import/vcf/VcfMapper.ts) runs this chain:

1. `vcf-annotation-parser.parseAnnotation` — extracts CSQ (VEP) or ANN (SnpEff) into a fixed `AnnotationResult` with hard-coded field picks: `best?.fields.get('gnomADe_AF') ?? best?.fields.get('gnomADg_AF')`, `best?.fields.get('CADD_PHRED')`, `best?.fields.get('ClinVar_CLNSIG')`. These are **first-match wins** with no record of which alternative was present.
2. `info-field-registry.applyInfoFieldRegistry` — walks the remaining INFO fields; anything matching a `DEFAULT_INFO_FIELD_MAPPINGS` entry goes to its canonical column; **annotation-parser values beat registry values**, so CSQ `gnomADe_AF=0.5` will silently overwrite a standalone `gnomAD_AF=0.01` even if they disagree.
3. Unmapped fields fall into `info_json` as a raw string blob.
4. `extension-parsers.extractSv/Cnv/Str` — hard-coded INFO/FORMAT picks, no registry, no source tracking.

### How JSON imports populate them today

Three strategies — [`ColumnarStrategy`](../../src/main/import/strategies/ColumnarStrategy.ts), [`ObjectStrategy`](../../src/main/import/strategies/ObjectStrategy.ts), [`SimpleStrategy`](../../src/main/import/strategies/SimpleStrategy.ts):

- **Columnar** uses `resolveColumnIndices` against `HEADER_ID_TO_COLUMN` in `fieldMapping.ts`. `GnomPMaxFiltAF` and `GnomTotal` are both aliased to `GNOMAD_AF` with no way to tell them apart downstream. `CADDPhredScore` → `CADD`. `ClinVSig` → `CLINVAR`. The header is VarVis-shaped and source is implicit.
- **Object** (`ObjectFormatMapper`) expects plain `gnomad_af`, `cadd`, `clinvar`, `hpo_sim_score` properties and maps them 1:1 — assuming the upstream object already collapsed source provenance.
- **Simple** is the leanest of the three; no annotation-concept columns beyond `gene_symbol` / `consequence`.

None of the three JSON strategies records which producer built the file, which gene / transcript release was used, or which frequency / pathogenicity source was selected. The producer's own metadata — if any exists in the JSON header — is discarded.

### Where provenance is / isn't tracked

| Layer                        | What's tracked                                                                                                                 | What's missing                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `cases.file_path` + `genome_build` | original filename, reference build                                                                                      | per-file annotation source                                                                                |
| `case_data_info` (v21)       | `import_file_type`, `platform`, `af_filter`, `gene_list_filter`, `region_filter`, `quality_filter`, free-text `data_notes`   | structured per-annotation-source tracking; these are user-entered workflow notes, not extracted metadata |
| `case_import_files` (v25)    | `variant_type`, `caller`, `annotation_format` (string like `"csq"` / `"ann"` / `null`), `imported_at`                        | **which annotator versions fed which columns**; no link between a variant's populated columns and this row |
| `variants.info_json`         | raw key=value dump of unmapped INFO                                                                                            | schema; source binding; query-ability                                                                    |
| VCF header itself            | `##INFO=<ID=...,Description="...">` has free-text provenance (e.g. "gnomAD v3.1.2, all populations") that parsers ignore       | we parse INFO definitions (`vcf-header-parser`) but never persist them                                  |

**Critical gap:** `case_import_files` exists and is written by [`import-logic.ts:275`](../../src/main/ipc/handlers/import-logic.ts) / `:350`, but nothing links a row in `variants` back to it. A case is allowed to have N import files (SNV VCF + SV VCF + CNV VCF, or SNV v1 then an annotation re-import). The one-to-many is implicit: we know a case had files but we don't know which variant came from which file — let alone which column came from which annotation source within a file.

## External patterns researched

### OpenCRAVAT — `annotator__column` namespacing + metadata tables

OpenCRAVAT stores each annotator's output as separate columns on a single wide `variant` table, namespaced by annotator: `clinvar__sig`, `gnomad__af`, `cadd__phred`, `revel__score`, etc. A sidecar **`variant_annotator`** table stores per-annotator configuration (name, version, description), and **`variant_header`** stores the column metadata (display name, type, filterable, annotator owner). Reference: [OpenCRAVAT annotator tutorial](https://docs.opencravat.org/en/latest/Annotator-Tutorial.html).

- **Population frequency from multiple sources**: separate columns (`gnomad__af`, `gnomad__af_afr`, `thousandgenomes__af`, etc.); no unification layer.
- **Pathogenicity scores**: one column per predictor (`cadd__phred`, `revel__score`, `spliceai__ds_max`).
- **Provenance**: the `variant_annotator` sidecar carries version + source URL per annotator, and the UI pairs the data column with its metadata row by parsing the `annotator__column` prefix.
- **Pros**: every source is queryable with no JOIN; UI can group-by annotator using the namespace prefix; extensible without schema migrations when the column list is dynamic per-DB.
- **Cons**: column explosion (hundreds of columns is common); sparse data (most variants lack most annotators); schema varies across databases so queries have to be introspective; does not solve "I want the primary frequency" without a hard-coded preference list.

### GEMINI — flat wide variants table with hard-coded source names in column names

[GEMINI](https://gemini.readthedocs.io/) stores variants in one wide SQLite table with fixed columns such as `cadd_scaled`, `polyphen_score`, `sift_score`, `aaf_gnomad_all`, `aaf_1kg_all`, `aaf_esp_all`, `aaf_exac_all`, `clinvar_sig`, `clinvar_disease_name`, `in_esp` / `in_1kg` / `in_exac` boolean indicators. Sources: [blog post](https://davetang.org/muse/2016/01/13/getting-started-with-gemini/), [GEMINI schema docs](https://gemini.readthedocs.io/en/latest/content/database_schema.html).

- **Population frequency from multiple sources**: hard-coded column per (source × population), e.g. `aaf_1kg_eur`, `aaf_1kg_afr`, `aaf_gnomad_all`. The namespace is fixed at install time — new sources require a schema change.
- **Pathogenicity scores**: one hard-coded column per predictor.
- **Provenance**: implicit in the column name; version is a property of the GEMINI release, not stored per-row.
- **Pros**: flat, fast, SQL-friendly.
- **Cons**: rigid; no per-case source variance; exactly the problem VarLens has today, just with more columns.

### OpenCGA / CellBase — unified annotation object with source + version on every field

[OpenCGA's Variant Annotation docs](http://docs.opencb.org/display/opencga/Variant+Annotation) describe a nested object (`VariantAnnotation`) with fields `populationFrequencies: List<PopulationFrequency>` where each entry has `{study, population, refAlleleFreq, altAlleleFreq, altAlleleCount, altHomGenotypeCount, ...}`; `functionalScore: List<Score>` where each `Score` has `{score, source, description}`; `consequenceTypes: List<ConsequenceType>`; `traitAssociation: List<EvidenceEntry>`. The storage engine tracks annotator version and source-data version globally per project and re-annotation is idempotent.

- **Population frequency**: **list of objects**, each carrying `study` (e.g. "gnomAD_v3"), `population` (e.g. "afr"), and the numeric fields. This is the canonical representation VA-Spec references as well.
- **Pathogenicity scores**: parallel list of `{source, score}` objects.
- **Provenance**: first-class. Version tracked at project level, source on every object.
- **Pros**: clean, matches domain; extensible without schema changes; serialisable to MongoDB or JSON-column SQL.
- **Cons**: expensive to index for range queries (e.g. "filter by AF < 0.01 where source = gnomAD v3"); needs generated columns or JSON path indexes to stay fast; doesn't map naturally to a flat `variants` SELECT.

### Exomiser — parallel `frequencyData` / `pathogenicityData` lists in JSON output

[Exomiser's JSON output](https://exomiser.readthedocs.io/en/latest/advanced_analysis.html) models frequency and pathogenicity as parallel structured lists. `frequencyData` contains an array of `{source, frequency}` tuples where sources are an enum (`THOUSAND_GENOMES`, `ESP_AA`, `ESP_EA`, `EXAC_AFR_HOM`, `GNOMAD_E_AFR`, `GNOMAD_G_ALL`, `TOPMED`, `UK10K`, `LOCAL`, ...); `pathogenicityData` contains `{source, score}` entries with sources from an enum (`POLYPHEN`, `MUTATION_TASTER`, `SIFT`, `CADD`, `REMM`, `REVEL`, `MVP`, `ALPHA_MISSENSE`, `M_CAP`, `MPC`, `PRIMATE_AI`, `SPLICE_AI`) plus a convenience `mostPathogenicScore` pointer ([Exomiser changelog](https://github.com/exomiser/Exomiser/blob/master/exomiser-cli/CHANGELOG.md)).

- **Pattern**: structured list per concept, enumerated source names, computed "best" pointer.
- **Translates well to SQL**: each list becomes a child table with `(variant_id, source, value)`, plus a boolean `is_primary` (or a computed primary view).

### AnnotSV and ClassifyCNV — domain-specific SV canonical score

[AnnotSV](https://github.com/lgmgeo/AnnotSV) produces one ranking score (`AnnotSV_ranking_score`) that maps to the ACMG/ClinGen 5-class CNV interpretation scheme. ClassifyCNV emits the same classes. SV callers like Sniffles2, Manta, Spectre carry their own confidence / read-support metrics but do not emit population frequencies (those come from gnomAD-SV, dbVar, DGV). This matters because **SV annotation is a second, mostly disjoint namespace** of canonical concepts: `sv_pathogenicity_class`, `sv_population_freq`, `sv_gene_overlap_type` (full / partial / regulatory) — none of which share storage with SNV scores.

### GA4GH VA-Spec — Statement vs Study Result object model

[GA4GH Variant Annotation Specification 1.0](https://va-spec.ga4gh.org/en/latest/modeling-foundations.html) separates **Statements** (assertions, e.g. "this variant is Pathogenic for condition X per ClinGen") from **Study Results** (raw data from a single study, e.g. "Cohort Allele Frequency = 0.0012 in gnomAD v4"). A `CohortAlleleFrequencyStudyResult` has `{focusAllele, focusAlleleCount, locusAlleleCount, cohort, source, ancestry, ...}`. Both Statement and Study Result objects include first-class provenance and method fields.

- **Pattern**: every annotation carries `{source, method, date, confidence}`; aggregation ("which is the primary frequency to show?") is a UI or downstream-layer concern.
- **Implication for VarLens**: if we adopt a sidecar meta table, the columns should mirror the Statement / Study Result field set (source, source_version, method, assertion_date).

### Synthesis: common patterns and anti-patterns

| Pattern                                                                      | Used by                          | Pro                                          | Con                                               |
| ---------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Wide column per (source × concept), hard-coded                               | GEMINI                           | fast, flat, simple SQL                       | schema rigidity, column explosion                 |
| Namespaced columns `annotator__concept`, metadata sidecar                    | OpenCRAVAT                       | dynamic, introspective, fast                 | many columns, no automatic aggregation            |
| Nested `List<{source, value, version}>` objects                              | OpenCGA, Exomiser, GA4GH VA-Spec | domain-faithful, extensible                  | range-query unfriendly without JSON indexes       |
| Single canonical column + sidecar `annotations_meta` table                   | (hybrid — not a tool per se)     | flat SELECT stays fast, provenance preserved | "primary source wins" logic must be defined       |
| Pure EAV (`variant_id, attribute, value`)                                    | avoided by most                  | maximal flexibility                          | query performance disaster; no type safety       |

**Anti-patterns to avoid:**
- Overwriting an existing value when a "better" source appears during import (VarLens does this today in `applyInfoFieldRegistry`).
- Using `info_json` as a source-of-truth dumping ground (queries can't reach it without JSON path extractors).
- Hard-coding a preferred source list in application code that users can't override per-case.

## Design proposals

### Proposal A — Pure EAV (Entity-Attribute-Value) table

```sql
CREATE TABLE variant_annotation_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL,
  concept TEXT NOT NULL,            -- 'population_freq' | 'missense_pathogenicity' | ...
  source_name TEXT NOT NULL,        -- 'gnomAD' | 'TOPMed' | 'REVEL' | 'AlphaMissense'
  source_version TEXT,              -- 'v4.1.0'
  subpopulation TEXT,               -- 'all' | 'afr' | 'eas' (for freq)
  numeric_value REAL,
  text_value TEXT,
  case_import_file_id INTEGER,      -- provenance back to the file
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  FOREIGN KEY (case_import_file_id) REFERENCES case_import_files(id) ON DELETE CASCADE
);
CREATE INDEX idx_vav_variant_concept ON variant_annotation_values(variant_id, concept);
```

**Pros**: infinitely extensible; new concepts require no migration; matches the domain 1:1.

**Cons**: every `variants` SELECT needs either a pivot or 5-10 LEFT JOINs to show the main table. Filter queries become `EXISTS (SELECT 1 FROM variant_annotation_values WHERE ...)` — slow on 5M-row databases. Vuetify sortable columns effectively stop working because sort keys would need to JOIN into EAV for every row. VarLens's FTS5 index on `variants` doesn't cover EAV rows.

**Migration cost**: high. The entire `VariantRepository.getVariants()` query would need a rewrite, `VariantFilterBuilder` would need a SORTABLE_COLUMNS rewrite, and every filter preset breaks.

### Proposal B — Canonical column + annotations_meta sidecar **(recommended)**

Keep the flat `variants` shape but **rename** concept columns and add a sidecar that records, per variant × concept, which source produced the value. The canonical column always holds the primary value (chosen at import time by a configurable preference list); additional sources go into a JSON extras column.

```sql
-- Rename / clarify existing columns
ALTER TABLE variants RENAME COLUMN gnomad_af TO population_freq;
ALTER TABLE variants RENAME COLUMN cadd TO missense_pathogenicity;  -- reinterpret
ALTER TABLE variants RENAME COLUMN clinvar TO clinical_significance;
ALTER TABLE variants RENAME COLUMN hpo_sim_score TO phenotype_match_score;
-- (SQLite ALTER RENAME COLUMN is supported from 3.25+, which better-sqlite3 ships.)

-- New: per (variant, concept, source) provenance + extras
CREATE TABLE variant_annotation_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL,
  concept TEXT NOT NULL CHECK(concept IN (
    'population_freq', 'missense_pathogenicity', 'splice_pathogenicity',
    'clinical_significance', 'phenotype_match_score', 'mode_of_inheritance',
    'sv_pathogenicity', 'sv_population_freq', 'str_pathogenicity'
  )),
  source_name TEXT NOT NULL,        -- 'gnomAD_exomes' | 'REVEL' | 'ClinVar' | ...
  source_version TEXT,              -- 'v4.1.0' | '1.5' | '2026-01-15'
  subset TEXT,                      -- 'all' | 'afr' | 'popmax' | 'HIGH_confidence'
  numeric_value REAL,               -- for numeric concepts
  text_value TEXT,                  -- for categorical concepts
  case_import_file_id INTEGER NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,  -- matches the main variants.<col>
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  FOREIGN KEY (case_import_file_id) REFERENCES case_import_files(id) ON DELETE CASCADE,
  UNIQUE (variant_id, concept, source_name, source_version, subset, case_import_file_id)
);
CREATE INDEX idx_vam_variant ON variant_annotation_meta(variant_id);
CREATE INDEX idx_vam_concept_primary ON variant_annotation_meta(concept, is_primary) WHERE is_primary = 1;

-- Per-file registry of which concept columns it populated and from what source
CREATE TABLE case_import_file_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_import_file_id INTEGER NOT NULL,
  concept TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_version TEXT,
  source_description TEXT,          -- free-text from VCF INFO header
  vcf_info_id TEXT,                 -- 'gnomADe_AF' | 'CSQ[CADD_PHRED]' | json:gnomad_af
  FOREIGN KEY (case_import_file_id) REFERENCES case_import_files(id) ON DELETE CASCADE
);
```

**Flow**: at import time, for each concept we pick a source using a user-configurable preference list (default: `population_freq: [gnomAD_genomes, gnomAD_exomes, TOPMed, 1000G]`). The winning value lands on `variants.population_freq`; *every* observed source, including the winner, lands on `variant_annotation_meta` with `is_primary=1` on the winner. Filter queries continue to hit `variants.population_freq` directly. The variant details panel JOINs `variant_annotation_meta WHERE variant_id = ?` to show the tooltip "gnomAD_genomes v4.1.0 popmax = 0.0012 — from file_A.vcf imported 2026-04-08".

**Pros**:
- Flat SELECT path is untouched — existing query performance holds.
- Filter/sort by canonical column still works without EAV pivots.
- Provenance is fully preserved and queryable.
- Multiple sources coexist without overwriting.
- Natural extension to SV/CNV/STR: add `sv_pathogenicity_score` column on `variant_sv`, wire the same sidecar with concept `sv_pathogenicity`.
- Migration is incremental: existing rows become `variant_annotation_meta` entries marked `source_name = 'legacy_inferred', source_version = NULL, is_primary = 1`.

**Cons**:
- "Primary source" logic must be codified — what if the user wants TOPMed to win for African-ancestry cases? Solution: per-project / per-case preference list stored in settings.
- Double-write on import (one row per variant × concept × source). Mitigated by bulk-insert batching (same pattern VarLens already uses for `variant_transcripts`).
- Renaming columns is a breaking change for any external consumers of the SQLite file. Mitigate by keeping views named `gnomad_af`, `cadd`, `clinvar` as compatibility shims.

### Proposal C — JSON column per concept, indexed via generated columns

```sql
ALTER TABLE variants ADD COLUMN population_freq_json TEXT;   -- e.g. '[{"source":"gnomAD_g","version":"v4","subset":"popmax","value":0.0012}]'
ALTER TABLE variants ADD COLUMN population_freq REAL
  GENERATED ALWAYS AS (json_extract(population_freq_json, '$[0].value')) STORED;
CREATE INDEX idx_variants_popfreq ON variants(population_freq);
```

Each concept gets a JSON column with an ordered array of source entries (primary first), plus a `STORED GENERATED` column that lifts the primary numeric value for fast filtering. SQLite 3.38+ supports this (better-sqlite3 ships 3.47+).

**Pros**: provenance travels inline with the row; extensible with no schema changes per new source; leverages SQLite's `json_each()` for source-filtered queries (e.g. "variants where any entry has source='REVEL' and value > 0.5"); avoids a second table.

**Cons**: JSON manipulation is per-row CPU work on every upsert; migrating existing `gnomad_af` to `population_freq_json` is a one-shot rewrite of the whole variants table (~5M rows in the dev DB would take minutes); `json_extract` on GENERATED column works but indexing subset-aware queries requires multiple generated columns per subset.

### Comparison of the three proposals

| Criterion                             | A: EAV                        | B: Canonical + Meta **(recommended)**   | C: JSON + Generated |
| ------------------------------------- | ----------------------------- | --------------------------------------- | ------------------- |
| SELECT performance (list)             | poor (pivot or N joins)       | unchanged                               | near-unchanged      |
| Filter performance                    | poor                          | unchanged                               | good (indexed gen col) |
| Sort performance                      | poor                          | unchanged                               | good                |
| Provenance completeness               | full                          | full                                    | full (inline)       |
| Migration cost                        | very high                     | moderate (renames + sidecar)            | moderate (single rewrite pass) |
| Accommodates SV/CNV/STR               | yes                           | yes (per extension table)               | yes                 |
| SQL verbosity for UI tooltips         | high                          | one JOIN                                | `json_each`         |
| Works with existing VariantFilterBuilder | no (rewrite)              | yes (column renames only)               | yes                 |
| Works with FTS5 triggers              | no                            | yes                                     | yes                 |

## Recommendation

**Proposal B: Canonical column + `variant_annotation_meta` sidecar.** It preserves the flat, fast query path VarLens has invested in (FTS5, `VariantFilterBuilder`, `SORTABLE_COLUMNS`, column-filter dialogs, the `internal_af` left-join pattern) while closing the provenance gap. The migration is incremental — column renames are additive with compatibility views, and the sidecar starts empty and fills during future imports. It also maps cleanly onto the GA4GH VA-Spec mental model (canonical column = "the primary Statement", meta rows = "Study Results"), which gives us a path toward GA4GH interop later.

Secondary reason: Proposal C (JSON columns) looks tempting but the dev database already has 5.5k variants and a user's production DB could hit 5M. A one-shot rewrite of the whole table to push existing values into JSON arrays is a hard migration that can fail mid-way in encrypted-DB environments. Sidecar inserts are resumable.

## Schema sketches and example SQL

**Renaming + compatibility shims** (incremental, safe on existing DBs):
```sql
-- v26 migration
ALTER TABLE variants RENAME COLUMN gnomad_af TO population_freq;
ALTER TABLE variants RENAME COLUMN cadd TO missense_pathogenicity;
ALTER TABLE variants RENAME COLUMN clinvar TO clinical_significance;
ALTER TABLE variants RENAME COLUMN hpo_sim_score TO phenotype_match_score;

-- Backwards-compat view so external scripts keep working
CREATE VIEW IF NOT EXISTS variants_legacy AS
  SELECT id, case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number,
         consequence, func,
         population_freq AS gnomad_af,
         missense_pathogenicity AS cadd,
         clinical_significance AS clinvar,
         phenotype_match_score AS hpo_sim_score,
         /* rest unchanged */
         moi, transcript, cdna, aa_change, gt_num, qual,
         variant_type, end_pos, sv_type, sv_length, caller
  FROM variants;
```

**Seed existing rows into the meta table** (preserves history):
```sql
INSERT INTO variant_annotation_meta
  (variant_id, concept, source_name, source_version, numeric_value, case_import_file_id, is_primary)
SELECT v.id, 'population_freq', 'legacy_inferred', NULL, v.population_freq,
       COALESCE(
         (SELECT id FROM case_import_files cif WHERE cif.case_id = v.case_id ORDER BY imported_at LIMIT 1),
         -1
       ),
       1
FROM variants v
WHERE v.population_freq IS NOT NULL;
-- repeat for missense_pathogenicity, clinical_significance, phenotype_match_score
```

**Writing a new annotation at import** (VCF path, conceptual):
```sql
-- After the VCF mapper resolves gnomADg_AF=0.0012 AND TOPMed_AF=0.0008 AND gnomAD_genomes preferred:
BEGIN;
  UPDATE variants SET population_freq = 0.0012 WHERE id = ?;
  INSERT INTO variant_annotation_meta
    (variant_id, concept, source_name, source_version, subset, numeric_value, case_import_file_id, is_primary)
  VALUES
    (?, 'population_freq', 'gnomAD_genomes', 'v4.1.0', 'all', 0.0012, ?, 1),
    (?, 'population_freq', 'TOPMed',         'r3',     'all', 0.0008, ?, 0);
COMMIT;
```

**UI tooltip query** (VariantDetailsPanel):
```sql
SELECT m.source_name, m.source_version, m.subset, m.numeric_value, m.is_primary,
       cif.file_path, cif.imported_at
FROM variant_annotation_meta m
JOIN case_import_files cif ON cif.id = m.case_import_file_id
WHERE m.variant_id = ? AND m.concept = 'population_freq'
ORDER BY m.is_primary DESC, m.source_name;
```

## Migration path for existing data

1. **v26 — column renames + sidecar tables + compat view** (idempotent, no row writes).
2. **v27 — backfill `variant_annotation_meta`** from existing non-NULL values with `source_name='legacy_inferred'`, `is_primary=1`. Chunked, resumable.
3. **v28 — `case_import_file_sources` table**: on next import, populate it by parsing VCF `##INFO` header lines (`Description="..."` fields often say "gnomAD v3.1.2" in plain text; we already parse INFO defs in `vcf-header-parser.ts` but discard them).
4. **v29 — remove compat view** once external tooling is updated (user-opt-in; can stay forever if noisy).

No data loss at any step. Existing filter presets work unchanged because SQL queries operate on the renamed columns via the compat view for at least one release.

## UI implications

- **Variant table cells** gain an optional "source badge" (small chip) when `variant_annotation_meta` has > 1 source for that variant × concept. Clicking expands a tooltip that lists every source with version, subset, and file.
- **Column headers** display the canonical concept name ("Population Frequency") rather than a tool name. A gear icon next to the header opens a per-project preference dialog to reorder the source preference list (e.g. "always prefer TOPMed over gnomAD for this cohort").
- **Filter dialog** gains a "source" dropdown for numeric concept filters: "population freq < 0.01 **from gnomAD_genomes**" becomes expressible. Default is "primary source (any)".
- **Case detail** surfaces `case_import_file_sources` as a table: for each imported file, which concept columns it contributed and which source produced them. This is the UI equivalent of `gcc -v` for an imported case.
- **Variant details panel** adds an "Annotation sources" expansion tile listing every row in `variant_annotation_meta` for the current variant. This is where the user sees `gnomAD_genomes v4.1.0 popmax = 0.0012 (from file_A.vcf imported 2026-04-08)`.

## Extension tables (SV/CNV/STR) considerations

SV/CNV/STR annotations have their own concept namespace. The sidecar approach scales naturally:

**SV-specific concepts**:
- `sv_pathogenicity_class` — from AnnotSV ranking score, ClassifyCNV, or manual ACMG/ClinGen CNV class
- `sv_population_freq` — from gnomAD-SV, dbVar, DGV
- `sv_gene_overlap` — full / partial / regulatory element (AnnotSV)
- `sv_caller_confidence` — already intrinsic on `variant_sv` (support, dr/dv) — no provenance needed

**STR-specific concepts**:
- `str_pathogenicity_class` — from STRipy, stranger
- `str_reference_range` — already in `variant_str.normal_max` / `pathologic_min`, tag with source_name

**Proposed extension schema additions** (part of Proposal B):
```sql
ALTER TABLE variant_sv ADD COLUMN sv_pathogenicity_class TEXT;  -- '1'|'2'|'3'|'4'|'5'
ALTER TABLE variant_sv ADD COLUMN sv_pathogenicity_score REAL;
ALTER TABLE variant_sv ADD COLUMN sv_population_freq REAL;
ALTER TABLE variant_sv ADD COLUMN sv_gene_overlap_type TEXT;
-- All of these populate variant_annotation_meta with concepts sv_pathogenicity_class etc.
```

The sidecar's `concept` column accepts any of the SV/CNV/STR-specific enums, so a single `variant_annotation_meta` table serves both the main table and the extensions. The `case_import_file_sources` table already distinguishes SV / CNV / STR imports via `case_import_files.variant_type`.

## Open questions and trade-offs

1. **Primary source selection strategy.** Is the preference list static at app level, per-project, per-case, or per-variant? My current thinking: per-project default with per-case override, stored in a new `project_preferences` table. Needs user research.

2. **What counts as a "concept"?** The list in Proposal B is illustrative — the real list has to be negotiated with users (clinicians). Do we split `missense_pathogenicity` from `splice_pathogenicity`? Probably yes. Do we split `population_freq` from `population_freq_popmax`? Unclear.

3. **Subpopulation granularity.** gnomAD has 11 subpopulations × 3 genotype states × AN/AC/AF — representing all of that in `variant_annotation_meta` is ~100 rows per variant per import. Alternative: store only (popmax, all) on the meta table and shove the rest into a per-variant JSON column. Hybrid of B and C.

4. **Re-annotation workflow.** If a user re-imports the same VCF with a newer annotator version, do we append new rows to the meta table or replace existing ones? OpenCGA replaces; Exomiser appends. Append preserves history but grows the table; replace is lossy.

5. **Query performance at scale.** `variant_annotation_meta` will dwarf `variants` by 3-5x. Need to measure on a 5M-variant database before committing — the index on `(variant_id, concept)` should make tooltip queries O(1) per concept, but bulk inserts at import time will roughly double the write cost.

6. **Compatibility with built-in filter presets.** `built-in-presets.ts` hard-codes `gnomad_af < 0.01` strings. The rename means those presets need either a one-shot update or we keep both column names via the view forever.

7. **VCF INFO header parsing.** We already parse INFO definitions in `vcf-header-parser.ts` but discard the `Description` field. Lightweight improvement independent of the bigger redesign: persist those descriptions in `case_import_file_sources` on every import.

8. **The biggest open question (blocker for moving forward):** *Who chooses the canonical source when there's a conflict?* If import time auto-selects and the user disagrees three months later, do we rerun the entire preference resolution pass and update `is_primary` flags, or do we keep the historical decision and override in the UI? This is the single call I can't make without product input — everything else downstream (migration shape, UI tooling, query path) follows from the answer.

## References

- [VarLens schema definitions](../../src/main/database/schema.ts)
- [VarLens migrations (especially v25 multi-variant-type + case_import_files)](../../src/main/database/migrations.ts)
- [VarLens VCF INFO field registry](../../src/main/import/vcf/info-field-registry.ts)
- [VarLens VCF mapper](../../src/main/import/vcf/VcfMapper.ts)
- [VarLens JSON columnar format mapping](../../src/main/import/config/fieldMapping.ts)
- [VarLens object format mapper](../../src/main/import/transforms/ObjectFormatMapper.ts)
- [VarLens import-logic case_import_files writer](../../src/main/ipc/handlers/import-logic.ts)
- [Existing VCF import plan](VCF-IMPORT-AND-ANNOTATION-PLAN.md)
- [Exomiser advanced analysis (frequency / pathogenicity source enums)](https://exomiser.readthedocs.io/en/latest/advanced_analysis.html)
- [Exomiser changelog](https://github.com/exomiser/Exomiser/blob/master/exomiser-cli/CHANGELOG.md)
- [GEMINI database schema](https://gemini.readthedocs.io/en/latest/content/database_schema.html)
- [GEMINI getting-started tutorial (column listing)](https://davetang.org/muse/2016/01/13/getting-started-with-gemini/)
- [OpenCGA Variant Annotation](http://docs.opencb.org/display/opencga/Variant+Annotation)
- [OpenCRAVAT annotator tutorial (`annotator__column` pattern)](https://docs.opencravat.org/en/latest/Annotator-Tutorial.html)
- [GA4GH Variant Annotation Specification — modeling foundations](https://va-spec.ga4gh.org/en/latest/modeling-foundations.html)
- [GA4GH VA-Spec Study Result profiles](https://va-spec.ga4gh.org/en/1.0/va-standard-profiles/base-profiles/study-result-profiles.html)
- [AnnotSV](https://github.com/lgmgeo/AnnotSV)
- [EAV anti-pattern overview](https://cedanet.com.au/antipatterns/eav.php)
- [EAV guidelines for biomedical databases](https://pmc.ncbi.nlm.nih.gov/articles/PMC2110957/)
