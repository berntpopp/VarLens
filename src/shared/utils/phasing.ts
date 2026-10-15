/**
 * Phase of two heterozygous calls of one case (#586), from the stored phased
 * genotype (`0|1`, `1|0`, split `1|.` / `.|1`) and its phase set id (VCF
 * FORMAT PS). Only calls in the same phase set are compared: a phased
 * genotype without a PS is unknown, never assumed phased chromosome-wide.
 */
import { genotypeZygosity } from './genotype'
import { trimAlleles } from './trim-alleles'

/** cis: the ALT alleles on one haplotype; trans: on opposite haplotypes. */
export type PhaseRelation = 'cis' | 'trans'

/** Label of a compound-het row: proven trans, proven cis, or not established. */
export type CompHetPhase = 'trans' | 'cis' | 'possible'

export const COMPHET_PHASE_LABELS: Record<CompHetPhase, string> = {
  trans: 'Confirmed compound heterozygous, in trans by phase set',
  cis: 'In cis by phase set (same haplotype), not compound heterozygous',
  possible: 'Possible compound heterozygous'
}

export const COMPHET_PHASE_COLORS: Record<CompHetPhase, string> = {
  trans: 'success',
  cis: 'warning',
  possible: 'secondary'
}

export interface PhasedCall {
  chr: string
  gt_num: string | null
  ps?: number | null
}

export interface CompHetCandidateRow extends PhasedCall {
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  comphet_phase?: CompHetPhase | null
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

const bareChr = (chr: string): string => chr.replace(/^chr/i, '').toUpperCase()

function alleleKey(row: Pick<CompHetCandidateRow, 'chr' | 'pos' | 'ref' | 'alt'>): string {
  const { pos, ref, alt } = trimAlleles(
    Number(row.pos),
    row.ref.toUpperCase(),
    row.alt.toUpperCase()
  )
  return `${bareChr(row.chr)}:${pos}:${ref}:${alt}`
}

/**
 * Attach `comphet_phase` onto each het row in `pageRows` that has at least one
 * other distinct het allele in its gene among `partnerRows` (#630).
 */
export function attachCaseCompHetPhase(
  pageRows: CompHetCandidateRow[],
  partnerRows: readonly CompHetCandidateRow[]
): void {
  const hetByGene = new Map<string, Map<string, PhasedCall>>()
  for (const r of partnerRows) {
    if (r.gene_symbol === null || r.gene_symbol === '' || genotypeZygosity(r.gt_num) !== 'het')
      continue
    let entry = hetByGene.get(r.gene_symbol)
    if (entry === undefined) {
      entry = new Map()
      hetByGene.set(r.gene_symbol, entry)
    }
    const key = alleleKey(r)
    if (!entry.has(key)) {
      entry.set(key, {
        chr: r.chr,
        gt_num: r.gt_num,
        ps: r.ps == null ? null : Number(r.ps)
      })
    }
  }

  for (const row of pageRows) {
    if (
      row.gene_symbol === null ||
      row.gene_symbol === '' ||
      genotypeZygosity(row.gt_num) !== 'het'
    ) {
      row.comphet_phase = undefined
      continue
    }
    const entry = hetByGene.get(row.gene_symbol)
    if (entry === undefined) {
      row.comphet_phase = undefined
      continue
    }
    const ownKey = alleleKey(row)
    const partners: PhasedCall[] = []
    for (const [key, partner] of entry.entries()) {
      if (key !== ownKey) partners.push(partner)
    }
    if (partners.length > 0) {
      row.comphet_phase = compHetPhase(
        {
          chr: row.chr,
          gt_num: row.gt_num,
          ps: row.ps == null ? null : Number(row.ps)
        },
        partners
      )
    } else {
      row.comphet_phase = undefined
    }
  }
}

/**
 * Distinct gene symbols of heterozygous rows needing a partner query on page
 * reads (#630), or `null` when every candidate compound-het partner is already
 * in `pageRows`.
 */
export function compHetPartnerGenes(
  pageRows: readonly { gene_symbol: string | null; gt_num: string | null }[],
  filter: { inheritance_modes?: string[] },
  allOnFirstPage: boolean
): string[] | null {
  if (
    allOnFirstPage &&
    filter.inheritance_modes?.length === 1 &&
    filter.inheritance_modes[0] === 'candidate_compound_het'
  ) {
    return null
  }
  return [
    ...new Set(
      pageRows
        .filter((v) => genotypeZygosity(v.gt_num) === 'het')
        .map((v) => v.gene_symbol)
        .filter((g): g is string => g != null && g !== '')
    )
  ]
}
