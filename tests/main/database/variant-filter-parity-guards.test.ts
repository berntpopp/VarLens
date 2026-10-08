/**
 * Issue #447 — the parts of the backend-parity contract that need no live
 * PostgreSQL, so they run in the default desktop suite. The full two-backend
 * comparison lives in tests/main/storage/variant-filter-backend-parity.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const geneRef = vi.hoisted(() => ({ getCoordinatesForGenes: vi.fn() }))

vi.mock('../../../src/main/database/geneReferenceLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/database/geneReferenceLoader')>()),
  getGeneReferenceDb: () => geneRef
}))

import { DatabaseService } from '../../../src/main/database'
import type { Repositories } from '../../../src/main/database/createRepositories'
import type { GeneReferenceDb } from '../../../src/main/database/GeneReferenceDb'
import { CohortService } from '../../../src/main/database/cohort'
import { queryCohortVariants } from '../../../src/main/ipc/handlers/cohort-logic'
import {
  prepareCohortExportParams,
  prepareVariantExport
} from '../../../src/main/ipc/handlers/export-logic'
import { clearPanelIntervalCache } from '../../../src/main/ipc/handlers/panelIntervalHelper'
import { buildVariantFilter } from '../../../src/main/ipc/handlers/variants-logic'
import { toSerializableError } from '../../../src/main/ipc/serializable-error'
import { fromTransportableWorkerError } from '../../../src/main/database/worker-error-codec'
import { PanelRegionsUnavailableError } from '../../../src/shared/filters/panel-intervals'
import { ErrorCode } from '../../../src/shared/types/errors'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { buildPostgresVariantQueryParts } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import { buildSummaryQueryParts } from '../../../src/main/storage/postgres/postgres-cohort-summary-query'
import { dispatchTask } from '../../../src/main/workers/db-worker-dispatch'
import type { ColumnFiltersParam } from '../../../src/shared/types/column-filters'

/** `chr:pos:ref:alt` of a cohort row; its variant_key is opaque (#503). */
const coord = (row: unknown): string => {
  const { chr, pos, ref, alt } = row as { chr: string; pos: number; ref: string; alt: string }
  return `${chr}:${pos}:${ref}:${alt}`
}
const GENE = { hgncId: 'HGNC:90001', symbol: 'PARITY1' }

function variant(chr: string, pos: number, over: Record<string, unknown> = {}): never {
  return {
    chr,
    pos,
    ref: 'A',
    alt: 'T',
    gene_symbol: null,
    consequence: null,
    gnomad_af: null,
    cadd: null,
    clinvar: null,
    func: null,
    gt_num: '0/1',
    variant_type: 'snv',
    end_pos: null,
    ...over
  } as never
}

