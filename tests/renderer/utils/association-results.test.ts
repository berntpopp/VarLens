import { describe, expect, it } from 'vitest'

import {
  BURDEN_REFERENCE_NOTE,
  buildAssociationTsv,
  excludedSiteCount,
  excludedSitesLabel,
  nonAutosomalNote,
  type AssociationResultRow
} from '../../../src/renderer/src/utils/association-results'

const row: AssociationResultRow = {
  gene_symbol: 'GENE1',
  n_variants: 2,
  sites_excluded: { missing_call: 2, conflicting_calls: 1, no_called_alleles: 0 },
  groupA_carriers: 3,
  groupB_carriers: 1,
  groupA_total: 5,
  groupB_total: 5,
  fisher: { p_value: 0.04, odds_ratio: 6, ci_lower: null, ci_upper: null },
  logistic_burden: {
    p_value: 0.03,
    beta: 1.2,
    se: 0.5,
    ci_lower: 0.2,
    ci_upper: 2.2,
    used_firth: false
  },
  q_value: 0.08
}

describe('association result text', () => {
  it('states the assumption word for word', () => {
    expect(BURDEN_REFERENCE_NOTE).toBe(
      'Samples without a stored call are treated as reference. Use data called and filtered the same way for both groups.'
    )
  })

  it('sums and names the excluded sites', () => {
    expect(excludedSiteCount(row.sites_excluded)).toBe(3)
    expect(excludedSitesLabel(row.sites_excluded)).toBe(
      'Missing call: 2, conflicting calls: 1, no called alleles: 0'
    )
  })

  it('exports the assumption, the sites used and the excluded sites per reason', () => {
    const [note, header, line] = buildAssociationTsv([row]).split('\n')
    expect(note).toBe(`# ${BURDEN_REFERENCE_NOTE}`)
    expect(header.split('\t')).toEqual([
      'Gene',
      'Variants',
      'Cases_A',
      'Cases_B',
      'Fisher_OR',
      'Fisher_CI_Lower',
      'Fisher_CI_Upper',
      'Fisher_p',
      'Burden_beta',
      'Burden_SE',
      'Burden_p',
      'q_value',
      'Excluded_missing_call',
      'Excluded_conflicting_calls',
      'Excluded_no_called_alleles'
    ])
    expect(line.split('\t')).toEqual([
      'GENE1',
      '2',
      '3',
      '1',
      '6',
      '',
      '',
      '0.04',
      '1.2',
      '0.5',
      '0.03',
      '0.08',
      '2',
      '1',
      '0'
    ])
  })

  it('says how many qualifying variants are not on an autosome, in the view text and the export', () => {
    expect(nonAutosomalNote(0)).toBeNull()
    expect(nonAutosomalNote(1)).toBe(
      '1 qualifying variant was left out because it is not on chromosomes 1-22.'
    )
    expect(nonAutosomalNote(7)).toBe(
      '7 qualifying variants were left out because they are not on chromosomes 1-22.'
    )

    // An empty run on chrX still exports the reason.
    expect(buildAssociationTsv([], 7).split('\n').slice(0, 2)).toEqual([
      `# ${BURDEN_REFERENCE_NOTE}`,
      '# 7 qualifying variants were left out because they are not on chromosomes 1-22.'
    ])
    expect(buildAssociationTsv([row]).split('\n')).toHaveLength(3)
  })

  it.each([
    ['=1+1', "'=1+1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['GENE\tOTHER', '"GENE\tOTHER"'],
    ['GENE\n"OTHER"', '"GENE\n""OTHER"""']
  ])('exports imported gene %j as one inert spreadsheet cell', (gene, escaped) => {
    const tsv = buildAssociationTsv([{ ...row, gene_symbol: gene }])
    expect(tsv).toContain(`\n${escaped}\t2\t3\t1\t6\t`)
  })
})
