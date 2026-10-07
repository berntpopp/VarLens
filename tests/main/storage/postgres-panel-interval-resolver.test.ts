import { beforeEach, describe, expect, it, vi } from 'vitest'

const geneReferenceMocks = vi.hoisted(() => ({
  getCoordinatesForGenes: vi.fn()
}))

vi.mock('../../../src/main/database/geneReferenceLoader', () => ({
  getGeneReferenceDb: () => ({
    getCoordinatesForGenes: geneReferenceMocks.getCoordinatesForGenes
  })
}))

import { PostgresPanelIntervalResolver } from '../../../src/main/storage/postgres/postgres-panel-interval-resolver'
import { POSTGRES_VARIANT_COLUMN_DEFINITIONS } from '../../../src/main/storage/postgres/postgres-variant-columns'
import { NUMERIC_COLUMN_FILTER_KEYS } from '../../../src/shared/filters/column-filter-validation'
import { PanelRegionsUnavailableError } from '../../../src/shared/filters/panel-intervals'

function sqlOf(call: unknown[]): string {
  return String(call[0]).replace(/\s+/g, ' ')
}

describe('PostgresPanelIntervalResolver', () => {
  beforeEach(() => {
    geneReferenceMocks.getCoordinatesForGenes.mockReset()
  })

  it('strips the panel request and runs no query when no panel is active', async () => {
    const query = vi.fn()
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'public')

    expect(
      await resolver.resolveCaseFilter({ case_id: 1, active_panel_ids: [], panel_padding_bp: 10 })
    ).toEqual({ case_id: 1 })
    expect(await resolver.resolveCohortParams({ limit: 5 })).toEqual({ limit: 5 })
    expect(query).not.toHaveBeenCalled()
  })

  it('keeps already-resolved regions and drops the redundant request', async () => {
    const lookup = vi.fn()
    const resolver = new PostgresPanelIntervalResolver(
      { query: vi.fn() } as never,
      'public',
      lookup
    )
    const intervals = [{ chr: '1', start: 100, end: 200 }]

    expect(
      await resolver.resolveCaseFilter({
        case_id: 1,
        active_panel_ids: [3],
        panel_intervals: intervals
      })
    ).toEqual({ case_id: 1, panel_intervals: intervals })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('resolves a case filter with the build and chromosome style of that case', async () => {
    geneReferenceMocks.getCoordinatesForGenes.mockReturnValue(
      new Map([['HGNC:1100', { chromosome: '7', start_pos: 100_000, end_pos: 200_000 }]])
    )
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ genome_build: 'GRCh37', chr: 'chr7' }] })
      .mockResolvedValueOnce({ rows: [{ hgnc_id: 'HGNC:1100' }] })
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'tenant')

    const resolved = await resolver.resolveCaseFilter({
      case_id: 42,
      gene_symbol: 'X',
      active_panel_ids: [3, 4]
    })

    expect(sqlOf(query.mock.calls[0])).toContain('FROM "tenant"."cases" c WHERE c.id = $1')
    expect(sqlOf(query.mock.calls[0])).toContain('FROM "tenant"."variants" v WHERE v.case_id = $1')
    expect(query.mock.calls[0][1]).toEqual([42])
    expect(sqlOf(query.mock.calls[1])).toContain('FROM "tenant"."panel_genes"')
    expect(query.mock.calls[1][1]).toEqual([[3, 4]])
    expect(geneReferenceMocks.getCoordinatesForGenes).toHaveBeenCalledWith(['HGNC:1100'], 'GRCh37')
    // Default padding is 5 kb; regions are not joined through case_active_panels.
    expect(resolved).toEqual({
      case_id: 42,
      gene_symbol: 'X',
      panel_intervals: [{ chr: 'chr7', start: 95_000, end: 205_000 }]
    })
  })

  it('defaults to GRCh38 and unprefixed chromosomes for a case with no rows', async () => {
    const lookup = vi.fn().mockResolvedValue([{ chr: '7', start: 1, end: 2 }])
    const query = vi.fn().mockResolvedValue({ rows: [{ genome_build: null, chr: null }] })
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'public', lookup)

    await resolver.resolveCaseFilter({ case_id: 1, active_panel_ids: [3], panel_padding_bp: 0 })

    expect(lookup).toHaveBeenCalledWith([3], 'GRCh38', 0, false)
  })

  it('resolves cohort params with the selected build', async () => {
    const lookup = vi.fn().mockResolvedValue([{ chr: '1', start: 100, end: 200 }])
    const query = vi.fn().mockResolvedValue({ rows: [{ chr: '1' }] })
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'public', lookup)

    const resolved = await resolver.resolveCohortParams({
      active_panel_ids: [3],
      panel_padding_bp: 7500,
      genome_build: 'GRCh37',
      limit: 10
    })

    expect(lookup).toHaveBeenCalledWith([3], 'GRCh37', 7500, false)
    // genome_build stays: on a cohort query it is the build restriction itself.
    expect(resolved).toEqual({
      genome_build: 'GRCh37',
      limit: 10,
      panel_intervals: [{ chr: '1', start: 100, end: 200 }]
    })
  })

  it('applies no restriction when the active panel has no genes (same as SQLite)', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ genome_build: 'GRCh38', chr: '7' }] })
      .mockResolvedValueOnce({ rows: [] })
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'public')

    expect(await resolver.resolveCaseFilter({ case_id: 1, active_panel_ids: [9] })).toEqual({
      case_id: 1
    })
    expect(geneReferenceMocks.getCoordinatesForGenes).not.toHaveBeenCalled()
  })

  it('rejects with a typed error when the panel has genes but none has coordinates for the build', async () => {
    geneReferenceMocks.getCoordinatesForGenes.mockReturnValue(new Map())
    const caseQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ genome_build: 'GRCh37', chr: '7' }] })
      .mockResolvedValueOnce({ rows: [{ hgnc_id: 'HGNC:1100' }, { hgnc_id: 'HGNC:1101' }] })

    const resolver = new PostgresPanelIntervalResolver({ query: caseQuery } as never, 'public')
    const rejection = resolver.resolveCaseFilter({ case_id: 1, active_panel_ids: [3] })
    await expect(rejection).rejects.toBeInstanceOf(PanelRegionsUnavailableError)
    await expect(rejection).rejects.toMatchObject({ geneCount: 2, genomeBuild: 'GRCh37' })

    const cohortQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ chr: '7' }] })
      .mockResolvedValueOnce({ rows: [{ hgnc_id: 'HGNC:1100' }] })
    const cohortResolver = new PostgresPanelIntervalResolver(
      { query: cohortQuery } as never,
      'public'
    )
    await expect(
      cohortResolver.resolveCohortParams({ active_panel_ids: [3], genome_build: 'GRCh37' })
    ).rejects.toBeInstanceOf(PanelRegionsUnavailableError)
  })

  it('propagates a resolution failure instead of returning a wider or narrower filter', async () => {
    geneReferenceMocks.getCoordinatesForGenes.mockImplementation(() => {
      throw new Error('gene reference unavailable')
    })
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ genome_build: 'GRCh38', chr: '7' }] })
      .mockResolvedValueOnce({ rows: [{ hgnc_id: 'HGNC:1100' }] })
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'public')

    await expect(resolver.resolveCaseFilter({ case_id: 1, active_panel_ids: [3] })).rejects.toThrow(
      'gene reference unavailable'
    )
  })
})

