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
