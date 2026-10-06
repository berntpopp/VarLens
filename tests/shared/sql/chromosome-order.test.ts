import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'

import {
  OTHER_CONTIG_RANK,
  buildVariantOrderTerms,
  chrRankSql,
  chromosomeRank,
  cohortOrderByClause,
  compareChromosomes,
  genomicVariantOrderTerms
} from '../../../src/shared/sql/chromosome-order'

const SAMPLE_CONTIGS = [
  '1',
  '2',
  '9',
  '10',
  '22',
  'X',
  'Y',
  'M',
  'MT',
  'chr1',
  'chr10',
  'Chr2',
  'CHR22',
  'chrX',
  'chrx',
  'x',
  'chrY',
  'chrM',
  'chrMT',
  'chrUn_KI270742v1',
  'GL000220.1',
  'chr1_KI270706v1_random',
  'HLA-A*01:01:01:01',
  'chr',
  '23',
  '0',
  ''
]

describe('chromosomeRank', () => {
  it('ranks autosomes 1..22, then X, Y, MT', () => {
    expect(chromosomeRank('1')).toBe(1)
    expect(chromosomeRank('2')).toBe(2)
    expect(chromosomeRank('10')).toBe(10)
    expect(chromosomeRank('22')).toBe(22)
    expect(chromosomeRank('X')).toBe(23)
    expect(chromosomeRank('Y')).toBe(24)
    expect(chromosomeRank('MT')).toBe(25)
  })

  it('ignores a chr prefix of any case and treats M and MT as one contig', () => {
    expect(chromosomeRank('chr1')).toBe(1)
    expect(chromosomeRank('Chr2')).toBe(2)
    expect(chromosomeRank('CHR22')).toBe(22)
    expect(chromosomeRank('chrx')).toBe(23)
    expect(chromosomeRank('chrM')).toBe(25)
    expect(chromosomeRank('M')).toBe(25)
    expect(chromosomeRank('chrMT')).toBe(25)
  })

  it('puts every other contig after MT with one shared rank', () => {
    for (const contig of ['chrUn_KI270742v1', 'GL000220.1', '23', '0', '', 'chr']) {
      expect(chromosomeRank(contig)).toBe(OTHER_CONTIG_RANK)
    }
    expect(chromosomeRank(null)).toBe(OTHER_CONTIG_RANK)
    expect(chromosomeRank(undefined)).toBe(OTHER_CONTIG_RANK)
  })
})

describe('compareChromosomes', () => {
  it('sorts naturally with other contigs alphabetically at the end', () => {
    const shuffled = ['10', 'MT', 'GL000220.1', '2', 'Y', '1', 'chrUn_x', 'X', '22', '11']
    expect([...shuffled].sort(compareChromosomes)).toEqual([
      '1',
      '2',
      '10',
      '11',
      '22',
      'X',
      'Y',
      'MT',
      'GL000220.1',
      'chrUn_x'
    ])
  })
})

describe('chrRankSql', () => {
  it('evaluates to the same rank as chromosomeRank() in SQLite', () => {
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE t (chr TEXT)')
      const insert = db.prepare('INSERT INTO t (chr) VALUES (?)')
      for (const contig of SAMPLE_CONTIGS) insert.run(contig)
      const rows = db.prepare(`SELECT chr, ${chrRankSql('t.chr')} AS rank FROM t`).all() as Array<{
        chr: string
        rank: number
      }>
      for (const row of rows) expect(row.rank, row.chr).toBe(chromosomeRank(row.chr))
    } finally {
      db.close()
    }
  })

  it('accepts only plain or alias-qualified identifiers', () => {
    expect(chrRankSql()).toContain('substr(chr, 4)')
    expect(chrRankSql('cvs.chr')).toContain('substr(cvs.chr, 4)')
    expect(() => chrRankSql('chr); DROP TABLE variants; --')).toThrow(/unsafe column/)
    expect(() => chrRankSql('a.b.c')).toThrow(/unsafe column/)
  })
})

describe('buildVariantOrderTerms', () => {
  const rank = (column: string): string => chrRankSql(column)

  it('defaults to rank, chr, pos without a NULLS clause on pos', () => {
    expect(buildVariantOrderTerms([], 'v')).toEqual([
      `${rank('v.chr')} ASC`,
      'v.chr ASC',
      'v.pos ASC'
    ])
    expect(genomicVariantOrderTerms('variants')).toEqual([
      `${rank('variants.chr')} ASC`,
      'variants.chr ASC',
      'variants.pos ASC'
    ])
  })

  it('expands a chr sort to rank + name, then pos within the chromosome', () => {
    expect(buildVariantOrderTerms([{ key: 'chr', column: 'v.chr', order: 'desc' }], 'v')).toEqual([
      `${rank('v.chr')} DESC`,
      'v.chr DESC',
      'v.pos ASC'
    ])
  })

  it('does not add a pos tiebreaker when pos is sorted explicitly', () => {
    expect(
      buildVariantOrderTerms(
        [
          { key: 'chr', column: 'v.chr', order: 'asc' },
          { key: 'pos', column: 'v.pos', order: 'desc' }
        ],
        'v'
      )
    ).toEqual([`${rank('v.chr')} ASC`, 'v.chr ASC', 'v.pos DESC NULLS LAST'])
  })

  it('keeps other sort keys as column DIR NULLS LAST and normalises direction', () => {
    expect(
      buildVariantOrderTerms(
        [{ key: 'cadd', column: 'v.cadd', order: 'sideways' as unknown as 'asc' }],
        'v'
      )
    ).toEqual(['v.cadd ASC NULLS LAST'])
  })
})

describe('postgres dialect', () => {
  it('compares the chr name bytewise (COLLATE "C") like SQLite BINARY', () => {
    expect(genomicVariantOrderTerms('v', 'postgres')).toEqual([
      `${chrRankSql('v.chr')} ASC`,
      'v.chr COLLATE "C" ASC',
      'v.pos ASC'
    ])
    expect(cohortOrderByClause('chr', 'cvs.chr', 'asc', 'cvs', 'postgres')).toContain(
      'cvs.chr COLLATE "C" ASC'
    )
  })
})

describe('cohortOrderByClause', () => {
  it('uses the natural genomic tiebreaker after the primary sort', () => {
    expect(cohortOrderByClause('carrier_count', 'cvs.carrier_count', 'desc', 'cvs')).toBe(
      `ORDER BY cvs.carrier_count DESC NULLS LAST, ${chrRankSql('cvs.chr')} ASC, cvs.chr ASC, cvs.pos ASC, cvs.ref ASC, cvs.alt ASC`
    )
  })

  it('sorts by natural chromosome order for sort_by=chr', () => {
    expect(cohortOrderByClause('chr', 'chr', 'desc')).toBe(
      `ORDER BY ${chrRankSql('chr')} DESC, chr DESC, pos ASC, ref ASC, alt ASC`
    )
  })
})
