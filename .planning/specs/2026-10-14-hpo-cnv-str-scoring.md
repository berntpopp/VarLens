# HPO phenotype scoring for CNVs and STRs

Status: draft for approval, 2026-10-14. Branch `feat/hpo-phenotype-v2`. Refs #600 (phenotype score), #581 (SV/CNV evidence scoring), #582 (STR evidence scoring). Upstream annotation: varlens-annotation-workflows#3 (AnnotSV fields into VCF INFO), #4 (VEP `--max_sv_size` for CNVs > 10 Mb), #5 (Stranger STR VCF).
Builds on `.planning/specs/2026-10-14-hpo-phenotype-scoring-v2.md` (the v2 SNV scorer, §7 Outcome: shipped with τ = 1, background correction off, exclusions as conflicts only).

Inputs:
- `.planning/docs/hpo-phenotype-v2/research-cnv.md` and `research-str.md` (our research; [V]/[A] marks there)
- the agy (Gemini Argon) brainstorm `~/.cache/varlens-session/s6-agy-cnv-str.md` (decisions on it in §9)
- Code read for this spec: `src/shared/phenotype/phenotype-score.ts`, `phenotype-index.ts`, `hpo-sources.ts`, `src/main/services/phenotype/hpo-similarity-db.ts`, `hpo-data-update.ts`, `src/main/services/scoring/evidence/case-context.ts`, `rank-page.ts`, `src/main/services/scoring/score-str.ts`, `src/main/import/vcf/gene-fallback.ts`, `src/shared/dsl/column-registry.ts`, `src/shared/config/shortlist-evidence.config.ts`.

Implementation plan: `.planning/plans/2026-10-14-hpo-cnv-str-scoring-plan.md`.

## 1. Problem

`hpo_resnik` is a gene score: the max of S(d) over the gene's diseases. It is wrong for CNVs and STRs in different ways.

CNV:
- A CNV row carries only its best transcript's gene (`VcfMapper.ts:181`), or the first overlapping protein-coding gene from the import fallback (`gene-fallback.ts`). The other genes it deletes or duplicates are invisible to the score.
- Dosage is ignored. A whole-gene duplication of a haploinsufficient gene scores like its deletion.
- Recurrent genomic disorders cannot score at all. 185 of 267 region-like HPOA diseases have no gene link, and the builder drops every unlinked disease (`hpo-similarity-db.ts:78-91`). Examples: 16p11.2 deletion (OMIM:611913), 1q21.1 duplication (OMIM:612475).

STR:
- **Mechanism contamination.** The gene max credits repeat calls with point-mutation and CNV diseases. In 15 catalogue genes the contaminating disease has more annotations than the repeat disease, so it likely wins. Example: a TCF4 CTG18.1 expansion in a child with ID shows "best: Pitt-Hopkins syndrome".
- **Status is ignored.** An FMR1 premutation is credited with Fragile X syndrome. A heterozygous RFC1 expansion is credited with CANVAS, which is recessive.
- **Missing diseases.** Some repeat diseases are not gene-linked in HPO, so they are not in the index: ORPHA:273 (DM1, the richest DM1 profile, 108 annotations), ORPHA:401901 and ORPHA:98757.

The status-vocabulary bug and the missing STR/SV/CNV genes at import are already fixed on this branch (`b07165b2`, `gene-fallback.ts`). They are not part of this spec.

