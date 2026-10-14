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

## Variant-level benchmark (backgrounds)

3609 of 3620 simulated cases have an HPO-annotated spiked disease
and enter; 1175 gene clusters; pooled modes AD, AR_HOM, AR_COMPHET, XLD.
Hit@k is macro-averaged over consequence classes under the production ordering; intervals
are 95 % gene-cluster bootstrap (2000 replicates), Δ is paired vs (a).
`hpo_resnik` bins: ≥ 3 / 2.5 / 2 / 1.5 (fixed before any background was opened),
hand-set points 4 / 3 / 2 / 1 / 0; fold-tuned points (reference last):
- fold 0: 5 / 4 / 3 / 0 / -7
- fold 1: 5 / 4 / 3 / 0 / -7
- fold 2: 5 / 4 / 3 / 0 / -7
- fold 3: 5 / 4 / 3 / 0 / -7
- fold 4: 5 / 4 / 3 / 0 / -7

Varvis `hpo_sim_score` comes from the background patient's own phenotype, not the simulated
disease: any gain of (b) is a disease-gene prior (genes with a score), not a phenotype match.
The control row ranks with a moderate profile of a random disease not linked to the causal
gene: its gain over (a) is what `hpo_resnik` adds without a matching phenotype (an
"annotated disease gene" prior).

### primary, clean profiles

