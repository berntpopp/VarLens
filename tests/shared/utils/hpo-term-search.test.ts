import { describe, expect, it } from 'vitest'

import { searchHpoTerms } from '../../../src/shared/utils/hpo-term-search'

const TERMS = [
  { id: 'HP:0001250', name: 'Seizure' },
  { id: 'HP:0002069', name: 'Bilateral tonic-clonic seizure' },
  { id: 'HP:0007359', name: 'Focal-onset seizure' },
  { id: 'HP:0000118', name: 'Phenotypic abnormality' },
  { id: 'HP:0012250', name: 'Abnormal seizure semiology' }
]

describe('searchHpoTerms', () => {
  it('ranks exact label before label substrings and sorts the rest alphabetically', () => {
    expect(searchHpoTerms(TERMS, 'seizure').map((t) => t.id)).toEqual([
      'HP:0001250',
      'HP:0012250',
      'HP:0002069',
      'HP:0007359'
    ])
  })

  it('ranks an exact ID first, then ID prefixes', () => {
    expect(searchHpoTerms(TERMS, 'hp:0001250')[0].id).toBe('HP:0001250')
    expect(searchHpoTerms(TERMS, 'HP:00012').map((t) => t.id)).toEqual(['HP:0001250'])
  })

  it('caps results and ignores too-short queries', () => {
    expect(searchHpoTerms(TERMS, 'seizure', 2)).toHaveLength(2)
    expect(searchHpoTerms(TERMS, 's')).toEqual([])
    expect(searchHpoTerms(TERMS, '  ')).toEqual([])
    expect(searchHpoTerms(TERMS, 'seizure', 0)).toEqual([])
  })
})
