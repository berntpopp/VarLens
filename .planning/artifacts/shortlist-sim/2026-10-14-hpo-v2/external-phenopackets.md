# HPO phenotype scoring v2: external benchmark on phenopacket-store (#600)

GA4GH phenopacket-store 0.1.27 (all_phenopackets.zip sha256 `d0c70005bb09b87035087516252b6b539fbc0415be7c664b73c9cde7eedf205a`),
10377 phenopackets; HPO release 2026-09-02. Kept: single-gene diagnoses with ≥ 1
observed HPO term whose gene is in genes_to_phenotype.txt. Dropped: 72 not single-gene or without an observed HPO term; 127 gene not in the scorer's gene map.
Kept 10178 cases, 8843 with ≥ 1 excluded term,
689 genes, 769 diseases. Each diagnosed gene is ranked among all genes; ranks
are tie-averaged; intervals are 95 % percentile bootstrap over genes (2000 replicates),
because phenopacket-store holds many cases per gene and publication.

**Leakage.** HPOA disease annotations are curated partly from the same publications.
7675 of 10178 cases (75.4 %)
come from a PMID that phenotype.hpoa's reference column cites for the case's disease;
their phenotypes may literally be the annotation. The not-cited subset is the cleaner test.

## Reading (hand-written)

- **Present terms only, v2 beats sprint 3** on real published cases: Hit@1 +15 pp, MRR +0.12
  overall; on the non-overlapping subset Hit@10 52.6 % vs 38.9 %.
- **Exclusions hurt, badly, and monotonically with their number.** Adding the curated excluded
  terms drops Hit@10 by 18.5 pp (1–3 excluded) and 49.3 pp (≥ 4) overall, and by 18.9 / 35.2 pp
  on the non-overlapping subset; with ≥ 4 exclusions v2 falls far below sprint 3.
- Mechanism: in ~87 % of cases with exclusions, the causal gene's best disease annotates at least
  one of the excluded terms (median 4). Phenopacket curators record absent features of the
  disease's own spectrum (variable expressivity), so the penalty lands on the true disease, while
  genes whose diseases never mention those organ systems pay nothing.
- The synthetic E1/E2 arms excluded only mimic features (plus one false exclusion in E2) and did
  not model this; E2's Hit@50 drop was the early warning. Real exclusions behave like E2, not E1.
- Leakage: 75.4 % of cases come from a publication HPOA cites for the case's disease. Absolute
  numbers are much higher there; the direction of every effect is the same in both subsets.

## All cases

### all (10178 cases, 689 genes; median 7 observed, 7 excluded)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |
|---|---|---|---|---|---|
| (a) sprint 3, observed | 40.5 [34.5, 46.7] | 69.1 [61.3, 75.7] | 84.6 [79.4, 89.2] | 3.0 [2.0, 4.0] | 0.502 [0.439, 0.563] |
| (b) v2, observed | 55.4 [49.6, 61.1] | 75.3 [70.2, 80.1] | 85.9 [82.6, 89.2] | 1.0 [1.0, 2.0] | 0.624 [0.568, 0.676] |
| (c) v2, observed + excluded | 21.0 [18.5, 23.8] | 38.8 [35.0, 42.8] | 54.6 [49.9, 58.9] | 32.3 [21.0, 51.0] | 0.272 [0.246, 0.301] |

Paired Δ (c) − (b), effect of exclusions: Hit@10 -36.5 [-40.7, -32.1] pp, MRR -0.352 [-0.392, -0.308].
Paired Δ (c) − (a), v2 vs sprint 3: Hit@10 -30.3 [-37.1, -22.4] pp, MRR -0.230 [-0.288, -0.174].
(c) causal gene's best disease annotates ≥ 1 excluded term in 86.9 % of cases with exclusions (median 4 conflicts).

## By leakage

### publication cited by HPOA (overlapping) (7675 cases, 585 genes; median 7 observed, 8 excluded)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |
|---|---|---|---|---|---|
| (a) sprint 3, observed | 49.2 [44.1, 54.5] | 78.9 [75.4, 82.5] | 91.4 [88.6, 93.7] | 2.0 [1.0, 2.0] | 0.594 [0.550, 0.641] |
| (b) v2, observed | 65.2 [61.4, 69.4] | 82.7 [79.5, 85.8] | 90.4 [87.6, 92.8] | 1.0 [1.0, 1.0] | 0.713 [0.679, 0.750] |
| (c) v2, observed + excluded | 24.4 [21.8, 27.5] | 41.4 [37.4, 46.0] | 56.0 [51.5, 60.7] | 27.0 [16.0, 44.0] | 0.303 [0.274, 0.336] |