**CNVs arrive annotated, like STRs.** EPI2ME STR VCFs already carry Stranger fields (varlens-annotation-workflows#5 ships and validates them). The annotation workflow (`../varlens-annotation-workflows`) VEP-annotates CNVs: CSQ carries several genes per record, plus OverlapBP/OverlapPC. AnnotSV results exist only in TSV sidecars today.

This spec consumes what the VCF carries and uses runtime reference data only as the fallback:
- **Gene set:** every distinct CSQ gene of the record. They are stored as `variant_transcripts` rows (one per CSQ entry) on both backends. The gene-interval overlap from `gene_reference.db` is used only when a CNV has no CSQ: unannotated, or larger than VEP's `--max_sv_size` (10 Mb by default, varlens-annotation-workflows#4).
- **Dosage:** AnnotSV HI/TS written into INFO (varlens-annotation-workflows#3) when present, else the runtime ClinGen download.

A separate lane is testing how VarLens imports multi-gene VEP CNVs today. Its result is a hard dependency of the CNV wiring (plan, lane L5).

## 2. Goals and non-goals

Goals:
1. Give every CNV row (`variant_type = 'cnv'`, or an `sv` row with `sv_type` DEL/DUP) a phenotype score on the same [0, 1] scale as SNV `hpo_resnik`. The score must stay comparable across types, reduce exactly to the SNV score for a single-gene CNV, and not inflate with CNV size.
2. Give every catalogued STR row a phenotype score computed only against the diseases of its locus and status band. Normal alleles get null.
3. Download every new reference source at runtime with a version and a digest or schema check, through the existing HPO update path. Nothing is bundled.
4. Expose the result to the evidence DSL with three new derived fields and one new tooltip line. Ship identical behaviour on SQLite and PostgreSQL.
5. Validate against pre-registered criteria (§7) before `structuralTypes.enabled` is flipped for CNV or STR.

Non-goals (each could be a later spec):
- INV, BND, INS and translocation breakpoint scoring. These rows get null.
- TAD and enhancer effects, CNV population frequency, DECIPHER coordinates (licence unclear), and T2T coordinates (`str` and `cnv` rows on T2T get null).
- pHaplo, pTriplo and LOEUF dosage weights. ClinGen is the only dosage source in v1.
- Age, anticipation and penetrance in the score. Typical onset is shown, not scored.
- Short-read saturation rescue from `REPCI`.
- Mixed-type order calibration (SNV against CNV points), and flipping `structuralTypes.enabled`. Both are decided after §7 runs.
- New case-table or cohort-table columns.
- Wiring the new score into the legacy 0-1 SV/CNV/STR scorers. Decided: not before §7 passes (§11).

## 3. Data sources

All sources are fetched by the existing **Update HPO data** action (`hpo-data-update.ts`) and preprocessed into the same `hpo_similarity.db`. One file means one status row, one atomic rename and one cache key.

`HPO_DATA_CONFIG.builderVersion` goes from 5 to 6 (5 is taken by the v2 review fixes: deduplicated, alias-canonicalised HPOA pooling), so installed data reports "needs update". The web server keeps reading the operator-built file (`npm run build:hpo-db`), which fetches the same sources.

| Source | Asset (URL base in typed config) | Licence | Version pin | Integrity | Size |
|---|---|---|---|---|---|
| HPO (unchanged) | `hp.json`, `phenotype.hpoa`, `genes_to_phenotype.txt` | HPO licence (existing) | release tag | GitHub asset digest, pinned fallback | ~80 MB |
| ClinGen dosage, genes | `ftp.clinicalgenome.org/ClinGen_gene_curation_list_GRCh{37,38}.tsv` | **CC0 1.0** (attribution requested) | no releases. Version = the file's header date + download date; sha256 is stored in meta | no published digest: TLS, strict header check (exact column names), and row floors (≥ 1,000 genes, ≥ 400 regions) | ~250 KB per build |
| ClinGen dosage, regions | `ftp.clinicalgenome.org/ClinGen_region_curation_list_GRCh{37,38}.tsv` | CC0 1.0 | as above | as above | ~100 KB per build |
| STRchive loci | GitHub release asset `STRchive-loci-v<ver>.json` (`dashnowlab/STRchive`) | **MIT** (notice shipped with attribution) | release tag, e.g. `v2.28.0` | GitHub asset digest, fail closed. Pinned fallback `v2.28.0`, sha256 `16301ecb00239f0e3c684913aefc2f48c6f5a7c2a481958aab4db55d282bca86` | ~0.5 MB |
| Mondo | GitHub release asset `mondo.obo` (`monarch-initiative/mondo`) | **CC BY 4.0** (attribution required) | release tag, e.g. `v2026-10-06` | GitHub asset digest. Pinned fallback sha256 `2631e8e165d41def1a46749adb1ce0a336c8aba7f6bc0978729592cee8fed60b` | ~53 MB, read at build only |

Notes:
- **Why Mondo.** ClinGen regions name their disease by MONDO id. HPOA uses OMIM and ORPHA ids. The builder keeps only the `xref: OMIM:` and `xref: Orphanet:` lines tagged `MONDO:equivalentTo` for the ≈ 45 MONDO ids it needs, and discards the rest. Mondo is the one source the brief did not name; the user chose the download (2026-10-14).
- **Update policy: per source (user decision 2026-10-14).** HPO is required: if HPO fails, the update fails and the installed DB is untouched (today's behaviour). If an optional source (ClinGen, STRchive, Mondo) fails its download, digest, header or row floor, the builder copies that source's tables and `sources` entry from the installed DB, so it keeps its previous version. With no previous copy, its tables stay empty and CNV/STR scoring for that part is null. The status row shows a warning naming the stale or missing source. The build stays one atomic rename.
- **The VCF is read first.** The CSQ gene set and the INFO HI/TS from varlens-annotation-workflows#3 take precedence over the downloads. The INFO keys are set in typed config (`hpo-locus-scoring.config.ts`) once #3 fixes its format. They are read from `info_json`, so there is no new column and no migration. The tooltip names the dosage source, either "AnnotSV" (from the VCF) or "ClinGen <date>" (downloaded), because AnnotSV's copy of ClinGen can be older. The other #3 fields (ACMG_class, ranking score, B_*_AFmax, P_*_hpo) are **not** read by this score: P_*_hpo and the ranking already contain a phenotype term, and reading them would double-count it. Exposing them as DSL fields is a separate follow-up.
- **Gene intervals are not new data, and they are the fallback.** They come from the bundled `resources/gene_reference.db` (`gene_coordinates`, both builds), as the import gene fallback already does. ClinGen genes are joined by **HGNC id**, never by symbol, so symbol drift cannot misassign dosage.
- **Versions in the UI.** `HpoDataStatus` gains `sources: Record<string, string>` (e.g. `{ hpo: 'v2026-09-01', clingen: '2026-10-14', strchive: 'v2.28.0', mondo: 'v2026-10-06' }`). `HpoDataRow.vue` shows them in one line, with attribution for each source.

New tables in `hpo_similarity.db`. These are reference tables, not user-DB migrations:

```sql
dosage_genes   (hgnc_id TEXT PRIMARY KEY, symbol TEXT, hi INTEGER, ts INTEGER)           -- 0,1,2,3,30,40 or NULL
dosage_regions (isca_id TEXT, build TEXT, chr TEXT, start INTEGER, end INTEGER,
                label TEXT, hi INTEGER, ts INTEGER, loss_diseases TEXT, gain_diseases TEXT,  -- JSON id arrays (OMIM/ORPHA)
                PRIMARY KEY (isca_id, build))
str_loci       (id TEXT PRIMARY KEY, json TEXT NOT NULL)                                  -- normalised catalogue row (§5.1)
```

Builder change, the only one that touches the existing disease tables:
- Diseases named by a kept region (HI or TS ≥ 2 with an OMIM/ORPHA mapping, about 43) are **admitted** to `diseases` and `disease_terms`.
- So are the catalogue diseases of every STR locus (§5.1), including ORPHA:273.
- They are **not** added to `gene_diseases`. Every gene's disease set, and so every SNV `hpo_resnik`, best disease and percentile, stays **byte-identical**. A unit test asserts this.
- IC is already computed from all HPOA diseases (`informationContent(positive, …)`), so the IC corpus does not change either.

## 4. CNV scoring

Notation:
- The case's v2 result gives S(g) ∈ [0, 1] for each of the G indexed genes, the best disease d*(g), and `sorted`, the ascending gene scores. S(d) is known for every indexed disease.
- A CNV c has interval [a, b] in the case build. b is `end_pos`, else `pos + |sv_length|`.
- Its type is DEL or DUP. It comes from `sv_type`, else from the copy number against the reference CN: 2, or 1 on chrX/chrY outside the PARs in a male.
- G(c) is the set of the CNV's genes that are in the phenotype index. n_c = |G(c)|, counting only genes with weight w > 0.
  - **Annotated (CSQ present):** the distinct `variant_transcripts.gene_symbol` values of the row. They are fetched in one batched query per Stage-1 page of CNV rows, with the same query shape on both backends.
  - **Fallback (no CSQ, e.g. > 10 Mb before #4):** gene-interval overlap of [a, b] from `gene_reference.db`.
  - Whole-gene containment, needed for the DUP rule, always comes from `gene_reference.db` coordinates of the listed genes. CSQ OverlapPC would give the same answer, but the import does not keep it today, and it is not needed.

### 4.1 Gene route

HI/TS per gene come from the row's INFO (AnnotSV, varlens-annotation-workflows#3) when present, else from the runtime ClinGen table by HGNC id. A gene with neither is "unknown".

Dosage weight w(g, c), all values in the typed config `hpo-locus-scoring.config.ts`:

| CNV and ClinGen score | w |
|---|---|
| DEL, HI 2–3 | 1.0 |
| DEL, HI unknown, 0 or 1 | 0.6 |
| DEL, HI 30 (AR) | 0.3; 1.0 if CN = 0, hemizygous loss, or the gene has another het allele in the case (pass-1 `gene_het_hits ≥ 1`) |
| DEL, HI 40 | 0.1 |
| DUP spanning the whole gene, TS 2–3 | 1.0 |
| DUP spanning the whole gene, TS unknown, 0 or 1 | 0.3 |
| DUP spanning the whole gene, TS 40 | 0.1 |
| DUP with a breakpoint inside the gene | 0.5 · w_DEL(g) |

The weights are fixed defaults. They are ablated in §7, not tuned on the validation cases.

Best gene: g* = argmax over g in G(c) of w(g, c) · S(g).

Size correction, **Šidák on the case's own gene distribution**:
- q = the share of the case's genes with S ≥ S(g*).
- p_c = 1 − (1 − q)^{n_c}: the chance that the best of n_c random genes of this case scores at least this high.
- Map p_c back onto the score scale with the case's own empirical quantile: `sidak(s, n) = sorted[G − ceil(p_c·G)]`, with the index clamped to [0, G − 1].
- **S_gene(c) = w(g*, c) · sidak(S(g*), n_c).**

Properties:
- For n_c = 1, p_c = q and the index is exactly the rank of S(g*), so `sidak(s, 1) = s`. A single-gene CNV with w = 1 equals the SNV `hpo_resnik` of that gene, with no special case (unit test over every gene).
- The correction has no parameters and works in the shipped `correction: 'off'` mode. It does not need the z-mode √(2 ln n) path.
- It is conservative when neighbouring genes are correlated, for example paralog clusters. That errs toward under-crediting large CNVs, which the region route compensates for.

### 4.2 Region route

- Kept regions: ClinGen regions with HI ≥ 2 give loss diseases, and TS ≥ 2 give gain diseases. They are mapped through Mondo to OMIM/ORPHA, in the case build.
- Coverage is containment, not reciprocal overlap: cov(c, R) = |c ∩ R| / |R|.
- v(cov) = 1 if cov ≥ 0.8; (cov − 0.3)/0.5 for 0.3 ≤ cov < 0.8; 0 below 0.3.
- **S_region(c) = max over regions R of the CNV's type of v(cov) · max over d in D_R of S(d).**
- There is no size correction: the set is about 43 diseases, and a CNV larger than a region still fully contains it.

### 4.3 Combined

- **S_cnv(c) = max(S_gene, S_region)** becomes the CNV row's `hpo_resnik`.
- `hpo_best_disease` is the winning disease.
- `hpo_best_locus` is the winning gene symbol or ISCA id.
- `cnv_gene_count` is the number of protein-coding genes in the CNV's gene set (CSQ, else interval overlap), whether or not they are indexed. This is the Riggs 3A–C count, and it is computed even without HPO terms.
- The explanation is `explainDisease(winning disease)` plus a locus note (§6).

### 4.4 Worked example (illustrative numbers)

A case with G = 5,000 indexed genes has a 600 kb DEL at 16p11.2 with CN 1, a known 16p11.2 BP4–BP5 deletion. It overlaps 27 protein-coding genes, 9 of them indexed.

- **Gene route.** The best weighted gene is TBX6. In this example it has HI 3, so w = 1 and S = 0.62. Forty genes score ≥ 0.62, so q = 40/5000 = 0.008. With n_c = 9: p_c = 1 − 0.992⁹ = 0.0697, and ceil(0.0697 · 5000) = 349, so the gene at upper-tail rank 349 is used, say S = 0.41. **S_gene = 1 · 0.41 = 0.41.** The naive max would have reported 0.62.
- **Region route.** ISCA-37400 (16p11.2 BP4–BP5, HI 3) maps through MONDO:0012756 to OMIM:611913, with S(d) = 0.71. The CNV covers 100 % of the region, so v = 1. **S_region = 0.71.**
- **Result.** S_cnv = 0.71, `hpo_best_disease` = OMIM:611913, `hpo_best_locus` = ISCA-37400, `cnv_gene_count` = 27.
- **Duplication.** For a whole-gene DUP of the same interval with TS unknown, every gene gets w = 0.3. ISCA-37400's gain disease (TS 3) is OMIM:614671. With a deletion-shaped profile, S(614671) is low, so the DUP ranks below the DEL. That is the intended dosage-direction check.

### 4.5 Cost

- Interval lookup reuses the sorted per-chromosome spans that `gene-fallback.ts` already builds. The plan extracts them to one shared module.
- Per CNV: one binary search plus k array reads, a scan of about 60 regions per chromosome, and one `sidak` lookup.
- Budget: ≤ 5 ms per case for 5,000 CNVs (p95), and ≤ 50 ms extra index load.

## 5. STR scoring

### 5.1 Catalogue

STRchive loci are normalised at DB build into `str_loci` rows:
- `id`, `gene`, `chrom`, `start/stop` for hg19 and hg38
- `pathogenic_motif_*_orientation`, `benign_max`, `intermediate_min/max`, `pathogenic_min`
- `inheritance`, `evidence`, `typ_age_onset_min/max`
- disease sets: `{ full: ids, premutation?: ids, intermediate?: ids, femaleOnly?: ids }`

The full set is the locus' `omim` ∪ `orphanet` ids, or Mondo-mapped ids when both are empty, kept only if they are in HPOA.

A small typed override table, `src/shared/str/str-overrides.ts`, covers the cases STRchive lumps or omits. It is code, reviewed like code, and keyed by STRchive id. Unknown ids fail the build loudly.
- **FMR1:** full = FXS. premutation = FXTAS (OMIM:300623, ORPHA:93256) plus FXPOI (OMIM:311360), with FXPOI `femaleOnly`.
- **ATXN2:** intermediate = ALS (ORPHA:803).
- **HTT:** add ORPHA:248111 (juvenile) to full.
- **DMPK:** add ORPHA:273 to full.
- **ATXN3:** add ORPHA:276238, ORPHA:276241 and ORPHA:276244 to full.

### 5.2 Locus, band and gate (per row)

1. **Locus.** Try `variant_catalog_id`, then `repeat_id`, matched against the STRchive id or the gene with Stranger's `_n` suffix stripped. Then `gene_symbol` when that gene has exactly one catalogue locus. Then coordinate overlap in the case build. If nothing matches, the row is off-catalogue: all STR fields are null.
2. **Band.** c_max is the largest allele in `str_alt_copies` (for example "72/24" gives 72).
   - The catalogue thresholds give `full` (≥ pathogenic_min), `intermediate` (inside the intermediate range), `premutation` (FMR1 only, from the override) or `normal`.
   - When the copies cannot be parsed, map Stranger's status instead: `full_mutation` → full, `pre_mutation` → premutation, otherwise normal.
   - The catalogue wins over Stranger's own thresholds. One source of truth, and the same one that defines the disease sets.
3. **Motif.** If the call's `repeat_unit` is known and the locus lists pathogenic motifs, the band is `normal` unless the motif matches one of them. The comparison ignores rotation and reverse complement. Example: RFC1 AAAAG is benign.
4. **Evidence.** Refuted or Disputed loci get null.
5. **Gate.**
   - AR loci need two alleles at or above pathogenic_min. One allele is enough if the gene has another het allele in the case (pass-1 `gene_het_hits ≥ 1`, the same second-hit rule as CNV HI 30).
   - XR loci in a female get null.
   - Males are hemizygous on chrX outside the PARs.
   - Unknown sex never suppresses a score.
   - `femaleOnly` diseases are dropped for males.

### 5.3 Score

- **S_str = max over d in D_band(locus) of S(d)**, via the new `scoreDiseases(ids)`. It is null when the band is normal, the gate fails or no disease in the set is indexed.
- There is no size correction: |D| ≤ 6, the same as an SNV gene's own disease max.
- `hpo_resnik` = S_str. `hpo_best_disease` = the argmax disease. `hpo_best_locus` = the STRchive id. `str_band` = the band, which is set even when the score is null or there are no HPO terms.

### 5.4 Worked examples (illustrative S values)

| Call and profile | Today (gene max) | New |
|---|---|---|
| TCF4 CTG18.1, 85/20, child with ID, seizures and hypotonia | 0.68, "best: Pitt-Hopkins syndrome" | Set {OMIM:613267 FECD3}: S = 0.03, best FECD3 |
| ATXN3 CAG, 72/24, adult with ataxia, dysarthria and diplopia | 0.74 (MJD, if it won the max) | Set {OMIM:109150, ORPHA:98757, ORPHA:276238/41/44}: S = 0.74, best MJD, locus line "ATXN3 CAG 72/24 · full · AD · onset 20–50" |
| FMR1 CGG, 95, boy with ID | 0.81, "best: Fragile X syndrome" | Premutation set {FXTAS}; FXPOI is dropped (male): S = 0.05 |
| RFC1 AAGGG, 900/12, no other RFC1 allele, CANVAS profile | 0.77 | AR gate fails: null, `str_band` = full |
| Same, plus a het RFC1 SNV in the case | 0.77 | Gate passes: S = 0.77 |

## 6. Contracts and UI

### 6.1 Contract changes (committed first, plan lane W0)

**`HpoGeneScorer`** (`hpo-similarity-db.ts`): existing members unchanged, plus:

```ts
/** max S(d) over the listed disease ids that are indexed; null if none is */
scoreDiseases(ids: readonly string[]): { score: number; disease: string } | null
/** explanation of one disease (STR, region route); percentile against the gene distribution */
explainDisease(id: string): HpoExplanation | null
/** §4.1 Šidák mapping on this case's gene scores; sidak(s, 1) === s */
sidak(score: number, n: number): number
```

**Locus reference** (`src/shared/types/locus-reference.ts`, new): `DosageGene`, `DosageRegion`, `StrLocus` and `LocusReference` (§3, §5.1). It is loaded by `readLocusReference(path)` with the same mtime/size cache key as the phenotype index. When the tables are absent, it is null:
- `str_band` falls back to the Stranger status;
- `cnv_gene_count` still works, because it comes from `gene_reference.db`;
- the CNV and STR phenotype scores are null.

**Pure scorers** (`src/shared/phenotype/cnv-score.ts`, `str-score.ts`, new). They take the overlapped gene spans, the reference, a `Pick<HpoGeneScorer, …>` and a `hetHits(gene)` callback. They return `{ score, bestDisease, bestLocus, geneCount?, band?, note }`. They import nothing from Electron or the DB, so the benchmark imports them directly.

**`HpoExplanation`** gains an optional `locus?: HpoLocusNote`:

```ts
{ kind: 'gene' | 'region' | 'str'; id: string; label: string;
  dosage?: string; coverage?: number; diseaseGenes?: number; genes?: number;
  band?: string; copies?: string; motif?: string; inheritance?: string; onset?: string }
```

**`LightRow` and `DerivedFields`** (`case-context.ts`):
- `LightRow` gains optional `variant_type`, `end_pos`, `sv_type`, `cnv_copy_number`, `str_alt_copies`, `str_status`, `str_repeat_id`, `str_variant_catalog_id` and `str_repeat_unit`. They are set only for non-SNV rows, so pass-1 memory stays ~100 bytes per SNV.
- `DerivedFields` gains `hpo_best_locus`, `cnv_gene_count` and `str_band`.
- `GeneContext` gains `hetHits(gene): number`.

**CNV gene sets:** one batched read of the distinct `variant_transcripts.gene_symbol` values for the CNV rows of a Stage-1 page. It is implemented in `shortlist-evidence.ts` (SQLite) and `PostgresShortlistService.ts` (PostgreSQL), and passed to the scorer as `cnvGenes: Map<rowId, string[]>`. An empty or missing entry selects the interval fallback.

**`ShortlistCandidate`** gains `str_repeat_id`, `str_variant_catalog_id` and `str_repeat_unit`. These are projected on **both** backends: `base-query-and-joins.ts` and `PostgresVariantReadRepository.ts`, mapped in `shortlist-query.ts`.

**DSL** (`column-registry.ts`), all `caseOnly` and `shortlistOnly`, and all in `SHORTLIST_DERIVED_COLUMNS`:

| Key | Label | Type | In `HPO_DERIVED_COLUMNS` |
|---|---|---|---|
| `hpo_best_locus` | HPO best-matching locus (gene, region or STR id) | text | yes |
| `cnv_gene_count` | CNV protein-coding genes overlapped | numeric | no |
| `str_band` | STR band (normal, intermediate, premutation, full) | categorical | no |

For SNV rows, `hpo_best_locus` is the gene symbol. `cnv_gene_count` and `str_band` are null on other types.

**Config:**
- `structuralTypes.types` becomes `['sv', 'cnv', 'str']`, so `ruleset-problems.ts` accepts STR-scoped groups once the flag is on.
- `structuralTypes.enabled` **stays `false`**.

**Migrations:** none. The new fields are derived per row and never stored, like `hpo_resnik`. The reference data lives in `hpo_similarity.db`. Migration numbers stay TBD in the plan in case review forces persistence.

**IPC:** `hpo-data:status` and `hpo-data:update` return the widened `HpoDataStatus` on the same channels. The parity manifest is unchanged, and the web route serves the same shape.

### 6.2 Parity

- **SQLite and PostgreSQL.** All scoring runs in shared code: `case-context.ts`, `rank-page.ts` and the pure scorers. The backends differ only in the candidate projection, so the plan has one parity test that ranks the same CNV/STR fixture case on both backends and compares the derived fields.
- **Cohort.** The new fields are case-only shortlist fields like their `hpo_*` siblings, so the cohort view gets no filter, sort or column change. Its column metadata must not list them; the registry test asserts this. There are no new table columns in either view.

### 6.3 UI

The tooltip gets one new line, built in `rank-tooltip-phenotype.ts` (`PhenotypeLines.locus: string | null`). The block stays dense; small text is intentional. The existing title, matched, conflicts and rank lines are unchanged.

| Row | Locus line |
|---|---|
| CNV, region route | `locus: 16p11.2 BP4–BP5 (ISCA-37400, HI 3) · 100 % covered · 9/27 genes indexed` |
| CNV, gene route | `locus: TBX6 (HI 3) · best of 9 indexed genes, size-corrected` |
| STR | `locus: ATXN3 CAG 72/24 · full · AD · onset 20–50` |
| SNV | no locus line |

- The rank line keeps "top N % of genes in this case". S_cnv and S_str are on the gene scale, so the percentile stays meaningful.
- `HpoDataRow.vue` lists source versions and attribution: "ClinGen Dosage Sensitivity (CC0)", "STRchive (MIT)", "Mondo (CC BY 4.0)".
- The user docs page under `docs/` gets one section on CNV and STR phenotype scoring and the data sources.

## 7. Validation (pre-registered)

The protocol, seeds and the arms below are committed under `.planning/artifacts/shortlist-sim/<date>-cnv-str/protocol.md` **before any run**. Nothing is tuned on the validation cases. If a criterion fails, the type stays behind the flag, and the outcome is recorded in §10 of this spec.

Harness: a locus-level ranker in `scripts/shortlist-sim/cnv-str/`. It ranks CNVs among the case's CNVs, and STRs among its STRs, by phenotype score alone. It calls the pure scorers directly and needs no change to the SNV shortlist simulation, which has no SV support. Mixed-type ranking is out of scope (§2).

### 7.1 CNV

- **Gene source in the benchmark.** Phenopackets and background calls carry no CSQ, so the benchmark uses the interval fallback. CSQ vs interval equivalence is covered by a fixture test on a VEP-annotated CNV VCF from the annotation workflow, not by the benchmark.
- **Real cases.** The 110 phenopacket-store 0.1.27 SV phenopackets with coordinates. Each is spiked into 10 background CNV sets of the same build: 1000 Genomes high-coverage SV DEL/DUP calls for GRCh38, and the phase-3 SV release for GRCh37 [A, availability to verify in the lane]. The count per build is reported.
- **Simulation.** All kept ClinGen regions (DEL for HI ≥ 2, DUP for TS ≥ 2), plus ClinVar P/LP CNVs. Profiles are sampled from the target disease's HPOA annotations with the existing clean, moderate and noisy sampler. The same backgrounds are used.
- **Arms:**
  - A0: naive max-gene. Max S(g) over G(c), no weights, no correction, no regions.
  - A1: A0 + dosage weights.
  - A2: A1 + Šidák.
  - A3: A2 + regions, the shipped design.
  - Reference: the SvAnna sum Σ w·e^{S}.
- **Metrics:** Hit@1/5/10 and MRR among the case's CNVs, with locus-clustered bootstrap 95 % CIs and paired deltas.

| # | Criterion (all must hold to enable CNV) |
|---|---|
| CNV-1 | Real cases: A3 Hit@10 ≥ A0 Hit@10 − 2.0 pp (non-inferior). |
| CNV-2 | Simulation, moderate profiles, backgrounds containing ≥ 1 Mb CNVs: A3 Hit@10 − A0 ≥ +5.0 pp, CI lower bound > 0. |
| CNV-3 | Simulation, ClinGen region diseases: A3 Hit@10 − A2 ≥ +20 pp. This checks that the region route works for the 69 % of region diseases with no gene link. |
| CNV-4 | Background CNVs: Spearman ρ(S_cnv, n_c) ≤ 0.25. A0's ρ is reported for contrast. |
| CNV-5 | SNV invariance: every gene's S(g), d*(g) and percentile identical before and after the builder change. Unit test, exact. |
| CNV-6 | Latency: p95 ≤ 5 ms added per case at 5,000 CNVs; index load ≤ +50 ms. |

Leakage: simulated profiles come from the same annotations the scorer reads, so simulated numbers are optimistic. CNV-1 is the honest number. It is mostly gene-anchored (ANKRD11, NF1, CYP21A2, EHMT1), so it tests the gene route more than the region route.

### 7.2 STR (simulation only)

No public STR phenopacket benchmark exists (research-str §4).

- **Backgrounds.** Synthetic normal calls at every catalogue locus, drawn uniformly from each locus' benign range. Decoys are added at population rates: TCF4 CTG18.1 full at 3 %, ATXN2 intermediate at 4 %, a heterozygous RFC1 expansion at 2 %, and an FMR1 premutation at 0.4 % of females and 0.2 % of males. HPRC TRGT calls are an optional second background if available [A].
- **Causal arms.** One case per catalogue locus × clean, moderate and noisy profiles. The genotype respects inheritance: biallelic for AR, male for XR. Profiles come from the locus disease's HPOA terms.
- **Trick arms:**
  - T1: TCF4 full + Pitt-Hopkins profile.
  - T2: FMR1 premutation + FXS profile, male.
  - T3: heterozygous RFC1 + CANVAS profile.
  - T4: AR (SBMA) expansion in a female.
  - T5: every locus normal.
- **Baseline.** Today's gene-level `hpo_resnik`, with the gene from `gene-fallback.ts`.

| # | Criterion (all must hold to enable STR) |
|---|---|
| STR-1 | False leads = 0. In T1–T5, no `hpo_best_disease` outside the band's set and no non-null score where the gate fails. Deterministic: any failure is a bug, not a tuning issue. |
| STR-2 | Causal arms with decoys, moderate profiles: Hit@1 − baseline ≥ +5.0 pp, CI lower bound > 0. |
| STR-3 | Causal arms without decoys: Hit@1 non-inferior to baseline (Δ ≥ −1.0 pp). |
| STR-4 | The admitted catalogue diseases (ORPHA:273, ORPHA:401901, ORPHA:98757) are in the index and score > 0 on their own HPOA profile. Unit test. |

## 8. Risks

- **ClinGen has no digest and no releases.** Integrity rests on TLS plus header and row-floor checks, and the content changes almost daily. The stored sha256 and dates make every build traceable but not reproducible later. Accepted, as the data is CC0 and small.
- **AR genes without a ClinGen curation get w = 0.6.** This over-credits a heterozygous deletion of an uncurated recessive gene. HPOA inheritance terms could fix it later; the ablation shows the size of the effect.
- **No contiguous-gene synergy.** A multi-gene syndrome that is not a ClinGen region can be under-credited, because Šidák is conservative. It is visible in A2 vs A3 on real cases.
- **STR thresholds.** STRchive and Stranger can disagree, and the catalogue wins (the band is shown). Short-read callers saturate below pathogenic_min for long expansions, so some true full mutations read as intermediate or normal. `REPCI` is deferred.
- **Upstream annotation.**
  - If the multi-gene VEP CNV import keeps only some CSQ genes, the gene route silently under-counts. That is why the import-test lane gates L5.
  - Until varlens-annotation-workflows#4 lands, CNVs over 10 Mb have no CSQ and use interval overlap.
  - Until #3 lands, dosage always comes from the ClinGen download.
  - The two gene sources can differ slightly: VEP's gene model is not `gene_reference.db`. A fixture test pins the behaviour of both.
- **Build coverage.** GRCh37 and GRCh38 only. Liftover is never done, and T2T gets null.
- **Validation power.** The real CNV set is small (110) and gene-anchored, and STR validation is simulation only. The flag flip is a judgement on thin evidence, so the outcome section must state the CIs.
- **File size.** `PostgresVariantReadRepository.ts` is at 587 lines. The STR projection adds about 3 lines. If it crosses 600, the lane must split the projection list out.

## 9. Decisions on the agy brainstorm

| agy proposal | Decision | Why (one line) |
|---|---|---|
| All HPOA diseases (incl. DECIPHER) are already scored, so regions are free | Corrected | The shipped builder keeps gene-linked diseases only (`hpo-similarity-db.ts:78-91`), so region diseases must be admitted (§3). |
| √(2 ln N_eff) (z-mode) or 1/(1 + β ln M) size penalty | Rejected for Šidák on the case quantile | Parameter-free, exact at n = 1, and works in the shipped `off` mode, where agy's version needs a tuned β. |
| Contiguous-gene synergy Δ_syn (η = 0.35) | Rejected | An unvalidated extra parameter; regions cover the recurrent syndromes, and the ablation shows whether it is needed. |
| Reciprocal overlap (RO ≥ 0.25) plus critical-region overlap | Rejected for containment | AnnotSV's manual rules out RO for pathogenic regions, and ClinGen regions are already the critical regions. |
| Dosage weights from ClinGen + pHaplo/pTriplo + LOEUF | ClinGen only | One CC0 source; the pHaplo/LOEUF licences and sizes are unchecked. |
| INV/BND/INS breakpoint weights | Deferred | Not CNVs; there is no validation data for them in v1. |
| AR carrier weight 0.35, comp-het 0.9 | Merged into our HI 30 rule (0.3, or 1.0 with a second hit) | Same idea, one rule shared with STR. |
| Riggs-mapped evidence points (+4 / +2.5 / +1 / −1.5) | Rejected | Points are tuned by the evidence simulation as in shortlist spec §3; no hand-set points. |
| AnnotSV double-count guard | Not applicable | The score is computed in-app; imported AnnotSV scores are not DSL fields. |
| STR continuous α_status for intermediate alleles | Rejected for discrete bands | Bands are what clinicians read; null for normal is clearer than a small number. |
| STR `REPCI` saturation rescue (≥ 0.70) | Deferred (risk §8) | Needs per-caller validation we do not have. |
| STR motif weights (0.05 for benign motif) | Binary motif gate | Same effect with no parameter. |
| FXPOI only for non-male cases | Adopted (`femaleOnly`) | Correct and cheap. |
| SBMA in heterozygous females 0.15 | Null for XR in females | Simpler; no partial credit to tune. |
| `str_expansion_ratio` DSL field with a bonus | Rejected | Anticipation is not phenotype evidence (non-goal). |
| GIAB HG002 SV backgrounds | Replaced by 1000 Genomes SV calls | Many samples instead of one trio, and both builds. |
| STR ship bar Hit@1 ≥ 85 % absolute | Replaced by relative criteria + zero false leads | Absolute numbers depend on the synthetic background we choose. |

## 10. Outcome

To be filled after §7 runs: per-criterion results with CIs, ablation table, and the flag decision per type.

## 11. Decisions (user, 2026-10-14)

1. **Mondo:** download `mondo.obo` at runtime (not a hand-curated crosswalk).
2. **Update failures:** per source. HPO failure fails the update; a failed optional source keeps its previous version, and the status warns (§3).
3. **Rollout:** score exposed as DSL fields only; the shipped rankings and the legacy scorers stay unchanged until §7 passes; one flag per variant type (`structuralTypes.enabled` becomes per type).
