# Research: phenotype-driven prioritisation for CNVs/SVs (HPO v2)

Date: 2026-10-14. Research only, no code changed. [V] means I checked it in a primary source, the code or local data. [A] means it comes from an abstract, a snippet or memory.

## 1. State of the art

- **SvAnna** (Genome Med 2022, PMC9047340) [V]:
  - Each affected gene gets a deleteriousness score δ(g) ∈ {0, 1}. A duplication scores 1 only when it spans the whole gene.
  - The phenotype term is the gene's best symmetric-Resnik score Φ against HPO diseases.
  - **PSV = Σ_g δ(g)·e^Φ**, a sum, so it grows with gene count.
  - Benchmark: 188 published SVs added into 10 real PacBio backgrounds, 87% in the top 10.
  - ClinGen HI/TS is displayed but not scored.
- **Exomiser 13+** [V]: an SV is assigned to every overlapped gene and ranked by the normal gene score. There is no CNV-specific aggregation. Frequency uses Jaccard ≥ 0.8 matching against gnomAD-SV, DECIPHER, dbVar and DGV.
- **AnnotSV 3.5** (manual 2025-07) [V]:
  - Ranking follows the Riggs 2020 points for DEL/DUP.
  - The phenotype is annotation only: the **maximum** Exomiser or PhenoGenius gene score over the overlapped genes. A score ≥ 0.7 counts as "matched", on the manual's own "limited experience".
  - Pathogenic regions are matched by **complete overlap; the manual says reciprocal overlap cannot be used**.
  - GPL.
- **Riggs 2020 / ClinGen CNV calculator** [V]:
  - 2A: complete overlap of an established HI gene or region scores 1.0.
  - 3A–C are gene-count bins, with default points 0/0.45/0.90 [A].
  - The phenotype enters only as 5G (≤ 0.15) and 5H "highly specific and consistent" (≤ 0.30). It is weak, bounded evidence.
- **ClassifyCNV, X-CNV** have no phenotype input. **Phen2Gene and CADA** rank genes only. I found no recent CNV-specific phenotype benchmark [A].

**Consensus:** reduce a CNV to its genes and take the best gene (or a sum). Handle syndromes by overlap with curated regions. Nobody corrects for the number of genes.

## 2. Data reality

**HPO 2026-09-01, local files** [V]:
- `phenotype.hpoa` has 12,880 diseases: OMIM 8,478, ORPHA 4,355, DECIPHER 47.
- `genes_to_phenotype.txt` links 9,177 of them to genes, and **no DECIPHER disease is linked**.
- 267 diseases have region-like names, and **185 (69%) have no gene link**. Examples:
  - 16p11.2 deletion (OMIM:611913, 613444) and duplication (614671)
  - 1q21.1 duplication (612475)
  - 7q11.23 duplication (609757)
  - 22q11.2 duplication (608363)
  - 3q29, 17q12 and 1p36 deletions
  - DECIPHER:16 (22q11) and DECIPHER:3 (Williams)
- Linked ones attach to a driver gene: 188400 → TBX1, Smith-Magenis → RAI1, 612001 → CHRNA7/KLF13.
- Orphanet attaches "region genes" instead: Williams → 18 genes, 22q11.2 → 9. ORPHA:261197 (proximal 16p11.2) → SH2B1 looks wrong, because SH2B1 is distal.
- **The v2 builder drops every disease without a gene link** (`hpo-similarity-db.ts:78-82`). Region syndromes cannot score today, although the per-disease pass would score them for free (`phenotype-score.ts:383-398`).

**ClinGen dosage, GRCh38 lists fetched today** [V]:
- Genes: 1,536 curated. HI3 421, HI30 (AR) 597, HI40 35, TS3 3.
- Regions: 513, of which 359 are HI40 population regions. **59 have HI or TS ≥ 2, and 43 carry a MONDO id.**
- The 43 cover every recurrent region asked about: 22q11.2 A–D (ISCA-37446), 16p11.2 BP4–BP5 (37400) and distal (37486), Williams (37392), SMS/PLS (37418), 1q21.1 (37421), 15q13.3 (37411) and PWS/AS (37478).
- Both builds are published.
- The mapping chain is ClinGen region → MONDO → hpoa disease. Mondo xrefs map MONDO:0012756 ↔ OMIM:611913 and MONDO:0012915 ↔ OMIM:612475 [V].
- **Licence:** ClinGen curated content is **CC0 1.0** (terms of use, attribution requested) [V], so it can be bundled. Mondo is CC BY 4.0 [A].
- DECIPHER syndrome coordinates: I found no open licence [A].

