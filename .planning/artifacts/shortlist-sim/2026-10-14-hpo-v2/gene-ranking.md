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
| 1. E1 moderate: ΔHit@10 vs sprint 3 (pp) | 27.9 [24.7, 31.0] | ≥ 3.0, CI lo > 1.0 | PASS |
| 1. E1 noisy: ΔHit@10 vs sprint 3 (pp) | 45.2 [41.8, 48.7] | ≥ 3.0, CI lo > 1.0 | PASS |
| 2. E0 clean: Hit@10 (%) | 96.7 | ≥ 91.4 | PASS |
| 2. E0 moderate: ΔHit@10 vs sprint 3 (pp) | 24.6 [21.6, 27.6] | ≥ -0.5 (point estimate) | PASS |
| 2. E0 noisy: ΔHit@10 vs sprint 3 (pp) | 33.0 [29.6, 36.3] | ≥ -0.5 (point estimate) | PASS |
| 3. ρ(score, gene term count), worst arm × level | 0.65 | ≤ 0.4 | FAIL |
| 4. clean: Hit@50 drop E1 → E2 (pp) | 3.1 [2.0, 4.2] | ≤ 2.0 (point estimate) | FAIL |
| 4. moderate: Hit@50 drop E1 → E2 (pp) | 9.3 [7.5, 11.2] | ≤ 2.0 (point estimate) | FAIL |
| 4. noisy: Hit@50 drop E1 → E2 (pp) | 21.3 [18.8, 23.9] | ≤ 2.0 (point estimate) | FAIL |
| 5. p95 latency per case, all genes (ms) | 4.5 | ≤ 8 | PASS |

**Verdict: NO SHIP.**

## clean

### clean × E0 (1000 cases; median 5 present, 0 excluded, 0 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 79.3 [76.9, 81.6] | 96.7 [95.6, 97.8] | 99.3 [98.7, 99.8] | 99.6 [99.2, 99.9] | 1.0 [1.0, 1.0] | 0.858 [0.841, 0.875] | 0.59 | 0.32 |
| sprint 3 (frozen baseline) | 58.7 [55.7, 61.9] | 88.8 [86.7, 90.7] | 97.9 [97.0, 98.7] | 99.2 [98.6, 99.7] | 1.0 [1.0, 1.0] | 0.691 [0.666, 0.715] | 0.56 | 0.31 |

Paired Δ v2 − sprint 3: Hit@1 20.5 [17.4, 23.6]; Hit@10 8.0 [6.0, 10.0]; Hit@50 1.4 [0.5, 2.4] pp; MRR 0.168 [0.144, 0.190].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 92.9 (n 187) vs 97.6 (n 813); sprint3 97.6 (n 187) vs 86.7 (n 813).

### clean × E1 (1000 cases; median 5 present, 2 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 82.6 [80.4, 84.7] | 97.6 [96.7, 98.5] | 99.4 [98.9, 99.8] | 99.6 [99.2, 99.9] | 1.0 [1.0, 1.0] | 0.884 [0.869, 0.899] | 0.58 | 0.32 |
| sprint 3 (frozen baseline) | 58.7 [55.7, 61.9] | 88.8 [86.7, 90.7] | 97.9 [97.0, 98.7] | 99.2 [98.6, 99.7] | 1.0 [1.0, 1.0] | 0.691 [0.666, 0.715] | 0.56 | 0.31 |

Paired Δ v2 − sprint 3: Hit@1 23.9 [20.7, 26.9]; Hit@10 8.9 [6.9, 11.0]; Hit@50 1.5 [0.6, 2.5] pp; MRR 0.193 [0.170, 0.217].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 94.5 (n 187) vs 98.4 (n 813); sprint3 97.6 (n 187) vs 86.7 (n 813).

