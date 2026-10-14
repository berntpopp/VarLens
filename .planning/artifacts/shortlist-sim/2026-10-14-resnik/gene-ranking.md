# hpo_resnik gene-ranking benchmark (public data)

HPO release v2026-09-01; 1000 of 9162 eligible OMIM/ORPHA diseases
(seeded sample), every one of 5268 genes in genes_to_phenotype.txt ranked per case.
Profiles: 5 frequency-weighted true terms (unknown frequency = 0.5),
the same true terms in every stratum; causal gene drawn uniformly from the disease genes.
Ranks are tie-averaged; intervals are 95 % percentile bootstrap over diseases
(2000 replicates).

| Noise level | imprecision | steps up | noise terms |
|---|---|---|---|
| clean | 0 | 0 | 0 |
| moderate | 0.4 | 1 | 2 |
| noisy | 0.6 | 2 | 5 |

## clean (1000 cases, median profile 5 terms)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, annotation count) |
|---|---|---|---|---|---|---|---|
| before: `hpo_resnik` (patient→gene) | 62.5 [60.1, 65.0] | 92.4 [91.0, 93.6] | 98.4 [97.8, 99.0] | 99.3 [98.8, 99.7] | 1.0 [1.0, 1.5] | 0.732 [0.712, 0.751] | 0.68 |
| before: symmetric BMA (harness) | 63.6 [60.6, 66.6] | 90.5 [88.6, 92.2] | 97.9 [97.0, 98.7] | 99.3 [98.7, 99.8] | 1.0 [1.0, 1.0] | 0.729 [0.705, 0.752] | 0.59 |
| **after**: `hpo_resnik` | 58.7 [55.7, 61.9] | 88.8 [86.7, 90.7] | 97.9 [97.0, 98.7] | 99.2 [98.6, 99.7] | 1.0 [1.0, 1.0] | 0.691 [0.666, 0.715] | 0.56 |
| exact term overlap (reference) | 69.3 [66.9, 71.6] | 95.0 [93.9, 96.1] | 98.8 [98.2, 99.3] | 99.3 [98.8, 99.7] | 1.0 [1.0, 1.0] | 0.786 [0.769, 0.804] | 0.32 |

Paired ΔHit@10 of after (pp): vs before: `hpo_resnik` (patient→gene) -3.6 [-5.5, -1.8]; vs exact term overlap (reference) -6.3 [-8.1, -4.4]

## moderate (1000 cases, median profile 7 terms)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, annotation count) |
|---|---|---|---|---|---|---|---|
| before: `hpo_resnik` (patient→gene) | 22.6 [20.0, 25.1] | 56.3 [53.3, 59.1] | 79.1 [76.5, 81.5] | 85.5 [83.4, 87.6] | 7.0 [6.0, 8.5] | 0.335 [0.312, 0.358] | 0.75 |
| before: symmetric BMA (harness) | 33.3 [30.3, 36.1] | 66.8 [63.9, 69.6] | 85.3 [83.1, 87.4] | 92.4 [90.7, 94.0] | 4.0 [3.0, 4.0] | 0.447 [0.422, 0.472] | 0.63 |
| **after**: `hpo_resnik` | 27.7 [24.9, 30.5] | 64.5 [61.6, 67.4] | 85.4 [83.3, 87.5] | 92.9 [91.3, 94.4] | 4.0 [4.0, 5.0] | 0.403 [0.379, 0.428] | 0.58 |
| exact term overlap (reference) | 31.9 [29.5, 34.3] | 65.5 [62.9, 67.9] | 83.7 [81.8, 85.6] | 89.6 [88.0, 91.1] | 4.5 [3.5, 5.0] | 0.434 [0.410, 0.456] | 0.30 |

Paired ΔHit@10 of after (pp): vs before: `hpo_resnik` (patient→gene) 8.2 [5.0, 11.2]; vs exact term overlap (reference) -1.0 [-4.1, 2.3]

