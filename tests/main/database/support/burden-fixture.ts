/**
 * One dataset for the burden-test eligibility rules (#520), stored the same
 * way on SQLite and PostgreSQL, and the matrix both builders must return.
 * Groups: A = S1, S2; B = S3, S4.
 */
import type Database from 'better-sqlite3-multiple-ciphers'

import type { GeneContingencyData } from '../../../../src/main/statistics/types'

export const SAMPLES = ['S1', 'S2', 'S3', 'S4'] as const
export type Sample = (typeof SAMPLES)[number]

export interface BurdenRow {
  sample: Sample
  chr: string
  pos: number
  ref: string
  alt: string
  gene: string | null
  gt: string | null
  /** The per-row call quality: the only per-sample numeric column on `variants`. */
  qual: number
}

const site =
  (chr: string, pos: number, ref: string, alt: string, gene: string | null) =>
  (sample: Sample, gt: string | null, qual = 50, rowGene: string | null = gene): BurdenRow => ({
    sample,
    chr,
    pos,
    ref,
    alt,
    gene: rowGene,
    gt,
    qual
  })

const complete = site('chr1', 100, 'A', 'G', 'GENE1')
const unknown = site('chr1', 200, 'C', 'T', 'GENE1')
const conflict = site('chr1', 300, 'G', 'A', 'GENE1')
const phased = site('chr1', 90, 'T', 'C', 'GENE1')
const halfCalls = site('chr1', 500, 'C', 'A', 'GENE1')
const bare = site('2', 800, 'A', 'C', 'GENE2')

export const BURDEN_ROWS: BurdenRow[] = [
  // chr1:100 — complete. S2's homozygous call has low quality; S4's row names no gene.
  complete('S1', '0/1'),
  complete('S2', '1/1', 5),
  complete('S4', '0/1', 50, null),
  // chr1:200 — an unknown call in group B.
  unknown('S1', '0/1'),
  unknown('S3', './.'),
  // chr1:300 — S2 called twice: 0/1 (quality 99) and 1/1 (quality 2).
  conflict('S2', '0/1', 99),
  conflict('S2', '1/1', 2),
  conflict('S4', '0/1'),
  // chr1:90 — S1 stored twice, unphased and phased: the same call.
  phased('S1', '0/1'),
  phased('S1', '0|1'),
  // chr1:500 — the shipped classes: assumed het (one copy), reference half-call (no copy).
  halfCalls('S2', '1/.'),
  halfCalls('S3', '0/.'),
  // An autosome stored without the chr prefix.
  bare('S3', '0/1'),
  // Never eligible in phase 1: chrX, chrY, MT and unplaced contigs, in both spellings.
  site('chrX', 500, 'G', 'A', 'GENEX')('S1', '1'),
  site('X', 510, 'G', 'A', 'GENEX')('S2', '0/1'),
  site('chrY', 600, 'G', 'A', 'GENEY')('S1', '1'),
  site('chrM', 700, 'G', 'A', 'GENEM')('S2', '1'),
  site('MT', 710, 'G', 'A', 'GENEM')('S3', '1'),
  site('chrUn_KI270742v1', 50, 'A', 'C', 'GENEU')('S1', '0/1')
]

/** Qualifying variants that are not on an autosome: the six sites of the last block. */
export const EXPECTED_NON_AUTOSOMAL = 6

/** What both builders return for groups A = [S1, S2], B = [S3, S4], with or without a `qual` filter. */
export const EXPECTED_GENES = [
  {
    gene_symbol: 'GENE1',
    // Sites used, in order: chr1:90, chr1:100, chr1:500. Samples S1..S4.
    dosages: [
      [1, 1, 0],
      [0, 2, 1],
      [0, 0, 0],
      [0, 1, 0]
    ],
    sites_excluded: { missing_call: 1, conflicting_calls: 1, no_called_alleles: 0 },
    groupA_carrier_count: 2,
    groupB_carrier_count: 1
  },
  {
    gene_symbol: 'GENE2',
    dosages: [[0], [0], [1], [0]],
    sites_excluded: { missing_call: 0, conflicting_calls: 0, no_called_alleles: 0 },
    groupA_carrier_count: 0,
    groupB_carrier_count: 1
  }
]

export function projectGenes(genes: GeneContingencyData[]): typeof EXPECTED_GENES {
  return genes.map((gene) => ({
    gene_symbol: gene.gene_symbol,
    dosages: gene.samples.map((sample) => sample.dosages),
    sites_excluded: gene.sites_excluded,
    groupA_carrier_count: gene.groupA_carrier_count,
    groupB_carrier_count: gene.groupB_carrier_count
  }))
}

/** Store the fixture in a migrated SQLite database; returns the case id per sample. */
export function seedSqlite(db: Database.Database): Record<Sample, number> {
  const ids = {} as Record<Sample, number>
  const addCase = db.prepare(
    "INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, '/burden.vcf', 0, 0, 0)"
  )
  for (const sample of SAMPLES) ids[sample] = Number(addCase.run(sample).lastInsertRowid)
  const addRow = db.prepare(
    'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, qual) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const r of BURDEN_ROWS) {
    addRow.run(ids[r.sample], r.chr, r.pos, r.ref, r.alt, r.gene, r.gt, r.qual)
  }
  return ids
}
