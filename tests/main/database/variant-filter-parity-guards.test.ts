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
import { prepareVariantExport } from '../../../src/main/ipc/handlers/export-logic'
import { clearPanelIntervalCache } from '../../../src/main/ipc/handlers/panelIntervalHelper'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { buildPostgresVariantQueryParts } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import { buildSummaryQueryParts } from '../../../src/main/storage/postgres/postgres-cohort-summary-query'
import { dispatchTask } from '../../../src/main/workers/db-worker-dispatch'
import type { ColumnFiltersParam } from '../../../src/shared/types/column-filters'

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
      variant('7', 300_000, { gene_symbol: GENE.symbol, cadd: 10 })
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
    expect(result.data.map((row) => row.variant_key).sort()).toEqual([
      '7:150000:A:T',
      '7:202000:A:T',
      '7:90000:A:<DEL>'
    ])
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
    expect(active.parts.whereParts).toContain(
      '(cvs.cohort_frequency IS NULL OR cvs.cohort_frequency <= $1)'
    )
    const off = buildSummaryQueryParts({ max_internal_af: 0 }, 4)
    expect(off.parts.whereParts.join(' ')).not.toContain('cohort_frequency')
    expect(off.parts.values).toEqual([])
  })
})
