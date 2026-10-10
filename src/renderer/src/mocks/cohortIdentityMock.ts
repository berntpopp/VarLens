import type { Case, Variant } from '../../../shared/types/api'
import type { CohortCarrier, CohortVariantIdentity } from '../../../shared/types/cohort'
import type { AvailableBuild } from '../../../shared/types/database'
import { genotypeCallKey } from '../../../shared/utils/genotype'
import { cohortVariantKey } from '../../../shared/utils/cohort-variant-key'

export function mockAvailableBuilds(
  cases: ReadonlyArray<Pick<Case, 'genome_build'>>
): AvailableBuild[] {
  const counts = new Map<string, number>()
  for (const c of cases) {
    const build = c.genome_build ?? 'GRCh38'
    counts.set(build, (counts.get(build) ?? 0) + 1)
  }
  return Array.from(counts, ([build, caseCount]) => ({ build, caseCount }))
}

/** The same per-case conflicting-call rule used by both database backends. */
export function addMockCarrier(
  calls: Map<number, string>,
  caseId: number,
  gt: string | null | undefined
): void {
  const current = calls.get(caseId)
  if (current === undefined || genotypeCallKey(gt) > genotypeCallKey(current)) {
    calls.set(caseId, gt ?? '')
  }
}

export function mockCohortCarriers(
  variant: CohortVariantIdentity,
  variants: readonly Variant[],
  cases: readonly Case[]
): CohortCarrier[] {
  const key = cohortVariantKey(variant)
  const calls = new Map<number, string>()
  for (const row of variants) {
    if (cohortVariantKey(mockCohortIdentity(row, cases)) === key) {
      addMockCarrier(calls, row.case_id, row.gt_num)
    }
  }
  return Array.from(calls, ([case_id, gt_num]) => ({
    case_id,
    case_name: cases.find((c) => c.id === case_id)?.name ?? `Case ${case_id}`,
    gt_num
  })).sort((a, b) => a.case_name.localeCompare(b.case_name))
}

/**
 * Six-field cohort identity of a browser-dev mock variant. The genome build is
 * the build of the case that carries it, as in the real summary.
 */
export function mockCohortIdentity(
  v: Pick<Variant, 'chr' | 'pos' | 'ref' | 'alt' | 'case_id' | 'variant_type'>,
  cases: ReadonlyArray<Pick<Case, 'id' | 'genome_build'>>
): CohortVariantIdentity {
  return {
    chr: v.chr,
    pos: v.pos,
    ref: v.ref,
    alt: v.alt,
    variant_type: v.variant_type ?? 'snv',
    genome_build: cases.find((c) => c.id === v.case_id)?.genome_build ?? 'GRCh38'
  }
}