**VarLens gene intervals** [V]:
- `resources/gene_reference.db` `gene_coordinates` has GRCh38 41,325 rows and GRCh37 33,114 rows, indexed on `(chromosome, assembly)`.
- There is only a point lookup by `hgnc_id` (`GeneReferenceDb.ts:98`). Sorted arrays per chromosome in memory are enough for range queries.

## 3. Design (formulas)

Notation:
- Per case, v2 already gives S(g) ∈ [0,1], d*(g), and the sorted vector of gene scores.
- A CNV c has type DEL or DUP, from `sv_type` or `cnv_copy_number` (≤ 1 loss, ≥ 3 gain).
- G(c) is the set of disease genes overlapping c in the case build, and n_c = |G(c)|.

**(i) Gene content, weighted by dosage:**
- Weights w(g,c), from typed config:

  | Case | Weight |
  |---|---|
  | DEL, HI 2–3 | 1.0 |
  | DEL, HI unknown/0/1 | 0.6 |
  | DEL, HI 30 | 0.3, raised to 1.0 if CN 0 or `gene_hits` ≥ 2 (second hit) |
  | DEL, HI 40 | 0.1 |
  | DUP spanning the whole gene, TS 2–3 | 1.0 |
  | DUP spanning the whole gene, TS unknown | 0.3 |
  | DUP with a breakpoint inside the gene | 0.5·w_DEL |

- Best gene: g* = argmax w·S(g).
- Correction for many genes, Šidák on the case's own empirical upper tail. q_g = share of the case's genes with S ≥ S(g), which comes from the existing percentile pass.
- **S_gene(c) = w(g*,c)·(1 − (1 − q_{g*})^{n_c})**, reported as 1 − that tail.
- For an SNV n_c = 1, so the formula equals today's percentile and stays comparable across types.
- In z-mode, reuse `geneMaxPenalty·√(2 ln n)` (`phenotype-score.ts:396`).
- Gene count stays a separate DSL field (`cnv_gene_count`, for Riggs 3A–C), not part of the phenotype score.

**(ii) Region syndromes:**
- Build `region_diseases(isca_id, assembly, chr, start, end, type, disease_id)` from the 59 ClinGen regions: HI ≥ 2 → loss, TS ≥ 2 → gain. MONDO is mapped to OMIM/ORPHA at DB build.
- The builder keeps these diseases even though they have no gene link.
- Coverage is containment: cov = |c∩R| / |R|.
- v = 1 if cov ≥ 0.8. v = (cov − 0.3)/0.5 for 0.3 ≤ cov < 0.8. v = 0 below 0.3.
- **S_region(c) = max_R v·S(d_R)** over regions of the same type. There are only about 43 diseases, so no correction is needed.

**Combined:**
- S_cnv = max(S_gene, S_region) becomes the CNV row's `hpo_resnik`.
- `hpo_best_disease` is the winning disease. A new `hpo_best_locus` names the winning gene or region.

**(iii) Explanation** (lazy), for example:
> "DEL 16p11.2 CN1, 27 genes (9 disease genes). Region: BP4–BP5 (ISCA-37400, HI3) → OMIM:611913, 0.71, coverage 100%. Best gene: TBX6 (HI3) via OMIM:122600, 0.44 after correction for 9 genes."

The terms come from the existing `explain()`.

**Cost:**
- Gene scores are already computed once per case (≤ 8 ms).
- Loading the intervals takes about 5 ms per build and is cached.
- Each CNV needs a binary search and k lookups, plus a scan of 59 regions, so thousands of CNVs add < 5 ms.

**Pitfalls:**
- **Gene count:**
  - A large CNV inflates the best-gene maximum. The Šidák correction handles this; SvAnna's sum makes it worse.
  - Benign incidental CNVs hit disease genes. Keep the phenotype as one bounded input, like 5H, next to frequency, HI40 and gene count.
