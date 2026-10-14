# HPO phenotype scoring v2: gene-ranking benchmark (public data)

HPO release v2026-09-01; 1000 of 9162 eligible OMIM/ORPHA diseases
(seeded sample, same seed and diseases as the sprint-3 run), every one of 5268 genes
ranked per case. Profiles: 5 frequency-weighted true terms (unknown frequency =
0.5); noise levels as in sprint 3, crossed with arms E0/E1/E2 (spec §5):
E1 excludes 2–3 features with f ≥ 0.7
of the 10 most similar other diseases (sprint-3 scorer on the true terms, the
causal gene's diseases excluded) outside the true disease's ancestor closure, and marks
1–2 true terms with the highest f·IC key; E2 adds one excluded true
feature with f ∈ [0.5, 0.9] and, in
25 % of noisy cases, a noise term marked key.
E2 composition: false exclusion in 2276/3000 cases,
noise key in 269/1000 noisy cases.
The sprint-3 baseline is the frozen scorer (scripts/shortlist-sim/phenotype/sprint3-baseline.ts)
on the builder-v2 DB; it sees the present terms only, which are identical across arms.
Ranks are tie-averaged; intervals are 95 % percentile bootstrap over diseases (2000 replicates).

Folds: 5 gene-grouped folds over connected gene–disease components;
genes per fold 2002 / 817 / 817 / 816 / 816, sampled diseases per fold 426 / 137 / 141 / 139 / 157.
**No tuning in this run:** the spec defaults are evaluated on all folds, so every number here is
out-of-sample with respect to parameter fitting.

## Ship criteria (spec §5)

| Criterion | Value | Threshold | Result |
|---|---|---|---|
| 1. E1 moderate: ΔHit@10 vs sprint 3 (pp) | 26.0 [22.9, 28.9] | ≥ 3.0, CI lo > 1.0 | PASS |
| 1. E1 noisy: ΔHit@10 vs sprint 3 (pp) | 32.0 [28.7, 35.2] | ≥ 3.0, CI lo > 1.0 | PASS |
| 2. E0 clean: Hit@10 (%) | 97.4 | ≥ 91.4 | PASS |
| 2. E0 moderate: ΔHit@10 vs sprint 3 (pp) | 23.0 [20.0, 25.9] | ≥ -0.5 (point estimate) | PASS |
| 2. E0 noisy: ΔHit@10 vs sprint 3 (pp) | 22.0 [18.8, 25.1] | ≥ -0.5 (point estimate) | PASS |
| 3. ρ(score, gene term count), worst arm × level | 0.63 | ≤ 0.4 | FAIL |
| 4. clean: Hit@50 drop E1 → E2 (pp) | 0.0 [0.0, 0.0] | ≤ 2.0 (point estimate) | PASS |
| 4. moderate: Hit@50 drop E1 → E2 (pp) | 0.0 [0.0, 0.0] | ≤ 2.0 (point estimate) | PASS |
| 4. noisy: Hit@50 drop E1 → E2 (pp) | 1.2 [0.4, 2.0] | ≤ 2.0 (point estimate) | PASS |
| 5. p95 latency per case, all genes (ms) | 4.0 | ≤ 8 | PASS |

**Verdict: NO SHIP.**

## clean

### clean × E0 (1000 cases; median 5 present, 0 excluded, 0 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ top 100 (terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 80.2 [77.8, 82.3] | 97.4 [96.5, 98.4] | 99.6 [99.2, 99.9] | 99.8 [99.5, 100.0] | 1.0 [1.0, 1.0] | 0.868 [0.851, 0.883] | 0.58 | -0.01 | 0.32 |
| sprint 3 (frozen baseline) | 58.7 [55.7, 61.9] | 88.8 [86.7, 90.7] | 97.9 [97.0, 98.7] | 99.2 [98.6, 99.7] | 1.0 [1.0, 1.0] | 0.691 [0.666, 0.715] | 0.56 | -0.09 | 0.31 |

Paired Δ v2 − sprint 3: Hit@1 21.4 [18.3, 24.5]; Hit@10 8.7 [6.7, 10.8]; Hit@50 1.7 [0.8, 2.6] pp; MRR 0.177 [0.154, 0.199].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 94.5 (n 187) vs 98.1 (n 813); sprint3 97.6 (n 187) vs 86.7 (n 813).
Hit@10 by causal-gene term-count tertile (≤ 35 / ≤ 79 / more), %: v2 95.9 (n 338) / 97.7 (n 330) / 98.8 (n 332); sprint3 94.0 (n 338) / 89.4 (n 330) / 82.8 (n 332).

### clean × E1 (1000 cases; median 5 present, 2 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ top 100 (terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 80.2 [77.8, 82.5] | 97.3 [96.4, 98.3] | 99.6 [99.2, 99.9] | 99.8 [99.5, 100.0] | 1.0 [1.0, 1.0] | 0.867 [0.850, 0.884] | 0.57 | -0.01 | 0.32 |
| sprint 3 (frozen baseline) | 58.7 [55.7, 61.9] | 88.8 [86.7, 90.7] | 97.9 [97.0, 98.7] | 99.2 [98.6, 99.7] | 1.0 [1.0, 1.0] | 0.691 [0.666, 0.715] | 0.56 | -0.09 | 0.31 |

Paired Δ v2 − sprint 3: Hit@1 21.5 [18.4, 24.6]; Hit@10 8.6 [6.6, 10.6]; Hit@50 1.7 [0.8, 2.6] pp; MRR 0.177 [0.154, 0.200].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 94.5 (n 187) vs 98.0 (n 813); sprint3 97.6 (n 187) vs 86.7 (n 813).
Hit@10 by causal-gene term-count tertile (≤ 35 / ≤ 79 / more), %: v2 95.9 (n 338) / 97.7 (n 330) / 98.5 (n 332); sprint3 94.0 (n 338) / 89.4 (n 330) / 82.8 (n 332).

### clean × E2 (1000 cases; median 5 present, 3 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ top 100 (terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 80.2 [77.8, 82.5] | 97.3 [96.4, 98.3] | 99.6 [99.2, 99.9] | 99.8 [99.5, 100.0] | 1.0 [1.0, 1.0] | 0.867 [0.850, 0.884] | 0.57 | -0.01 | 0.32 |
| sprint 3 (frozen baseline) | 58.7 [55.7, 61.9] | 88.8 [86.7, 90.7] | 97.9 [97.0, 98.7] | 99.2 [98.6, 99.7] | 1.0 [1.0, 1.0] | 0.691 [0.666, 0.715] | 0.56 | -0.09 | 0.31 |

Paired Δ v2 − sprint 3: Hit@1 21.5 [18.4, 24.6]; Hit@10 8.6 [6.6, 10.6]; Hit@50 1.7 [0.8, 2.6] pp; MRR 0.177 [0.154, 0.200].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 94.5 (n 187) vs 98.0 (n 813); sprint3 97.6 (n 187) vs 86.7 (n 813).
Hit@10 by causal-gene term-count tertile (≤ 35 / ≤ 79 / more), %: v2 95.9 (n 338) / 97.7 (n 330) / 98.5 (n 332); sprint3 94.0 (n 338) / 89.4 (n 330) / 82.8 (n 332).

## moderate

### moderate × E0 (1000 cases; median 7 present, 0 excluded, 0 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ top 100 (terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 57.4 [54.4, 60.2] | 87.5 [85.3, 89.4] | 95.2 [93.8, 96.4] | 96.7 [95.5, 97.8] | 1.0 [1.0, 1.0] | 0.678 [0.654, 0.700] | 0.61 | -0.01 | 0.33 |
| sprint 3 (frozen baseline) | 27.7 [24.9, 30.5] | 64.5 [61.6, 67.4] | 85.4 [83.3, 87.5] | 92.9 [91.3, 94.4] | 4.0 [4.0, 5.0] | 0.403 [0.379, 0.428] | 0.58 | -0.10 | 0.33 |

Paired Δ v2 − sprint 3: Hit@1 29.7 [26.5, 32.8]; Hit@10 23.0 [20.0, 25.9]; Hit@50 9.8 [7.7, 11.9] pp; MRR 0.274 [0.249, 0.299].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 81.1 (n 187) vs 89.0 (n 813); sprint3 77.5 (n 187) vs 61.5 (n 813).
Hit@10 by causal-gene term-count tertile (≤ 35 / ≤ 79 / more), %: v2 87.0 (n 338) / 88.4 (n 330) / 87.1 (n 332); sprint3 76.3 (n 338) / 63.0 (n 330) / 53.9 (n 332).

### moderate × E1 (1000 cases; median 7 present, 2 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ top 100 (terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 63.8 [60.8, 66.5] | 90.5 [88.5, 92.2] | 97.1 [96.0, 98.1] | 98.3 [97.4, 99.0] | 1.0 [1.0, 1.0] | 0.731 [0.707, 0.752] | 0.60 | -0.01 | 0.33 |
| sprint 3 (frozen baseline) | 27.7 [24.9, 30.5] | 64.5 [61.6, 67.4] | 85.4 [83.3, 87.5] | 92.9 [91.3, 94.4] | 4.0 [4.0, 5.0] | 0.403 [0.379, 0.428] | 0.58 | -0.10 | 0.33 |

Paired Δ v2 − sprint 3: Hit@1 36.1 [32.8, 39.3]; Hit@10 26.0 [22.9, 28.9]; Hit@50 11.7 [9.7, 13.8] pp; MRR 0.327 [0.301, 0.353].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 85.0 (n 187) vs 91.7 (n 813); sprint3 77.5 (n 187) vs 61.5 (n 813).
Hit@10 by causal-gene term-count tertile (≤ 35 / ≤ 79 / more), %: v2 89.5 (n 338) / 91.5 (n 330) / 90.4 (n 332); sprint3 76.3 (n 338) / 63.0 (n 330) / 53.9 (n 332).

### moderate × E2 (1000 cases; median 7 present, 3 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ top 100 (terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 63.8 [60.8, 66.5] | 90.5 [88.5, 92.2] | 97.1 [96.0, 98.1] | 98.3 [97.4, 99.0] | 1.0 [1.0, 1.0] | 0.731 [0.707, 0.752] | 0.60 | -0.01 | 0.33 |
| sprint 3 (frozen baseline) | 27.7 [24.9, 30.5] | 64.5 [61.6, 67.4] | 85.4 [83.3, 87.5] | 92.9 [91.3, 94.4] | 4.0 [4.0, 5.0] | 0.403 [0.379, 0.428] | 0.58 | -0.10 | 0.33 |

Paired Δ v2 − sprint 3: Hit@1 36.1 [32.8, 39.3]; Hit@10 26.0 [22.9, 28.9]; Hit@50 11.7 [9.7, 13.8] pp; MRR 0.327 [0.301, 0.353].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 85.0 (n 187) vs 91.7 (n 813); sprint3 77.5 (n 187) vs 61.5 (n 813).
Hit@10 by causal-gene term-count tertile (≤ 35 / ≤ 79 / more), %: v2 89.5 (n 338) / 91.5 (n 330) / 90.4 (n 332); sprint3 76.3 (n 338) / 63.0 (n 330) / 53.9 (n 332).

## noisy

### noisy × E0 (1000 cases; median 10 present, 0 excluded, 0 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ top 100 (terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 24.5 [21.8, 27.0] | 52.3 [49.1, 55.5] | 71.7 [68.9, 74.4] | 79.5 [77.1, 81.9] | 9.0 [7.0, 11.0] | 0.337 [0.311, 0.361] | 0.63 | -0.01 | 0.34 |
| sprint 3 (frozen baseline) | 6.8 [5.2, 8.5] | 30.3 [27.4, 33.4] | 55.6 [52.6, 58.7] | 67.7 [64.9, 70.7] | 38.0 [33.0, 44.0] | 0.144 [0.128, 0.161] | 0.59 | -0.12 | 0.35 |

Paired Δ v2 − sprint 3: Hit@1 17.6 [15.0, 20.2]; Hit@10 22.0 [18.8, 25.1]; Hit@50 16.1 [13.1, 19.0] pp; MRR 0.192 [0.168, 0.215].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 47.0 (n 187) vs 53.5 (n 813); sprint3 42.7 (n 187) vs 27.4 (n 813).
Hit@10 by causal-gene term-count tertile (≤ 35 / ≤ 79 / more), %: v2 56.1 (n 338) / 50.4 (n 330) / 50.3 (n 332); sprint3 44.9 (n 338) / 22.1 (n 330) / 23.5 (n 332).

### noisy × E1 (1000 cases; median 10 present, 2 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ top 100 (terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 33.8 [30.8, 36.6] | 62.3 [59.3, 65.2] | 80.4 [78.0, 82.6] | 86.3 [84.3, 88.3] | 4.0 [3.0, 5.0] | 0.433 [0.406, 0.460] | 0.63 | -0.01 | 0.34 |
| sprint 3 (frozen baseline) | 6.8 [5.2, 8.5] | 30.3 [27.4, 33.4] | 55.6 [52.6, 58.7] | 67.7 [64.9, 70.7] | 38.0 [33.0, 44.0] | 0.144 [0.128, 0.161] | 0.59 | -0.12 | 0.35 |

Paired Δ v2 − sprint 3: Hit@1 26.9 [24.0, 29.7]; Hit@10 32.0 [28.7, 35.2]; Hit@50 24.8 [21.9, 27.8] pp; MRR 0.289 [0.264, 0.313].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 57.0 (n 187) vs 63.5 (n 813); sprint3 42.7 (n 187) vs 27.4 (n 813).
Hit@10 by causal-gene term-count tertile (≤ 35 / ≤ 79 / more), %: v2 65.9 (n 338) / 60.8 (n 330) / 60.0 (n 332); sprint3 44.9 (n 338) / 22.1 (n 330) / 23.5 (n 332).

### noisy × E2 (1000 cases; median 10 present, 3 excluded, 2 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ top 100 (terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 32.9 [29.9, 35.7] | 60.8 [57.7, 63.9] | 79.2 [76.7, 81.5] | 85.3 [83.1, 87.4] | 5.0 [4.0, 6.0] | 0.421 [0.394, 0.447] | 0.63 | -0.01 | 0.34 |
| sprint 3 (frozen baseline) | 6.8 [5.2, 8.5] | 30.3 [27.4, 33.4] | 55.6 [52.6, 58.7] | 67.7 [64.9, 70.7] | 38.0 [33.0, 44.0] | 0.144 [0.128, 0.161] | 0.59 | -0.12 | 0.35 |

Paired Δ v2 − sprint 3: Hit@1 26.0 [23.1, 28.7]; Hit@10 30.5 [27.4, 33.7]; Hit@50 23.6 [20.6, 26.6] pp; MRR 0.276 [0.251, 0.300].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 54.0 (n 187) vs 62.4 (n 813); sprint3 42.7 (n 187) vs 27.4 (n 813).
Hit@10 by causal-gene term-count tertile (≤ 35 / ≤ 79 / more), %: v2 64.6 (n 338) / 59.5 (n 330) / 58.4 (n 332); sprint3 44.9 (n 338) / 22.1 (n 330) / 23.5 (n 332).

Scorer-under-test runtime per case (all genes): median 3.0 ms, p95 4.0 ms (the first case includes the index load).

Run: frozen real-data setting `--options {"tau":1,"correction":"off","exclusionMode":"conflictsOnly"}` (external-tuning.md), DB `hpo_similarity.tau-1.db`; feat/hpo2-bench `81bf9262`. Secondary evidence only.