### clean × E2 (1000 cases; median 5 present, 3 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 62.7 [59.6, 65.6] | 88.9 [87.0, 90.8] | 96.3 [95.1, 97.4] | 97.8 [96.9, 98.7] | 1.0 [1.0, 1.0] | 0.715 [0.691, 0.737] | 0.58 | 0.33 |
| sprint 3 (frozen baseline) | 58.7 [55.7, 61.9] | 88.8 [86.7, 90.7] | 97.9 [97.0, 98.7] | 99.2 [98.6, 99.7] | 1.0 [1.0, 1.0] | 0.691 [0.666, 0.715] | 0.56 | 0.31 |

Paired Δ v2 − sprint 3: Hit@1 3.9 [0.3, 7.6]; Hit@10 0.2 [-2.2, 2.7]; Hit@50 -1.6 [-3.0, -0.2] pp; MRR 0.024 [-0.003, 0.051].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 86.2 (n 187) vs 89.6 (n 813); sprint3 97.6 (n 187) vs 86.7 (n 813).

## moderate

### moderate × E0 (1000 cases; median 7 present, 0 excluded, 0 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 64.0 [61.2, 66.7] | 89.1 [87.1, 91.0] | 95.1 [93.8, 96.4] | 96.3 [95.1, 97.4] | 1.0 [1.0, 1.0] | 0.730 [0.706, 0.750] | 0.62 | 0.33 |
| sprint 3 (frozen baseline) | 27.7 [24.9, 30.5] | 64.5 [61.6, 67.4] | 85.4 [83.3, 87.5] | 92.9 [91.3, 94.4] | 4.0 [4.0, 5.0] | 0.403 [0.379, 0.428] | 0.58 | 0.33 |

Paired Δ v2 − sprint 3: Hit@1 36.4 [33.1, 39.7]; Hit@10 24.6 [21.6, 27.6]; Hit@50 9.7 [7.4, 12.0] pp; MRR 0.326 [0.299, 0.353].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 81.1 (n 187) vs 91.0 (n 813); sprint3 77.5 (n 187) vs 61.5 (n 813).

### moderate × E1 (1000 cases; median 7 present, 2 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 70.6 [67.9, 73.2] | 92.4 [90.6, 94.0] | 97.8 [96.9, 98.6] | 98.4 [97.5, 99.1] | 1.0 [1.0, 1.0] | 0.790 [0.768, 0.809] | 0.61 | 0.34 |
| sprint 3 (frozen baseline) | 27.7 [24.9, 30.5] | 64.5 [61.6, 67.4] | 85.4 [83.3, 87.5] | 92.9 [91.3, 94.4] | 4.0 [4.0, 5.0] | 0.403 [0.379, 0.428] | 0.58 | 0.33 |

Paired Δ v2 − sprint 3: Hit@1 43.0 [39.7, 46.3]; Hit@10 27.9 [24.7, 31.0]; Hit@50 12.4 [10.3, 14.6] pp; MRR 0.386 [0.359, 0.412].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 87.5 (n 187) vs 93.5 (n 813); sprint3 77.5 (n 187) vs 61.5 (n 813).

### moderate × E2 (1000 cases; median 7 present, 3 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 45.1 [42.0, 48.2] | 74.6 [71.8, 77.1] | 88.5 [86.5, 90.5] | 93.2 [91.6, 94.7] | 2.0 [2.0, 2.0] | 0.548 [0.521, 0.575] | 0.61 | 0.34 |
| sprint 3 (frozen baseline) | 27.7 [24.9, 30.5] | 64.5 [61.6, 67.4] | 85.4 [83.3, 87.5] | 92.9 [91.3, 94.4] | 4.0 [4.0, 5.0] | 0.403 [0.379, 0.428] | 0.58 | 0.33 |

Paired Δ v2 − sprint 3: Hit@1 17.5 [13.9, 21.2]; Hit@10 10.1 [7.0, 13.2]; Hit@50 3.1 [0.6, 5.5] pp; MRR 0.145 [0.115, 0.174].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 71.4 (n 187) vs 75.3 (n 813); sprint3 77.5 (n 187) vs 61.5 (n 813).

## noisy

