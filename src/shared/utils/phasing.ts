/**
 * Phase of two heterozygous calls of one case (#586), from the stored phased
 * genotype (`0|1`, `1|0`, split `1|.` / `.|1`) and its phase set id (VCF
 * FORMAT PS). Only calls in the same phase set are compared: a phased
 * genotype without a PS is unknown, never assumed phased chromosome-wide.
 */
import { genotypeZygosity } from './genotype'

/** cis: the ALT alleles on one haplotype; trans: on opposite haplotypes. */
export type PhaseRelation = 'cis' | 'trans'

/** Label of a compound-het row: proven trans, proven cis, or not established. */
export type CompHetPhase = 'trans' | 'cis' | 'possible'

export interface PhasedCall {
  chr: string
  gt_num: string | null
  ps?: number | null
}

/** Haplotype index (0 or 1) of the ALT allele in a phased diploid het call; null otherwise. */
export function phasedAltSide(gt: string | null | undefined): 0 | 1 | null {
  if (gt == null || genotypeZygosity(gt) !== 'het') return null
  const alleles = gt.split('|')
  if (alleles.length !== 2) return null
  if (alleles[0] === '1') return 0
  return alleles[1] === '1' ? 1 : null
}

/** cis / trans when both calls are phased in the same phase set; null when not established. */
export function phaseRelation(a: PhasedCall, b: PhasedCall): PhaseRelation | null {
  if (a.ps == null || b.ps == null || a.ps !== b.ps || a.chr !== b.chr) return null
  const sideA = phasedAltSide(a.gt_num)
  const sideB = phasedAltSide(b.gt_num)
  if (sideA === null || sideB === null) return null
  return sideA === sideB ? 'cis' : 'trans'
}

/**
 * A row's label against its partners: trans when any partner is proven in
 * trans, cis when every partner is proven in cis, otherwise possible.
 */
export function compHetPhase(row: PhasedCall, partners: readonly PhasedCall[]): CompHetPhase {
  let allCis = partners.length > 0
  for (const partner of partners) {
    const relation = phaseRelation(row, partner)
    if (relation === 'trans') return 'trans'
    if (relation !== 'cis') allCis = false
  }
  return allCis ? 'cis' : 'possible'
}
