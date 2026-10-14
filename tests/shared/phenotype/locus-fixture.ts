/**
 * Toy CNV/STR reference downloads (CNV/STR spec §3) with the real file headers.
 * Region ISCA-1 (HI 3) names MONDO:0000001 → OMIM:1, the toy HPO's unlinked disease.
 * ClinGen files are padded with filler rows to the configured row floors.
 */
import { HPO_DATA_CONFIG } from '../../../src/shared/config/hpo-data.config'

const { minGenes, minRegions } = HPO_DATA_CONFIG.locusSources.clingen
const pmids = (n: number): string[] => Array<string>(n).fill('')
const scoreCells = (hi: string, ts: string): string[] => [
  hi,
  'desc',
  ...pmids(6),
  ts,
  'desc',
  ...pmids(6),
  '2026-01-01'
]

const HEAD = (first: string[], date = '03 Oct,2026'): string[] => [
  `#ClinGen ${first[0] === 'Gene Symbol' ? 'Gene' : 'Region'} Curation Results`,
  `#${date}`,
  '#Genomic Locations are reported on GRCh38 (hg38): GCF_000001405.36',
  '#' +
    [
      ...first,
      'cytoBand',
      'Genomic Location',
      'Haploinsufficiency Score',
      'Haploinsufficiency Description',
      ...[1, 2, 3, 4, 5, 6].map((i) => `Haploinsufficiency PMID${i}`),
      'Triplosensitivity Score',
      'Triplosensitivity Description',
      ...[1, 2, 3, 4, 5, 6].map((i) => `Triplosensitivity PMID${i}`),
      'Date Last Evaluated',
      'Haploinsufficiency Disease ID',
      'Triplosensitivity Disease ID'
    ].join('\t')
]

/** NCBI Gene id `n` ↔ `HGNC:n`; gene 1 is GENE1 (HI 3), gene 2 GENE2 (HI 30, TS not yet evaluated). */
export const ENTREZ_TO_HGNC = new Map(
  Array.from({ length: minGenes + 1 }, (_, i) => [String(i + 1), `HGNC:${i + 1}`])
)

export function clingenGenes(rows = minGenes): string {
  const lines = Array.from({ length: rows }, (_, i) => {
    const [hi, ts] = i === 0 ? ['3', '0'] : i === 1 ? ['30', 'Not yet evaluated'] : ['0', '0']
    return [`GENE${i + 1}`, String(i + 1), '1p1', 'chr1:1-2', ...scoreCells(hi, ts), '', ''].join(
      '\t'
    )
  })
  return [...HEAD(['Gene Symbol', 'Gene ID']), ...lines, ''].join('\n')
}

export function clingenRegions(rows = minRegions): string {
  const lines = Array.from({ length: rows }, (_, i) => {
    const [hi, ts, loss, location] =
      i === 0
        ? ['3', '1', 'MONDO:0000001', 'chr16:100-200']
        : i === 1
          ? ['40', '0', 'MONDO:0000003', 'tbd']
          : ['40', '0', '', `chr2:${i}-${i + 10}`]
    return [
      `ISCA-${i + 1}`,
      `region ${i + 1}`,
      '1p1',
      location,
      ...scoreCells(hi, ts),
      loss,
      ''
    ].join('\t')
  })
  return [...HEAD(['ISCA ID', 'ISCA Region Name'], '28 Apr,2026'), ...lines, ''].join('\n')
}

const locus = (id: string, gene: string, extra: object = {}): object => ({
  id,
  gene,
  chrom: 'chr1',
  start_hg38: 100,
  stop_hg38: 130,
  start_hg19: 90,
  stop_hg19: 120,
  evidence: ['Definitive'],
  inheritance: ['AD'],
  pathogenic_motif_reference_orientation: ['CAG'],
  benign_max: 30,
  intermediate_min: 31,
  intermediate_max: 39,
  pathogenic_min: 40,
  typ_age_onset_min: 20,
  typ_age_onset_max: 50,
  omim: ['2'],
  orphanet: [],
  mondo: [],
  ...extra
})

/** Every overridden locus, plus DM1 named only by MONDO:0000002 → OMIM:3. */
export const STRCHIVE_LOCI = JSON.stringify([
  locus('FXS_FMR1', 'FMR1', { chrom: 'chrX', inheritance: ['XD'], intermediate_max: 200 }),
  locus('SCA2_ATXN2', 'ATXN2'),
  locus('HD_HTT', 'HTT'),
  locus('DM1_DMPK', 'DMPK', { omim: [], mondo: ['0000002'] }),
  locus('SCA3_ATXN3', 'ATXN3', { omim: ['4'], orphanet: ['98757'] }),
  locus('FTDALS1_C9orf72', 'C9orf72')
])

const term = (id: string, xrefs: string[]): string =>
  ['[Term]', `id: ${id}`, 'name: x', ...xrefs, ''].join('\n')
export const MONDO_OBO = [
  'format-version: 1.2',
  'data-version: releases/2026-10-06',
  '',
  term('MONDO:0000001', [
    'xref: OMIM:1 {source="MONDO:equivalentTo"}',
    'xref: Orphanet:9 {source="OMIM:1", source="MONDO:equivalentTo"}',
    'xref: OMIM:7 {source="MONDO:relatedTo"}'
  ]),
  term('MONDO:0000002', ['xref: OMIM:3 {source="MONDO:equivalentTo"}']),
  term('MONDO:0000099', ['xref: OMIM:99 {source="MONDO:equivalentTo"}'])
].join('\n')
