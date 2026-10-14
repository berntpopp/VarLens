/**
 * Whole-case context for evidence scoring (spec §3.2–3.3). Built in pass 1
 * over every eligible SNV/indel row of the case, so a row's gene counts never
 * depend on paging, variant type or inheritance mode (no recursion).
 */
import { genotypeZygosity, type Zygosity } from '../../../../shared/utils/genotype'
import { isInPAR } from '../../../../shared/utils/par-regions'
import { compHetPhase, type CompHetPhase } from '../../../../shared/utils/phasing'
import { trimAlleles } from '../../../../shared/utils/trim-alleles'
import type { HpoGeneScorer } from '../../phenotype/hpo-similarity-db'
import type { StrBand } from '../../../../shared/types/locus-reference'

export type { Zygosity }
export type CaseSex = 'male' | 'female' | null

export interface CaseInfo {
  build: string
  sex: CaseSex
  /** The case's phenotype scorer (#600, spec v2 §3); absent → the hpo_* fields are null. */
  hpo?: HpoGeneScorer
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
  // CNV/STR locus scoring (CNV/STR spec §6.1): set only for non-SNV rows, so
  // pass-1 memory stays ~100 bytes per SNV.
  variant_type?: string | null
  end_pos?: number | null
  sv_type?: string | null
  cnv_copy_number?: number | null
  str_alt_copies?: string | null
  str_status?: string | null
  str_repeat_id?: string | null
  str_variant_catalog_id?: string | null
  str_repeat_unit?: string | null
}

export interface DerivedFields {
  zygosity: Zygosity | null
  /** Distinct het alleles in the row's gene (the row itself included when het). */
  gene_het_hits: number
  /** Distinct alleles in the row's gene, any zygosity. */
  gene_hits: number
  /** IDs of the other het alleles in the gene; empty unless the row is het. */
  partners: number[]
  /** In-app phenotype score of the row's gene in [0, 1]; null without HPO terms/data. */
  hpo_resnik: number | null
  /** Id of the gene's best-matching disease; null like hpo_resnik. */
  hpo_best_disease: string | null
  /** Excluded case terms contradicted by that disease; null like hpo_resnik. */
  hpo_conflicts: number | null
  /** Gene symbol, ISCA region id or STRchive id the score came from; null like hpo_resnik. */
  hpo_best_locus: string | null
  /** CNV rows: protein-coding genes overlapped; null on other types. */
  cnv_gene_count: number | null
  /** STR rows: catalogue band; null on other types or off-catalogue. */
  str_band: StrBand | null
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
  /** Distinct het alleles of the gene in the case (pass 1); the CNV HI 30 and STR AR second hit. */
  hetHits(gene: string): number
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
      hetHits: (gene) => genes.get(gene)?.het.size ?? 0,
      derived(row: LightRow): DerivedFields {
        const zygosity = deriveZygosity(row, info)
        const gene = row.gene_symbol === null || row.gene_symbol === '' ? null : row.gene_symbol
        const hpo = {
          hpo_resnik: gene === null ? null : (info.hpo?.score(gene) ?? null),
          hpo_best_disease: gene === null ? null : (info.hpo?.bestDisease(gene) ?? null),
          hpo_conflicts: gene === null ? null : (info.hpo?.conflicts(gene) ?? null),
          // Locus fields are filled by the CNV/STR scorers (plan lane L5).
          hpo_best_locus: null,
          cnv_gene_count: null,
          str_band: null
        }
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
            ...hpo,
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
          ...hpo,
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
