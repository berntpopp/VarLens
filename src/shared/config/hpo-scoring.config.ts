/**
 * Phenotype scoring v2 constants (spec §3, `.planning/specs/2026-10-14-hpo-phenotype-scoring-v2.md`).
 * Tuned on training folds only; frozen before the test folds are read.
 */
export const HPO_SCORING_CONFIG = {
  /** α_f: share of a forward match that depends on the annotation frequency (rare features still count). */
  alphaF: 0.25,
  /** f₀: reverse-score shrinkage prior, so a 1-term disease cannot reach 1 on a single match. */
  f0: 1.0,
  /** γ: forward (patient → disease) weight in S⁺; the rest is the reverse average. */
  gamma: 0.55,
  /** λ: exclusion penalty strength, S = S⁺·exp(−λ·load). */
  lambda: 0.45,
  /** E_max: load cap, so a few wrong exclusions cannot zero a strong match. */
  eMax: 2.5,
  /** Weight of a key (leading) present term; bounded so one mis-coded term cannot dominate. */
  keyWeight: 2,
  /** Pseudo-counts of fractions m/n: f = (m + a)/(n + a + b); `1/1` → 0.6, not 1. */
  fractionPrior: { a: 0.8, b: 1.2 },
  /** f_excl of a fraction: this quantile of Beta(m + a, n − m + b), a conservative lower bound. */
  exclusionQuantile: 0.1,
  /** HPO frequency terms: f = bracket midpoint; f_excl = near the lower edge (penalty only for proven penetrance). */
  frequencyTerms: {
    'HP:0040280': { f: 1.0, fExcl: 0.95 },
    'HP:0040281': { f: 0.895, fExcl: 0.8 },
    'HP:0040282': { f: 0.545, fExcl: 0.3 },
    'HP:0040283': { f: 0.17, fExcl: 0.05 },
    'HP:0040284': { f: 0.025, fExcl: 0.01 }
  } as Record<string, { f: number; fExcl: number }>,
  /** No frequency: the empirical mean of quantified annotations; weak exclusion penalty. */
  missing: { f: 0.35, fExcl: 0.15 },
  /** Case results kept per process, so shortlist paging / re-sorting never rescores. */
  memoisedCases: 8,
  /** A present term counts as "matched" in the explanation from this relative match r(p, d). */
  explainMinMatch: 0.5
} as const
