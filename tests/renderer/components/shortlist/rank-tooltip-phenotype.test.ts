import { describe, expect, it } from 'vitest'
import { phenotypeLines } from '../../../../src/renderer/src/components/shortlist/rank-tooltip-phenotype'
import type { HpoExplanation, HpoLocusNote } from '../../../../src/shared/types/hpo-profile'

const hpo: HpoExplanation = {
  score: 0.62,
  percentile: 0.97,
  diseaseId: 'OMIM:607208',
  diseaseLabel: 'Dravet syndrome',
  matched: [
    {
      patientTerm: 'HP:1',
      patientLabel: 'hypotonia',
      diseaseTerm: 'HP:1',
      diseaseLabel: 'hypotonia',
      key: false,
      frequency: 0.5
    },
    {
      patientTerm: 'HP:2',
      patientLabel: 'epilepsy',
      diseaseTerm: 'HP:2',
      diseaseLabel: 'epilepsy',
      key: true,
      frequency: 0.5
    }
  ],
  conflicts: [],
  notConflicts: []
}

describe('phenotypeLines (rank-tooltip-phenotype)', () => {
  it('formats the CNV region locus line with dosage, coverage and HPO gene count', () => {
    const region: HpoLocusNote = {
      kind: 'region',
      id: 'ISCA-37400',
      label: '16p11.2 BP4–BP5',
      dosage: 'HI 3 (ClinGen 2026-10-14)',
      coverage: 0.996,
      diseaseGenes: 9,
      genes: 27
    }
    expect(phenotypeLines({ ...hpo, locus: region }).locus).toBe(
      'locus: 16p11.2 BP4–BP5 (ISCA-37400) · HI 3 (ClinGen 2026-10-14) · 99 % covered · ' +
        '9 HPO genes of 27 overlapped'
    )
  })

  it('formats the CNV gene locus line as plain best overlapped gene (#642)', () => {
    const gene: HpoLocusNote = {
      kind: 'gene',
      id: 'TBX6',
      label: 'TBX6',
      diseaseGenes: 9,
      genes: 27
    }
    expect(phenotypeLines({ ...hpo, locus: gene }).locus).toBe(
      'locus: TBX6 · best of 9 HPO genes of 27 overlapped'
    )
    expect(
      phenotypeLines({
        ...hpo,
        locus: { ...gene, diseaseGenes: 1, genes: undefined }
      }).locus
    ).toBe('locus: TBX6 · best of 1 HPO gene')
  })

  it('formats the STR locus line and omits locus for SNV rows', () => {
    const str: HpoLocusNote = {
      kind: 'str',
      id: 'ATXN3_SCA3',
      label: 'ATXN3',
      motif: 'CAG',
      copies: '72/24',
      band: 'full',
      inheritance: 'AD',
      onset: '20–50'
    }
    expect(phenotypeLines({ ...hpo, locus: str }).locus).toBe(
      'locus: ATXN3 CAG 72/24 · full · AD · onset 20–50'
    )
    expect(phenotypeLines(hpo).locus).toBeNull()
  })
})
