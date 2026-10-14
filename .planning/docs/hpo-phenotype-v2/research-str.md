# HPO phenotype score v2 for STR calls (#582)

**Date:** 2026-10-14 · **Branch:** `feat/hpo-phenotype-v2` · [V] verified here (files, code, data), [A] assumption or literature recall, not re-checked.

## Verdict: needs more than a filter

The gene-level `hpo_resnik` gives wrong answers for STRs today. Three separate gaps:

1. **No gene, so no score.** [V] STR rows take `gene_symbol` only from VEP/SnpEff annotation (`VcfMapper.ts:181`). Stranger and straglr VCFs have none, so `hpo_resnik` is null (`case-context.ts:132-136`). `REPID` and `HGNCId` are present in Stranger output but ignored (`extension-parsers.ts:140-162`).
2. **Status vocabulary bug, already live.** [V] Stranger writes `normal | pre_mutation | full_mutation`, comma-joined per allele before splitting (`tests/test-data/vcf/synthetic-str.vcf`, `import-filters-integration.test.ts:219`). The legacy scorer and the shortlist type expect `'pathologic' | 'intermediate'` (`score-str.ts:39-44`, `shortlist.ts:132`), and the tests seed `'pathologic'` (`shortlist-query.test.ts:79`). Real imports therefore never get the pathologic impact. Fix this first, separately from #582.
3. **Mechanism contamination.** Taking the max over all of a gene's diseases credits STR calls with point-mutation and CNV diseases (numbers below).

The plan that works: a **status gate × locus disease-set score**, built from a bundled STRchive-derived catalogue, with disease ids admitted into the HPO DB even when `genes_to_phenotype` does not link them.

## 1. Data reality

Inputs: HPO `raw-v2026-09-01` crossed with STRchive `STRchive-loci.json` (82 loci, 79 genes; MIT licence, verified with the GitHub API). [V]

- 72 of the 79 genes are in `genes_to_phenotype`. 66 have at least one catalogue repeat disease linked. [V]
- **27 of those 66 also link a non-repeat-mechanism disease** (my manual mechanism classification [A]):
  - AR (androgen insensitivity, Reifenstein)
  - ATN1 (CHEDDA, 56 annotations vs 26 for DRPLA)
  - CACNA1A (9 diseases, including EA2, FHM1 and DEE42)
  - HTT (Lopes-Maciel-Rodan syndrome)
  - FMR1 (Xq27.3q28 duplication)
  - TCF4 (Pitt-Hopkins with 69 annotations, vs FECD3 with 9)
  - PHOX2B (neuroblastoma)
  - ARX (lissencephaly, ACC with abnormal genitalia)
  - FGF14 (SCA27A, nystagmus)
  - TBX1 (22q11 syndromes, 131 annotations)
  - 16 more, e.g. POLG, PRNP (FFI), SOX3, HOXD13, FOXL2, ZFHX3, TAF1
- **In 15 genes the contaminating disease has more annotations than the repeat disease**, so it is likely to win the max: AR, ATN1, CACNA1A, FGF14, FOXL2, GLS, HOXD13, POLG, SOX3, TAF1, TBX1, TCF4, ZIC3, PHOX2B, ZFHX3. [V] counts; [A] that the max follows.
  - Example: a TCF4 CTG call in a child with ID shows "→ Pitt-Hopkins", a false lead.
