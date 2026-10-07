/**
 * Sorting impact and ClinVar by severity rank instead of by text (#469), in
 * the ORDER BY builders shared by the case view and the cohort view on both
 * backends.
 */
import { describe, expect, it } from 'vitest'

import {
  buildVariantOrderTerms,
  cohortOrderByClause
} from '../../../src/shared/sql/chromosome-order'
import { severitySortTerms } from '../../../src/shared/sql/severity-sort'

describe('severitySortTerms', () => {
  it('orders impact by its stored rank, then by the text, unknown last', () => {
    expect(severitySortTerms('consequence', 'v', 'v.consequence', 'desc')).toEqual([
      'NULLIF(v.impact_rank, 0) DESC NULLS LAST',
      'v.consequence DESC NULLS LAST'
    ])
  })

  it('orders ClinVar by its stored rank', () => {
    expect(severitySortTerms('clinvar', '', 'clinvar', 'asc')).toEqual([
      'NULLIF(clinvar_rank, 0) ASC NULLS LAST',
      'clinvar ASC NULLS LAST'
    ])
  })

  it('leaves every other key alone', () => {
    for (const key of ['func', 'gene_symbol', 'cadd', 'chr', 'impact_rank']) {
      expect(severitySortTerms(key, 'v', `v.${key}`, 'asc')).toBeNull()
    }
  })
})

describe('case view order (buildVariantOrderTerms)', () => {
  it.each(['sqlite', 'postgres'] as const)('sorts impact by rank on %s', (dialect) => {
    const alias = dialect === 'sqlite' ? 'variants' : 'v'
    expect(
      buildVariantOrderTerms(
        [{ key: 'consequence', column: `${alias}.consequence`, order: 'desc' }],
        alias,
        dialect
      )
    ).toEqual([
      `NULLIF(${alias}.impact_rank, 0) DESC NULLS LAST`,
      `${alias}.consequence DESC NULLS LAST`
    ])
  })

  it('keeps a text sort for other columns', () => {
    expect(
      buildVariantOrderTerms([{ key: 'func', column: 'v.func', order: 'asc' }], 'v', 'postgres')
    ).toEqual(['v.func ASC NULLS LAST'])
  })
})

describe('cohort view order (cohortOrderByClause)', () => {
  it.each(['sqlite', 'postgres'] as const)('sorts ClinVar by rank on %s', (dialect) => {
    const clause = cohortOrderByClause('clinvar', 'cvs.clinvar', 'desc', 'cvs', dialect)
    expect(clause).toMatch(
      /^ORDER BY NULLIF\(cvs\.clinvar_rank, 0\) DESC NULLS LAST, cvs\.clinvar DESC NULLS LAST, \(CASE /
    )
    expect(clause).toMatch(/cvs\.pos ASC, cvs\.ref ASC, cvs\.alt ASC$/)
  })

  it('sorts impact by rank without an alias', () => {
    expect(cohortOrderByClause('consequence', 'consequence', 'asc')).toMatch(
      /^ORDER BY NULLIF\(impact_rank, 0\) ASC NULLS LAST, consequence ASC NULLS LAST, /
    )
  })
})
