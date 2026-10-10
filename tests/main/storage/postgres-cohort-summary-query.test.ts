import { describe, expect, it } from 'vitest'

import type { CohortSearchParams } from '../../../src/shared/types/cohort'
import {
  buildSummaryCountSql,
  buildSummaryPageSql,
  buildSummaryQueryParts,
  summaryBuildTotalsJoin
} from '../../../src/main/storage/postgres/postgres-cohort-summary-query'

const TOTAL_CASES = 10
/** Frequency is derived at read time: carriers over the cases of the row's genome build. */
const FREQUENCY = '(cvs.carrier_count::double precision / NULLIF(bt.total, 0))'

describe('buildSummaryQueryParts', () => {
  it('returns no predicates and an empty join for an empty query', () => {
    const result = buildSummaryQueryParts({}, TOTAL_CASES)

    expect(result.unavailable).toBe(false)
    expect(result.parts.joins).toBe('')
    expect(result.parts.whereParts).toEqual([])
    expect(result.parts.values).toEqual([])
  })

  it('maps direct columns to alias cvs', () => {
    const params: CohortSearchParams = {
      gene_symbol: 'BRCA1',
      consequences: ['HIGH', 'MODERATE'],
      funcs: ['missense_variant'],
      clinvars: ['Pathogenic'],
      gnomad_af_max: 0.01,
      cadd_min: 20,
      variant_type: 'sv'
    }

    const result = buildSummaryQueryParts(params, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    expect(result.unavailable).toBe(false)
    expect(where).toContain('cvs.gene_symbol =')
    expect(where).toContain('cvs.consequence IN (')
    expect(where).toContain('cvs.func IN (')
    expect(where).toContain('cvs.clinvar IN (')
    expect(where).toContain('cvs.gnomad_af IS NULL OR cvs.gnomad_af <=')
    expect(where).toContain('cvs.cadd IS NULL OR cvs.cadd >=')
    expect(where).toContain('cvs.variant_type =')
    // No alias `v.` leaks into the summary predicates.
    expect(where).not.toMatch(/\bv\./)
    expect(result.parts.values).toEqual([
      'BRCA1',
      'HIGH',
      'MODERATE',
      'missense_variant',
      'Pathogenic',
      0.01,
      20,
      'sv'
    ])
  })

  it('expands variant_type snv to the snv/indel pair', () => {
    const result = buildSummaryQueryParts({ variant_type: 'snv' }, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    expect(where).toContain("cvs.variant_type IN ('snv', 'indel')")
  })

  it('scopes by genome_build directly on cvs (no cases join)', () => {
    const result = buildSummaryQueryParts({ genome_build: 'GRCh37' }, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    expect(where).toContain('cvs.genome_build =')
    expect(where).not.toContain('cases')
    expect(result.parts.joins).toBe('')
    expect(result.parts.values).toContain('GRCh37')
  })

  it('moves aggregate predicates from HAVING to WHERE without grouping', () => {
    const params: CohortSearchParams = {
      carrier_count_min: 3,
      max_internal_af: 0.2
    }

    const result = buildSummaryQueryParts(params, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    expect(result.unavailable).toBe(false)
    expect(where).toContain('cvs.carrier_count >=')
    expect(where).toContain(`${FREQUENCY} <=`)
    expect(where).not.toContain('cvs.cohort_frequency')
    expect(result.parts.needsBuildTotals).toBe(true)
    // No GROUP BY / HAVING aggregate expression leaks through.
    expect(where).not.toContain('COUNT(')
    // Mirrors live builder ordering: max_internal_af before carrier_count_min.
    expect(result.parts.values).toEqual([0.2, 3])
  })

  it('maps aggregate column filters (carrier_count, cohort_frequency, het/hom) to cvs columns', () => {
    const params: CohortSearchParams = {
      column_filters: {
        carrier_count: { operator: '>=', value: 2 },
        cohort_frequency: { operator: '<', value: 0.5 },
        het_count: { operator: '>', value: 1 },
        hom_count: { operator: '=', value: 0 }
      }
    }

    const result = buildSummaryQueryParts(params, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    expect(result.unavailable).toBe(false)
    expect(where).toContain('cvs.carrier_count')
    expect(where).toContain(`${FREQUENCY} <`)
    expect(where).not.toContain('cvs.cohort_frequency')
    expect(result.parts.needsBuildTotals).toBe(true)
    expect(where).toContain('cvs.het_count')
    expect(where).toContain('cvs.hom_count')
    expect(where).not.toContain('COUNT(')
  })

  it('maps annotation flags to stored boolean/text columns', () => {
    const params: CohortSearchParams = {
      starred_only: true,
      has_comment: true,
      acmg_classifications: ['pathogenic', 'likely_pathogenic']
    }

    const result = buildSummaryQueryParts(params, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    expect(result.unavailable).toBe(false)
    expect(where).toContain('cvs.has_star')
    expect(where).toContain('cvs.has_comment')
    expect(where).toContain('cvs.acmg_best IN (')
    expect(result.parts.values).toEqual(['pathogenic', 'likely_pathogenic'])
  })

  it('builds the genomic-coordinate search match on cvs', () => {
    const result = buildSummaryQueryParts({ search_term: 'chr17:43044295' }, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    expect(where).toContain('cvs.chr IN ($1, $2) AND cvs.pos = $3')
    expect(where).toContain('cvs.pos =')
    expect(result.parts.values).toEqual(['17', 'chr17', 43044295])
  })

  it('builds the gene/consequence/OMIM ILIKE search on cvs', () => {
    const result = buildSummaryQueryParts({ search_term: 'BRCA' }, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    expect(where).toContain('cvs.gene_symbol ILIKE')
    expect(where).toContain('cvs.consequence ILIKE')
    expect(where).toContain('cvs.omim_mim_number ILIKE')
    // Mirrors the live builder: one bound param per ILIKE branch.
    expect(result.parts.values).toEqual(['%BRCA%', '%BRCA%', '%BRCA%'])
  })

  it.each(['c.1_2del', 'p.Val600Glu'])(
    'routes the HGVS term %s to cdna / aa_change (#515)',
    (term) => {
      const result = buildSummaryQueryParts({ search_term: term }, TOTAL_CASES)

      expect(result.parts.whereParts).toEqual([
        "(cvs.cdna ILIKE $1 ESCAPE '\\' OR cvs.aa_change ILIKE $1 ESCAPE '\\')"
      ])
      // `_` is literal in HGVS, not a LIKE wildcard.
      expect(result.parts.values).toEqual([`%${term.replace('_', '\\_')}%`])
    }
  )

  it('coerces a numeric-looking filter value on numeric columns only (#510)', () => {
    const result = buildSummaryQueryParts(
      {
        column_filters: {
          gene_symbol: { operator: '=', value: '007' },
          pos: { operator: '=', value: '007' }
        }
      },
      TOTAL_CASES
    )

    expect(result.parts.values).toEqual(['007', 7])
  })

  it('uses the exact panel-interval predicate that overlaps spanning variants', () => {
    const params: CohortSearchParams = {
      panel_intervals: [
        { chr: '17', start: 43000000, end: 43100000 },
        { chr: '13', start: 32000000, end: 32400000 }
      ]
    }

    const result = buildSummaryQueryParts(params, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    // Pass-9 #7: must mirror the live predicate verbatim against cvs.
    expect(where).toContain(
      'cvs.chr = $1 AND cvs.pos <= $2 AND COALESCE(cvs.end_pos, cvs.pos) >= $3'
    )
    expect(where).toContain(
      'cvs.chr = $4 AND cvs.pos <= $5 AND COALESCE(cvs.end_pos, cvs.pos) >= $6'
    )
    expect(result.parts.values).toEqual(['17', 43100000, 43000000, '13', 32400000, 32000000])
  })

  it('falls back (unavailable) when an extension-table predicate is present', () => {
    const params: CohortSearchParams = {
      gene_symbol: 'BRCA1',
      column_filters: {
        'sv.support': { operator: '>=', value: 5 }
      }
    }

    const result = buildSummaryQueryParts(params, TOTAL_CASES)

    expect(result.unavailable).toBe(true)
    expect(result.unavailableReason).toBe('extension_predicate')
  })

  it('detects cnv and str extension predicates as well', () => {
    expect(
      buildSummaryQueryParts(
        { column_filters: { 'cnv.copy_number': { operator: '>', value: 2 } } },
        TOTAL_CASES
      ).unavailable
    ).toBe(true)
    expect(
      buildSummaryQueryParts(
        { column_filters: { 'str.repeat_length': { operator: '>', value: 30 } } },
        TOTAL_CASES
      ).unavailable
    ).toBe(true)
  })

  it('does not treat base column filters as extension predicates', () => {
    const result = buildSummaryQueryParts(
      { column_filters: { gnomad_af: { operator: '<', value: 0.01 } } },
      TOTAL_CASES
    )

    expect(result.unavailable).toBe(false)
    expect(result.parts.whereParts.join(' ')).toContain('cvs.gnomad_af')
  })

  it('builds aggregate-aware ORDER BY against direct cvs columns', () => {
    const carrier = buildSummaryQueryParts(
      { sort_by: 'carrier_count', sort_order: 'asc' },
      TOTAL_CASES
    )
    expect(carrier.parts.orderBy).toContain('cvs.carrier_count ASC')
    expect(carrier.parts.orderBy).not.toContain('COUNT(')

    const freq = buildSummaryQueryParts(
      { sort_by: 'cohort_frequency', sort_order: 'desc' },
      TOTAL_CASES
    )
    expect(freq.parts.orderBy).toContain(`${FREQUENCY} DESC`)

    // Within one genome build the denominator is constant, so the indexed
    // carrier count gives the same order.
    const freqOneBuild = buildSummaryQueryParts(
      { sort_by: 'cohort_frequency', sort_order: 'desc', genome_build: 'GRCh38' },
      TOTAL_CASES
    )
    expect(freqOneBuild.parts.orderBy).toContain('cvs.carrier_count DESC')
    expect(freqOneBuild.parts.orderBy).not.toContain('bt.total')

    const cadd = buildSummaryQueryParts({ sort_by: 'cadd_phred' }, TOTAL_CASES)
    expect(cadd.parts.orderBy).toContain('cvs.cadd DESC')
  })

  it('defaults ORDER BY to carrier_count when sort_by is unknown', () => {
    const result = buildSummaryQueryParts({ sort_by: 'nonexistent_column' }, TOTAL_CASES)
    // Default sort is served by the all-ascending keyset order (migration 0020).
    expect(result.parts.keyset).toBe(true)
    expect(result.parts.orderBy).toContain('(-COALESCE(cvs.carrier_count, -1)) ASC')
  })

  it('produces sequential positional placeholders across mixed predicates', () => {
    const params: CohortSearchParams = {
      gene_symbol: 'TP53',
      carrier_count_min: 2
    }

    const result = buildSummaryQueryParts(params, TOTAL_CASES)
    const where = result.parts.whereParts.join(' ')

    expect(where).toContain('$1')
    expect(where).toContain('$2')
    expect(result.parts.values).toEqual(['TP53', 2])
  })
})

describe('summary SQL with read-time cohort frequency', () => {
  const TABLE = '"s"."cohort_variant_summary"'
  const JOIN = summaryBuildTotalsJoin('"s"."cases"')

  it('never reads the stored cohort_frequency column', () => {
    const page = buildSummaryPageSql(TABLE, [], 'ORDER BY cvs.pos', TOTAL_CASES, 1, 2, JOIN)
    expect(page).toContain(`${FREQUENCY} AS cohort_frequency`)
    expect(page).not.toContain('cvs.cohort_frequency')
  })

  it('counts cases per genome build from the visible cases only', () => {
    expect(JOIN).toContain('FROM "s"."cases"')
    expect(JOIN).toContain('GROUP BY genome_build')
    expect(JOIN).toContain('bt.genome_build = cvs.genome_build')
  })

  it('does not need build totals when no predicate uses the frequency', () => {
    const result = buildSummaryQueryParts({ gene_symbol: 'BRCA1' }, TOTAL_CASES)
    expect(result.parts.needsBuildTotals).toBe(false)
    expect(buildSummaryCountSql(TABLE, result.parts.whereParts)).not.toContain('bt.')
  })

  it('joins build totals into the count when a predicate uses the frequency', () => {
    const result = buildSummaryQueryParts({ max_internal_af: 0.1 }, TOTAL_CASES)
    const count = buildSummaryCountSql(TABLE, result.parts.whereParts, JOIN)
    expect(count).toContain(JOIN)
    expect(count.indexOf(JOIN)).toBeLessThan(count.indexOf('WHERE'))
  })
})

describe('carrier_count_max (#455)', () => {
  // Review Focus 3
  it('caps the stored count next to the minimum, without build totals', () => {
    const result = buildSummaryQueryParts(
      { carrier_count_min: 2, carrier_count_max: 3 },
      TOTAL_CASES
    )
    expect(result.parts.whereParts).toEqual([
      'cvs.carrier_count >= $1',
      'cvs.carrier_count <= $2::bigint'
    ])
    expect(result.parts.values).toEqual([2, 3])
    expect(result.parts.needsBuildTotals).toBe(false)
  })

  // Review Focus 2
  it('ignores a cap below 1', () => {
    const result = buildSummaryQueryParts({ carrier_count_max: 0 }, TOTAL_CASES)
    expect(result.parts.whereParts).toEqual([])
    expect(result.parts.values).toEqual([])
  })
})
