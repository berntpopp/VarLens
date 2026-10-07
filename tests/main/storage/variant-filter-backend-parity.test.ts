/**
 * Issue #447 guardrail — variant-filter backend parity.
 *
 * Seeds the SAME fixture into SQLite and a real PostgreSQL schema, runs one
 * table of filters through every read path that builds the shared variant
 * filter, and asserts the returned variant sets are identical (and equal to an
 * explicit expectation, so "identically wrong" cannot pass):
 *
 *   desktop case   — buildVariantFilter + VariantRepository.getVariants
 *   desktop export — prepareVariantExport (compiled export SQL)
 *   desktop cohort — db-worker dispatch `cohort:variants`
 *   web case       — PostgresVariantReadRepository.queryVariants
 *   web export     — PostgresExportRepository.streamVariantRows
 *   web cohort     — PostgresCohortRepository.queryVariants (summary path)
 *   web cohort live — PostgresCohortRepository.streamCohortRows (live path)
 *
 * Variants are identified by `chr:pos:ref:alt` because row ids differ between
 * the two databases.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1 (picked up by `make web-gate-postgres-tests`).
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const geneRef = vi.hoisted(() => ({
  getCoordinatesForGenes: vi.fn()
}))

vi.mock('../../../src/main/database/geneReferenceLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/database/geneReferenceLoader')>()),
  getGeneReferenceDb: () => geneRef
}))

import { DatabaseService } from '../../../src/main/database'
import type { Repositories } from '../../../src/main/database/createRepositories'
import type { GeneReferenceDb } from '../../../src/main/database/GeneReferenceDb'
import { prepareVariantExport } from '../../../src/main/ipc/handlers/export-logic'
import { clearPanelIntervalCache } from '../../../src/main/ipc/handlers/panelIntervalHelper'
import { buildVariantFilter } from '../../../src/main/ipc/handlers/variants-logic'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresPanelIntervalResolver } from '../../../src/main/storage/postgres/postgres-panel-interval-resolver'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresExportRepository } from '../../../src/main/storage/postgres/PostgresExportRepository'
import { PostgresShortlistService } from '../../../src/main/storage/postgres/PostgresShortlistService'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import { SqliteReadExecutor } from '../../../src/main/storage/sqlite/SqliteReadExecutor'
import { dispatchTask } from '../../../src/main/workers/db-worker-dispatch'
import type { CohortSearchParams } from '../../../src/shared/types/cohort'
import type { VariantFilter } from '../../../src/shared/types/database'
import type { PanelResolutionRequest } from '../../../src/shared/types/panels'
import type { FilterState } from '../../../src/shared/types/filters'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'
import {
  A,
  B,
  C,
  FIXTURE,
  PANEL_GENE,
  PARTIAL_PANEL_GENES,
  PARTIAL_PANEL_UNMAPPED,
  fixtureGeneCoordinates,
  keyOf,
  keysOf,
  type ParityFixtureVariant
} from './variant-filter-backend-parity.fixture'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

type CaseFilter = Partial<Omit<VariantFilter, 'case_id'>>
type Outcome = { keys: string[] } | { error: string }

async function outcome(run: () => Promise<string[]> | string[]): Promise<Outcome> {
  try {
    return { keys: [...(await run())].sort() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const ok = (variants: ParityFixtureVariant[]): Outcome => ({ keys: keysOf(variants) })

describe.skipIf(!RUN)('variant filter backend parity — issue #447', () => {
  let sqlite: DatabaseService
  let sqliteCaseIds: number[]
  let sqlitePanelId: number
  let sqliteEmptyPanelId: number
  let sqlitePartialPanelId: number

  let schema: string
  let pool: Pool
  let pgCaseIds: number[]
  let pgPanelId: number
  let pgEmptyPanelId: number
  let pgPartialPanelId: number

  const summaryRepo = new PostgresCohortSummaryRepository()

  async function seedPostgres(): Promise<void> {
    pgCaseIds = []
    for (const fixture of FIXTURE) {
      const caseRow = await pool.query<{ id: string }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, $4) RETURNING id`,
        [fixture.name, `/tmp/${fixture.name}.json`, Date.now(), fixture.genomeBuild]
      )
      const caseId = Number(caseRow.rows[0].id)
      pgCaseIds.push(caseId)
      for (const v of fixture.variants) {
        await pool.query(
          `INSERT INTO "${schema}".variants
             (case_id, chr, pos, ref, alt, variant_type, end_pos, gene_symbol, gnomad_af, cadd, gt_num)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            caseId,
            v.chr,
            v.pos,
            v.ref,
            v.alt,
            v.variant_type,
            v.end_pos,
            v.gene_symbol,
            v.gnomad_af,
            v.cadd,
            v.gt_num
          ]
        )
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await summaryRepo.incrementalAdd({
          schema,
          client: client as never,
          caseId,
          genomeBuild: fixture.genomeBuild
        })
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
    await pool.query(
      `INSERT INTO "${schema}".variant_frequency (chr, pos, ref, alt, case_count)
       SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id) FROM "${schema}".variants
       GROUP BY chr, pos, ref, alt`
    )
    // A.padding has no frequency row: the internal-AF filter must keep it.
    await pool.query(
      `DELETE FROM "${schema}".variant_frequency WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4`,
      [A.padding.chr, A.padding.pos, A.padding.ref, A.padding.alt]
    )

    const panel = async (name: string): Promise<number> => {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO "${schema}".panels (name, source, created_at, updated_at)
         VALUES ($1, 'manual', $2, $2) RETURNING id`,
        [name, Date.now()]
      )
      return Number(row.rows[0].id)
    }
    pgPanelId = await panel('parity-panel')
    pgEmptyPanelId = await panel('parity-empty-panel')
    // Deliberately NOT inserted into case_active_panels: the filter carries the
    // panel ids itself, exactly as on SQLite.
    pgPartialPanelId = await panel('parity-partial-panel')
    for (const [panelId, gene] of [
      [pgPanelId, PANEL_GENE] as const,
      ...PARTIAL_PANEL_GENES.map((partialGene) => [pgPartialPanelId, partialGene] as const)
    ]) {
      await pool.query(
        `INSERT INTO "${schema}".panel_genes (panel_id, hgnc_id, symbol) VALUES ($1, $2, $3)`,
        [panelId, gene.hgncId, gene.symbol]
      )
    }
  }

  function seedSqlite(): void {
    sqlite = new DatabaseService(':memory:')
    sqliteCaseIds = FIXTURE.map((fixture) => {
      const caseId = sqlite.cases.createCase(
        fixture.name,
        `/tmp/${fixture.name}.json`,
        0,
        fixture.genomeBuild
      )
      sqlite.variants.insertVariantsBatch(caseId, fixture.variants.map((v) => ({ ...v })) as never)
      return caseId
    })
    sqlite.cohortSummary.rebuild()
    sqlite.cohort.invalidateColumnMetaCache()
    sqlite.db.exec(
      `DELETE FROM variant_frequency;
       INSERT INTO variant_frequency (chr, pos, ref, alt, case_count)
       SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id) FROM variants GROUP BY chr, pos, ref, alt`
    )
    sqlite.db
      .prepare('DELETE FROM variant_frequency WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?')
      .run(A.padding.chr, A.padding.pos, A.padding.ref, A.padding.alt)

    sqlitePanelId = sqlite.panels.createPanel({ name: 'parity-panel', source: 'manual' }).id
    sqliteEmptyPanelId = sqlite.panels.createPanel({
      name: 'parity-empty-panel',
      source: 'manual'
    }).id
    sqlite.panels.setGenes(sqlitePanelId, [PANEL_GENE])
    sqlitePartialPanelId = sqlite.panels.createPanel({
      name: 'parity-partial-panel',
      source: 'manual'
    }).id
    sqlite.panels.setGenes(sqlitePartialPanelId, PARTIAL_PANEL_GENES)
  }

  beforeAll(async () => {
    seedSqlite()

    schema = `vt_filter_parity_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 3 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    await seedPostgres()
  }, 180_000)

  afterAll(async () => {
    sqlite?.close()
    if (pool) await pool.end()
    if (schema !== undefined) {
      const cleaner = new Client({ connectionString: PG_URL })
      await cleaner.connect()
      await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await cleaner.end()
    }
  }, 120_000)

  beforeEach(() => {
    clearPanelIntervalCache()
    geneRef.getCoordinatesForGenes.mockReset()
    geneRef.getCoordinatesForGenes.mockImplementation(fixtureGeneCoordinates)
  })

  // ── Path runners ──────────────────────────────────────────────────────────

  /** Backend panel ids by logical id: 1 = panel, 2 = empty, 3 = partial. */
  const sqlitePanels = (): number[] => [sqlitePanelId, sqliteEmptyPanelId, sqlitePartialPanelId]
  const pgPanels = (): number[] => [pgPanelId, pgEmptyPanelId, pgPartialPanelId]

  /** Substitute the backend-specific panel ids for the logical ones. */
  function withPanels<T extends { active_panel_ids?: number[] }>(filter: T, ids: number[]): T {
    if (filter.active_panel_ids === undefined) return { ...filter }
    return { ...filter, active_panel_ids: filter.active_panel_ids.map((id) => ids[id - 1]) }
  }

  function casePaths(caseIndex: number, filter: CaseFilter): Record<string, Promise<Outcome>> {
    const sqliteFilter = (): CaseFilter => structuredClone(withPanels(filter, sqlitePanels()))
    const pgFilter = (): VariantFilter => ({
      ...structuredClone(withPanels(filter, pgPanels())),
      case_id: pgCaseIds[caseIndex]
    })
    const sqliteCaseId = sqliteCaseIds[caseIndex]

    return {
      'desktop case': outcome(() => {
        const full = buildVariantFilter(
          sqliteCaseId,
          sqliteFilter(),
          () => sqlite,
          () => null
        )
        return sqlite.variants.getVariants(full, 1000, 0).data.map(keyOf)
      }),
      'desktop export': outcome(async () => {
        const prepared = await prepareVariantExport(() => sqlite, sqliteCaseId, sqliteFilter())
        if (!('compiled' in prepared)) throw new Error(prepared.error ?? 'export refused')
        const rows = sqlite.db
          .prepare(prepared.compiled.sql)
          .all(...(prepared.compiled.parameters as unknown[])) as ParityFixtureVariant[]
        expect(prepared.count).toBe(rows.length)
        return rows.map(keyOf)
      }),
      'web case': outcome(async () => {
        const repo = new PostgresVariantReadRepository(pool, schema)
        return (await repo.queryVariants(pgFilter(), 1000, 0)).data.map(keyOf)
      }),
      'web export': outcome(async () => {
        const repo = new PostgresExportRepository(pool, schema)
        const keys: string[] = []
        for await (const row of repo.streamVariantRows(pgFilter())) {
          keys.push(keyOf(row as unknown as ParityFixtureVariant))
        }
        return keys
      })
    }
  }

  function cohortPaths(params: CohortSearchParams): Record<string, Promise<Outcome>> {
    const base = { limit: 1000, offset: 0, ...params }
    const pgParams = (): CohortSearchParams => structuredClone(withPanels(base, pgPanels()))
    return {
      'desktop cohort': outcome(() => {
        const repos = (sqlite as unknown as { _repos: Repositories })._repos
        const result = dispatchTask(
          { db: sqlite.db, repos, geneRefDb: geneRef as unknown as GeneReferenceDb },
          {
            type: 'cohort:variants',
            params: [structuredClone(withPanels(base, sqlitePanels()))]
          } as never
        ) as { data: Array<{ variant_key: string }> }
        return result.data.map((row) => row.variant_key)
      }),
      'web cohort': outcome(async () => {
        const repo = new PostgresCohortRepository(pool, schema)
        return (await repo.queryVariants(pgParams())).data.map((row) => row.variant_key)
      }),
      'web cohort live': outcome(async () => {
        const repo = new PostgresCohortRepository(pool, schema)
        const keys: string[] = []
        for await (const row of repo.streamCohortRows(pgParams())) {
          keys.push(String(row.variant_key))
        }
        return keys
      })
    }
  }

  /** Shortlist Stage 1 on both backends (ad-hoc config, every candidate kept). */
  function shortlistPaths(
    caseIndex: number,
    baseFilters: Partial<FilterState>
  ): Record<string, Promise<Outcome>> {
    const configFor = (ids: number[]): ShortlistConfig => ({
      variantTypeScope: ['snv', 'cnv'],
      baseFilters: {
        ...baseFilters,
        ...(baseFilters.activePanelIds !== undefined
          ? { activePanelIds: baseFilters.activePanelIds.map((id) => ids[id - 1]) }
          : {})
      },
      topN: 100,
      rankConfig: {
        weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 },
        pinStarredTop: true
      }
    })
    return {
      'desktop shortlist': outcome(() =>
        sqlite.shortlistService
          .getShortlist(
            {
              caseId: sqliteCaseIds[caseIndex],
              adHocConfig: configFor(sqlitePanels())
            },
            () => geneRef as unknown as GeneReferenceDb
          )
          .rows.map(keyOf)
      ),
      'web shortlist': outcome(async () => {
        const service = new PostgresShortlistService({
          pool,
          schema,
          filterPresets: { getPreset: async () => null },
          variants: new PostgresVariantReadRepository(pool, schema)
        })
        const result = await service.getShortlist({
          caseId: pgCaseIds[caseIndex],
          adHocConfig: configFor(pgPanels())
        })
        return result.rows.map(keyOf)
      })
    }
  }

  async function expectAll(
    paths: Record<string, Promise<Outcome>>,
    expected: Outcome | { errorMatching: RegExp }
  ): Promise<void> {
    const resolved: Record<string, Outcome> = {}
    for (const [name, pending] of Object.entries(paths)) resolved[name] = await pending

    if ('errorMatching' in expected) {
      const messages = Object.values(resolved).map((entry) =>
        'error' in entry ? entry.error : `returned ${entry.keys.length} rows instead of failing`
      )
      for (const message of messages) expect(message).toMatch(expected.errorMatching)
      expect(new Set(messages).size, JSON.stringify(resolved)).toBe(1)
      return
    }
    // One assertion over every path so a failure shows all divergences at once.
    expect(resolved).toEqual(
      Object.fromEntries(Object.keys(resolved).map((name) => [name, expected]))
    )
  }

  // ── Panel regions ─────────────────────────────────────────────────────────

  const PANEL = { active_panel_ids: [1], panel_padding_bp: 5000 }
  const PANEL_A = [A.inGene, A.padding, A.spanningCnv, A.startEdge, A.endEdge, A.touchingDup]

  it('panel regions: spanning CNV, padded intergenic SNV and in-gene SNV (case + export)', async () => {
    await expectAll(casePaths(0, PANEL), ok(PANEL_A))
    await expectAll(casePaths(1, PANEL), ok([B.sharedHom, B.padding]))
  }, 120_000)

  it('panel regions resolve gene coordinates for the genome build of the case', async () => {
    await expectAll(casePaths(2, PANEL), ok([C.inGrch37Gene]))
  }, 120_000)

  it('panel regions: all cohort paths return the union of the case-view sets', async () => {
    await expectAll(cohortPaths({ ...PANEL, genome_build: 'GRCh38' }), ok([...PANEL_A, B.padding]))
    await expectAll(cohortPaths({ ...PANEL, genome_build: 'GRCh37' }), ok([C.inGrch37Gene]))
  }, 120_000)

  it('panel padding is honoured (padding 0 drops the intergenic SNV)', async () => {
    const noPadding = { active_panel_ids: [1], panel_padding_bp: 0 }
    await expectAll(casePaths(0, noPadding), ok([A.inGene, A.spanningCnv]))
    await expectAll(
      cohortPaths({ ...noPadding, genome_build: 'GRCh38' }),
      ok([A.inGene, A.spanningCnv])
    )
  }, 120_000)

  it('a panel WITHOUT genes applies no restriction on every path', async () => {
    const emptyPanel = { active_panel_ids: [2], panel_padding_bp: 5000 }
    await expectAll(casePaths(1, emptyPanel), ok(Object.values(B)))
    await expectAll(cohortPaths({ ...emptyPanel, genome_build: 'GRCh37' }), ok(Object.values(C)))
    // Together with a panel that does resolve, only the resolved regions restrict.
    const both = { active_panel_ids: [1, 2], panel_padding_bp: 5000 }
    await expectAll(casePaths(1, both), ok([B.sharedHom, B.padding]))
  }, 120_000)

  it('a panel with SOME unmapped genes still filters, and both backends name the same unmapped genes', async () => {
    const PARTIAL = { active_panel_ids: [3], panel_padding_bp: 5000 }
    await expectAll(casePaths(0, PARTIAL), ok(PANEL_A))
    await expectAll(casePaths(2, PARTIAL), ok([C.inGrch37Gene]))
    await expectAll(
      cohortPaths({ ...PARTIAL, genome_build: 'GRCh38' }),
      ok([...PANEL_A, B.padding])
    )

    /** `panels:resolutionStatus` on both backends; `scope` is a case index or a build. */
    const status = async (logicalIds: number[], scope: number | string): Promise<unknown[]> => {
      const request = (ids: number[], caseIds: number[]): PanelResolutionRequest => ({
        panelIds: logicalIds.map((id) => ids[id - 1]),
        ...(typeof scope === 'number' ? { caseId: caseIds[scope] } : { genomeBuild: scope })
      })
      return [
        await new SqliteReadExecutor(sqlite, null).execute({
          type: 'panels:resolutionStatus',
          params: [request(sqlitePanels(), sqliteCaseIds)]
        }),
        await new PostgresPanelIntervalResolver(pool, schema).getResolutionStatus(
          request(pgPanels(), pgCaseIds)
        )
      ]
    }
    const partial = (build: string, totalGenes = 4): unknown => ({
      genomeBuild: build,
      totalGenes,
      unmappedCount: PARTIAL_PANEL_UNMAPPED[build].length,
      unmappedGenes: PARTIAL_PANEL_UNMAPPED[build]
    })
    const none = { genomeBuild: 'GRCh38', unmappedCount: 0, unmappedGenes: [] }

    // The build comes from the case (case view) or from the request (cohort view).
    expect(await status([3], 0)).toEqual([partial('GRCh38'), partial('GRCh38')])
    expect(await status([3], 2)).toEqual([partial('GRCh37'), partial('GRCh37')])
    expect(await status([3], 'GRCh37')).toEqual([partial('GRCh37'), partial('GRCh37')])
    // A gene shared by two active panels is counted once.
    expect(await status([1, 3], 'GRCh38')).toEqual([partial('GRCh38'), partial('GRCh38')])
    expect(await status([1], 0)).toEqual(Array(2).fill({ ...none, totalGenes: 1 }))
    expect(await status([2], 0)).toEqual(Array(2).fill({ ...none, totalGenes: 0 }))
  })

  it('a panel whose genes have no coordinates for the build is refused on every path', async () => {
    // No silent "no restriction": the user would see every variant while
    // believing the panel is active.
    geneRef.getCoordinatesForGenes.mockImplementation(() => new Map())
    const refused = (build: string): { errorMatching: RegExp } => ({
      errorMatching: new RegExp(
        `^Active gene panel resolves to no genomic regions: none of its 1 gene\\(s\\) has coordinates for genome build ${build}$`
      )
    })
    await expectAll(casePaths(0, PANEL), refused('GRCh38'))
    await expectAll(casePaths(2, PANEL), refused('GRCh37'))
    await expectAll(cohortPaths({ ...PANEL, genome_build: 'GRCh38' }), refused('GRCh38'))
    await expectAll(cohortPaths({ ...PANEL, genome_build: 'GRCh37' }), refused('GRCh37'))
  }, 120_000)

  it('a failing region resolution fails every path instead of widening or narrowing', async () => {
    geneRef.getCoordinatesForGenes.mockImplementation(() => {
      throw new Error('gene reference unavailable')
    })
    await expectAll(casePaths(0, PANEL), { errorMatching: /gene reference unavailable/ })
    await expectAll(cohortPaths({ ...PANEL, genome_build: 'GRCh38' }), {
      errorMatching: /gene reference unavailable/
    })
  }, 120_000)

  // ── NULL-inclusive ranges ─────────────────────────────────────────────────

  const A_ALL = Object.values(A)
  const withoutCadd = A_ALL.filter((v) => v.cadd === null)
  const withoutGnomad = A_ALL.filter((v) => v.gnomad_af === null)

  it('gnomad_af_max and cadd_min keep rows without a value', async () => {
    await expectAll(casePaths(0, { gnomad_af_max: 0.01 }), ok([A.inGene, ...withoutGnomad]))
    await expectAll(casePaths(0, { cadd_min: 20 }), ok([A.inGene, A.otherChr, ...withoutCadd]))
    await expectAll(
      cohortPaths({ gnomad_af_max: 0.01, genome_build: 'GRCh38' }),
      ok([A.inGene, ...withoutGnomad, B.padding])
    )
    await expectAll(
      cohortPaths({ cadd_min: 20, genome_build: 'GRCh38' }),
      ok([A.inGene, A.otherChr, ...withoutCadd, B.padding])
    )
  }, 120_000)

  it('range column filters keep empty values by default and drop them on request', async () => {
    for (const value of [20, '20']) {
      await expectAll(
        casePaths(0, { column_filters: { cadd: { operator: '>=', value } } }),
        ok([A.inGene, A.otherChr, ...withoutCadd])
      )
      await expectAll(
        casePaths(0, { column_filters: { cadd: { operator: '>=', value, includeEmpty: false } } }),
        ok([A.inGene, A.otherChr])
      )
      await expectAll(
        cohortPaths({
          genome_build: 'GRCh38',
          column_filters: { cadd_phred: { operator: '>=', value } }
        }),
        ok([A.inGene, A.otherChr, ...withoutCadd, B.padding])
      )
      await expectAll(
        cohortPaths({
          genome_build: 'GRCh38',
          column_filters: { cadd_phred: { operator: '>=', value, includeEmpty: false } }
        }),
        ok([A.inGene, A.otherChr])
      )
    }
  }, 120_000)

  it('case-view internal frequency keeps variants without a frequency row; 0 means no filter', async () => {
    // 3 cases: A.inGene is carried by 2 (0.667), everything else by 1 (0.333).
    const rare = A_ALL.filter((v) => v !== A.inGene)
    await expectAll(casePaths(0, { max_internal_af: 0.5 }), ok(rare))
    await expectAll(casePaths(0, { max_internal_af: 0 }), ok(A_ALL))
  }, 120_000)

  it('cohort internal frequency: 0 means no filter and a missing frequency is kept', async () => {
    const grch38 = [...A_ALL, B.padding, B.unrelated]
    const rare = grch38.filter((v) => v !== A.inGene)
    const params = { genome_build: 'GRCh38' }
    // 2 GRCh38 cases: A.inGene is carried by both (1.0), everything else by one (0.5).
    await expectAll(cohortPaths({ ...params, max_internal_af: 0.6 }), ok(rare))
    await expectAll(cohortPaths({ ...params, max_internal_af: 0 }), ok(grch38))

    // SQLite reads the stored, nullable summary frequency: with the value
    // missing its listing must keep the row. PostgreSQL derives the frequency
    // from carrier_count on every read (summary and live path alike), so it
    // never sees a NULL: blanking the unused column changes nothing there.
    const where = `chr = '${A.inGene.chr}' AND pos = ${A.inGene.pos} AND genome_build = 'GRCh38'`
    sqlite.db.exec(`UPDATE cohort_variant_summary SET cohort_frequency = NULL WHERE ${where}`)
    await pool.query(
      `UPDATE "${schema}".cohort_variant_summary SET cohort_frequency = NULL WHERE ${where}`
    )
    try {
      const paths = cohortPaths({ ...params, max_internal_af: 0.6 })
      expect(await paths['desktop cohort']).toEqual(ok(grch38))
      expect(await paths['web cohort']).toEqual(ok(rare))
    } finally {
      sqlite.db.exec(`UPDATE cohort_variant_summary SET cohort_frequency = 1.0 WHERE ${where}`)
      await pool.query(
        `UPDATE "${schema}".cohort_variant_summary SET cohort_frequency = 1.0 WHERE ${where}`
      )
    }
  }, 120_000)

  // ── Numeric-looking value on a text column ────────────────────────────────

  it('a number compared with a text column matches the stored text on every path', async () => {
    // The DSL sends `gene_symbol = 5` style values as numbers.
    await expectAll(
      cohortPaths({ genome_build: 'GRCh38', column_filters: { chr: { operator: '=', value: 8 } } }),
      ok([A.otherChr])
    )
    await expectAll(
      cohortPaths({
        genome_build: 'GRCh38',
        column_filters: { chr: { operator: '=', value: '8' } }
      }),
      ok([A.otherChr])
    )
  }, 120_000)

  // ── Bare chr / pos column filters ─────────────────────────────────────────

  it('bare chr and pos column filters select the same rows on every path', async () => {
    const chr7 = A_ALL.filter((v) => v.chr === '7')
    const grch38 = { genome_build: 'GRCh38' }
    await expectAll(
      casePaths(0, { column_filters: { chr: { operator: '=', value: '7' } } }),
      ok(chr7)
    )
    // A number against the text column `chr` (the DSL sends `chr = 8` as a number).
    await expectAll(
      casePaths(0, { column_filters: { chr: { operator: '=', value: 8 } } }),
      ok([A.otherChr])
    )
    await expectAll(
      cohortPaths({ ...grch38, column_filters: { chr: { operator: '=', value: 8 } } }),
      ok([A.otherChr])
    )
    await expectAll(
      casePaths(0, { column_filters: { chr: { operator: 'in', value: ['8'] } } }),
      ok([A.otherChr])
    )
    await expectAll(
      cohortPaths({ ...grch38, column_filters: { chr: { operator: '=', value: '8' } } }),
      ok([A.otherChr])
    )
    for (const value of [150_000, '150000']) {
      await expectAll(
        casePaths(0, { column_filters: { pos: { operator: '=', value } } }),
        ok([A.inGene, A.otherChr])
      )
      await expectAll(
        cohortPaths({ ...grch38, column_filters: { pos: { operator: '=', value } } }),
        ok([A.inGene, A.otherChr])
      )
    }
    await expectAll(
      casePaths(0, { column_filters: { pos: { operator: 'in', value: [90_000, 300_000] } } }),
      ok([A.spanningCnv, A.symbolOnly])
    )
    await expectAll(
      casePaths(0, {
        column_filters: {
          chr: { operator: '=', value: '7' },
          pos: { operator: '>', value: 205_000 }
        }
      }),
      ok([A.afterEnd, A.symbolOnly])
    )
    await expectAll(
      cohortPaths({
        ...grch38,
        column_filters: {
          chr: { operator: '=', value: '7' },
          pos: { operator: '>', value: 205_000 }
        }
      }),
      ok([A.afterEnd, A.symbolOnly])
    )
  }, 120_000)

  // ── Null checks (DSL is:null / is:notnull) ────────────────────────────────

  it('null-check column filters mean "no value", never zero, on every path', async () => {
    const isNull = { operator: 'is_null' as const, value: '' }
    const notNull = { operator: 'not_null' as const, value: '' }
    const unscored = [C.inGrch37Gene, C.grch38Position]
    const grch37 = { genome_build: 'GRCh37' }

    await expectAll(casePaths(2, { column_filters: { cadd: isNull } }), ok(unscored))
    await expectAll(casePaths(2, { column_filters: { cadd: notNull } }), ok([C.zeroScores]))
    await expectAll(casePaths(2, { column_filters: { gnomad_af: isNull } }), ok(unscored))
    await expectAll(
      cohortPaths({ ...grch37, column_filters: { cadd_phred: isNull } }),
      ok(unscored)
    )
    await expectAll(
      cohortPaths({ ...grch37, column_filters: { cadd_phred: notNull } }),
      ok([C.zeroScores])
    )
    await expectAll(cohortPaths({ ...grch37, column_filters: { gnomad_af: isNull } }), ok(unscored))

    // Text column: every case-A variant without a gene symbol.
    const noGene = A_ALL.filter((v) => v.gene_symbol === null)
    const withGene = A_ALL.filter((v) => v.gene_symbol !== null)
    await expectAll(casePaths(0, { column_filters: { gene_symbol: isNull } }), ok(noGene))
    await expectAll(casePaths(0, { column_filters: { gene_symbol: notNull } }), ok(withGene))
    await expectAll(
      cohortPaths({ ...grch37, column_filters: { gene_symbol: notNull } }),
      ok(Object.values(C))
    )

    // Extension column: no fixture variant has a variant_cnv row.
    const cnvs = A_ALL.filter((v) => v.variant_type === 'cnv')
    const cnvType = { variant_type: 'cnv' }
    await expectAll(
      casePaths(0, { ...cnvType, column_filters: { 'cnv.copy_number': isNull } }),
      ok(cnvs)
    )
    await expectAll(
      casePaths(0, { ...cnvType, column_filters: { 'cnv.copy_number': notNull } }),
      ok([])
    )
  }, 120_000)

  // ── Shortlist ─────────────────────────────────────────────────────────────

  it('shortlist candidates honour panel, inheritance, search and starred filters on both backends', async () => {
    const shortlistable = A_ALL // case A holds only snv + cnv rows
    await expectAll(shortlistPaths(0, {}), ok(shortlistable))

    await expectAll(shortlistPaths(0, { activePanelIds: [1], panelPaddingBp: 5000 }), ok(PANEL_A))
    await expectAll(
      shortlistPaths(0, { activePanelIds: [1], panelPaddingBp: 0 }),
      ok([A.inGene, A.spanningCnv])
    )
    await expectAll(shortlistPaths(0, { activePanelIds: [2] }), ok(shortlistable))

    await expectAll(shortlistPaths(1, { inheritanceModes: ['homozygous'] }), ok([B.sharedHom]))
    await expectAll(
      shortlistPaths(1, { inheritanceModes: ['heterozygous'] }),
      ok([B.padding, B.unrelated])
    )

    await expectAll(shortlistPaths(0, { searchQuery: 'OTHER' }), ok([A.otherChr]))

    const star = `INSERT INTO case_variant_annotations (case_id, variant_id, starred, created_at, updated_at)`
    const where = `chr = '${A.otherChr.chr}' AND pos = ${A.otherChr.pos}`
    sqlite.db.exec(
      `${star} SELECT case_id, id, 1, 0, 0 FROM variants WHERE case_id = ${sqliteCaseIds[0]} AND ${where}`
    )
    await pool.query(
      `${star} SELECT case_id, id, 1, 0, 0 FROM "${schema}".variants WHERE case_id = $1 AND ${where}`.replace(
        'INTO case_variant_annotations',
        `INTO "${schema}".case_variant_annotations`
      ),
      [pgCaseIds[0]]
    )
    try {
      await expectAll(shortlistPaths(0, { starredOnly: true }), ok([A.otherChr]))
    } finally {
      sqlite.db.exec('DELETE FROM case_variant_annotations')
      await pool.query(`DELETE FROM "${schema}".case_variant_annotations`)
    }
  }, 120_000)

  it('shortlist refuses a panel without regions for the build on both backends', async () => {
    geneRef.getCoordinatesForGenes.mockImplementation(() => new Map())
    await expectAll(shortlistPaths(0, { activePanelIds: [1] }), {
      errorMatching: /^Active gene panel resolves to no genomic regions/
    })
  }, 120_000)

  // ── Invalid numeric filter value ──────────────────────────────────────────

  it('a non-numeric value on a numeric column is rejected identically everywhere', async () => {
    const rejected = { errorMatching: /Invalid numeric value/ }
    for (const operator of ['<', '=', 'in'] as const) {
      const value = operator === 'in' ? ['abc'] : 'abc'
      await expectAll(casePaths(0, { column_filters: { cadd: { operator, value } } }), rejected)
      await expectAll(
        cohortPaths({
          genome_build: 'GRCh38',
          column_filters: { cadd_phred: { operator, value } }
        }),
        rejected
      )
    }
    await expectAll(
      casePaths(0, { column_filters: { 'cnv.copy_number': { operator: '<', value: 'abc' } } }),
      rejected
    )
  }, 120_000)
})