## noisy (1000 cases, median profile 10 terms)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, annotation count) |
|---|---|---|---|---|---|---|---|
| before: `hpo_resnik` (patient→gene) | 3.5 [2.5, 4.8] | 14.3 [12.3, 16.5] | 33.9 [30.9, 36.8] | 48.0 [44.8, 51.0] | 118.5 [95.5, 138.0] | 0.074 [0.062, 0.086] | 0.80 |
| before: symmetric BMA (harness) | 7.9 [6.2, 9.6] | 32.1 [29.2, 35.0] | 55.3 [52.3, 58.4] | 66.7 [63.9, 69.6] | 38.0 [32.0, 45.0] | 0.159 [0.142, 0.178] | 0.66 |
| **after**: `hpo_resnik` | 6.8 [5.2, 8.5] | 30.3 [27.4, 33.4] | 55.6 [52.6, 58.7] | 67.7 [64.9, 70.7] | 38.0 [33.0, 44.0] | 0.144 [0.128, 0.161] | 0.59 |
| exact term overlap (reference) | 16.2 [14.3, 18.1] | 42.6 [40.0, 45.2] | 64.4 [61.8, 66.9] | 73.3 [70.9, 75.6] | 21.0 [18.3, 26.3] | 0.250 [0.231, 0.271] | 0.26 |

Paired ΔHit@10 of after (pp): vs before: `hpo_resnik` (patient→gene) 15.9 [13.1, 19.0]; vs exact term overlap (reference) -12.3 [-15.5, -9.2]

Production scorer runtime per case (all genes): median 3 ms, p95 4 ms; before median 235 ms, p95 395 ms.
The first case also loads the typed-array index from the DB: 182 ms, once per process.

**Before** = the scorer as of the first benchmark (one-sided patient→gene BMA, all annotation rows,
full ontology; DB builder v1). **After** = feat/sprint-3 `567c2e08` + `e61e100f`: positive-only
annotations (NOT and zero-frequency rows dropped), Phenotypic abnormality subtree only,
canonical/deduplicated patient terms, symmetric BMA over a DAG dynamic programme (DB builder v2).
Both runs share the seed, the 1000 diseases, the causal genes and the profiles. The after gene
universe is the positively annotated genes (5268 vs 5277 before). The before symmetric row is
the old harness-only reference.

Reproduce: `npm run build:hpo-db -- --out <data>/cache/hpo/hpo_similarity.db --tag v2026-09-01`,
download the same release's three raw files into `<data>/cache/hpo/raw-v2026-09-01/` (the
runner refuses them unless their sha256 matches the DB's `sources_sha256`), then
`npx jiti scripts/shortlist-sim/phenotype/gene-ranking.ts --run <name> [--before <earlier run>]`
(after: 39 s wall, 0.56 GB peak; before: 1074 s).

## Reading

- **Noise robustness fixed.** ΔHit@10 after − before: +8.2 pp moderate, +15.9 pp noisy. Hit@100
  also rises from 48 % to 68 % (noisy). Clean profiles lose 3.6 pp, the expected price of
  symmetric averaging: genes with many extra terms are penalised even when the profile matches exactly.
- **Bias reduced, not gone.** ρ(score, annotation count) went from 0.68–0.80 to 0.56–0.59.
  Exact overlap sits at 0.26–0.32.
- **Exact overlap still wins under noise** (−12.3 pp noisy, −6.3 pp clean; tied at moderate). Part
  of that is the circularity below. Exact overlap rewards verbatim matches, and gene annotations
  contain the sampled disease terms verbatim. Overlap is a reference, not a candidate: real
  patient terms rarely match annotations verbatim.
- **Optimistic in absolute terms.** genes_to_phenotype.txt is derived from the same disease
  annotations the profiles are sampled from. Compare scorers with each other, not with real-case
  Hit rates.
- **Runtime:** 3 ms per case for all genes (was 235 ms), plus a one-off 182 ms index load.

Verdict for #600: the after scorer is a sound preset candidate on gene ranking (clearly better
than before under realistic noise, cheap). Its variant-level value (calibration, gain over the
varvis template) still needs the background benchmark below.

## TODO: variant-level benchmark (needs the private backgrounds)

Blocked on 2026-10-14: the varvis exome backgrounds (`VARLENS_SIM_BACKGROUND_DIR`, default
`/run/media/bernt-popp/1819-E513/immunology_cases`) were not mounted. When available, spike the
ClinVar pool into the backgrounds with these noisy profiles and compare on the same gene-grouped
folds and seeds: (a) the varvis template without phenotype, (b) + varvis `hpo_sim_score` bins,
(c) + `hpo_resnik` bins tuned on training folds only (plus a hand-set bin version). Report
Hit@1/5/10 with cluster-bootstrap intervals, paired Δ vs (a) per noise level, and the
reliability of `hpo_resnik` by score decile.
