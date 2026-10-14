# CNV/STR phenotype scoring: pre-registered validation protocol

Spec: `.planning/specs/2026-10-14-hpo-cnv-str-scoring.md` §7. Plan lane L6. Refs #600, #581, #582.
Committed **before any run**. Nothing below is changed after the first run; a deviation is listed
in the report as a deviation, with its reason. Nothing is tuned on the validation cases: the
scorers (`src/shared/phenotype/cnv-score.ts`, `str-score.ts`) and the weights in
`src/shared/config/hpo-locus-scoring.config.ts` are used as committed at base `c2b19816`.

## Criteria (verbatim from spec §7)

| # | Criterion (all must hold to enable CNV) |
|---|---|
| CNV-1 | Real cases: A3 Hit@10 ≥ A0 Hit@10 − 2.0 pp (non-inferior). |
| CNV-2 | Simulation, moderate profiles, backgrounds containing ≥ 1 Mb CNVs: A3 Hit@10 − A0 ≥ +5.0 pp, CI lower bound > 0. |
| CNV-3 | Simulation, ClinGen region diseases: A3 Hit@10 − A2 ≥ +20 pp. This checks that the region route works for the 69 % of region diseases with no gene link. |
| CNV-4 | Background CNVs: Spearman ρ(S_cnv, n_c) ≤ 0.25. A0's ρ is reported for contrast. |
| CNV-5 | SNV invariance: every gene's S(g), d*(g) and percentile identical before and after the builder change. Unit test, exact. |
| CNV-6 | Latency: p95 ≤ 5 ms added per case at 5,000 CNVs; index load ≤ +50 ms. |

| # | Criterion (all must hold to enable STR) |
|---|---|
| STR-1 | False leads = 0. In T1–T5, no `hpo_best_disease` outside the band's set and no non-null score where the gate fails. Deterministic: any failure is a bug, not a tuning issue. |
| STR-2 | Causal arms with decoys, moderate profiles: Hit@1 − baseline ≥ +5.0 pp, CI lower bound > 0. |
| STR-3 | Causal arms without decoys: Hit@1 non-inferior to baseline (Δ ≥ −1.0 pp). |
| STR-4 | The admitted catalogue diseases (ORPHA:273, ORPHA:401901, ORPHA:98757) are in the index and score > 0 on their own HPOA profile. Unit test. |

A criterion that cannot be evaluated (empty stratum, missing data) is reported as **FAILED (not
evaluable)**. A failed criterion keeps that type behind its flag.

## Data (all downloaded at run time into `DATA_DIR`, outside the repository; never committed)

- **HPO** release `v2026-09-01` (the release of the v2 benchmark), built into a builder-v6
  `hpo_similarity.db` with real downloads of ClinGen dosage (genes + regions, both builds),
  STRchive and Mondo (`npm run build:hpo-db -- --tag v2026-09-01 --out <cache>`). The source
  versions and digests in its `meta` are copied into the report.
- **Gene intervals**: `resources/gene_reference.db` via `src/main/services/reference/gene-intervals.ts`.
- **Real CNV cases**: phenopacket-store 0.1.27 (`DATA_DIR/external/phenopacket-store/0.1.27`).
- **Backgrounds**: GRCh38 = 1000 Genomes high-coverage SV (`1KGP_3202.gatksv_svtools_novelins.freeze_V3.wAF.vcf.gz`);
  GRCh37 = 1000 Genomes phase 3 integrated SV map (`ALL.wgs.mergedSV.v8.20130502.svs.genotypes.vcf.gz`).
- **ClinVar CNVs**: NCBI `variant_summary.txt.gz` (download date recorded).

## Seeds

Master seed `20261014`. Every random draw is `rng(diseaseSeed(<case key>, 20261014 ^ <salt>))`
with a fixed salt per purpose (profile, background choice, STR genotype, decoys). Bootstrap:
2,000 replicates, seed `20261017`, 95 % percentile intervals, paired over the same clusters.

## CNV

**Real cases.** Every genomic interpretation of a phenopacket with a `structuralType` whose label,
id or description yields a chromosome, start and end:
- HGVS-like `NC_0000NN.V:g.a_bdel|dup`, `g.a_bdel|dup(GRCh37|GRCh38)`, ISCN-like
  `<band>(a_b)xN` or `(a-b)xN`, and `chrN:a-b`.
- Type: `del`/`dup` in the text, else copy number `x0`/`x1` → DEL, `x3`/`x4` → DUP, else the
  structural-type label (deletion/duplication). Undetermined type → dropped.
- Chromosome from the RefSeq accession, `chr`, or the cytoband prefix.
- Build: explicit (GRCh37/hg19, GRCh38/hg38, or the RefSeq accession version) → else the build in
  which the case's `geneContext` gene overlaps the interval in `gene_reference.db` (both or
  neither → GRCh37) → else GRCh37.
- A case is a phenopacket with ≥ 1 such CNV and ≥ 1 observed HPO term; all of its CNVs are causal,
  and its rank is the best rank among them. Cluster = the `geneContext` symbol, else `chr:band`.
- Counts per build and the drops are reported.

