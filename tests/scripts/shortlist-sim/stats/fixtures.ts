import type { AlleleRank, CaseResult } from '../../../../scripts/shortlist-sim/common/types'

export function caseResult(
  over: Partial<CaseResult> & { ranks?: Array<number | null> }
): CaseResult {
  const { ranks, ...rest } = over
  const alleles: AlleleRank[] = (ranks ?? [1]).map((r) => ({
    rank: r,
    higher: r === null ? 0 : r - 1,
    equal: 0
  }))
  return {
    caseId: 'c1',
    scorer: 'tier1',
    scenario: 'primary',
    fold: 0,
    mode: 'AD',
    consequenceClass: 'missense',
    bg: 'bg1',
    gene: 'G1',
    newSince2024: false,
    alleles,
    decoysTop10: 0,
    eligible: 100,
    causalEligible: alleles.map((a) => a.rank !== null),
    ...rest
  }
}
