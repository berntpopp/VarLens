import { describe, expect, it } from 'vitest'
import {
  parseClingenGenes,
  parseClingenRegions,
  parseMondoXrefs,
  parseStrchiveLoci
} from '../../../src/shared/phenotype/reference-sources'
import { applyStrOverride, STR_OVERRIDES } from '../../../src/shared/str/str-overrides'
import { HPO_DATA_CONFIG } from '../../../src/shared/config/hpo-data.config'
import {
  clingenGenes,
  clingenRegions,
  ENTREZ_TO_HGNC,
  MONDO_OBO,
  STRCHIVE_LOCI
} from './locus-fixture'

const { minGenes, minRegions } = HPO_DATA_CONFIG.locusSources.clingen

describe('ClinGen dosage parsers', () => {
  it('keys genes by HGNC id and maps scores, unevaluated to null', () => {
    const genes = parseClingenGenes(clingenGenes(), ENTREZ_TO_HGNC, minGenes)
    expect(genes).toHaveLength(minGenes)
    expect(genes.slice(0, 2)).toEqual([
      { hgncId: 'HGNC:1', symbol: 'GENE1', hi: 3, ts: 0 },
      { hgncId: 'HGNC:2', symbol: 'GENE2', hi: 30, ts: null }
    ])
  })

  it('drops genes without an HGNC id', () => {
    const map = new Map([['1', 'HGNC:1']])
    expect(parseClingenGenes(clingenGenes(), map, minGenes)).toHaveLength(1)
  })

  it('parses placed regions without the chr prefix and keeps their disease ids', () => {
    const regions = parseClingenRegions(clingenRegions(), 'GRCh38', minRegions)
    expect(regions).toHaveLength(minRegions - 1) // the "tbd" region is dropped
    expect(regions[0]).toEqual({
      iscaId: 'ISCA-1',
      build: 'GRCh38',
      chr: '16',
      start: 100,
      end: 200,
      label: 'region 1',
      hi: 3,
      ts: 1,
      lossDiseases: ['MONDO:0000001'],
      gainDiseases: []
    })
  })

  it('refuses a renamed column and a file under the row floor', () => {
    const renamed = clingenGenes().replace('Haploinsufficiency Score', 'HI Score')
    expect(() => parseClingenGenes(renamed, ENTREZ_TO_HGNC, minGenes)).toThrow(
      /header changed: no column "Haploinsufficiency Score"/
    )
    expect(() => parseClingenRegions(clingenRegions(10), 'GRCh38', minRegions)).toThrow(
      /has 10 rows, fewer than/
    )
  })
})

describe('STRchive and Mondo parsers', () => {
  it('normalises loci with prefixed disease ids', () => {
    const atxn3 = parseStrchiveLoci(STRCHIVE_LOCI).find((l) => l.id === 'SCA3_ATXN3')
    expect(atxn3).toMatchObject({
      gene: 'ATXN3',
      chrom: '1',
      hg38: { start: 100, stop: 130 },
      pathogenicMin: 40,
      evidence: 'Definitive',
      diseases: { full: ['OMIM:4', 'ORPHA:98757'] },
      mondo: []
    })
  })

  it('refuses a catalogue that is not a locus array', () => {
    expect(() => parseStrchiveLoci('{}')).toThrow(/not a locus array/)
    expect(() => parseStrchiveLoci('[{"gene":"X"}]')).toThrow(/lacks its id/)
  })

  it('keeps only MONDO:equivalentTo OMIM/Orphanet xrefs of the wanted ids', () => {
    const xrefs = parseMondoXrefs(MONDO_OBO, new Set(['MONDO:0000001', 'MONDO:0000002']))
    expect(Object.fromEntries(xrefs)).toEqual({
      'MONDO:0000001': ['OMIM:1', 'ORPHA:9'],
      'MONDO:0000002': ['OMIM:3']
    })
    expect(() => parseMondoXrefs('garbage', new Set())).toThrow(/not an OBO file/)
  })

  it('applies the FMR1 override: thresholds and banded disease sets', () => {
    const fmr1 = parseStrchiveLoci(STRCHIVE_LOCI).find((l) => l.id === 'FXS_FMR1')!
    expect(applyStrOverride(fmr1, STR_OVERRIDES.FXS_FMR1)).toMatchObject({
      intermediateMin: 45,
      intermediateMax: 54,
      pathogenicMin: 200,
      diseases: {
        full: ['OMIM:300624', 'ORPHA:908'],
        premutation: ['OMIM:300623', 'ORPHA:93256', 'OMIM:311360'],
        femaleOnly: ['OMIM:311360']
      }
    })
  })
})