**Backgrounds.** Per build, the DEL/DUP/CNV records of one sample (non-reference genotype; for
multi-allelic CN records, the sample's copy number decides DEL/DUP; < 1 kb dropped). Ten samples
per build: 5 drawn at random among samples carrying ≥ 1 call ≥ 1 Mb, and 5 among the rest (all
samples if a stratum has fewer). Every case is spiked into all 10 backgrounds of its build.
**CNV-2's stratum** is the backgrounds with ≥ 1 call ≥ 1 Mb.

**Simulation (GRCh38 only).**
- ClinGen regions of the v6 DB, GRCh38: DEL cases for HI ≥ 2 (loss diseases), DUP cases for
  TS ≥ 2 (gain diseases). The CNV is the region interval. Target disease: drawn at random among
  the region's diseases that have ≥ 1 positive HPOA term. Regions without one are dropped (counted).
- ClinVar: `variant_summary` rows with Type `copy number loss`/`copy number gain`, Assembly
  GRCh38, ClinicalSignificance exactly `Pathogenic`, `Likely pathogenic` or
  `Pathogenic/Likely pathogenic`, length ≥ 1 kb, and ≥ 1 OMIM/Orphanet phenotype id with
  positive HPOA terms (target drawn at random among them). 500 drawn at random (all if fewer).
- Profiles: `sampleProfile` of `scripts/shortlist-sim/phenotype/profiles.ts` (clean, moderate,
  noisy; 5 true terms) on every OMIM/ORPHA disease's positive HPOA terms (gene link not required).
- Cluster: ISCA id for regions, target disease id for ClinVar.

**Arms** (gene set always from the interval fallback; `hetHits` = 0; sex unknown):
- A0: max S(g) over the CNV's indexed genes.
- A1: max w(g, c)·S(g) over genes with w > 0.
- A2: `scoreCnv` with no regions (gene route: A1 + Šidák).
- A3: `scoreCnv` (shipped design).
- Sum (reference): Σ w(g, c)·e^{S(g)} over genes with w > 0.

**Metrics.** Rank of the causal CNV among the case's CNVs (spiked + background) by arm score,
descending; null scores rank below every non-null score; ties are tie-averaged. Hit@1/5/10 and
MRR, averaged over the case's backgrounds, then over cases. Real cases use their observed terms;
CNV-2 uses moderate profiles of all simulated cases; CNV-3 uses moderate profiles of the region
cases (both backgrounds as stated).

**CNV-4.** Per (real case, background), Spearman ρ between A3 score and n_c over the background
CNVs with n_c ≥ 1 (n_c = indexed genes with w > 0); null scores count as 0. The criterion is the
median ρ; A0's median is reported.

**CNV-5.** For 200 profiles (real cases, then simulated), every gene's S(g), d*(g) and percentile
from the v6 DB equal those from the builder-v5 DB of the same HPO release (exact equality), plus
the unit test `tests/shared/phenotype/phenotype-locus.test.ts`.

**CNV-6.** A3 over a fixed 5,000-CNV set (seeded draw from the pooled GRCh38 background calls),
timed per profile for 200 profiles after one warm-up, excluding `openHpoGeneScorer` (the SNV
cost); p95 reported. Index load = `readLocusReference` + the GRCh38 gene-interval index, cold, in
the bench process.

## STR (GRCh38, simulation only)

- **Catalogue**: `str_loci` of the v6 DB (hg38 span required).
- **Normal call** per locus: two alleles (one for a male on chrX outside the PARs), each uniform
  in [1, N], N = benignMax, else intermediateMin − 1, else pathogenicMin − 1, else 10. Repeat
  unit = the first pathogenic motif. A full allele is pathogenicMin + U[0, pathogenicMin].
- **Decoys** (with-decoy arm), independently per case: TCF4 CTG18.1 one full allele at 3 %, ATXN2
  one intermediate allele at 4 %, RFC1 one full allele (other normal) at 2 %, FMR1 one premutation
  allele at 0.4 % of females and 0.2 % of males. Never at the causal locus. An all-decoys
  sensitivity arm is reported, not a criterion.
- **Causal arms**: one case per locus with pathogenicMin, non-Refuted/Disputed evidence, and ≥ 1
  full-set disease with positive HPOA terms (target drawn at random) × clean/moderate/noisy.
  Sex: male for X-linked loci, else random. Genotype: AR → two full alleles; male chrX → one;
  else one full + one normal. `hetHits` = 0.
- **New** = `scoreStr`; **baseline** = today's gene-level score S(locus gene), set for every
  STR row whose gene is indexed (normal alleles included). Rank of the causal row among the case's
  STR rows; nulls last; ties averaged. Cluster = locus gene.
- **Trick arms** (STR-1), each × 3 levels × 20 seeds, decoy-free background:
  T1 TCF4 full + Pitt-Hopkins (OMIM:610954) profile; T2 FMR1 premutation + Fragile X (OMIM:300624),
  male; T3 one RFC1 full allele + CANVAS (OMIM:614575); T4 AR locus (SBMA, AR gene) full allele in a
  female + SBMA (OMIM:313200); T5 every locus normal, profile of a random catalogue disease. A false
  lead is any decoy/trick row with a best disease outside its band's set (`femaleOnly` dropped for
  males) or a non-null score where the gate fails (T3, T4, every T5 row).
- **STR-4**: each id is in the v6 disease index and `scoreDiseases([id])` > 0 on a profile of all of
  its positive HPOA terms; plus the unit test `tests/main/services/phenotype/locus-reference-db.test.ts`.

## Outputs

Aggregate tables only, to `.planning/artifacts/shortlist-sim/2026-10-14-cnv-str/report.md` and
spec §10. Per-case files stay in `DATA_DIR/runs/`.
