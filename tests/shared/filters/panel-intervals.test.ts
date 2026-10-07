import { describe, expect, it } from 'vitest'

import {
  buildPaddedPanelIntervals,
  mergeOverlappingIntervals,
  PanelRegionsUnavailableError,
  resolvePanelGeneRegions,
  resolvePanelGeneStatus
} from '../../../src/shared/filters/panel-intervals'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('buildPaddedPanelIntervals', () => {
  it('pads both sides of every gene and clamps the start at 1', () => {
    expect(
      buildPaddedPanelIntervals(
        [
          { chromosome: '7', start_pos: 100_000, end_pos: 200_000 },
          { chromosome: '1', start_pos: 1_000, end_pos: 2_000 }
        ],
        5_000,
        false
      )
    ).toEqual([
      { chr: '1', start: 1, end: 7_000 },
      { chr: '7', start: 95_000, end: 205_000 }
    ])
  })

  it('emits regions in the chromosome naming style of the variant data', () => {
    const coordinates = [
      { chromosome: '7', start_pos: 10, end_pos: 20 },
      { chromosome: 'chrX', start_pos: 10, end_pos: 20 }
    ]
    expect(buildPaddedPanelIntervals(coordinates, 0, true).map((iv) => iv.chr)).toEqual([
      'chr7',
      'chrX'
    ])
    expect(buildPaddedPanelIntervals(coordinates, 0, false).map((iv) => iv.chr)).toEqual([
      '7',
      'chrX'
    ])
  })

  it('merges genes whose padded regions overlap or touch', () => {
    expect(
      buildPaddedPanelIntervals(
        [
          { chromosome: '7', start_pos: 100, end_pos: 200 },
          { chromosome: '7', start_pos: 221, end_pos: 300 },
          { chromosome: '7', start_pos: 500, end_pos: 600 }
        ],
        10,
        false
      )
    ).toEqual([
      { chr: '7', start: 90, end: 310 },
      { chr: '7', start: 490, end: 610 }
    ])
  })
})

describe('mergeOverlappingIntervals', () => {
  it('returns an empty list unchanged and does not mutate its input', () => {
    expect(mergeOverlappingIntervals([])).toEqual([])
    const input = [
      { chr: '2', start: 5, end: 9 },
      { chr: '2', start: 1, end: 6 }
    ]
    expect(mergeOverlappingIntervals(input)).toEqual([{ chr: '2', start: 1, end: 9 }])
    expect(input[1]).toEqual({ chr: '2', start: 1, end: 6 })
  })
})

describe('resolvePanelGeneRegions', () => {
  const coordinates = new Map([['HGNC:1', { chromosome: '7', start_pos: 100, end_pos: 200 }]])

  it('returns the padded regions of the genes that have coordinates', () => {
    const lookup = (ids: string[], build: string) => {
      expect(ids).toEqual(['HGNC:1', 'HGNC:2'])
      expect(build).toBe('GRCh38')
      return coordinates
    }
    expect(resolvePanelGeneRegions(['HGNC:1', 'HGNC:2'], 'GRCh38', 10, true, lookup)).toEqual([
      { chr: 'chr7', start: 90, end: 210 }
    ])
  })

  it('returns no regions for a panel without genes and never consults the gene reference', () => {
    const lookup = (): never => {
      throw new Error('must not be called')
    }
    expect(resolvePanelGeneRegions([], 'GRCh38', 10, false, lookup)).toEqual([])
  })

  it('throws a typed, user-facing error when no panel gene has coordinates for the build', () => {
    const run = (): unknown =>
      resolvePanelGeneRegions(['HGNC:1', 'HGNC:2'], 'GRCh37', 10, false, () => new Map())

    expect(run).toThrow(PanelRegionsUnavailableError)
    try {
      run()
    } catch (error) {
      const typed = error as PanelRegionsUnavailableError
      expect(typed.name).toBe('PanelRegionsUnavailableError')
      expect(typed.code).toBe(ErrorCode.VALIDATION)
      expect(typed.geneCount).toBe(2)
      expect(typed.genomeBuild).toBe('GRCh37')
      expect(typed.userMessage).toContain('GRCh37')
      expect(typed.userMessage).toMatch(/cannot be applied/)
    }
  })
})

describe('resolvePanelGeneStatus', () => {
  const coordinates = { chromosome: '7', start_pos: 100, end_pos: 200 }
  const lookup =
    (mapped: string[]) =>
    (hgncIds: string[]): Map<string, typeof coordinates> =>
      new Map(hgncIds.filter((id) => mapped.includes(id)).map((id) => [id, coordinates]))

  it('lists the genes without coordinates for the build, sorted by symbol', () => {
    expect(
      resolvePanelGeneStatus(
        [
          { hgnc_id: 'HGNC:3', symbol: 'ZNF1' },
          { hgnc_id: 'HGNC:1', symbol: 'BRCA1' },
          { hgnc_id: 'HGNC:2', symbol: 'ABC1' }
        ],
        'GRCh37',
        lookup(['HGNC:1'])
      )
    ).toEqual({
      genomeBuild: 'GRCh37',
      totalGenes: 3,
      unmappedCount: 2,
      unmappedGenes: [
        { hgncId: 'HGNC:2', symbol: 'ABC1' },
        { hgncId: 'HGNC:3', symbol: 'ZNF1' }
      ]
    })
  })

  it('counts a gene shared by several panels once', () => {
    const status = resolvePanelGeneStatus(
      [
        { hgnc_id: 'HGNC:9', symbol: 'TTN' },
        { hgnc_id: 'HGNC:9', symbol: 'TTN' },
        { hgnc_id: 'HGNC:1', symbol: 'BRCA1' }
      ],
      'GRCh38',
      lookup(['HGNC:1'])
    )
    expect(status.totalGenes).toBe(2)
    expect(status.unmappedGenes).toEqual([{ hgncId: 'HGNC:9', symbol: 'TTN' }])
  })

  it('reports nothing unmapped when every gene resolves, and for a panel without genes', () => {
    expect(
      resolvePanelGeneStatus([{ hgnc_id: 'HGNC:1', symbol: 'BRCA1' }], 'GRCh38', lookup(['HGNC:1']))
    ).toEqual({ genomeBuild: 'GRCh38', totalGenes: 1, unmappedCount: 0, unmappedGenes: [] })
    expect(resolvePanelGeneStatus([], 'GRCh38', lookup([]))).toEqual({
      genomeBuild: 'GRCh38',
      totalGenes: 0,
      unmappedCount: 0,
      unmappedGenes: []
    })
  })

  it('reports a fully unmapped panel instead of throwing', () => {
    const status = resolvePanelGeneStatus(
      [{ hgnc_id: 'HGNC:1', symbol: 'BRCA1' }],
      'T2T-CHM13',
      lookup([])
    )
    expect(status.unmappedCount).toBe(status.totalGenes)
  })

  it('queries the coordinate lookup for exactly the requested build', () => {
    const builds: string[] = []
    resolvePanelGeneStatus([{ hgnc_id: 'HGNC:1', symbol: 'BRCA1' }], 'GRCh37', (ids, build) => {
      builds.push(build)
      return lookup([])(ids)
    })
    expect(builds).toEqual(['GRCh37'])
  })
})
