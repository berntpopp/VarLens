/**
 * Single source of truth for every tunable constant used by the Shortlist
 * scoring heuristic. Every magic number that used to be inlined across
 * `score-snv.ts`, `score-sv.ts`, `score-cnv.ts`, `score-str.ts`, and the
 * shared `index.ts` mappings now lives here.
 *
 * Why a standalone config module:
 *
 *   • A single `grep` finds every knob.
 *   • A tuning PR touches one file, not five.
 *   • Tests can import the same constants to avoid drift between test
 *     fixtures and production code.
 *   • Rationale comments stay attached to the constant they justify.
 *
 * Structure:
 *
 *   SCORING_CONFIG
 *     ├── consequenceImpact     — VEP IMPACT → impact sub-score
 *     ├── clinvarBoost          — ClinVar significance → clinvar sub-score
 *     ├── snv                   — SNV / indel thresholds + curve params
 *     ├── sv                    — SV thresholds + precision factors
 *     ├── cnv                   — CNV copy-number branching + quality norm
 *     ├── str                   — STR status + known-locus scoring
 *     └── defaults              — cross-type null fallbacks
 *
 * Complete reference documentation for the heuristic lives in
 * `.planning/docs/shortlist-scoring-heuristic.md`.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§4)
 */

export const SCORING_CONFIG = {
  // ───────────────────────────────────────────────────────────────
  // Shared lookup tables
  // ───────────────────────────────────────────────────────────────

  /**
   * VEP IMPACT classification → `impact` sub-score in [0, 1].
   *
   * Ordered by severity. The 0.66 step for MODERATE matches the two-thirds
   * convention used by tools like Exomiser / LIRICAL for missense impact;
   * the 0.33 for LOW preserves a small positive contribution for
   * synonymous-splice-adjacent calls without letting them compete with
   * HIGH variants. MODIFIER (e.g. intronic, intergenic) contributes
   * nothing unless another term boosts the row.
   */
  consequenceImpact: {
    HIGH: 1.0,
    MODERATE: 0.66,
    LOW: 0.33,
    MODIFIER: 0.0
  } as Readonly<Record<string, number>>,

  /**
   * ClinVar clinical significance string → `clinvar` sub-score boost in
   * [0, 1]. String keys match the values VarLens ingests from ClinVar
   * (both the standalone vocabulary and the `/`-separated combined form).
   *
   * The 0.9 for Likely_pathogenic (vs 1.0 for Pathogenic) is deliberately
   * small — the interpretive difference between P and LP is narrower than
   * the UI distance suggests, and clinvarPinTop treats anything ≥ 0.9 as
   * "pinned to top" which preserves the P/LP equivalence where it matters.
   *
   * Uncertain_significance (VUS) gets a small positive boost so VUS rows
   * rank above no-ClinVar rows when all other components tie.
   */
  clinvarBoost: {
    Pathogenic: 1.0,
    'Pathogenic/Likely_pathogenic': 0.95,
    Likely_pathogenic: 0.9,
    Uncertain_significance: 0.3,
    Likely_benign: 0,
    Benign: 0
  } as Readonly<Record<string, number>>,

  // ───────────────────────────────────────────────────────────────
  // SNV / indel
  // ───────────────────────────────────────────────────────────────

  snv: {
    /**
     * CADD score at which `pathogenicity` saturates at 1.0. Rentzsch et
     * al. (2019) cite CADD ≥ 20 as "top 1% deleterious" and CADD ≥ 30 as
     * "top 0.1%"; 40 is the commonly cited high-confidence damaging
     * ceiling beyond which additional points stop separating candidates.
     * The curve is linear from 0..40 and then clamps.
     */
    caddSaturationCeiling: 40,

    /**
     * gnomAD allele frequency at or above which `rarity` drops to 0.
     * 1% is the standard clinical rarity cutoff for Mendelian variant
     * triage (ACMG BA1/BS1 thresholds sit at 5% / 1% respectively; we
     * use the stricter of the two). Between 0 and this cutoff, rarity
     * scales linearly toward 1.0 at AF=0.
     */
    rarityUpperCutoffAf: 0.01,

    /**
     * Rarity fallback when `gnomad_af` is null — assume rare until
     * proven otherwise. This matches the "absence of evidence ≠ evidence
     * of absence" convention: a novel variant that gnomAD hasn't seen
     * should surface at the top of the shortlist, not be penalised.
     */
    nullRarityDefault: 1.0
  },

  // ───────────────────────────────────────────────────────────────
  // SV
  // ───────────────────────────────────────────────────────────────

  sv: {
    /**
     * VAF multiplier applied when `sv_is_precise === 1`. Precise
     * breakpoints → full trust in the reported VAF.
     */
    precisePathogenicityFactor: 1.0,

    /**
     * VAF multiplier applied when the SV breakpoint is imprecise (or
     * `sv_is_precise` is null/undefined). Imprecise calls are penalised
     * 30% because confidence in the breakpoint — and therefore the
     * called VAF — is lower.
     */
    imprecisePathogenicityFactor: 0.7,

    /**
     * SV length (bp) at or above which `impact` is elevated to the
     * large-event bucket. 1 kb is the conventional cutoff at which an
     * SV stops looking like an indel and starts looking like a
     * gene-disrupting event (exon-scale disruption).
     */
    largeEventLengthThresholdBp: 1000,

    /**
     * `impact` score for SVs at or above `largeEventLengthThresholdBp`.
     * Top-tier because a ≥ 1 kb event is structurally disruptive.
     */
    largeEventImpact: 1.0,

    /**
     * `impact` score for SVs below the large-event threshold OR with
     * unknown length. Small events still score meaningfully but don't
     * compete with large ones. Unknown length falls here on purpose —
     * an un-sized call is not a confident large-event signal.
     */
    smallEventImpact: 0.66,

    /**
     * VAF fallback when `sv_vaf` is null — 0.5 is intentionally
     * middling. We have neither low nor high confidence the allele is
     * real at clinically-relevant dosage, so we score neither top nor
     * bottom and let other components break the tie.
     */
    nullVafDefault: 0.5,

    /**
     * `rarity` placeholder until a gnomAD-SV (or equivalent) population
     * frequency source is wired into Stage 1. With no frequency data,
     * we cannot penalise common SVs, so every SV gets full rarity
     * credit. Documented in the spec as a Phase-1 limitation.
     */
    rarityPlaceholder: 1.0
  },

  // ───────────────────────────────────────────────────────────────
  // CNV
  // ───────────────────────────────────────────────────────────────

  cnv: {
    /**
     * Copy number ≤ this cutoff → homozygous-deletion bucket (highest
     * impact). The ≤ comparison catches `0` and any future caller that
     * reports negative numbers for complete loss.
     */
    homozygousDeletionCnCutoff: 0,

    /**
     * Copy number that signals a heterozygous deletion in the
     * "partial loss" bucket.
     */
    heterozygousDeletionCn: 1,

    /**
     * Copy number at or above this cutoff → duplication / gain bucket.
     * Diploid (CN=2) is excluded from the loss AND gain buckets.
     */
    duplicationCnCutoff: 3,

    /**
     * `impact` score for homozygous deletion (CN ≤
     * `homozygousDeletionCnCutoff`). Full loss of both alleles is the
     * clearest loss-of-function signal CNV data can provide.
     */
    homozygousDeletionImpact: 1.0,

    /**
     * `impact` score for heterozygous deletion (CN === 1) or any
     * duplication (CN ≥ `duplicationCnCutoff`). Partial loss and gain
     * events both matter clinically but don't carry the same weight as
     * full bi-allelic loss.
     */
    partialLossOrGainImpact: 0.66,

    /**
     * `impact` score for neutral diploid (CN === 2) OR unknown CN
     * (`cnv_copy_number == null`). A neutral call contributes nothing;
     * unknown is treated as neutral on purpose (caller didn't produce a
     * usable number).
     */
    neutralOrUnknownImpact: 0,

    /**
     * Copy-number quality score at which `pathogenicity` saturates at
     * 1.0. Most CNV callers report quality on a ~0-100 phred-like scale
     * so 100 is the natural ceiling; higher values clamp down to 1.0.
     */
    qualitySaturationCeiling: 100,

    /**
     * `rarity` placeholder until a per-event CNV frequency source is
     * wired. Same rationale as `sv.rarityPlaceholder`.
     */
    rarityPlaceholder: 1.0
  },

  // ───────────────────────────────────────────────────────────────
  // STR
  // ───────────────────────────────────────────────────────────────

  str: {
    /**
     * `impact` when an allele's Stranger `str_status` is `full_mutation`. The caller has
     * already determined the expansion exceeds the pathologic threshold
     * for the locus — this is the strongest signal STR data provides.
     */
    pathologicImpact: 1.0,

    /**
     * `impact` when an allele's Stranger `str_status` is `pre_mutation`. Premutation-range
     * or borderline expansions — meaningful but not definitively
     * pathologic.
     */
    intermediateImpact: 0.66,

    /**
     * `impact` for 'normal' status, empty status, or unknown status.
     */
    normalOrUnknownImpact: 0,

    /**
     * `pathogenicity` credit for an STR in a known disease locus
     * (non-empty `str_disease`). Full credit because pathologic /
     * intermediate expansions at Mendelian loci are effectively always
     * clinically relevant.
     */
    knownLocusPathogenicity: 1.0,

    /**
     * `pathogenicity` credit for an STR expansion at an unknown or
     * novel locus. Partial credit — we detected the expansion but the
     * clinical significance is unclear without a known gene/disease
     * link.
     */
    unknownLocusPathogenicity: 0.5,

    /**
     * `rarity` placeholder until STR population frequency is modelled.
     */
    rarityPlaceholder: 1.0
  },

  // ───────────────────────────────────────────────────────────────
  // Cross-type defaults
  // ───────────────────────────────────────────────────────────────

  defaults: {
    /**
     * Default `phenotype` sub-score when `hpo_sim_score` is null or
     * undefined. Applied across all variant types. No built-in preset
     * currently weights phenotype > 0 because VarLens doesn't ship
     * with an HPO similarity pipeline yet — the field exists so the
     * formula is ready when it lands.
     */
    nullPhenotypeScore: 0
  }
} as const
