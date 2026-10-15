# CNV/STR phenotype scoring: pre-registered validation protocol (#642)

Spec: `.planning/specs/2026-10-14-hpo-cnv-str-scoring.md` §7 and issue #642 (Sprint 4 Lane 2). Refs #642, #581, #582.
Pre-registered **before any run** of seed `20261015`. Nothing below is changed after the run; any
deviation is listed in the report with its reason. Nothing is tuned on the validation cases: the
scorers (`src/shared/phenotype/cnv-score.ts`, `str-score.ts`) and the weights in
`src/shared/config/hpo-locus-scoring.config.ts` are fixed before running `run.ts`.

## Changes from the 2026-10-14 protocol (#642)

1. **CNV gene route simplified to plain best overlapping gene (`S_gene(c) = max_{g ∈ G(c)} S(g)`).**
   The 2026-10-14 benchmark falsified the composite gene route: per-gene dosage weighting (`A0 → A1`)
   cost −11 pp Hit@10 in simulation, and the Šidák multi-gene penalty (`A1 → A2`) cost another −9 pp
   Hit@10, while `A0` already had median Spearman ρ(S, n_c) = 0.053 (well under the 0.25 ceiling).
   `scoreCnv` is now `max(S_gene(c), S_region(c))` with `S_gene(c) = A0`.
2. **Pre-registered arms:** `A0` (gene route only), `region` (ClinGen region route only),
   `A3` (`scoreCnv = max(A0, region)`), and `sum` (unpenalized additive reference `∑_{g ∈ G(c)} e^{S(g)}`).
3. **Stratification of `CNV-2` and `CNV-3`:** Because `S_gene = A0`, `A3 = max(A0, S_region)` is
   identical to `A0` on CNVs that do not overlap a ClinGen dosage region (342/386 simulated cases)
   and strictly improves over `A0` on ClinGen region cases (44/386, 69 % of which lack gene links in
   HPOA). `CNV-2` therefore tests on the ≥ 1 Mb background stratum that `A3` strictly improves over
   `A0` on Hit@1 (point estimate > 0, 95 % CI lower bound > 0), beats `region`-only by ≥ +50.0 pp
   Hit@10 (CI lower bound > 0), and beats the unpenalized `sum` reference by ≥ +5.0 pp Hit@10 (CI
   lower bound > 0). `CNV-3` tests the ClinGen region stratum directly (`A3 − A0` Hit@1 ≥ +20.0 pp
   and Hit@10 ≥ +10.0 pp, both CI lower bounds > 0). Both the ClinGen region stratum and the ClinVar
   non-region stratum are reported separately, along with a per-cluster breakdown of the 12 real-case
   phenopacket locus clusters.
4. **Fresh master seed `20261015`** (replacing `20261014`, which was used in the initial run and its
   post-hoc bug-fix verification).

## Criteria (all must hold to enable CNV / STR)

| # | Criterion (all must hold to enable CNV) |
|---|---|
| CNV-1 | Real cases: `A3` Hit@10 ≥ `A0` Hit@10 − 2.0 pp (non-inferior; per-cluster table also reported). |
| CNV-2 | Simulation, moderate profiles, backgrounds containing ≥ 1 Mb CNVs (n = 386): `A3 − A0` Hit@1 > 0 pp (CI lower bound > 0); `A3 − region` Hit@10 ≥ +50.0 pp (CI lower bound > 0); `A3 − sum` Hit@10 ≥ +5.0 pp (CI lower bound > 0). |
| CNV-3 | Simulation, moderate profiles, ClinGen region diseases (n = 44): `A3 − A0` Hit@1 ≥ +20.0 pp (CI lower bound > 0) and Hit@10 ≥ +10.0 pp (CI lower bound > 0). |
| CNV-4 | Background CNVs: median Spearman ρ(S_cnv, n_c) ≤ 0.25 (`A0` reported alongside). |
| CNV-5 | SNV invariance: every gene's S(g), d*(g) and percentile identical before and after the builder change (0 mismatches across 200 profiles). |
| CNV-6 | Latency: p95 ≤ 5.0 ms added per case at 5,000 CNVs; cold index load (`readLocusReference` + GRCh38 gene-interval index) ≤ 50.0 ms. |

| # | Criterion (all must hold to enable STR) |
|---|---|
| STR-1 | False leads = 0. In T1–T5, no `hpo_best_disease` outside the band's set and no non-null score where the gate fails. Deterministic: any failure is a bug, not a tuning issue. |
| STR-2 | Causal arms with decoys, moderate profiles: Hit@1 − baseline ≥ +5.0 pp, CI lower bound > 0. |
| STR-3 | Causal arms without decoys: Hit@1 non-inferior to baseline (Δ ≥ −1.0 pp at every noise level). |
| STR-4 | The admitted catalogue diseases (ORPHA:273, ORPHA:401901, ORPHA:98757) are in the index and score > 0 on their own HPOA profile. |

A criterion that cannot be evaluated (empty stratum, missing data) is reported as **FAILED (not
evaluable)**. A failed criterion keeps that type behind its flag.

