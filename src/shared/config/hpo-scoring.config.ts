/**
 * Background correction of S⁺ by the disease's score over random profiles (annotation-breadth
 * bias, spec criterion 3). 'mean': S⁺ ← max(0, (S⁺ − μ)/(1 − μ)), exclusions multiplicative.
 * 'z': z⁺ = (S⁺ − μ)/σ, error-tolerant exclusion LRs subtracted, gene max corrected for its
 * disease count; reported through boundedZ (½ + ½·x/(1 + |x|), x = S/2) in (0, 1), ranks unchanged.
 */
export type HpoBackgroundCorrection = 'off' | 'mean' | 'z'

/** Per-call overrides of the tunable scoring knobs (the benchmark tunes them on training folds). */
export interface HpoScoringOptions {
  correction: HpoBackgroundCorrection
  tau: number
  geneMaxPenalty: number
  lrEpsilon: number
  lambdaZ: number
  excludeMinFrequency: number
  exclusionMode: HpoExclusionMode
}

/** 'conflictsOnly': excluded terms are explained as conflicts but never lower the score. */
export type HpoExclusionMode = 'penalty' | 'conflictsOnly'

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
  /** Background correction mode; 'off' until the pre-registered benchmark passes with another. */
  backgroundCorrection: 'off' as HpoBackgroundCorrection,
  /**
   * τ: forward weight w·IC(p)^τ, so generic noise terms count less. 1 was chosen by all 5 outer
   * folds of the pre-registered real-data tuning (external-tuning.md, 2026-10-14).
   */
  tau: 1,
  /** Null query sizes 1..nullMaxK; larger (effective) profiles use the nullMaxK column. */
  nullMaxK: 20,
  /** Random present-only profiles per query size at DB build (build time ∝ this). */
  nullSamples: 200,
  /** Fixed seed: the same release always builds the same null. */
  nullSeed: 0x5eed,
  /** σ floor = this quantile of σ over all diseases (per size), so sparse diseases cannot inflate z. */
  sigmaFloorQuantile: 0.05,
  /** Absolute σ floor, for when that quantile is 0 (a null that never varies must not divide by 0). */
  sigmaMin: 1e-3,
  /** c: z-mode gene score = max_d z_d − c·√(2 ln n_d); the max of n noisy z grows that way. */
  geneMaxPenalty: 0.5,
  /** ε: z-mode exclusion error rate; caps one excluded term's LR at −ln ε. */
  lrEpsilon: 0.1,
  /** λ_z: z-mode weight of the exclusion load. */
  lambdaZ: 0.5,
  /**
   * Penalise an excluded term only where the disease's point frequency f_d(e) is at least this;
   * above 0, annotations without a recorded frequency never penalise. Real case reports exclude
   * features of the suspected disease itself (differential checklists), so only near-obligate
   * features are safe to penalise.
   */
  excludeMinFrequency: 0,
  /**
   * Whether exclusions lower the score or are only reported as conflicts. Conflicts only: on real
   * case reports no penalty mode beat it (exclusions are mostly features of the true disease);
   * pre-registered real-data tuning, external-tuning.md (2026-10-14).
   */
  exclusionMode: 'conflictsOnly' as HpoExclusionMode,
  /** z mode: load of one disease NOT annotation contradicting a present term, and the load cap. */
  lrCap: Math.log(20),
  /** Case results kept per process, so shortlist paging / re-sorting never rescores. */
  memoisedCases: 8,
  /** A present term counts as "matched" in the explanation from this relative match r(p, d). */
  explainMinMatch: 0.5
} as const