Paired Δ (c) − (b), effect of exclusions: Hit@10 -41.3 [-45.2, -37.2] pp, MRR -0.411 [-0.440, -0.379].
Paired Δ (c) − (a), v2 vs sprint 3: Hit@10 -37.5 [-42.8, -32.0] pp, MRR -0.291 [-0.343, -0.242].
(c) causal gene's best disease annotates ≥ 1 excluded term in 88.8 % of cases with exclusions (median 4 conflicts).

### publication not cited by HPOA (non-overlapping) (2503 cases, 181 genes; median 7 observed, 4 excluded)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |
|---|---|---|---|---|---|
| (a) sprint 3, observed | 13.8 [8.6, 22.1] | 38.9 [26.4, 53.6] | 63.8 [54.7, 74.8] | 22.0 [8.0, 41.0] | 0.222 [0.152, 0.318] |
| (b) v2, observed | 25.5 [18.2, 36.2] | 52.6 [45.1, 62.9] | 72.1 [64.5, 79.5] | 8.0 [4.0, 15.0] | 0.349 [0.277, 0.455] |
| (c) v2, observed + excluded | 10.7 [8.1, 14.5] | 30.7 [23.1, 38.2] | 50.3 [38.5, 61.4] | 49.0 [25.0, 120.0] | 0.178 [0.138, 0.225] |

Paired Δ (c) − (b), effect of exclusions: Hit@10 -21.9 [-30.6, -13.2] pp, MRR -0.172 [-0.252, -0.102].
Paired Δ (c) − (a), v2 vs sprint 3: Hit@10 -8.2 [-23.8, 7.5] pp, MRR -0.044 [-0.134, 0.034].
(c) causal gene's best disease annotates ≥ 1 excluded term in 79.2 % of cases with exclusions (median 2 conflicts).

## By number of excluded terms

### 0 excluded (1335 cases, 270 genes; median 7 observed, 0 excluded)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |
|---|---|---|---|---|---|
| (a) sprint 3, observed | 27.9 [14.7, 47.9] | 47.3 [26.6, 74.6] | 70.6 [57.9, 88.5] | 13.0 [2.0, 39.0] | 0.357 [0.201, 0.576] |
| (b) v2, observed | 40.4 [25.5, 61.8] | 64.7 [53.1, 81.5] | 82.2 [77.5, 89.9] | 3.0 [1.0, 8.0] | 0.491 [0.351, 0.688] |
| (c) v2, observed + excluded | 40.4 [25.5, 61.8] | 64.7 [53.1, 81.5] | 82.2 [77.5, 89.9] | 3.0 [1.0, 8.0] | 0.491 [0.351, 0.688] |

Paired Δ (c) − (b), effect of exclusions: Hit@10 0.0 [0.0, 0.0] pp, MRR 0.000 [0.000, 0.000].
Paired Δ (c) − (a), v2 vs sprint 3: Hit@10 17.3 [3.4, 26.6] pp, MRR 0.134 [0.073, 0.169].

### 1–3 excluded (2069 cases, 432 genes; median 6 observed, 2 excluded)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |
|---|---|---|---|---|---|
| (a) sprint 3, observed | 38.8 [32.9, 45.3] | 71.3 [64.1, 79.2] | 86.5 [80.8, 91.5] | 2.0 [2.0, 4.0] | 0.502 [0.441, 0.568] |
| (b) v2, observed | 55.3 [49.1, 61.6] | 75.0 [69.2, 80.8] | 86.5 [80.8, 91.4] | 1.0 [1.0, 2.0] | 0.624 [0.566, 0.683] |
| (c) v2, observed + excluded | 32.8 [27.5, 39.3] | 56.5 [49.0, 64.3] | 71.7 [63.8, 79.1] | 5.0 [3.0, 12.0] | 0.411 [0.353, 0.475] |

Paired Δ (c) − (b), effect of exclusions: Hit@10 -18.5 [-22.3, -14.2] pp, MRR -0.213 [-0.247, -0.177].
Paired Δ (c) − (a), v2 vs sprint 3: Hit@10 -14.8 [-21.5, -8.9] pp, MRR -0.091 [-0.138, -0.046].
(c) causal gene's best disease annotates ≥ 1 excluded term in 73.9 % of cases with exclusions (median 1 conflicts).

### ≥ 4 excluded (6774 cases, 486 genes; median 8 observed, 11 excluded)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |
|---|---|---|---|---|---|
| (a) sprint 3, observed | 43.5 [37.9, 49.2] | 72.7 [68.4, 77.0] | 86.8 [82.8, 90.4] | 2.0 [2.0, 3.0] | 0.531 [0.481, 0.583] |
| (b) v2, observed | 58.5 [53.8, 63.4] | 77.5 [72.9, 81.5] | 86.4 [82.5, 89.7] | 1.0 [1.0, 1.0] | 0.650 [0.605, 0.695] |
| (c) v2, observed + excluded | 13.6 [11.3, 16.0] | 28.3 [23.4, 33.5] | 43.9 [38.1, 49.7] | 82.0 [51.0, 129.5] | 0.186 [0.158, 0.216] |

