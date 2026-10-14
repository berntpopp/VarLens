/**
 * Whole-case context for evidence scoring (spec §3.2–3.3). Built in pass 1
 * over every eligible SNV/indel row of the case, so a row's gene counts never
 * depend on paging, variant type or inheritance mode (no recursion).
 */
import { genotypeZygosity, type Zygosity } from '../../../../shared/utils/genotype'
import { isInPAR } from '../../../../shared/utils/par-regions'
import { compHetPhase, type CompHetPhase } from '../../../../shared/utils/phasing'
import { trimAlleles } from '../../../../shared/utils/trim-alleles'

export type { Zygosity }
export type CaseSex = 'male' | 'female' | null

export interface CaseInfo {
  build: string
  sex: CaseSex
  /** Resnik BMA of the case's HPO terms vs a gene (#600); absent → hpo_resnik null. */
  hpoResnik?: (gene: string) => number | null
}

/** The pass-1 projection of an eligible row. */
export interface LightRow {
  id: number
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  gt_num: string | null
  /** Phase set id (VCF FORMAT PS); compared only when phasing is considered. */
  ps?: number | null
}

export interface DerivedFields {
  zygosity: Zygosity | null
  /** Distinct het alleles in the row's gene (the row itself included when het). */
  gene_het_hits: number
  /** Distinct alleles in the row's gene, any zygosity. */
  gene_hits: number
  /** IDs of the other het alleles in the gene; empty unless the row is het. */
  partners: number[]
  /** In-app phenotype similarity of the row's gene; null without HPO terms/data. */
  hpo_resnik: number | null
  /** Alias for partners (lazy compound-het partner IDs). */
  readonly compoundHetPartnerVariantIds?: number[]
  /** Phase of the row against its partners (#586); null unless phasing is considered and it has partners. */
  readonly comphet_phase?: CompHetPhase | null
}

export type CaseAlleleLookup = DerivedFields
export const lookupCaseContext = (ctx: GeneContext, row: LightRow): DerivedFields =>
  ctx.derived(row)

export interface GeneContext {
  info: CaseInfo
  derived(row: LightRow): DerivedFields
}

const bareChr = (chr: string): string => chr.replace(/^chr/i, '').toUpperCase()

/**
 * Allele identity shared by the app and the simulation harness (spec §4.3):
 * chr without prefix, upper-case alleles, common suffix then common prefix
 * trimmed to the minimal representation ({@link trimAlleles}). There is
 * no reference at import, so repeat-shifted indels are not left-aligned and
 * keep distinct keys.
 */
export function alleleKey(row: Pick<LightRow, 'chr' | 'pos' | 'ref' | 'alt'>): string {
  const { pos, ref, alt } = trimAlleles(row.pos, row.ref.toUpperCase(), row.alt.toUpperCase())
  return `${bareChr(row.chr)}:${pos}:${ref}:${alt}`
}

/**
 * The genotype's zygosity class (`./1`, `1/.` are assumed het); a hom call on
 * chrX outside the PARs of a male case is hemizygous. Unknown sex keeps `hom`.
 */
export function deriveZygosity(
  row: Pick<LightRow, 'chr' | 'pos' | 'gt_num'>,
  info: CaseInfo
): Zygosity | null {
  const zygosity = genotypeZygosity(row.gt_num)
  if (
    zygosity === 'hom' &&
    info.sex === 'male' &&
    bareChr(row.chr) === 'X' &&
    !isInPAR(row.chr, row.pos, info.build)
  ) {
    return 'hemi'
  }
  return zygosity
}

interface GeneEntry {
  /** het allele key → the first row carrying it */
  het: Map<string, LightRow>
  all: Set<string>
}

export class GeneContextBuilder {
  private readonly genes = new Map<string, GeneEntry>()

  constructor(
    private readonly info: CaseInfo,
    private readonly considerPhasing = false
  ) {}

  add(rows: readonly LightRow[]): void {
    for (const row of rows) {
      if (row.gene_symbol === null || row.gene_symbol === '') continue
      let entry = this.genes.get(row.gene_symbol)
      if (entry === undefined) {
        entry = { het: new Map(), all: new Set() }
        this.genes.set(row.gene_symbol, entry)
      }
      const key = alleleKey(row)
      entry.all.add(key)
      if (deriveZygosity(row, this.info) === 'het' && !entry.het.has(key)) entry.het.set(key, row)
    }
  }

  build(): GeneContext {
    const { genes, info, considerPhasing } = this
    return {
      info,
      derived(row: LightRow): DerivedFields {
        const zygosity = deriveZygosity(row, info)
        const hpo_resnik =
          row.gene_symbol === null || row.gene_symbol === ''
            ? null
            : (info.hpoResnik?.(row.gene_symbol) ?? null)
        const entry =
          row.gene_symbol === null || row.gene_symbol === ''
            ? undefined
            : genes.get(row.gene_symbol)
        if (entry === undefined) {
          const empty: number[] = []
          return {
            zygosity,
            gene_het_hits: zygosity === 'het' ? 1 : 0,
            gene_hits: 1,
            hpo_resnik,
            partners: empty,
            compoundHetPartnerVariantIds: empty
          }
        }
        let memoPartners: LightRow[] | undefined
        const partnerRows = (): LightRow[] => {
          if (memoPartners !== undefined) return memoPartners
          if (zygosity !== 'het') return (memoPartners = [])
          const own = alleleKey(row)
          const result: LightRow[] = []
          for (const [key, partner] of entry.het.entries()) {
            if (key !== own) result.push(partner)
          }
          return (memoPartners = result)
        }
        let memoIds: number[] | undefined
        const computePartners = (): number[] =>
          (memoIds ??= partnerRows().map((partner) => partner.id))

        return {
          zygosity,
          gene_het_hits: entry.het.size,
          gene_hits: entry.all.size,
          hpo_resnik,
          get partners(): number[] {
            return computePartners()
          },
          get compoundHetPartnerVariantIds(): number[] {
            return computePartners()
          },
          get comphet_phase(): CompHetPhase | null {
            const partners = partnerRows()
            return considerPhasing && partners.length > 0 ? compHetPhase(row, partners) : null
          }
        }
      }
    }
  }
}
