/**
 * CNV and STR phenotype scoring constants (spec
 * `.planning/specs/2026-10-14-hpo-cnv-str-scoring.md` §4, §5). Fixed defaults:
 * ablated in the §7 validation, never tuned on its cases.
 */
import type { StrBand } from '../types/locus-reference'

export const HPO_LOCUS_SCORING_CONFIG = {
  /** ClinGen dosage scores (§4.1): ≥ sensitiveMin is sensitive; 30 = AR gene; 40 = unlikely. */
  dosageScores: { sensitiveMin: 2, recessive: 30, unlikely: 40 },

  /** Dosage weight w(g, c) per CNV type and ClinGen score (§4.1 table). */
  dosageWeights: {
    del: {
      sensitive: 1.0,
      /** HI unknown, 0 or 1 */
      unknown: 0.6,
      /** HI 30, one allele lost */
      recessive: 0.3,
      /** HI 30 with CN 0, a hemizygous loss or another het allele in the gene */
      recessiveBiallelic: 1.0,
      unlikely: 0.1
    },
    /** DUP spanning the whole gene */
    dup: { sensitive: 1.0, unknown: 0.3, unlikely: 0.1 },
    /** DUP with a breakpoint inside the gene: this factor times the gene's DEL weight */
    dupPartialFactor: 0.5
  },

  /** Region route (§4.2): v(cov) = 1 at ≥ full, linear from min to full, 0 below min. */
  regionCoverage: { full: 0.8, min: 0.3 },

  /** Copy number of a non-deleted, non-duplicated locus (1 on male chrX/chrY outside the PARs). */
  referenceCopyNumber: 2,

  /**
   * INFO keys of the AnnotSV HI/TS written into the VCF (varlens-annotation-workflows#3).
   * ponytail: placeholder names until #3 fixes the format; update them and the fixture test then.
   */
  annotsvInfoKeys: { hi: 'AnnotSV_HI', ts: 'AnnotSV_TS' },

  str: {
    /** Band from Stranger's STR_STATUS when the copies cannot be parsed (§5.2); else normal. */
    strangerStatusBand: { full_mutation: 'full', pre_mutation: 'premutation' } as Readonly<
      Record<string, StrBand>
    >,
    /** STRchive evidence levels whose loci get a null score (§5.2). */
    nullEvidence: ['Refuted', 'Disputed'] as readonly string[],
    /** AR gate: other het alleles in the gene that stand in for a second expanded allele. */
    secondHitMin: 1
  }
} as const