### noisy × E0 (1000 cases; median 10 present, 0 excluded, 0 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 33.9 [31.0, 36.9] | 63.3 [60.3, 66.1] | 81.9 [79.6, 84.2] | 87.2 [85.0, 89.2] | 4.0 [3.5, 5.0] | 0.435 [0.409, 0.462] | 0.65 | 0.34 |
| sprint 3 (frozen baseline) | 6.8 [5.2, 8.5] | 30.3 [27.4, 33.4] | 55.6 [52.6, 58.7] | 67.7 [64.9, 70.7] | 38.0 [33.0, 44.0] | 0.144 [0.128, 0.161] | 0.59 | 0.35 |

Paired Δ v2 − sprint 3: Hit@1 27.1 [24.1, 30.1]; Hit@10 33.0 [29.6, 36.3]; Hit@50 26.3 [23.1, 29.3] pp; MRR 0.291 [0.265, 0.317].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 57.3 (n 187) vs 64.6 (n 813); sprint3 42.7 (n 187) vs 27.4 (n 813).

### noisy × E1 (1000 cases; median 10 present, 2 excluded, 1 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 46.3 [43.3, 49.3] | 75.5 [73.0, 78.1] | 88.3 [86.4, 90.3] | 92.0 [90.2, 93.6] | 2.0 [1.5, 2.0] | 0.560 [0.533, 0.586] | 0.64 | 0.35 |
| sprint 3 (frozen baseline) | 6.8 [5.2, 8.5] | 30.3 [27.4, 33.4] | 55.6 [52.6, 58.7] | 67.7 [64.9, 70.7] | 38.0 [33.0, 44.0] | 0.144 [0.128, 0.161] | 0.59 | 0.35 |

Paired Δ v2 − sprint 3: Hit@1 39.5 [36.3, 42.6]; Hit@10 45.2 [41.8, 48.7]; Hit@50 32.7 [29.6, 35.8] pp; MRR 0.416 [0.389, 0.442].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 69.2 (n 187) vs 77.0 (n 813); sprint3 42.7 (n 187) vs 27.4 (n 813).

### noisy × E2 (1000 cases; median 10 present, 3 excluded, 2 key)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ρ(score, diseases) |
|---|---|---|---|---|---|---|---|---|
| **v2** (under test) | 22.1 [19.6, 24.7] | 45.0 [41.9, 48.1] | 67.0 [64.1, 70.0] | 76.0 [73.3, 78.7] | 17.0 [13.0, 21.0] | 0.294 [0.270, 0.319] | 0.64 | 0.35 |
| sprint 3 (frozen baseline) | 6.8 [5.2, 8.5] | 30.3 [27.4, 33.4] | 55.6 [52.6, 58.7] | 67.7 [64.9, 70.7] | 38.0 [33.0, 44.0] | 0.144 [0.128, 0.161] | 0.59 | 0.35 |

Paired Δ v2 − sprint 3: Hit@1 15.3 [12.8, 17.9]; Hit@10 14.7 [11.4, 18.2]; Hit@50 11.4 [7.9, 14.9] pp; MRR 0.150 [0.128, 0.174].
Hit@10 single-disease vs pleiotropic (≥ 2 diseases) causal genes, %: v2 41.2 (n 187) vs 45.9 (n 813); sprint3 42.7 (n 187) vs 27.4 (n 813).

Scorer-under-test runtime per case (all genes): median 3.4 ms, p95 4.5 ms (the first case includes the index load).

## Notes (post-hoc, not used for tuning)

E2 Hit@50 drop vs E1 by cause (v2, pp): the false exclusion of a true feature drives it —
clean 4.0 (759 cases with it) vs 0.0 (241 without); moderate 12.3 vs 0.0; noisy 26.7 (false
exclusion only, 556), 30.4 (with a noise key, 202), 4.5 (noise key only, 67), 0.0 (neither, 175).

Run: v2 = feat/hpo-phenotype-v2 `5a03cb74` (`openHpoGeneScorer(terms, HPO_DB)` on the builder-v3
DB); baseline = frozen sprint-3 scorer on `hpo_similarity.sprint3.db` (builder v2).
Reproduce: `npx jiti scripts/shortlist-sim/phenotype/gene-ranking.ts --run <name>` (≈ 15 min).
