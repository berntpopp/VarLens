import type { Case, Variant } from '../../../shared/types/api'
import type { CohortVariantIdentity } from '../../../shared/types/cohort'

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
