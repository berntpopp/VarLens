# HPO phenotype scoring v2: excluded terms, key terms, frequencies, disease level

Status: approved for implementation 2026-10-14. Branch `feat/hpo-phenotype-v2`, based on `feat/sprint-3` (PR #632).
Refs #600. Research:
- `.planning/docs/hpo-phenotype-v2/research-sota.md` (literature, with source-code checks)
- `.planning/docs/hpo-phenotype-v2/research-ux.md`
- `.planning/docs/hpo-phenotype-v2/brainstorm-agy-argon.md` (independent design brainstorm)

## 1. Problem

The sprint-3 `hpo_resnik` score handles only observed terms:

- A case cannot record "examined and absent", for example "no microcephaly on measurement".
- Not assessed and absent cannot be told apart.
- All patient terms weigh the same.
- Annotation frequencies are ignored, except that `0/n` rows are dropped.
- Genes are scored against the union of all their diseases.

On public data (`.planning/artifacts/shortlist-sim/2026-10-14-resnik/gene-ranking.md`), Hit@10 is 88.8 / 64.5 / 30.3 % for clean, moderate and noisy profiles. The exact-overlap baseline reaches 95.0 / 65.5 / 42.6 %. The score correlates with annotation breadth: ρ(score, gene term count) is 0.56–0.59.

## 2. Data model (Phenopackets semantics)

`case_hpo_terms` gains two columns: SQLite v58, PostgreSQL 0041.

- `excluded INTEGER/BOOLEAN NOT NULL DEFAULT 0`: the feature was looked for and found absent (Phenopackets `excluded: true`).
- `key INTEGER/BOOLEAN NOT NULL DEFAULT 0`: the leading finding, the main reason for testing.
- A term that is not listed counts as **not assessed**, so no third state is stored.
- An excluded term can never be key; the repository enforces this.
- Existing rows become present and not key.

Shared type: `CaseHpoTerm { hpo_id, hpo_label, excluded: boolean, key: boolean, … }`.

IPC: extend `caseMetadata.assignHpoTerm(caseId, hpoId, hpoLabel, flags?)` with optional `{ excluded?, key? }`. This is an upsert, so changing a term's status reuses the same channel. It is the smallest change: no new channel, and the parity manifest entry is unchanged.

Consumers outside the scorer:
- The case-list HPO filter and the overview "top phenotypes" count **present** terms only.
- `getDistinctHpoTerms` returns present terms with a deterministic label on both backends (`MIN(hpo_label)`).

## 3. Scorer (disease level, bounded in [0, 1])

Notation:
- P⁺ = present patient terms with weight w (key: `keyWeight`, default 2; others 1).
- P⁻ = excluded terms.
- Only terms in the HP:0000118 subtree count; aliases are mapped to current terms.
- sim(a, b) = IC(MICA(a, b)).
- T_d = the positive annotations of disease d, with frequency f(d, t).

Preprocessing:
1. Drop every excluded term that equals, or is an ancestor of, a present term. A present observation overrides an excluded ancestor.
2. Drop present terms that are ancestors of other present terms. The descendant keeps the higher weight.

Per disease d:
- **Forward, normalised:** r(p, d) = maxₜ sim(p, t)·(1 − α_f + α_f·f(d, t)) / IC(p), in [0, 1]. Fwd(d) = Σ w_p·r(p, d) / Σ w_p.
  - Normalising by IC(p) avoids the key-term dilution trap: a broad key term no longer loses weight to its low IC. Fwd(d) is still a weighted average, so marking p key raises S(d) when r(p, d) exceeds Fwd(d) and lowers it when r(p, d) is below (a weaker or lower-frequency match than the disease's other matches). This is intended: a key term the disease explains poorly should count against it. Example at τ = 1 (review 2026-10-14): broad term IC 1 at f 0.35, specific term IC 4 at f 1, both matched exactly; marking the broad term key lowers S(d) from 0.790636 to 0.778719.
- **Reverse, frequency-weighted with shrinkage:** Rev(d) = Σₜ f(d, t)·(maxₚ sim(p, t) / IC(t)) / (f₀ + Σₜ f(d, t)).
- S⁺(d) = γ·Fwd(d) + (1 − γ)·Rev(d).
- **Exclusion load:**
  - For each excluded term e, c(e, d) = max f_excl(d, t) over the disease terms t that are e or one of its descendants. Siblings reached only through a shared ancestor never count.
  - The load is the maximum c per top-level organ system (each child of HP:0000118), summed over systems. This avoids double-counting correlated exclusions.
  - A disease `NOT` annotation that is an ancestor of, or equal to, a present term adds 1 to the load: the disease explicitly lacks that feature.
  - Load(d) = min(E_max, that sum).
- S(d) = S⁺(d)·exp(−λ·Load(d)).
- Gene score: S(g) = max over the gene's diseases of S(d). The best disease d*(g) is kept for the explanation.

Frequencies, parsed at build time from `phenotype.hpoa`:
- **Fractions m/n:** f = (m + 0.8)/(n + 2), so `1/1` becomes 0.6. Several rows for the same pair are pooled.
- **HPO frequency terms:**

  | Term | f | f_excl |
  |---|---|---|
  | HP:0040280 | 1.0 | 0.95 |
  | HP:0040281 | 0.895 | 0.80 |
  | HP:0040282 | 0.545 | 0.30 |
  | HP:0040283 | 0.17 | 0.05 |
  | HP:0040284 | 0.025 | 0.01 |

- **Percentages:** taken as given.
- **Missing:** f = 0.35, f_excl = 0.15. This is the empirical mean of quantified annotations; only proven high-penetrance features can trigger a strong exclusion penalty.
- **Fractions, f_excl:** a conservative lower bound, the Beta(m + 0.8, n − m + 1.2) 10th percentile. A close approximation is allowed if it is documented and tested.

Defaults, all in typed config `src/shared/config/hpo-scoring.config.ts`:

| Parameter | Default |
|---|---|
| α_f | 0.25 |
| f₀ | 1.0 |
| γ | 0.55 |
| λ | 0.45 |
| E_max | 2.5 |
| keyWeight | 2 |

Every parameter is tuned on training folds only and frozen before the test folds are read.

Output per case:
- the score for every gene, in [0, 1];
- the best disease per gene;
- `explain(gene)`: the best disease (id and label), matched pairs (patient term, disease term, key flag, frequency), and conflicts (excluded term, contradicted disease term, frequency).
- The case percentile of each gene's score is computed in the same pass and shown in the explanation. It is not a probability, and no probability language is used anywhere.

Performance (single-pass DP over typed arrays, as in sprint 3):
- Present terms: k⁺ forward passes plus one union pass.
- Exclusions: one bitmask pass marks the descendants of all excluded terms (up to 32 per pass).
- Then one scan over the disease CSR.
- Budget: p95 ≤ 8 ms per case for all genes at 20 terms; index load ≤ 400 ms.
- Explanations are computed lazily, only for the rows displayed.

Field names:
- `hpo_resnik` keeps its name and becomes S(g). The label reads "HPO phenotype match (raw, uncalibrated)".
- New fields: `hpo_best_disease` (text) and `hpo_conflicts` (count).
- The HPO DB builder version is bumped, so existing installs rebuild.

Non-goals for v1:
- Onset- and sex-dependent annotations: noted as a follow-up, and the cap bounds the damage meanwhile.
- A correlation novelty weight between siblings, unless the benchmark shows the need.

## 4. UI (dense, existing components)

- **`HpoTermSelector.vue`:**
  - Present and Excluded rows.
  - Excluded chips are tonal error colour with a minus-circle icon, a visible "no " prefix and strikethrough, so colour is never the only cue.
  - Key chips show a star and bold text.
  - Chip menu: present / excluded / key / remove.
  - Keyboard: Enter adds as present; Shift+Enter adds as excluded; on a focused chip, `x` toggles excluded, `k` toggles key, and Delete removes it. The placeholder lists these shortcuts.
  - Focus returns to the input after each change.
  - Optimistic updates roll back and show a snackbar on failure.
- **`ProbandContextBanner.vue`:** key terms first, then present, then excluded. The overflow tooltip groups terms by state, and every chip has an aria label.
- **`RankScoreTooltip.vue`:**
  - A phenotype block: best disease; "✓ matched: ★ epilepsy · hypotonia"; "⊖ conflicts: microcephaly excluded (80 % in Dravet)"; at most 3 items per line, then "+N".
  - The score cell becomes focusable so keyboard users can open the tooltip.
- **Empty states:**
  - A case with only excluded terms shows "phenotype score inactive".
  - The HPO-data-missing hint (`RankingHpoHint.vue`) also covers excluded terms.
- The case-view and cohort features that list phenotypes use present terms only.

## 5. Benchmark (pre-registered)

Extend `scripts/shortlist-sim/phenotype/`, using the public gene ranking on 1,000 sampled diseases with the same seed as the sprint-3 run.

- **Folds:** 5 gene-grouped folds over connected gene–disease components.
- **Strata:** clean, moderate and noisy profiles, crossed with:
  - E0: no exclusions, no keys. This is the regression arm.
  - E1: realistic exclusions. Two or three frequent features (f ≥ 0.7) of the 10 most similar mimic diseases, absent from the true disease's ancestor closure. One or two key terms: the true terms with the highest f·IC.
  - E2: E1 plus adversarial errors. One true frequent feature is excluded (f 0.5–0.9), and in 25 % of cases a noise term is marked key.
- **Metrics:** Hit@1/10/50/100, median rank and MRR, with disease-clustered bootstrap CIs and paired Δ against the sprint-3 scorer. Also ρ(score, gene term count) and ρ(score, gene disease count), Hit@10 for single-disease vs pleiotropic genes, and latency.
- **Ship criteria (all must hold):**
  1. In E1 on moderate and noisy profiles, Hit@10 rises by at least 3.0 pp over sprint 3, with the CI lower bound above 1.0 pp.
  2. In E0, clean-profile Hit@10 is no lower than the sprint-3 run's 92.4 % one-sided result minus 1 pp. Moderate and noisy are non-inferior: Δ ≥ −0.5 pp.
  3. ρ(score, gene term count) ≤ 0.40.
  4. In E2, Hit@50 drops by at most 2.0 pp relative to E1.
  5. p95 latency is at most 8 ms per case.
- **Variant level:** when the private backgrounds are mounted, the same arms run through the shortlist simulation. The ClinVar-visible safety check must not degrade.

## 6. Lanes and contracts

The contracts are committed first on the batch branch:
- `CaseHpoTerm` with `excluded` and `key`;
- `HpoProfileTerm = { hpoId, excluded, key }`;
- the scorer API: `openHpoGeneScorer(terms: HpoProfileTerm[])` returning `{ score(gene), bestDisease(gene), explain(gene) }`;
- `HpoExplanation`;
- `rank_hpo` on shortlist rows.

| Lane | Owns |
|---|---|
| data | Migrations v58/0041, both metadata repos and executors, Zod schemas, handlers, preload, web auto-route, case-list filter, overview queries, mock API data shape |
| scorer | `hpo-sources.ts`, `resnik.ts` (or a new `phenotype-score.ts`), `hpo-similarity-db.ts`, `hpo-scoring.config.ts`, `case-context.ts` HPO part, `shortlist-evidence.ts`, `rank-page.ts`, DSL registry entries, phenotype tests |
| ui | `HpoTermSelector.vue`, `CaseMetadataCard.vue`, `useCaseMetadata.ts`, `ProbandContextBanner.vue`, `RankScoreTooltip.vue`, `ShortlistTable.vue` (props), `RankingHpoHint.vue`, renderer tests |
| bench | `scripts/shortlist-sim/phenotype/**` and its tests, the report under `.planning/artifacts/shortlist-sim/2026-10-14-hpo-v2/` |

Reviews: a ponytail review per lane, then Codex (GPT-6 Astra) and agy (Gemini 4 Argon High) on the merged scorer.

## 7. Outcome (2026-10-14)

- First full simulated run with spec defaults: criteria 1, 2 and 5 passed; 3 and 4 failed (`gene-ranking.md`).
- External real-patient benchmark (phenopacket-store 0.1.27, 10,178 cases; `external-phenopackets.md`): the exclusion penalty cut Hit@10 from 75.3 % to 38.8 %. In about 87 % of cases with exclusions, the true disease is annotated with at least one excluded term, because authors record absent features of the suspected disease. The simulated E1 arm modelled exclusions as features of mimic diseases, so it was too optimistic.
- Pre-registered real-data tuning (`external-tuning.md`, protocol committed before any run; rerun on builder v5, identical to 0.1 pp): all 5 outer folds chose **τ = 1, background correction off, exclusions = conflicts only**.
  - Non-cited out-of-fold Hit@10: +2.3 pp [−0.1, 5.5] vs original v2 (τ 0, penalty, correction off; frozen as `ORIGINAL_V2`, present terms only) and +16.0 pp [7.7, 22.6] vs sprint 3. The registered rule passes. The gain over original v2 supports **non-inferiority, not superiority** (the CI includes 0). The gain over sprint 3 is the strong result.
  - The protocol was registered after the baseline results on the same cohort had been seen, so this is not an untouched validation set.
- Sensitivity analyses added after the result (registered analysis unchanged; `external-tuning.md`, "Sensitivity analyses"):
  - (a) Counting a case as cited when HPOA cites its PMID for *any* disease of the causal gene (38 cases move): shipped vs original v2 +2.3 pp [−0.2, 5.5], vs sprint 3 +16.0 pp [7.5, 22.9] (2,465 cases).
  - (b) Outer folds grouped by connected gene–disease–publication component: every fold still chose the shipped setting; the out-of-fold numbers are unchanged.
  - (c) τ searched jointly with correction × exclusion mode (60 settings): every fold still chose τ = 1. With correction off and conflicts only, non-cited Hit@10 is 52.6 / 54.4 / 54.9 % for τ = 0 / 0.5 / 1 (in-sample).
- **τ trade-off.** On the simulated benchmark τ = 1 hurts noisy profiles. E0 ΔHit@10, shipped minus original v2 (paired, disease-clustered; builder-v5 rerun, identical to Codex's review table): clean +0.71 pp [0.20, 1.32], moderate −1.62 pp [−2.96, −0.26], noisy −10.94 pp [−13.31, −8.72]. Noisy E0 Hit@10 is 63.3 % at τ = 0 (Codex's separate isolated check: 63.7 %) and 52.3 % at τ = 1. E0 has no exclusions, so this loss is due to τ alone. Real case reports favoured τ = 1; the simulated noise model does not. This is a known risk of the shipped default, not evidence of overfitting.
- Frozen setting on the simulated criteria (`gene-ranking-frozen.md`): 1, 2, 4 and 5 pass. **Criterion 3 FAILED** (ρ = 0.63 over all genes, threshold ≤ 0.4) and stays failed. Shipping despite it is an **explicit post-result acceptance waiver**, granted after the result was known, not a pass.
  - Diagnostics only, they do not satisfy the gate: over the top 100 genes ρ is −0.01, but selecting the top 100 by score restricts the score range and cannot show whether annotation breadth helped genes into that group; noisy E0 Hit@10 by causal-gene term-count tertile is 56.1 / 50.4 / 50.3 %, with no equivalence margin defined in advance.
  - Proposed replacement for future work (register before running, on a new disease sample with a new seed): **breadth equivalence**: in every arm × level, Hit@10 of the highest minus the lowest causal-gene term-count tertile, and of pleiotropic minus single-disease causal genes, has a 95 % disease-clustered bootstrap CI inside ±5 pp.
- Shipped defaults are in `src/shared/config/hpo-scoring.config.ts`. The penalty and correction modes stay implemented and tested behind config for future evidence.
- Excluded terms are still recorded and shown in the UI, and conflicts appear in the score explanation; they do not change the score.