Paired Δ (c) − (b), effect of exclusions: Hit@10 -49.3 [-53.5, -44.6] pp, MRR -0.464 [-0.499, -0.428].
Paired Δ (c) − (a), v2 vs sprint 3: Hit@10 -44.4 [-50.5, -37.8] pp, MRR -0.345 [-0.405, -0.286].
(c) causal gene's best disease annotates ≥ 1 excluded term in 90.8 % of cases with exclusions (median 5 conflicts).

## By number of excluded terms, non-overlapping subset

### 0 excluded (698 cases, 71 genes; median 7 observed, 0 excluded)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |
|---|---|---|---|---|---|
| (a) sprint 3, observed | 6.6 [2.1, 27.1] | 17.3 [9.2, 52.3] | 50.1 [45.0, 72.5] | 50.0 [8.0, 57.0] | 0.111 [0.057, 0.350] |
| (b) v2, observed | 15.0 [10.8, 34.8] | 44.2 [38.7, 62.0] | 71.6 [53.7, 77.4] | 15.0 [3.0, 29.0] | 0.254 [0.212, 0.442] |
| (c) v2, observed + excluded | 15.0 [10.8, 34.8] | 44.2 [38.7, 62.0] | 71.6 [53.7, 77.4] | 15.0 [3.0, 29.0] | 0.254 [0.212, 0.442] |

Paired Δ (c) − (b), effect of exclusions: Hit@10 0.0 [0.0, 0.0] pp, MRR 0.000 [0.000, 0.000].
Paired Δ (c) − (a), v2 vs sprint 3: Hit@10 26.9 [0.8, 33.0] pp, MRR 0.143 [-0.001, 0.174].

### 1–3 excluded (547 cases, 108 genes; median 7 observed, 2 excluded)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |
|---|---|---|---|---|---|
| (a) sprint 3, observed | 13.4 [8.5, 22.6] | 46.8 [35.7, 63.5] | 69.5 [54.5, 82.7] | 12.0 [4.0, 29.0] | 0.246 [0.180, 0.365] |
| (b) v2, observed | 27.9 [18.0, 38.7] | 56.0 [42.8, 71.0] | 69.8 [54.2, 84.7] | 6.0 [3.0, 29.5] | 0.376 [0.273, 0.493] |
| (c) v2, observed + excluded | 13.8 [8.3, 21.5] | 37.1 [23.9, 56.4] | 52.2 [36.7, 72.3] | 42.0 [6.5, 176.3] | 0.214 [0.139, 0.319] |

Paired Δ (c) − (b), effect of exclusions: Hit@10 -18.9 [-27.4, -7.4] pp, MRR -0.163 [-0.227, -0.077].
Paired Δ (c) − (a), v2 vs sprint 3: Hit@10 -9.7 [-18.9, -1.4] pp, MRR -0.033 [-0.102, 0.034].
(c) causal gene's best disease annotates ≥ 1 excluded term in 61.6 % of cases with exclusions (median 1 conflicts).

### ≥ 4 excluded (1258 cases, 85 genes; median 7 observed, 11 excluded)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |
|---|---|---|---|---|---|
| (a) sprint 3, observed | 18.0 [11.8, 26.2] | 47.4 [36.4, 57.8] | 69.0 [58.1, 78.4] | 13.0 [6.0, 27.0] | 0.272 [0.203, 0.356] |
| (b) v2, observed | 30.4 [20.1, 42.3] | 55.7 [44.9, 67.3] | 73.5 [64.0, 82.8] | 7.0 [2.0, 16.0] | 0.391 [0.290, 0.509] |
| (c) v2, observed + excluded | 6.9 [4.1, 11.1] | 20.4 [12.8, 29.4] | 37.7 [27.6, 49.0] | 114.0 [54.0, 220.0] | 0.120 [0.076, 0.175] |

Paired Δ (c) − (b), effect of exclusions: Hit@10 -35.2 [-41.7, -28.4] pp, MRR -0.271 [-0.345, -0.201].
Paired Δ (c) − (a), v2 vs sprint 3: Hit@10 -26.9 [-34.2, -18.5] pp, MRR -0.152 [-0.214, -0.102].
(c) causal gene's best disease annotates ≥ 1 excluded term in 86.8 % of cases with exclusions (median 3 conflicts).