| Scorer | Hit@1 % | Hit@5 % | Hit@10 % | ΔHit@10 vs (a), pp | Δ decoys in top 10 |
|---|---|---|---|---|---|
| (a) varvis template, no phenotype | 11.1 [10.4, 12.0] | 26.4 [25.1, 28.0] | 36.9 [34.3, 40.3] | – | – |
| (b) + varvis `hpo_sim_score` bins | 10.9 [10.2, 11.8] | 31.8 [29.6, 34.5] | 41.8 [38.7, 45.6] | 4.9 [3.5, 6.5] | 0.00 [0.00, 0.00] |
| (c) + `hpo_resnik` bins, fold-tuned | 45.9 [42.6, 50.0] | 67.8 [64.7, 71.1] | 76.5 [70.6, 97.0] | 39.5 [33.0, 59.2] | 0.01 [0.00, 0.01] |
| (c') + `hpo_resnik` bins, hand-set | 19.4 [18.3, 20.7] | 40.5 [37.2, 44.2] | 53.5 [49.6, 57.8] | 16.5 [13.6, 20.2] | 0.00 [0.00, 0.00] |
| (c) with a random other disease's profile (control) | 10.4 [9.8, 11.2] | 24.6 [23.2, 26.3] | 33.8 [31.7, 36.4] | -3.2 [-4.9, -1.4] | 0.00 [0.00, 0.01] |

### primary, moderate profiles

| Scorer | Hit@1 % | Hit@5 % | Hit@10 % | ΔHit@10 vs (a), pp | Δ decoys in top 10 |
|---|---|---|---|---|---|
| (a) varvis template, no phenotype | 11.1 [10.4, 12.0] | 26.4 [25.1, 28.0] | 36.9 [34.3, 40.3] | – | – |
| (b) + varvis `hpo_sim_score` bins | 10.9 [10.2, 11.8] | 31.8 [29.6, 34.5] | 41.8 [38.7, 45.6] | 4.9 [3.5, 6.5] | 0.00 [0.00, 0.00] |
| (c) + `hpo_resnik` bins, fold-tuned | 39.8 [36.4, 43.7] | 62.8 [59.4, 66.3] | 72.9 [67.1, 92.9] | 36.0 [29.7, 55.8] | 0.00 [0.00, 0.01] |
| (c') + `hpo_resnik` bins, hand-set | 16.4 [15.4, 17.7] | 36.0 [33.2, 39.6] | 47.4 [43.9, 51.6] | 10.5 [8.5, 13.0] | 0.00 [0.00, 0.00] |
| (c) with a random other disease's profile (control) | 10.4 [9.8, 11.2] | 24.6 [23.2, 26.3] | 33.8 [31.7, 36.4] | -3.2 [-4.9, -1.4] | 0.00 [0.00, 0.01] |

### primary, noisy profiles

| Scorer | Hit@1 % | Hit@5 % | Hit@10 % | ΔHit@10 vs (a), pp | Δ decoys in top 10 |
|---|---|---|---|---|---|
| (a) varvis template, no phenotype | 11.1 [10.4, 12.0] | 26.4 [25.1, 28.0] | 36.9 [34.3, 40.3] | – | – |
| (b) + varvis `hpo_sim_score` bins | 10.9 [10.2, 11.8] | 31.8 [29.6, 34.5] | 41.8 [38.7, 45.6] | 4.9 [3.5, 6.5] | 0.00 [0.00, 0.00] |
| (c) + `hpo_resnik` bins, fold-tuned | 28.5 [26.1, 31.4] | 49.6 [46.2, 53.4] | 60.9 [54.3, 80.5] | 23.9 [17.3, 43.8] | 0.00 [0.00, 0.00] |
| (c') + `hpo_resnik` bins, hand-set | 13.6 [12.8, 14.5] | 30.7 [28.7, 33.8] | 42.3 [39.0, 46.2] | 5.4 [3.8, 7.3] | 0.00 [0.00, 0.00] |
| (c) with a random other disease's profile (control) | 10.4 [9.8, 11.2] | 24.6 [23.2, 26.3] | 33.8 [31.7, 36.4] | -3.2 [-4.9, -1.4] | 0.00 [0.00, 0.01] |

### clinvar_visible, clean profiles

| Scorer | Hit@1 % | Hit@5 % | Hit@10 % | ΔHit@10 vs (a), pp | Δ decoys in top 10 |
|---|---|---|---|---|---|
| (a) varvis template, no phenotype | 24.8 [22.9, 27.2] | 60.0 [56.5, 64.4] | 70.0 [66.7, 73.1] | – | – |
| (b) + varvis `hpo_sim_score` bins | 24.9 [23.0, 27.3] | 63.8 [60.6, 67.3] | 71.2 [68.2, 73.7] | 1.1 [0.1, 2.5] | 0.00 [-0.00, 0.01] |
| (c) + `hpo_resnik` bins, fold-tuned | 66.0 [59.7, 74.9] | 99.2 [98.2, 99.9] | 99.4 [98.4, 100.0] | 29.3 [26.5, 32.4] | -0.00 [-0.00, -0.00] |
| (c') + `hpo_resnik` bins, hand-set | 37.7 [34.8, 41.1] | 68.4 [65.2, 71.6] | 81.4 [72.3, 97.9] | 11.3 [2.1, 27.3] | -0.00 [-0.00, 0.00] |
| (c) with a random other disease's profile (control) | 25.5 [23.6, 28.1] | 58.1 [54.5, 62.2] | 67.9 [65.1, 71.1] | -2.1 [-4.6, 0.4] | -0.00 [-0.00, 0.00] |

### clinvar_visible, moderate profiles

| Scorer | Hit@1 % | Hit@5 % | Hit@10 % | ΔHit@10 vs (a), pp | Δ decoys in top 10 |
|---|---|---|---|---|---|
| (a) varvis template, no phenotype | 24.8 [22.9, 27.2] | 60.0 [56.5, 64.4] | 70.0 [66.7, 73.1] | – | – |
| (b) + varvis `hpo_sim_score` bins | 24.9 [23.0, 27.3] | 63.8 [60.6, 67.3] | 71.2 [68.2, 73.7] | 1.1 [0.1, 2.5] | 0.00 [-0.00, 0.01] |
| (c) + `hpo_resnik` bins, fold-tuned | 62.1 [56.2, 82.1] | 94.1 [73.7, 99.1] | 99.0 [97.8, 99.9] | 29.0 [26.2, 32.1] | -0.00 [-0.00, 0.00] |
| (c') + `hpo_resnik` bins, hand-set | 33.0 [30.3, 36.2] | 66.2 [62.9, 69.7] | 76.6 [70.9, 96.9] | 6.5 [1.0, 26.8] | -0.00 [-0.00, 0.00] |
| (c) with a random other disease's profile (control) | 25.5 [23.6, 28.1] | 58.1 [54.5, 62.2] | 67.9 [65.1, 71.1] | -2.1 [-4.6, 0.4] | -0.00 [-0.00, 0.00] |

### clinvar_visible, noisy profiles

| Scorer | Hit@1 % | Hit@5 % | Hit@10 % | ΔHit@10 vs (a), pp | Δ decoys in top 10 |
|---|---|---|---|---|---|
| (a) varvis template, no phenotype | 24.8 [22.9, 27.2] | 60.0 [56.5, 64.4] | 70.0 [66.7, 73.1] | – | – |
| (b) + varvis `hpo_sim_score` bins | 24.9 [23.0, 27.3] | 63.8 [60.6, 67.3] | 71.2 [68.2, 73.7] | 1.1 [0.1, 2.5] | 0.00 [-0.00, 0.01] |
| (c) + `hpo_resnik` bins, fold-tuned | 49.5 [43.0, 69.0] | 81.9 [68.3, 95.1] | 85.8 [72.7, 98.8] | 15.8 [1.9, 29.4] | -0.00 [-0.00, 0.00] |
| (c') + `hpo_resnik` bins, hand-set | 29.9 [27.4, 32.8] | 63.4 [60.0, 67.2] | 75.8 [69.5, 96.4] | 5.8 [0.5, 26.1] | 0.00 [-0.00, 0.00] |
| (c) with a random other disease's profile (control) | 25.5 [23.6, 28.1] | 58.1 [54.5, 62.2] | 67.9 [65.1, 71.1] | -2.1 [-4.6, 0.4] | -0.00 [-0.00, 0.00] |

### Safety check, ClinVar visible ((c) fold-tuned vs (a), spec §11.5 item 3)

- clean: ΔHit@10 lower bound 26.5 pp (> −2 required), Δ decoys upper bound -0.00 (≤ 0.5) → **pass**
- moderate: ΔHit@10 lower bound 26.2 pp (> −2 required), Δ decoys upper bound 0.00 (≤ 0.5) → **pass**
- noisy: ΔHit@10 lower bound 1.9 pp (> −2 required), Δ decoys upper bound 0.00 (≤ 0.5) → **pass**

## Calibration of `hpo_resnik`

Per noise level, scored eligible background rows are split at their score deciles (the top
decile split again at the 95th and 99th percentile; rows of genes without HPO annotation
separately); lift = share of causal genes in the bin ÷ share of background rows. A useful
score has lift rising with the score.

**clean**

| score range | background % | causal % | lift |
|---|---|---|---|
| no score | 66.8 | 0.1 | 0.00 |
| 0.00–0.05 | 4.7 | 0.0 | 0.01 |
| 0.05–0.25 | 2.4 | 0.0 | 0.00 |
| 0.25–0.45 | 3.7 | 0.0 | 0.01 |
| 0.45–0.60 | 3.6 | 0.1 | 0.02 |
| 0.60–0.70 | 2.6 | 0.0 | 0.00 |
| 0.70–0.85 | 3.7 | 0.0 | 0.00 |
| 0.85–1.00 | 3.5 | 0.0 | 0.01 |
| 1.00–1.15 | 2.9 | 0.2 | 0.07 |
| 1.15–1.35 | 2.8 | 0.7 | 0.25 |
| 1.35–1.60 | 1.8 | 2.1 | 1.16 |
| 1.60–2.10 | 1.1 | 12.9 | 11.58 |
| 2.10–∞ | 0.3 | 83.9 | 257.44 |

**moderate**

| score range | background % | causal % | lift |
|---|---|---|---|
| no score | 66.8 | 0.1 | 0.00 |
| 0.00–0.15 | 3.6 | 0.0 | 0.01 |
| 0.15–0.40 | 3.8 | 0.0 | 0.01 |
| 0.40–0.55 | 3.2 | 0.1 | 0.03 |
| 0.55–0.70 | 4.0 | 0.2 | 0.06 |
| 0.70–0.80 | 2.8 | 0.2 | 0.07 |
| 0.80–0.90 | 2.9 | 0.1 | 0.02 |
| 0.90–1.05 | 4.0 | 0.5 | 0.12 |
| 1.05–1.15 | 2.3 | 0.7 | 0.33 |
| 1.15–1.35 | 3.3 | 2.8 | 0.84 |
| 1.35–1.55 | 1.8 | 5.9 | 3.31 |
| 1.55–1.90 | 1.1 | 21.1 | 19.42 |
| 1.90–∞ | 0.3 | 68.3 | 206.03 |

**noisy**

| score range | background % | causal % | lift |
|---|---|---|---|
| no score | 66.8 | 0.1 | 0.00 |
| 0.00–0.30 | 3.7 | 0.1 | 0.02 |
| 0.30–0.50 | 3.2 | 0.2 | 0.06 |
| 0.50–0.65 | 3.7 | 0.2 | 0.06 |
| 0.65–0.75 | 2.9 | 0.2 | 0.06 |
| 0.75–0.85 | 3.1 | 0.7 | 0.21 |
| 0.85–1.00 | 4.8 | 2.2 | 0.47 |
| 1.00–1.10 | 3.0 | 2.9 | 0.96 |
| 1.10–1.20 | 2.5 | 4.3 | 1.69 |
| 1.20–1.35 | 2.8 | 9.2 | 3.24 |
| 1.35–1.50 | 1.7 | 12.2 | 7.12 |
| 1.50–1.80 | 1.3 | 26.2 | 20.39 |
| 1.80–∞ | 0.3 | 41.5 | 134.45 |

## Runtime

Full shortlist ranking per case (median): (a) 42 ms, (c) 47 ms.
`hpo_resnik` alone (open + score all genes): median 2.7 ms, p95 3.9 ms.

Reproduce (needs the private backgrounds and the HPO DB/raw files above):
`npx jiti scripts/shortlist-sim/run.ts --run <name> --pheno` (758 s wall, 5.0 GB peak, 6 workers).
Phase A and the varvis fold tuning are the regular run's; the `hpo_resnik` group is appended
to the fold-tuned template with its phenotype group zeroed.

### Reading (variant level)

- **The gain comes from the phenotype match.** With a random other disease's profile, (c) loses
  3.2 pp Hit@10 vs (a) [−4.9, −1.4]. A matching profile adds +39.5 / +36.0 / +23.9 pp (clean /
  moderate / noisy, primary). The lower bound is ≥ +17 pp even for noisy profiles.
- **Tuned beats hand-set clearly.** The fold-tuned points (identical in all 5 folds: 5 / 4 / 3 /
  0 / −7, so effectively +12 for ≥ 3 down to +7 for 1.5–2) are much steeper than the hand ladder
  4 / 3 / 2 / 1 / 0. The hand version gains only +16.5 / +10.5 / +5.4 pp. The large penalty on
  the reference bin is the point: most background rows (67 %) are in genes without HPO
  annotation or score below 1.5.
- **Decoys do not intrude** (Δ ≈ 0 everywhere). The ClinVar-visible safety check passes at every
  noise level (lower bound of ΔHit@10 +1.9 pp even for noisy profiles).
- **Calibration:** lift rises monotonically with the score at every noise level. The top 1 % of
  background scores holds 84 / 68 / 42 % of causal genes (lift 257 / 206 / 134).
- **Caveats.** (1) Optimistic in absolute terms: the gene annotations contain the sampled disease
  terms verbatim (same circularity as the gene ranking). Real referral profiles sit closer to
  the noisy stratum, and the deltas there are the ones to quote. (2) Some Hit@10 intervals of (c)
  are wide and asymmetric (e.g. [54.3, 80.5]). That is the macro average over consequence
  classes with a small class (in-frame), not instability of the common classes; Hit@1/5
  intervals are tight. (3) The tuned points come from this benchmark: before seeding a preset,
  freeze them and rerun with `--frozen`-style pre-registration on independent backgrounds.

**Recommendation for #600:** `hpo_resnik` earns a place in a **non-default** evidence preset.
Use the fold-tuned bin points (5 / 4 / 3 / 0 / −7 on ≥ 3 / 2.5 / 2 / 1.5 / reference), not
the hand ladder, and use them only for cases with entered HPO terms (without terms every row is
null → reference, so the group shifts all rows equally and changes nothing). Do not make it
the default until it is validated on independent backgrounds with real patient HPO profiles.

