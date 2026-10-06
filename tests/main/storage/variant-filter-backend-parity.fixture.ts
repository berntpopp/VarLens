/**
 * Shared fixture for variant-filter-backend-parity.test.ts (issue #447).
 *
 * One panel gene on chr7. GRCh38 coordinates 100,000-200,000; with the default
 * 5 kb padding the panel region is 95,000-205,000 (inclusive on both ends).
 * GRCh37 coordinates differ on purpose so a wrong-build lookup is visible.
 */

export interface ParityFixtureVariant {
  chr: string
  pos: number
  ref: string
  alt: string
  variant_type: string
  end_pos: number | null
  gene_symbol: string | null
  gnomad_af: number | null
  cadd: number | null
  gt_num: string
}

export interface ParityFixtureCase {
  name: string
  genomeBuild: string
  variants: ParityFixtureVariant[]
}

export const PANEL_GENE = { hgncId: 'HGNC:90001', symbol: 'PARITY1' }

export const GENE_COORDINATES: Record<
  string,
  { chromosome: string; start_pos: number; end_pos: number }
> = {
  GRCh38: { chromosome: '7', start_pos: 100_000, end_pos: 200_000 },
  GRCh37: { chromosome: '7', start_pos: 500_000, end_pos: 600_000 }
}

function variant(
  over: Partial<ParityFixtureVariant> & Pick<ParityFixtureVariant, 'chr' | 'pos'>
): ParityFixtureVariant {
  return {
    ref: 'A',
    alt: 'T',
    variant_type: 'snv',
    end_pos: null,
    gene_symbol: null,
    gnomad_af: null,
    cadd: null,
    gt_num: '0/1',
    ...over
  }
}

/** Case A — GRCh38. */
export const A = {
  /** SNV inside the gene body. */
  inGene: variant({ chr: '7', pos: 150_000, gene_symbol: 'PARITY1', gnomad_af: 0.001, cadd: 25 }),
  /** Intergenic SNV inside the padding, no gene symbol, no annotation. */
  padding: variant({ chr: '7', pos: 202_000 }),
  /** Deletion that starts before the padded region and covers the whole gene. */
  spanningCnv: variant({
    chr: '7',
    pos: 90_000,
    end_pos: 210_000,
    ref: 'N',
    alt: '<DEL>',
    variant_type: 'cnv'
  }),
  /** Carries the gene symbol but lies outside the region (stale annotation). */
  symbolOnly: variant({
    chr: '7',
    pos: 300_000,
    gene_symbol: 'PARITY1',
    gnomad_af: 0.2,
    cadd: 10
  }),
  otherChr: variant({ chr: '8', pos: 150_000, gene_symbol: 'OTHER', gnomad_af: 0.05, cadd: 30 }),
  /** First base of the padded region. */
  startEdge: variant({ chr: '7', pos: 95_000, ref: 'C', alt: 'G', gnomad_af: 0.5, cadd: 15 }),
  beforeStart: variant({ chr: '7', pos: 94_999, ref: 'C', alt: 'G' }),
  /** Last base of the padded region. */
  endEdge: variant({ chr: '7', pos: 205_000, ref: 'G', alt: 'A' }),
  afterEnd: variant({ chr: '7', pos: 205_001, ref: 'G', alt: 'A' }),
  /** Deletion ending one base before the padded region. */
  upstreamDel: variant({
    chr: '7',
    pos: 50_000,
    end_pos: 94_999,
    ref: 'N',
    alt: '<DEL>',
    variant_type: 'cnv'
  }),
  /** Duplication whose last base is the first base of the padded region. */
  touchingDup: variant({
    chr: '7',
    pos: 60_000,
    end_pos: 95_000,
    ref: 'N',
    alt: '<DUP>',
    variant_type: 'cnv'
  })
}

/** Case B — GRCh38. */
export const B = {
  /** Same coordinate as A.inGene (homozygous here). */
  sharedHom: { ...A.inGene, gt_num: '1/1' },
  padding: variant({ chr: '7', pos: 203_000, ref: 'T', alt: 'C' }),
  unrelated: variant({ chr: '9', pos: 100, gene_symbol: 'ZZZ', gnomad_af: 0.3, cadd: 5 })
}

/** Case C — GRCh37: the gene sits at 500,000-600,000 in this build. */
export const C = {
  inGrch37Gene: variant({ chr: '7', pos: 550_000, gene_symbol: 'PARITY1' }),
  /** Inside the GRCh38 coordinates only — must NOT match for a GRCh37 case. */
  grch38Position: variant({ chr: '7', pos: 150_000, alt: 'C', gene_symbol: 'PARITY1' })
}

export const FIXTURE: ParityFixtureCase[] = [
  { name: 'filter-parity-a', genomeBuild: 'GRCh38', variants: Object.values(A) },
  { name: 'filter-parity-b', genomeBuild: 'GRCh38', variants: Object.values(B) },
  { name: 'filter-parity-c', genomeBuild: 'GRCh37', variants: Object.values(C) }
]

export function keyOf(v: Pick<ParityFixtureVariant, 'chr' | 'pos' | 'ref' | 'alt'>): string {
  return `${v.chr}:${Number(v.pos)}:${v.ref}:${v.alt}`
}

/** Sorted, de-duplicated logical keys for an expected variant set. */
export function keysOf(variants: ParityFixtureVariant[]): string[] {
  return [...new Set(variants.map(keyOf))].sort()
}