describe('variant filter parity guards (no PostgreSQL required)', () => {
  let sqlite: DatabaseService
  let grch38Case: number
  let panelId: number

  beforeEach(() => {
    clearPanelIntervalCache()
    geneRef.getCoordinatesForGenes.mockReset()
    geneRef.getCoordinatesForGenes.mockImplementation((_ids: string[], assembly: string) =>
      assembly === 'GRCh38'
        ? new Map([[GENE.hgncId, { chromosome: '7', start_pos: 100_000, end_pos: 200_000 }]])
        : new Map()
    )

    sqlite = new DatabaseService(':memory:')
    grch38Case = sqlite.cases.createCase('guard-38', '/tmp/guard-38.json', 0, 'GRCh38')
    sqlite.variants.insertVariantsBatch(grch38Case, [
      variant('7', 150_000, { cadd: 25 }),
      variant('7', 202_000),
      variant('7', 90_000, { end_pos: 210_000, alt: '<DEL>', variant_type: 'cnv' }),
      variant('7', 300_000, { gene_symbol: GENE.symbol, cadd: 10, omim_mim_number: '600000' })
    ])
    const grch37Case = sqlite.cases.createCase('guard-37', '/tmp/guard-37.json', 0, 'GRCh37')
    sqlite.variants.insertVariantsBatch(grch37Case, [variant('7', 150_000, { alt: 'C' })])
    sqlite.cohortSummary.rebuild()

    panelId = sqlite.panels.createPanel({ name: 'guard-panel', source: 'manual' }).id
    sqlite.panels.setGenes(panelId, [GENE])
  })

  afterEach(() => {
    sqlite.close()
  })

  it('desktop export applies the active gene panel to the exported rows, not only to the pre-count', async () => {
    const prepared = await prepareVariantExport(() => sqlite, grch38Case, {
      active_panel_ids: [panelId],
      panel_padding_bp: 5000
    })
    if (!('compiled' in prepared)) throw new Error(prepared.error)

    const rows = sqlite.db
      .prepare(prepared.compiled.sql)
      .all(...(prepared.compiled.parameters as unknown[])) as Array<{ pos: number }>

    // In-gene SNV, padded intergenic SNV and the spanning CNV — but not the
    // variant that merely carries the gene symbol outside the region.
    expect(rows.map((row) => row.pos).sort((a, b) => a - b)).toEqual([90_000, 150_000, 202_000])
    expect(prepared.count).toBe(3)
  })

  it('desktop cohort keeps its genome-build restriction when a gene panel is active', () => {
    const repos = (sqlite as unknown as { _repos: Repositories })._repos
    const result = dispatchTask(
      { db: sqlite.db, repos, geneRefDb: geneRef as unknown as GeneReferenceDb },
      {
        type: 'cohort:variants',
        params: [{ active_panel_ids: [panelId], genome_build: 'GRCh38', limit: 100, offset: 0 }]
      } as never
    ) as { data: Array<{ variant_key: string }> }

    // 7:150000:A:C belongs to the GRCh37 case and must not leak in.
    expect(result.data.map(coord).sort()).toEqual([
      '7:150000:A:T',
      '7:202000:A:T',
      '7:90000:A:<DEL>'
    ])
  })

  describe('panel that resolves to no regions', () => {
    const cohort = (params: Record<string, unknown>): Array<{ variant_key: string }> => {
      const repos = (sqlite as unknown as { _repos: Repositories })._repos
      const result = dispatchTask(
        { db: sqlite.db, repos, geneRefDb: geneRef as unknown as GeneReferenceDb },
        { type: 'cohort:variants', params: [{ limit: 100, offset: 0, ...params }] } as never
      ) as { data: Array<{ variant_key: string }> }
      return result.data
    }
    const MESSAGE =
      'Active gene panel resolves to no genomic regions: none of its 1 gene(s) has coordinates for genome build GRCh37'

    it('desktop case view, export and cohort refuse a panel whose genes have no coordinates', async () => {
      // The gene reference mock only knows GRCh38 coordinates.
      const grch37Case = sqlite.cases.createCase('guard-37b', '/tmp/guard-37b.json', 0, 'GRCh37')
      sqlite.variants.insertVariantsBatch(grch37Case, [variant('7', 150_000, { alt: 'G' })])
      const panel = { active_panel_ids: [panelId], panel_padding_bp: 5000 }

      expect(() =>
        buildVariantFilter(
          grch37Case,
          panel,
          () => sqlite,
          () => null
        )
      ).toThrow(PanelRegionsUnavailableError)
      await expect(prepareVariantExport(() => sqlite, grch37Case, panel)).rejects.toThrow(MESSAGE)
      expect(() => cohort({ ...panel, genome_build: 'GRCh37' })).toThrow(MESSAGE)
    })

    it('the error crosses the worker boundary and reaches the user as a validation error', () => {
      let thrown: unknown
      try {
        cohort({ active_panel_ids: [panelId], genome_build: 'GRCh37' })
      } catch (error) {
        thrown = error
      }
      // What Piscina delivers to the main thread is a structured clone.
      const restored = fromTransportableWorkerError(structuredClone(thrown))
      expect(restored).toBeInstanceOf(PanelRegionsUnavailableError)
      expect(toSerializableError(restored)).toEqual({
        code: ErrorCode.VALIDATION,
        message: MESSAGE,
        userMessage:
          'The active gene panel cannot be applied: none of its 1 gene(s) has coordinates for genome build GRCh37. Deactivate the panel or use one that covers this build.'
      })
    })

    it('a panel without any genes applies no restriction', () => {
      const emptyPanel = sqlite.panels.createPanel({ name: 'guard-empty', source: 'manual' }).id
      const filter = buildVariantFilter(
        grch38Case,
        { active_panel_ids: [emptyPanel] },
        () => sqlite,
        () => null
      )
      expect(sqlite.variants.getVariants(filter, 100, 0).data).toHaveLength(4)
      expect(cohort({ active_panel_ids: [emptyPanel], genome_build: 'GRCh38' })).toHaveLength(4)
    })
  })

  describe('desktop cohort without a read pool, and the cohort export', () => {
    const GRCH37_KEY = '7:150000:A:C'

    beforeEach(() => {
      // The gene sits elsewhere in GRCh37, so the GRCh37 variant at 150,000 is
      // outside the panel — unless GRCh38 coordinates are used by mistake.
      geneRef.getCoordinatesForGenes.mockImplementation((_ids: string[], assembly: string) =>
        assembly === 'GRCh38'
          ? new Map([[GENE.hgncId, { chromosome: '7', start_pos: 100_000, end_pos: 200_000 }]])
          : new Map([[GENE.hgncId, { chromosome: '7', start_pos: 500_000, end_pos: 600_000 }]])
      )
    })

    it('main-thread fallback resolves the panel for the selected genome build', async () => {
      const panel = { active_panel_ids: [panelId], panel_padding_bp: 5000 }
      const keys = async (genomeBuild: string): Promise<string[]> => {
        const result = (await queryCohortVariants(
          { ...panel, genome_build: genomeBuild, limit: 100, offset: 0 } as never,
          () => sqlite,
          () => null
        )) as { data: Array<{ variant_key: string }> }
        return result.data.map(coord).sort()
      }

      expect(await keys('GRCh37')).toEqual([])
      expect(await keys('GRCh38')).toEqual(['7:150000:A:T', '7:202000:A:T', '7:90000:A:<DEL>'])
    })

    it('cohort export restricts to the active panel and build like the cohort table', () => {
      const exported = (params: Record<string, unknown>): string[] => {
        const prepared = prepareCohortExportParams(() => sqlite, params as never)
        expect(prepared).not.toHaveProperty('active_panel_ids')
        return new CohortService(sqlite.db).getCohortVariants(prepared).data.map(coord).sort()
      }
      const panel = { active_panel_ids: [panelId], panel_padding_bp: 5000 }

      expect(exported({ ...panel, genome_build: 'GRCh38' })).toEqual([
        '7:150000:A:T',
        '7:202000:A:T',
        '7:90000:A:<DEL>'
      ])
      expect(exported({ ...panel, genome_build: 'GRCh37' })).toEqual([])
      // No build selected: the table shows GRCh38, so the export must too.
      expect(exported({})).not.toContain(GRCH37_KEY)
      expect(exported({})).toHaveLength(4)
    })
  })

  describe('null-check column filters (DSL is:null / is:notnull)', () => {
    let nullCase: number

    beforeEach(() => {
      nullCase = sqlite.cases.createCase('guard-null', '/tmp/guard-null.json', 0, 'GRCh36')
      sqlite.variants.insertVariantsBatch(nullCase, [
        variant('3', 100, { cadd: 0, gene_symbol: 'ZERO' }),
        variant('3', 200, { cadd: 12.5, gene_symbol: 'SCORED' }),
        variant('3', 300, { cadd: null, gene_symbol: null })
      ])
      sqlite.cohortSummary.rebuild()
    })

    const casePositions = (columnFilters: ColumnFiltersParam): number[] =>
      sqlite.variants
        .getVariants({ case_id: nullCase, column_filters: columnFilters }, 100, 0)
        .data.map((row) => row.pos)
        .sort((a, b) => a - b)
    const cohortPositions = (columnFilters: ColumnFiltersParam): number[] =>
      sqlite.cohort
        .getCohortVariants({ genome_build: 'GRCh36', column_filters: columnFilters })
        .data.map((row) => row.pos)
        .sort((a, b) => a - b)

    it('SQLite case view: a numeric null check means NULL, never zero', () => {
      expect(casePositions({ cadd: { operator: 'is_null', value: '' } })).toEqual([300])
      expect(casePositions({ cadd: { operator: 'not_null', value: '' } })).toEqual([100, 200])
      expect(casePositions({ gene_symbol: { operator: 'is_null', value: '' } })).toEqual([300])
      expect(casePositions({ gene_symbol: { operator: 'not_null', value: '' } })).toEqual([
        100, 200
      ])
    })

    it('SQLite cohort view applies the same null checks', () => {
      expect(cohortPositions({ cadd_phred: { operator: 'is_null', value: '' } })).toEqual([300])
      expect(cohortPositions({ cadd_phred: { operator: 'not_null', value: '' } })).toEqual([
        100, 200
      ])
      expect(cohortPositions({ gene_symbol: { operator: 'is_null', value: '' } })).toEqual([300])
    })

    it('PostgreSQL builders emit IS NULL instead of a comparison with an empty string', () => {
      const casePart = (columnFilters: ColumnFiltersParam): string =>
        buildPostgresVariantQueryParts({ case_id: 1, column_filters: columnFilters }, '"public"')
          .fromAndWhereSql
      expect(casePart({ cadd: { operator: 'is_null', value: '' } })).toContain('v.cadd IS NULL')
      expect(casePart({ gene_symbol: { operator: 'not_null', value: '' } })).toContain(
        "(v.gene_symbol IS NOT NULL AND v.gene_symbol::text <> '')"
      )
      const summary = buildSummaryQueryParts(
        { column_filters: { cadd_phred: { operator: 'is_null', value: '' } } },
        4
      )
      expect(summary.parts.whereParts).toContain('cvs.cadd IS NULL')
      expect(summary.parts.values).toEqual([])
    })
  })

  describe('SQLite shortlist gene panel', () => {
    const config = (baseFilters: Record<string, unknown>): never =>
      ({
        variantTypeScope: ['snv', 'cnv'],
        baseFilters,
        topN: 50,
        rankConfig: {
          weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 },
          pinStarredTop: true
        }
      }) as never
    const shortlist = (
      caseId: number,
      baseFilters: Record<string, unknown>,
      provider: () => GeneReferenceDb | null = () => geneRef as unknown as GeneReferenceDb
    ): number[] =>
      sqlite.shortlistService
        .getShortlist({ caseId, adHocConfig: config(baseFilters) }, provider)
        .rows.map((row) => row.pos)
        .sort((a, b) => a - b)

    it('restricts candidates to the panel regions, like the variant table', () => {
      expect(shortlist(grch38Case, {})).toEqual([90_000, 150_000, 202_000, 300_000])
      expect(shortlist(grch38Case, { activePanelIds: [panelId], panelPaddingBp: 5000 })).toEqual([
        90_000, 150_000, 202_000
      ])
      expect(shortlist(grch38Case, { activePanelIds: [panelId], panelPaddingBp: 0 })).toEqual([
        90_000, 150_000
      ])
    })

    it('fails instead of dropping a panel that cannot be resolved', () => {
      const panel = { activePanelIds: [panelId] }
      expect(() => shortlist(grch38Case, panel, () => null)).toThrow(/Shortlist query failed/)

      // Genes without coordinates for the case's build: the typed, user-facing error.
      const grch37Case = sqlite.cases.createCase('guard-37c', '/tmp/guard-37c.json', 0, 'GRCh37')
      sqlite.variants.insertVariantsBatch(grch37Case, [variant('7', 150_000, { alt: 'G' })])
      expect(() => shortlist(grch37Case, panel)).toThrow(PanelRegionsUnavailableError)
    })
  })

  describe('numeric-looking value on a text column', () => {
    // better-sqlite3 binds JS numbers as REAL, and SQLite renders a REAL as
    // '7.0' before comparing it with a TEXT column — so the value must be
    // bound as text or `chr = 7` can never match the stored '7'.
    it('SQLite case view matches the stored text', () => {
      for (const value of ['600000', 600000]) {
        const result = sqlite.variants.getVariants(
          { case_id: grch38Case, column_filters: { omim_mim_number: { operator: '=', value } } },
          100,
          0
        )
        expect(result.data.map((row) => row.pos)).toEqual([300_000])
      }
    })

    it('SQLite cohort view matches the stored text', () => {
      for (const value of ['7', 7]) {
        const result = sqlite.cohort.getCohortVariants({
          genome_build: 'GRCh38',
          column_filters: { chr: { operator: '=', value } }
        })
        expect(result.data).toHaveLength(4)
      }
    })

    it('PostgreSQL case view binds it as text, as the cohort path does (#510)', () => {
      const params = (column: string): unknown[] =>
        buildPostgresVariantQueryParts(
          { case_id: 1, column_filters: { [column]: { operator: '=', value: '007' } } },
          '"public"'
        ).params
      expect(params('omim_mim_number')).toContain('007')
      expect(params('omim_mim_number')).not.toContain(7)
      expect(params('pos')).toContain(7)
    })
  })

  describe('bare chr / pos column filters', () => {
    const positions = (columnFilters: ColumnFiltersParam): number[] =>
      sqlite.variants
        .getVariants({ case_id: grch38Case, column_filters: columnFilters }, 100, 0)
        .data.map((row) => row.pos)
        .sort((a, b) => a - b)

    // `variant_frequency` is joined into every case query and also has `chr`
    // and `pos`, so an unqualified column reference is ambiguous in SQLite.
    it('SQLite case view accepts them (columns are qualified with the variants table)', () => {
      expect(positions({ chr: { operator: '=', value: '7' } })).toEqual([
        90_000, 150_000, 202_000, 300_000
      ])
      expect(positions({ chr: { operator: 'like', value: '8' } })).toEqual([])
      expect(positions({ pos: { operator: '=', value: '150000' } })).toEqual([150_000])
      expect(positions({ pos: { operator: 'in', value: [90_000, 202_000] } })).toEqual([
        90_000, 202_000
      ])
      expect(positions({ pos: { operator: '>=', value: 202_000 } })).toEqual([202_000, 300_000])
      expect(positions({ pos: { operator: '!=', value: 150_000 } })).toEqual([
        90_000, 202_000, 300_000
      ])
    })

    it('SQLite export SQL built from them is accepted too', async () => {
      const prepared = await prepareVariantExport(() => sqlite, grch38Case, {
        column_filters: {
          chr: { operator: '=', value: '7' },
          pos: { operator: '<', value: 100_000 }
        }
      })
      if (!('compiled' in prepared)) throw new Error(prepared.error)
      const rows = sqlite.db
        .prepare(prepared.compiled.sql)
        .all(...(prepared.compiled.parameters as unknown[])) as Array<{ pos: number }>
      expect(rows.map((row) => row.pos)).toEqual([90_000])
    })
  })

  describe('non-numeric value on a numeric column', () => {
    const MESSAGE = 'Invalid numeric value for column filter "cadd": "abc" is not a number'
    const caseFilters: ColumnFiltersParam = { cadd: { operator: '<', value: 'abc' } }
    const cohortFilters: ColumnFiltersParam = { cadd_phred: { operator: '<', value: 'abc' } }

    it('is rejected by the SQLite and PostgreSQL case builders with the same error', () => {
      expect(() =>
        sqlite.variants.getVariants({ case_id: grch38Case, column_filters: caseFilters }, 10, 0)
      ).toThrow(MESSAGE)
      expect(() =>
        buildPostgresVariantQueryParts({ case_id: 1, column_filters: caseFilters }, '"public"')
      ).toThrow(MESSAGE)
    })

    it('is rejected by the SQLite and PostgreSQL cohort builders with the same error', async () => {
      const cohortMessage = MESSAGE.replace('"cadd"', '"cadd_phred"')
      expect(() => sqlite.cohort.getCohortVariants({ column_filters: cohortFilters })).toThrow(
        cohortMessage
      )
      const query = vi.fn()
      await expect(
        new PostgresCohortRepository({ query } as never, 'public').queryVariants({
          column_filters: cohortFilters
        })
      ).rejects.toThrow(cohortMessage)
      expect(query).not.toHaveBeenCalled()
    })
  })

  it('PostgreSQL text search on a numeric column casts it, as the cohort path does', () => {
    const { fromAndWhereSql } = buildPostgresVariantQueryParts(
      { case_id: 1, column_filters: { cadd: { operator: 'like', value: '2' } } },
      '"public"'
    )
    expect(fromAndWhereSql).toContain('v.cadd::text ILIKE $2')
  })

  it('PostgreSQL cohort frequency filter keeps rows without a frequency and treats 0 as off', () => {
    const active = buildSummaryQueryParts({ max_internal_af: 0.2 }, 4)
    const frequency = '(cvs.carrier_count::double precision / NULLIF(bt.total, 0))'
    expect(active.parts.whereParts).toContain(`(${frequency} IS NULL OR ${frequency} <= $1)`)
    const off = buildSummaryQueryParts({ max_internal_af: 0 }, 4)
    expect(off.parts.whereParts.join(' ')).not.toContain('bt.total')
    expect(off.parts.values).toEqual([])
  })
})