describe('PostgresPanelIntervalResolver.getResolutionStatus', () => {
  beforeEach(() => {
    geneReferenceMocks.getCoordinatesForGenes.mockReset()
    geneReferenceMocks.getCoordinatesForGenes.mockImplementation(
      (hgncIds: string[]) =>
        new Map(
          hgncIds
            .filter((id) => id === 'HGNC:1100')
            .map((id) => [id, { chromosome: '17', start_pos: 1, end_pos: 2 }])
        )
    )
  })

  const PANEL_GENES = {
    rows: [
      { hgnc_id: 'HGNC:9', symbol: 'ZZZ1' },
      { hgnc_id: 'HGNC:1100', symbol: 'BRCA1' },
      { hgnc_id: 'HGNC:8', symbol: 'AAA1' }
    ]
  }

  it('uses the build of the case and names the unmapped genes in symbol order', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ genome_build: 'GRCh37' }] })
      .mockResolvedValueOnce(PANEL_GENES)
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'tenant')

    expect(await resolver.getResolutionStatus({ panelIds: [3, 4], caseId: 42 })).toEqual({
      genomeBuild: 'GRCh37',
      totalGenes: 3,
      unmappedCount: 2,
      unmappedGenes: [
        { hgncId: 'HGNC:8', symbol: 'AAA1' },
        { hgncId: 'HGNC:9', symbol: 'ZZZ1' }
      ]
    })
    expect(sqlOf(query.mock.calls[0])).toContain('FROM "tenant"."cases" WHERE id = $1')
    expect(query.mock.calls[0][1]).toEqual([42])
    expect(sqlOf(query.mock.calls[1])).toContain('FROM "tenant"."panel_genes"')
    expect(query.mock.calls[1][1]).toEqual([[3, 4]])
    expect(geneReferenceMocks.getCoordinatesForGenes).toHaveBeenCalledWith(
      expect.arrayContaining(['HGNC:9', 'HGNC:1100', 'HGNC:8']),
      'GRCh37'
    )
  })

  it('prefers the requested build (cohort view) and skips the case lookup', async () => {
    const query = vi.fn().mockResolvedValueOnce(PANEL_GENES)
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'public')

    const status = await resolver.getResolutionStatus({
      panelIds: [3],
      caseId: 42,
      genomeBuild: 'T2T-CHM13'
    })

    expect(status.genomeBuild).toBe('T2T-CHM13')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('defaults to GRCh38 for an unknown case and runs no gene query without panels', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'public')

    expect(await resolver.getResolutionStatus({ panelIds: [], caseId: 7 })).toEqual({
      genomeBuild: 'GRCh38',
      totalGenes: 0,
      unmappedCount: 0,
      unmappedGenes: []
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(geneReferenceMocks.getCoordinatesForGenes).not.toHaveBeenCalled()
  })

  it('propagates a gene reference failure instead of reporting "all mapped"', async () => {
    geneReferenceMocks.getCoordinatesForGenes.mockImplementation(() => {
      throw new Error('gene reference unavailable')
    })
    const query = vi.fn().mockResolvedValueOnce(PANEL_GENES)
    const resolver = new PostgresPanelIntervalResolver({ query } as never, 'public')

    await expect(
      resolver.getResolutionStatus({ panelIds: [3], genomeBuild: 'GRCh38' })
    ).rejects.toThrow('gene reference unavailable')
  })
})

describe('shared numeric column-filter keys', () => {
  it('match the numeric PostgreSQL column definitions plus the cohort aggregates', () => {
    const postgresNumeric = Object.values(POSTGRES_VARIANT_COLUMN_DEFINITIONS)
      .filter((definition) => definition.kind === 'numeric')
      .map((definition) => definition.key)
    const cohortOnly = ['cadd_phred', 'carrier_count', 'cohort_frequency', 'het_count', 'hom_count']

    expect([...NUMERIC_COLUMN_FILTER_KEYS].sort()).toEqual(
      [...postgresNumeric, ...cohortOnly].sort()
    )
  })
})
