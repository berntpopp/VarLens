/**
 * Whole-case context for evidence scoring (spec §3.2–3.3). Built in pass 1
 * over every eligible SNV/indel row of the case, so a row's gene counts never
 * depend on paging, variant type or inheritance mode (no recursion).
 */
import { genotypeZygosity, type Zygosity } from '../../../../shared/utils/genotype'
import { isInPAR } from '../../../../shared/utils/par-regions'

export type { Zygosity }
export type CaseSex = 'male' | 'female' | null

export interface CaseInfo {
  build: string
  sex: CaseSex
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
}

export interface DerivedFields {
  zygosity: Zygosity | null
  /** Distinct het alleles in the row's gene (the row itself included when het). */
  gene_het_hits: number
  /** Distinct alleles in the row's gene, any zygosity. */
  gene_hits: number
  /** IDs of the other het alleles in the gene; empty unless the row is het. */
  partners: number[]
  /** Alias for partners (lazy compound-het partner IDs). */
  readonly compoundHetPartnerVariantIds?: number[]
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
 * trimmed to the minimal representation, one base kept on each side. There is
 * no reference at import, so repeat-shifted indels are not left-aligned and
 * keep distinct keys.
 */
export function alleleKey(row: Pick<LightRow, 'chr' | 'pos' | 'ref' | 'alt'>): string {
  let ref = row.ref.toUpperCase()
  let alt = row.alt.toUpperCase()
  let pos = row.pos
  while (ref.length > 1 && alt.length > 1 && ref[ref.length - 1] === alt[alt.length - 1]) {
    ref = ref.slice(0, -1)
    alt = alt.slice(0, -1)
  }
  let start = 0
  while (ref.length - start > 1 && alt.length - start > 1 && ref[start] === alt[start]) start++
  if (start > 0) {
    ref = ref.slice(start)
    alt = alt.slice(start)
    pos += start
  }
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
  /** het allele key → id of the first row carrying it */
  het: Map<string, number>
  all: Set<string>
}

export class GeneContextBuilder {
  private readonly genes = new Map<string, GeneEntry>()

  constructor(private readonly info: CaseInfo) {}

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
      if (deriveZygosity(row, this.info) === 'het' && !entry.het.has(key))
        entry.het.set(key, row.id)
    }
  }

  build(): GeneContext {
    const { genes, info } = this
    return {
      info,
      derived(row: LightRow): DerivedFields {
        const zygosity = deriveZygosity(row, info)
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
            partners: empty,
            compoundHetPartnerVariantIds: empty
          }
        }
        let memoPartners: number[] | undefined
        const computePartners = (): number[] => {
          if (memoPartners !== undefined) return memoPartners
          if (zygosity !== 'het') return (memoPartners = [])
          const own = alleleKey(row)
          const result: number[] = []
          for (const [key, id] of entry.het.entries()) {
            if (key !== own) result.push(id)
          }
          return (memoPartners = result)
        }

        return {
          zygosity,
          gene_het_hits: entry.het.size,
          gene_hits: entry.all.size,
          get partners(): number[] {
            return computePartners()
          },
          get compoundHetPartnerVariantIds(): number[] {
            return computePartners()
          }
        }
      }
    }
  }
}
