import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'
import { SCORING_CONFIG } from './scoring-config'

/**
 * STR (short tandem repeat / expansion) scoring.
 *
 * Formula:
 *
 *   impact (Stranger STR_STATUS vocabulary, stored verbatim at import;
 *   an unsplit per-allele value like `normal,full_mutation` scores its
 *   most severe allele) =
 *     any 'full_mutation' → pathologicImpact
 *     any 'pre_mutation'  → intermediateImpact
 *     otherwise           → normalOrUnknownImpact
 *
 *   pathogenicity = knownLocus
 *                     ? knownLocusPathogenicity
 *                     : unknownLocusPathogenicity
 *   rarity        = rarityPlaceholder    // no STR frequency source wired
 *   clinvar       = mapClinvarBoost(clinvar)
 *   phenotype     = hpo_sim_score ?? defaults.nullPhenotypeScore
 *
 * `knownLocus` is true iff `str_disease` is non-null and non-empty (after
 * trim).
 *
 * A known disease locus raises only `pathogenicity`. The `clinvar` component
 * comes solely from the row's ClinVar annotation, so a disease locus alone
 * never makes an STR `clinvarPinTop`-eligible or labels it "ClinVar P/LP".
 *
 * Null-value contracts:
 *   - str_status null     → impact normalOrUnknownImpact
 *   - str_disease null    → unknown locus → unknownLocusPathogenicity
 *   - clinvar null        → clinvar 0 (mapClinvarBoost)
 *   - hpo_sim_score null  → phenotype defaults.nullPhenotypeScore
 *
 * Every numeric threshold lives in `scoring-config.ts#str`.
 */
export function scoreStr(row: ShortlistCandidate): RankComponents {
  const { str, defaults } = SCORING_CONFIG
  const alleles = row.str_status?.split(',') ?? []
  const statusImpact = alleles.includes('full_mutation')
    ? str.pathologicImpact
    : alleles.includes('pre_mutation')
      ? str.intermediateImpact
      : str.normalOrUnknownImpact
  const knownLocus = row.str_disease != null && row.str_disease.trim() !== ''
  return {
    impact: statusImpact,
    pathogenicity: knownLocus ? str.knownLocusPathogenicity : str.unknownLocusPathogenicity,
    rarity: str.rarityPlaceholder,
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? defaults.nullPhenotypeScore
  }
}
