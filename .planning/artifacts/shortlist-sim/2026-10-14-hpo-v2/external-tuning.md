# HPO phenotype scoring v2: tuning on real cases (phenopacket-store), pre-registered protocol

Status: **pre-registered 2026-10-14, before any tuning run.** Results are appended below this
protocol by `scripts/shortlist-sim/phenotype/tune-external.ts`; the protocol text is not edited
after the first run. Refs #600.

Why: on phenopacket-store the spec-default exclusion penalty costs −36.5 pp Hit@10
(`external-phenopackets.md`), because real excluded terms are mostly features of the true
disease's own spectrum. The simulated E1 arm was optimistic; real data behaves like E2.

## Data and folds

- Cases: phenopacket-store 0.1.27, the same 10,178 single-gene cases as `external-phenopackets.md`
  (observed + excluded terms; phenopackets carry no key flag).
- Folds: cases split **by diagnosed gene** into 5 gene-grouped folds (seeded shuffle of the
  sorted gene list, round-robin; `geneFolds` in `scripts/shortlist-sim/stats/folds.ts`).
- Subsets: **non-cited** (the case's PMID is not cited by phenotype.hpoa for its disease) =
  primary endpoint; **cited** = secondary. Both subsets may be used for training.

## Search (training folds only)

Greedy coordinate search in this order; each step picks among its points merged over the
previous choice:

1. C1 IC-weighted forward: τ ∈ {0, 0.5, 1}.
2. A1 background correction × exclusion mode, jointly (the scorer couples them: `off`/`mean`
   apply exclusions multiplicatively, `z` applies the B1 error-tolerant LR):
   correction ∈ {off, mean, z with c ∈ {0, 0.5, 1}} ×
   exclusion ∈ {penalty, penalty + obligate gate f ≥ 0.8, penalty + gate f ≥ 0.95, conflicts only}.
3. B1 ε ∈ {0.05, 0.1, 0.2, 0.3} × λ_z ∈ {0.25, 0.5, 1} — only when step 2 chose `z`.

keyWeight is not tuned: phenopackets have no key terms, so it cannot change any real-data rank;
it stays at the spec default 2. All other parameters stay at the scorer's config defaults.

**Training objective:** maximise mean Hit@10 (tie-averaged) over all training cases (cited and
non-cited). Ties: the earlier grid point.

## Out-of-fold evaluation

Each fold is scored with the setting chosen on the other four. Comparators on the same cases:
(a) frozen sprint-3 scorer, observed terms; (b) v2 spec defaults, observed terms only;
(b′) the chosen setting with the excluded terms removed (isolates the effect of scoring
exclusions); (t) the chosen setting, observed + excluded. Gene-clustered paired bootstrap, 2,000
replicates, 95 % percentile intervals.

**Primary ship rule (non-cited subset, Hit@10):** (t) − (b) ≥ 0 pp with CI lower bound ≥ −2 pp,
**and** (t) − (a) ≥ +5 pp. If no exclusion mode other than conflicts-only is non-inferior to (b),
the decision is **conflicts only** (exclusions shown as conflicts, not scored).
Secondary: the same on the cited subset and on all cases; (t) − (b′).

## Frozen setting and simulated check

The frozen setting is the greedy choice on **all** real cases (the out-of-fold numbers estimate
this procedure). With it, `gene-ranking.ts` re-runs the simulated benchmark (1,000 diseases,
E0/E1/E2 × clean/moderate/noisy) and reports spec §5 criteria 1–5 as secondary evidence.

---

Run: `tune-external.ts --release 0.1.27` on fix/hpo2-bench `2506e698` (scorer + builder v5 at `f0674af6`), one builder-v5 DB per τ (`build-tau-dbs.ts`); 60 settings scored (the registered greedy needs 23; the rest serve sensitivity (c)). Comparator (b) and every search start are the frozen `ORIGINAL_V2` options (τ 0, penalty, correction off). The first run (`81bf9262`, builder v4) gave the same primary numbers to 0.1 pp.

## Results

### Primary ship rule (non-cited, out-of-fold Hit@10)

| Check | Value (pp) | Threshold | Result |
|---|---|---|---|
| (t) − (b) v2 observed-only | 2.3 [-0.1, 5.5] | ≥ 0, CI lo ≥ −2 | PASS |
| (t) − (a) sprint 3 | 16.0 [7.7, 22.6] | ≥ +5 | PASS |

**Decision: SHIP the chosen setting.** Frozen setting (greedy on all cases): tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0.
No scored exclusion mode beat conflicts-only on the training folds: per protocol, excluded terms are shown as conflicts and not scored.

| Outer fold | chosen on the other four | training Hit@10 % |
|---|---|---|
| 0 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 79.9 |
| 1 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 79.0 |
| 2 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 81.3 |
| 3 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 79.6 |
| 4 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 83.7 |

### non-cited (primary) (2503 cases, 181 genes)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | MRR |
|---|---|---|---|---|
| (a) sprint 3, observed | 13.8 [8.5, 22.0] | 38.9 [26.6, 53.5] | 63.8 [54.6, 75.3] | 0.222 |
| (b) original v2 (τ 0, penalty, correction off), observed | 25.5 [18.4, 35.5] | 52.6 [44.8, 62.9] | 72.1 [64.3, 79.5] | 0.349 |
| (b′) chosen setting, observed | 27.7 [20.2, 37.6] | 54.9 [46.4, 65.3] | 73.6 [65.8, 80.1] | 0.371 |
| (t) chosen setting, observed + excluded | 27.7 [20.2, 37.6] | 54.9 [46.4, 65.3] | 73.6 [65.8, 80.1] | 0.371 |

Paired ΔHit@10 (pp): (t) − (b) 2.3 [-0.1, 5.5]; (t) − (a) 16.0 [7.7, 22.6]; (t) − (b′) 0.0 [0.0, 0.0].

### cited (secondary) (7675 cases, 585 genes)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | MRR |
|---|---|---|---|---|
| (a) sprint 3, observed | 49.2 [44.5, 54.5] | 78.9 [75.6, 82.3] | 91.4 [88.5, 93.7] | 0.594 |
| (b) original v2 (τ 0, penalty, correction off), observed | 65.2 [61.5, 69.1] | 82.7 [79.3, 85.7] | 90.4 [87.5, 92.8] | 0.713 |
| (b′) chosen setting, observed | 72.4 [68.3, 76.5] | 89.1 [86.5, 91.2] | 95.5 [93.8, 96.9] | 0.782 |
| (t) chosen setting, observed + excluded | 72.4 [68.3, 76.5] | 89.1 [86.5, 91.2] | 95.5 [93.8, 96.9] | 0.782 |

Paired ΔHit@10 (pp): (t) − (b) 6.3 [4.5, 8.6]; (t) − (a) 10.2 [6.9, 13.1]; (t) − (b′) 0.0 [0.0, 0.0].

### all cases (10178 cases, 689 genes)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | MRR |
|---|---|---|---|---|
| (a) sprint 3, observed | 40.5 [35.3, 46.5] | 69.1 [62.1, 75.7] | 84.6 [79.6, 89.0] | 0.502 |
| (b) original v2 (τ 0, penalty, correction off), observed | 55.4 [49.8, 61.0] | 75.3 [70.4, 80.0] | 85.9 [82.5, 89.1] | 0.624 |
| (b′) chosen setting, observed | 61.4 [55.5, 67.5] | 80.7 [75.6, 85.4] | 90.1 [87.0, 93.0] | 0.681 |
| (t) chosen setting, observed + excluded | 61.4 [55.5, 67.5] | 80.7 [75.6, 85.4] | 90.1 [87.0, 93.0] | 0.681 |

Paired ΔHit@10 (pp): (t) − (b) 5.4 [3.8, 7.3]; (t) − (a) 11.6 [8.2, 14.8]; (t) − (b′) 0.0 [0.0, 0.0].

Chosen-setting scoring per case (all genes, index in memory): median 3.2 ms, p95 6.3 ms.

### Greedy path on all cases (frozen setting; in-sample, descriptive)

**C1 IC-weighted forward (τ)** (pick: tau = 1, correction = off, exclusionMode = penalty, excludeMinFrequency = 0)

| setting | training Hit@10 % (all cases) |
|---|---|
| tau = 0, correction = off, exclusionMode = penalty, excludeMinFrequency = 0 | 38.8 |
| tau = 0.5, correction = off, exclusionMode = penalty, excludeMinFrequency = 0 | 40.6 |
| tau = 1, correction = off, exclusionMode = penalty, excludeMinFrequency = 0 | 41.9 |

**A1 correction × exclusion mode** (pick: tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0)

| setting | training Hit@10 % (all cases) |
|---|---|
| tau = 1, correction = off, exclusionMode = penalty, excludeMinFrequency = 0 | 41.9 |
| tau = 1, correction = off, exclusionMode = penalty, excludeMinFrequency = 0.8 | 68.8 |
| tau = 1, correction = off, exclusionMode = penalty, excludeMinFrequency = 0.95 | 76.6 |
| tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 80.7 |
| tau = 1, correction = mean, exclusionMode = penalty, excludeMinFrequency = 0 | 47.2 |
| tau = 1, correction = mean, exclusionMode = penalty, excludeMinFrequency = 0.8 | 69.0 |
| tau = 1, correction = mean, exclusionMode = penalty, excludeMinFrequency = 0.95 | 75.6 |
| tau = 1, correction = mean, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 78.4 |
| tau = 1, correction = z, exclusionMode = penalty, excludeMinFrequency = 0, geneMaxPenalty = 0 | 58.8 |
| tau = 1, correction = z, exclusionMode = penalty, excludeMinFrequency = 0.8, geneMaxPenalty = 0 | 64.2 |
| tau = 1, correction = z, exclusionMode = penalty, excludeMinFrequency = 0.95, geneMaxPenalty = 0 | 66.5 |
| tau = 1, correction = z, exclusionMode = conflictsOnly, excludeMinFrequency = 0, geneMaxPenalty = 0 | 67.4 |
| tau = 1, correction = z, exclusionMode = penalty, excludeMinFrequency = 0, geneMaxPenalty = 0.5 | 56.5 |
| tau = 1, correction = z, exclusionMode = penalty, excludeMinFrequency = 0.8, geneMaxPenalty = 0.5 | 62.0 |
| tau = 1, correction = z, exclusionMode = penalty, excludeMinFrequency = 0.95, geneMaxPenalty = 0.5 | 64.2 |
| tau = 1, correction = z, exclusionMode = conflictsOnly, excludeMinFrequency = 0, geneMaxPenalty = 0.5 | 65.2 |
| tau = 1, correction = z, exclusionMode = penalty, excludeMinFrequency = 0, geneMaxPenalty = 1 | 51.6 |
| tau = 1, correction = z, exclusionMode = penalty, excludeMinFrequency = 0.8, geneMaxPenalty = 1 | 57.3 |
| tau = 1, correction = z, exclusionMode = penalty, excludeMinFrequency = 0.95, geneMaxPenalty = 1 | 59.1 |
| tau = 1, correction = z, exclusionMode = conflictsOnly, excludeMinFrequency = 0, geneMaxPenalty = 1 | 60.1 |

## Sensitivity analyses (added after the result; the registered analysis above is unchanged)

(a) cases whose PMID HPOA cites for any disease of the causal gene count as cited; (b) outer
folds group connected gene–disease–publication components (`componentFolds`); (c) τ is
searched jointly with correction × exclusion mode (60 settings) instead of first. Paired
ΔHit@10 in pp, gene-clustered bootstrap (2000 replicates).

| Subset | Scorer | Hit@10 % | Δ vs (b) original v2 | Δ vs (a) sprint 3 |
|---|---|---|---|---|
| non-cited, registered (2503 cases, 181 genes) | shipped defaults (fixed), observed + excluded | 54.9 [46.4, 65.3] | 2.3 [-0.1, 5.5] | 16.0 [7.7, 22.6] |
| non-cited, registered (2503 cases, 181 genes) | (t) chosen setting, observed + excluded | 54.9 [46.4, 65.3] | 2.3 [-0.1, 5.5] | 16.0 [7.7, 22.6] |
| non-cited, registered (2503 cases, 181 genes) | (t) with component + publication folds | 54.9 [46.4, 65.3] | 2.3 [-0.1, 5.5] | 16.0 [7.7, 22.6] |
| non-cited, registered (2503 cases, 181 genes) | (t) with joint τ × correction × exclusion search | 54.9 [46.4, 65.3] | 2.3 [-0.1, 5.5] | 16.0 [7.7, 22.6] |
| (a) non-cited, citations of all diseases of the gene (2465 cases, 178 genes) | shipped defaults (fixed), observed + excluded | 54.6 [46.1, 65.3] | 2.3 [-0.2, 5.5] | 16.0 [7.5, 22.9] |
| (a) non-cited, citations of all diseases of the gene (2465 cases, 178 genes) | (t) chosen setting, observed + excluded | 54.6 [46.1, 65.3] | 2.3 [-0.2, 5.5] | 16.0 [7.5, 22.9] |
| (a) non-cited, citations of all diseases of the gene (2465 cases, 178 genes) | (t) with component + publication folds | 54.6 [46.1, 65.3] | 2.3 [-0.2, 5.5] | 16.0 [7.5, 22.9] |
| (a) non-cited, citations of all diseases of the gene (2465 cases, 178 genes) | (t) with joint τ × correction × exclusion search | 54.6 [46.1, 65.3] | 2.3 [-0.2, 5.5] | 16.0 [7.5, 22.9] |

(b) Component + publication folds (genes per fold 138 / 138 / 138 / 138 / 137):

| Outer fold | chosen on the other four | training Hit@10 % |
|---|---|---|
| 0 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 81.0 |
| 1 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 79.4 |
| 2 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 80.5 |
| 3 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 80.0 |
| 4 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 82.3 |

(c) Joint search, gene folds:

| Outer fold | chosen on the other four | training Hit@10 % |
|---|---|---|
| 0 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 79.9 |
| 1 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 79.0 |
| 2 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 81.3 |
| 3 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 79.6 |
| 4 | tau = 1, correction = off, exclusionMode = conflictsOnly, excludeMinFrequency = 0 | 83.7 |

(c) τ at correction = off, exclusionMode = conflictsOnly, Hit@10 % (in-sample, descriptive):

| τ | all cases | non-cited | (a) non-cited, gene-wide |
|---|---|---|---|
| 0 | 79.4 | 52.6 | 52.4 |
| 0.5 | 80.3 | 54.4 | 54.1 |
| 1 | 80.7 | 54.9 | 54.6 |