- **Coordinates and dosage:**
  - Coordinates are build-specific: ship both ClinGen builds and do not lift over.
  - Recessive genes need a second hit.
  - Duplication orientation is unknown.
- **Data quality:** Orphanet's region-gene links are noisy. Taking the maximum avoids double-counting.
- **Import:** a CNV keeps only its best transcript's gene (`vcf-annotation-parser.ts:251` → `VcfMapper.ts:181`). G(c) must come from intervals, not `gene_symbol`.
- **Benchmark:** adding region diseases changes the IC corpus, so the SNV benchmark must be rerun.

## 4. Validation

**Real cases:**
- The local phenopacket-store 0.1.27 has **636 SV phenopackets** [V]: 424 "chromosome_structure_variation", 211 deletions, 4 duplications.
- Only **110 have coordinates**, and 69 have no gene (mostly Jacobsen).
- Most are gene-anchored (ANKRD11 77, NF1 58, CYP21A2 56, EHMT1 44). They test route (i) well and route (ii) weakly.

**Simulation:**
- Positives: ClinVar/dbVar nstd102 P/LP CNVs (about 15k [A]) and the ClinGen HI/TS ≥ 2 regions.
- Profiles: sampled from the region disease's hpoa annotations with the existing noise and imprecision sampler.
- Leakage: the profiles share annotations with the scorer, so treat the phenopacket results as the honest number.
- Backgrounds: none exist. The harness has **no SV support**, and its backgrounds are exome SNV sets. Options are 1000 Genomes high-coverage SV/CNV calls [A] or local real CNV cases.
- Metrics: Hit@1/5/10 among CNVs. Ablations: max vs Šidák vs sum, with and without dosage weights, with and without regions.

## 5. Code map

| Concern | Location |
|---|---|
| Extension parsing | `src/main/import/vcf/extension-parsers.ts:72` (SV), `:113` (CNV: CN, GQ), `:140` (STR) |
| Extension tables | `src/main/database/migrations.ts:1442` (`variant_sv`), `:1458` (`variant_cnv`) |
| One gene per row | `vcf-annotation-parser.ts:251/373` → `VcfMapper.ts:181`. All genes are kept in `variant_transcripts` (`schema.ts:48`) |
| Intervals | `GeneReferenceDb.ts:98`, `scripts/build-gene-reference-db.ts` |
| Scope gate | `src/shared/config/shortlist-evidence.config.ts:77` (`structuralTypes.enabled: false`), `src/shared/evidence/ruleset-problems.ts:35,85` |
| DSL fields | `src/shared/dsl/column-registry.ts:241-270` (`sv_type`, `sv_length`, `cnv_copy_number`) |
| HPO in ranking | `src/main/database/ShortlistService.ts:303,312-318`. Scorer API: `src/main/services/phenotype/hpo-similarity-db.ts:227-235,342` |
| Legacy scorer | `src/main/services/scoring/score-cnv.ts`. Phenotype = imported `hpo_sim_score`, which is null for VCF. Rarity is a placeholder |
| Disease drop | `hpo-similarity-db.ts:78-82,131` |
| Simulation harness | `scripts/shortlist-sim/`, no SV/CNV support |

## 6. Recommendation

**MVP. All data is open.**
1. A CNV→gene interval mapper.
2. Bundle the ClinGen gene list (CC0, 250 KB) for HI/TS weights.
3. Add S_gene with the Šidák correction, plus `cnv_gene_count` and `hpo_best_locus`.
4. Keep the ClinGen-mapped region diseases in the HPO DB and add `region_diseases` (59 regions, both builds).
5. Validate on the 110 phenopackets with coordinates, plus the region simulation, before `structuralTypes` is enabled.

**Data-blocked or deferred:**
- DECIPHER coordinates (licence).
- CNV population frequency: none is wired, and the gnomAD-SV licence is unchecked.
- TAD and enhancer effects: low yield for array-sized CNVs.
- Public CNV backgrounds.
- Recurrent regions without a MONDO id, e.g. 15q11.2 BP1–BP2 and 22q11.2 central.