- **The repeat disease is not gene-linked at all** for CBL (Jacobsen), NIPA1 (ALS), RAI1, TBC1D7, FAM193B, MIR7-2, AFF3, TYMS and ZNF713. Any score these genes get comes from the wrong disease. [V]
- **Repeat diseases missing from the index**, because the builder keeps gene-linked diseases only (`hpo-similarity-db.ts:78`) [V]: ORPHA:273 Steinert DM1 (108 annotations, the richest DM1 profile), ORPHA:401901 C9orf72 HD-like, ORPHA:98757 (STRchive's MJD id).
- **Premutation diseases are thin.** [V]
  - OMIM:311360 POF1/FXPOI: 3 annotations.
  - FXTAS (OMIM:300623, ORPHA:93256) is well annotated.
- **Some extra diseases are repeat-related, not contamination:**
  - "Parkinson disease, late-onset" (OMIM:168600) linked to ATXN2, ATXN3, ATXN8OS and TBP is plausible for CAG parkinsonism.
  - ATXN2 → ALS (ORPHA:803) is the intermediate-range (27–33 CAG) risk. [A, GeneReviews NBK1275]
  - So the filter must be **status-aware**, not just "repeat yes/no".
- **STRchive already holds what a filter needs** [V]: OMIM/Orphanet/MONDO ids (MONDO on 76/82), `hpo_terms` (78/82), benign/intermediate/pathogenic thresholds, inheritance (AD 57, AR 10, XR 9, mixed 3, XD 1; 10 chrX loci), hg19/hg38/T2T coordinates, evidence tier (46 Definitive, 3 Disputed, 1 Refuted).
- **STRchive gaps:** it lumps FMR1 FXS, FXTAS and POF1 into one entry, and it omits ATXN2 ALS and HTT juvenile ORPHA:248111. A small curated override table is needed. [V]

## 2. Status, penetrance, tools

- **Bands** [A, GeneReviews]:
  - FMR1: normal <45, intermediate 45–54, premutation 55–200 (FXTAS mainly in males over 50; FXPOI in about 20% of female carriers), full >200 (FXS).
  - HTT: 27–35 intermediate (no disease, anticipation risk), 36–39 reduced penetrance, ≥40 full.
  - C9orf72: penetrance is age-dependent.
  - RFC1 and FXN: biallelic required.
  - STRchive thresholds agree, e.g. HTT pathogenic ≥36, FXN ≥56, RFC1 ≥400. [V]
- **Tools** [A] (no tool combines locus disease with HPO similarity):
  - Stranger annotates status, disease and inheritance from its catalogue, with no HPO.
  - Scout shows Stranger STRs filtered by HPO-derived gene panels, with no per-locus disease similarity.
  - STRipy and TRGT/STRchive reports show the locus disease and thresholds, with no HPO ranking.
  - Exomiser and LIRICAL do not prioritise STRs.
- **Rule:** score phenotype only when the status band has a disease set:
  - full mutation → full-range diseases
  - premutation or intermediate → only diseases defined for that band (FXTAS/FXPOI, ATXN2-ALS)
  - normal → null, not 0, so no credit and no penalty
- **Age and anticipation:** do not fold into the score. Show onset (STRchive `typ_age_onset_*`) in the explanation. Spec §3 already defers onset to a follow-up.

## 3. Design for VarLens

1. **Catalogue.** Add `src/shared/str/str-catalogue.json`: STRchive-derived, MIT attribution, pinned commit, about 80 rows.
   - Fields: `id`, `gene`, `hgnc`, `chrom`, `start/stop_hg19/hg38`, `motif`, `normalMax`, `intermediate`, `pathogenicMin`, `inheritance`, `xlinked`, and `diseases: {full: ids[], premutation?: ids[], intermediate?: ids[]}`.
   - Add a hand-curated overrides file for FMR1, ATXN2, HTT, DMPK (ORPHA:273, 589821) and ATXN3 (ORPHA:276238/41/44).
   - Offline, no runtime fetch. ponytail: no auto-refresh; bump with HPO.
2. **HPO DB builder.** Admit every catalogue disease id even when it is not gene-linked: union catalogue gene→disease pairs at `hpo-similarity-db.ts:78-131`. This also improves SNV scoring for DMPK and C9orf72. The DB version is already bumped by v2.
3. **Scorer API.** Add one method to `HpoGeneScorer` (`hpo-similarity-db.ts:228`): `scoreDiseases(ids): { score, best } | null`. It returns the max of the already computed `diseaseScore` (`phenotype-score.ts:48`), so it costs O(|ids|) ≤ 6 per row. Also add `explainDisease(id)`. A `score(gene, filter?)` overload would hide the mechanism; an explicit id list is clearer. z-mode makes `diseaseScore` unbounded, so use the same mode as the gene score.
4. **Locus resolution at import.**
   - Resolve `VARID`/`REPID`, then `HGNCId`, then the coordinate overlap with the catalogue (build-specific), and store `str_locus_id`.
   - Normalise status to `normal | intermediate | premutation | full_mutation` (pre_mutation maps to premutation). For raw straglr, compute the band from `REPCN` and the catalogue thresholds.
   - Set `gene_symbol` from the catalogue gene when annotation is absent.
5. **Gate (STR group behind `structuralTypes` #582, add `'str'` to `types`).**
   - Band from the allele with the max `REPCN`.
   - AR loci (FXN, RFC1, CSTB, …) need both alleles ≥ `pathogenicMin`. One expanded allele is shown as "carrier".
   - X-linked loci (AR, FMR1, ARX, SOX3, AFF2, …): treat males as hemizygous by sex. In females, FMR1 full mutations count and SBMA does not (XR).
6. **Derived fields and rules.**
   - Fields: `str_band`, `str_hpo` (= `scoreDiseases(set(band))`), `str_hpo_disease`.
   - Rule group: full × `str_hpo` ≥ 0.6 → high bin. Full alone → mid bin. Premutation/intermediate × matching band-disease phenotype → low-mid bin. Normal → 0.
   - Points are tuned on the simulation (§4), as in spec §3.
7. **Explanation:** "matched: ataxia, dysarthria → SCA3 (ATXN3 CAG 72/24, full, AD; typical onset 20–50)". It names the locus disease, never the gene's best disease.
8. **Pitfalls:**
   - Motif orientation: the reference motif `CTG` displays as CAG (`RU` vs `DisplayRU`).
   - Interrupted alleles (FMR1 AGG, ATXN1 CAT, SCA27B, RFC1 AAGGG vs benign AAAAG); motif identity is needed for RFC1, CANVAS and DAB1.
   - `REPCN` is stored as a per-sample string like "24/15".
   - Build coordinates (hg19 vs hg38 vs T2T).
   - Off-catalogue (EHdn) and Refuted/Disputed loci: no phenotype score.

## 4. Validation

- **phenopacket-store 0.1.27** (701 cohorts, local): none of the classic STR genes have cohorts (HTT, FMR1, ATXNs, DMPK, FXN, C9orf72, RFC1, NOTCH2NLC, AR, PABPN1, PHOX2B, ARX, TCF4, ATN1, TBP). Only HOXA13 has 5 expansion-mentioning cases. **No real public STR phenopacket benchmark exists here.** [V]
- **Simulation** (`scripts/shortlist-sim/`):
  - Spike one locus at a band-appropriate size into real EH/TRGT/straglr backgrounds (e.g. HPRC TRGT VCFs [A]), with profiles sampled from the locus disease's HPOA terms as in the SNV sim.
  - Negative arms:
    - premutation size with an FXS profile (must not fire);
    - TCF4 full with a Pitt-Hopkins profile (must not get FECD credit);
    - heterozygous RFC1 (must not fire).
  - Metrics: Hit@1 and Hit@10 among STR plus SNV candidates, and the false-lead rate of the "→ disease" label.
- **GeneReviews case series:** about 30 hand-built probands. Smoke test only.

## 5. Code map

- **Import:**
  - `src/main/import/vcf/extension-parsers.ts:140-162` (no HGNC or locus), `src/main/workers/import-pipeline.ts:73,247`, `src/shared/types/database-schema.ts:423-428`, `variant-extension-registry-data.ts:78-105`
- **Display:** `variant-table/str-columns.ts:28-58`, `variant-details/ExtensionDetailsSection.vue:79-375`, `shortlist/ShortlistTable.vue:122,160` (all under `src/renderer/src/components/`)
- **Shortlist:**
  - candidate mapping `src/main/database/shortlist-query.ts:96`
  - joins `src/main/database/variant-filter/base-query-and-joins.ts:96-98`
  - legacy scorer `src/main/services/scoring/score-str.ts:37-44`, `index.ts:109`
  - flag `src/shared/config/shortlist-evidence.config.ts:77` (types are `['sv','cnv']` only)
  - scope check `src/shared/evidence/ruleset-problems.ts:31-35,85`
- **Phenotype:**
  - `src/main/services/scoring/evidence/case-context.ts:132-136`
  - `src/main/services/phenotype/hpo-similarity-db.ts:78,228-237,342-375`
  - `src/shared/phenotype/phenotype-score.ts:42-48`
- **Sim harness:** `scripts/shortlist-sim/` has no STR support (grep: SNV and indel spiking only, `annotate/spike-annotation.ts`). [V]