## Data (all downloaded at run time into `DATA_DIR`, outside the repository; never committed)

- **HPO** release `v2026-09-01`, built into a builder-v6 `hpo_similarity.db` with ClinGen dosage
  (genes + regions, both builds), STRchive and Mondo. Source versions in `meta` are copied into the
  report.
- **Gene intervals**: `resources/gene_reference.db` via `src/main/services/reference/gene-intervals.ts`.
- **Real CNV cases**: phenopacket-store 0.1.27 (`DATA_DIR/external/phenopacket-store/0.1.27`).
- **Backgrounds**: GRCh38 = 1000 Genomes high-coverage SV (`1KGP_3202.gatksv_svtools_novelins.freeze_V3.wAF.vcf.gz`);
  GRCh37 = 1000 Genomes phase 3 integrated SV map (`ALL.wgs.mergedSV.v8.20130502.svs.genotypes.vcf.gz`).
- **ClinVar CNVs**: NCBI `variant_summary.txt.gz`.

## Seeds

Master seed `20261015`. Every random draw is `rng(diseaseSeed(<case key>, 20261015 ^ <salt>))`
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
- Counts per build, drops, and a per-cluster Hit@1/Hit@10 breakdown are reported.

**Backgrounds.** Per build, the DEL/DUP/CNV records of one sample (non-reference genotype; for
multi-allelic CN records, the sample's copy number decides DEL/DUP; < 1 kb dropped). Ten samples
per build: 5 drawn at random among samples carrying ≥ 1 call ≥ 1 Mb, and 5 among the rest. Every
case is spiked into all 10 backgrounds of its build. **CNV-2's stratum** is the backgrounds with
≥ 1 call ≥ 1 Mb.

**Simulation (GRCh38 only).**
- ClinGen regions of the v6 DB, GRCh38: DEL cases for HI ≥ 2 (loss diseases), DUP cases for
  TS ≥ 2 (gain diseases). The CNV is the region interval. Target disease: drawn at random among
  the region's diseases that have ≥ 1 positive HPOA term. Regions without one are dropped (counted).
- ClinVar: `variant_summary` rows with Type `copy number loss`/`copy number gain`, Assembly
  GRCh38, ClinicalSignificance `Pathogenic`, `Likely pathogenic` or `Pathogenic/Likely pathogenic`,
  length ≥ 1 kb, and ≥ 1 OMIM/Orphanet phenotype id with positive HPOA terms (target drawn at random
  among them). 500 drawn at random (all if fewer).
- Profiles: `sampleProfile` of `scripts/shortlist-sim/phenotype/profiles.ts` (clean, moderate,
  noisy; 5 true terms) on every OMIM/ORPHA disease's positive HPOA terms.
- Cluster: ISCA id for regions, target disease id for ClinVar.

**Arms** (gene set from interval overlap):
- `A0`: `scoreCnv` with empty regions (`max_{g ∈ G(c)} S(g)`).
- `region`: `scoreCnv` with empty genes (`max_{r ∈ R(c)} f(c, r) · w_r(r, c) · S(r)`).
- `A3`: `scoreCnv` (`max(A0, region)`, shipped design).
- `sum` (reference): `∑_{g ∈ G(c)} e^{S(g)}` over indexed overlapping genes.

## STR (GRCh38, simulation only)

- **Catalogue**: `str_loci` of the v6 DB (hg38 span required).
- **Normal call** per locus: two alleles (one for a male on chrX outside the PARs), each uniform
  in [1, N], N = benignMax, else intermediateMin − 1, else pathogenicMin − 1, else 10. Repeat
  unit = the first pathogenic motif. A full allele is pathogenicMin + U[0, pathogenicMin].
- **Decoys** (with-decoy arm), independently per case: TCF4 CTG18.1 one full allele at 3 %, ATXN2
  one intermediate allele at 4 %, RFC1 one full allele (other normal) at 2 %, FMR1 one premutation
  allele at 0.4 % of females and 0.2 % of males. Never at the causal locus.
- **Causal arms**: one case per locus with pathogenicMin, non-Refuted/Disputed evidence, and ≥ 1
  full-set disease with positive HPOA terms (target drawn at random) × clean/moderate/noisy.
- **New** = `scoreStr`; **baseline** = gene-level score S(locus gene) for every STR row whose gene
  is indexed (normal alleles included).
- **Trick arms** (STR-1), each × 3 levels × 20 seeds (seed `20261015`), decoy-free background:
  T1 TCF4 full + Pitt-Hopkins (OMIM:610954) profile; T2 FMR1 premutation + Fragile X (OMIM:300624),
  male; T3 one RFC1 full allele + CANVAS (OMIM:614575); T4 AR locus (SBMA, AR gene) full allele in a
  female + SBMA (OMIM:313200); T5 every locus normal, profile of a random catalogue disease.

## Outputs

Aggregate tables only, to `.planning/artifacts/shortlist-sim/2026-10-15-cnv-str/report.md`.
Per-case files stay in `DATA_DIR/runs/`.
