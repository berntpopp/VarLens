/**
 * The one builder for an evidence-ranking `ShortlistConfig`. The shipped
 * preset and the simulation harness both call it, so the benchmarked
 * configuration and the seeded one cannot drift (spec §5.5, §11.6).
 */
import { SHORTLIST_EVIDENCE_CONFIG } from '../config/shortlist-evidence.config'
import type { EvidenceRuleset } from '../types/evidence-ruleset'
import type { RankWeights, ShortlistConfig } from '../types/shortlist'

const NO_WEIGHTS: RankWeights = { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 }

export function evidenceShortlistConfig(
  ruleset: EvidenceRuleset,
  options: { baseFilters?: ShortlistConfig['baseFilters']; pinStarredTop?: boolean } = {}
): ShortlistConfig {
  const { defaultGate, defaultTopN, defaultTieBreakers, variantTypes } = SHORTLIST_EVIDENCE_CONFIG
  return {
    variantTypeScope: [...variantTypes],
    topN: defaultTopN,
    baseFilters: options.baseFilters ?? {
      maxGnomadAf: defaultGate.maxGnomadAf,
      consequences: [...defaultGate.consequences]
    },
    rankConfig: {
      weights: { ...NO_WEIGHTS },
      ruleset,
      clinvarPinTop: false,
      pinStarredTop: options.pinStarredTop ?? false
    },
    tieBreakers: defaultTieBreakers.map((tb) => ({ ...tb }))
  }
}
