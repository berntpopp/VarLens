import { describe, expect, it } from 'vitest'

import {
  citedByHpoa,
  hpoaReferences,
  parsePhenopacket
} from '../../../../scripts/shortlist-sim/phenotype/phenopackets'

// Synthetic phenopacket (schema 2.0 shape of phenopacket-store), no real patient.
const fixture = {
  id: 'PMID_1_Case_1',
  phenotypicFeatures: [
    { type: { id: 'HP:0000001', label: 'a' } },
    { type: { id: 'HP:0000002', label: 'b' } },
    { type: { id: 'HP:0000002', label: 'b again' } },
    { type: { id: 'HP:0000003', label: 'c' }, excluded: true },
    { type: { id: 'HP:0000001', label: 'a, also excluded' }, excluded: true },
    { type: { id: 'NCIT:C1', label: 'not HPO' } }
  ],
  interpretations: [
    {
      progressStatus: 'SOLVED',
      diagnosis: {
        disease: { id: 'OMIM:100001', label: 'x' },
        genomicInterpretations: [
          {
            interpretationStatus: 'CAUSATIVE',
            variantInterpretation: {
              variationDescriptor: { geneContext: { valueId: 'HGNC:1', symbol: 'GENE1' } }
            }
          },
          { interpretationStatus: 'CAUSATIVE', gene: { valueId: 'HGNC:1', symbol: 'GENE1' } }
        ]
      }
    }
  ],
  diseases: [{ term: { id: 'OMIM:100001' } }, { term: { id: 'ORPHA:9' } }],
  metaData: { externalReferences: [{ id: 'PMID:1' }, { id: 'DOI:10.1/x' }] }
}

const withGenes = (...symbols: string[]): unknown => ({
  ...fixture,
  interpretations: [
    {
      diagnosis: {
        genomicInterpretations: symbols.map((symbol) => ({ gene: { symbol } }))
      }
    }
  ]
})

describe('parsePhenopacket', () => {
  it('reads observed and excluded HPO terms, the gene, diseases and PMIDs', () => {
    expect(parsePhenopacket(fixture)).toEqual({
      id: 'PMID_1_Case_1',
      gene: 'GENE1',
      diseases: ['OMIM:100001', 'ORPHA:9'],
      pmids: ['PMID:1'],
      observed: ['HP:0000001', 'HP:0000002'],
      excluded: ['HP:0000003']
    })
  })

  it('rejects multi-gene, gene-less and observation-less cases', () => {
    expect(parsePhenopacket(withGenes('GENE1', 'GENE2'))).toBeNull()
    expect(parsePhenopacket(withGenes())).toBeNull()
    expect(
      parsePhenopacket({
        ...fixture,
        phenotypicFeatures: [{ type: { id: 'HP:0000003' }, excluded: true }]
      })
    ).toBeNull()
    expect(parsePhenopacket(null)).toBeNull()
  })
})

describe('HPOA leakage', () => {
  const hpoa = [
    '#version: test',
    'database_id\tdisease_name\tqualifier\thpo_id\treference\tevidence',
    'OMIM:100001\tx\t\tHP:0000001\tPMID:1;OMIM:100001\tPCS',
    'OMIM:100002\ty\t\tHP:0000001\tPMID:2\tPCS'
  ].join('\n')
  const refs = hpoaReferences(hpoa)

  it('flags a case whose publication HPOA cites for its own disease only', () => {
    const c = parsePhenopacket(fixture)!
    expect(refs.get('OMIM:100001')).toEqual(new Set(['PMID:1']))
    expect(citedByHpoa(c, refs)).toBe(true)
    expect(citedByHpoa({ ...c, pmids: ['PMID:2'] }, refs)).toBe(false)
  })
})
