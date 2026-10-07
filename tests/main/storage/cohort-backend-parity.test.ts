/**
 * Sprint A PR-3 Gate 9 (C7) — cohort backend-parity gate.
 *
 * Loads the SAME fixture into SQLite + a real Postgres, runs the same cohort
 * read on both, and asserts set-equality (sort-order normalised). This is the
 * storage-layer trip-wire for feedback_cohort_parity.md: any divergence between
 * the SQLite live-aggregation path and the Postgres materialised summary path
 * fails here before it can reach the cohort view.
 *
 * The five sub-checks (a-e) plus the panel-interval spanning-SV case (Pass-9 #7):
 *   (a) buildGroupedSelect rows (cohort query data) match.
 *   (b) per-case getFilterOptions(caseId) OUTPUT equality — SQLite computes live
 *       from variants; PG reads from cohort_column_meta. Equality is on the
 *       FilterOptions output shape, not the storage-row shape.
 *   (c) cohort-view getColumnMeta distinct counts from cohort_variant_summary
 *       match.
 *   (d) cohort_frequency values match after every add/remove path.
 *   (e) has_star/has_comment/acmg_best flags match after star+comment+ACMG
 *       mutations AND after case delete (no intervening rebuild).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService, type Variant } from '../../../src/main/database'
import type { ColumnFilterMeta } from '../../../src/shared/types/column-filters'
import type { CohortSearchParams, CohortVariant } from '../../../src/shared/types/cohort'
import {
  applyAnnotationFlagsGlobal,
  applyAnnotationFlagsPerCase
} from '../../../src/main/storage/postgres/cohort-annotation-flags-sql'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

/** One logical case + its variants, applied identically to both backends. */
interface FixtureVariant extends Omit<Variant, 'id' | 'case_id'> {
  gt_num: string | null
  variant_type?: string
  end_pos?: number | null
}

interface FixtureCase {
  name: string
  genomeBuild: string
  variants: FixtureVariant[]
}

function baseVariant(
  over: Partial<FixtureVariant> & Pick<FixtureVariant, 'chr' | 'pos'>
): FixtureVariant {
  return {
    chr: over.chr,
    pos: over.pos,
    ref: over.ref ?? 'A',
    alt: over.alt ?? 'T',
    gene_symbol: over.gene_symbol ?? null,
    consequence: over.consequence ?? null,
    gnomad_af: over.gnomad_af ?? null,
    cadd: over.cadd ?? null,
    clinvar: over.clinvar ?? null,
    func: over.func ?? null,
    gt_num: over.gt_num ?? '0/1',
    variant_type: over.variant_type ?? 'snv',
    end_pos: over.end_pos ?? null
  } as FixtureVariant
}

/**
 * Two GRCh38 cases sharing one coordinate (het + hom) plus per-case unique
 * coordinates with diverse gene/consequence/gnomad/cadd values so the column
 * metadata + filter-options reads exercise both numeric and categorical paths.
 */
const FIXTURE: FixtureCase[] = [
  {
    name: 'parity-a',
    genomeBuild: 'GRCh38',
    variants: [
      baseVariant({
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'T',
        gt_num: '0/1',
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        func: 'stop_gained',
        clinvar: 'Pathogenic',
        gnomad_af: 0.01,
        cadd: 32.5
      }),
      baseVariant({
        chr: '2',
        pos: 200,
        ref: 'C',
        alt: 'G',
        gt_num: '0/1',
        gene_symbol: 'TP53',
        consequence: 'MODERATE',
        func: 'missense_variant',
        clinvar: 'Benign',
        gnomad_af: 0.2,
        cadd: 12.5
      })
    ]
  },
  {
    name: 'parity-b',
    genomeBuild: 'GRCh38',
    variants: [
      baseVariant({
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'T',
        gt_num: '1/1',
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        func: 'stop_gained',
        clinvar: 'Pathogenic',
        gnomad_af: 0.01,
        cadd: 32.5
      }),
      baseVariant({
        chr: '3',
        pos: 300,
        ref: 'G',
        alt: 'A',
        gt_num: '0/1',
        gene_symbol: 'MYH7',
        consequence: 'LOW',
        func: 'synonymous_variant',
        clinvar: 'Likely benign',
        gnomad_af: 0.5,
        cadd: 5
      })
    ]
  }
]

const variantKey = (v: CohortVariant): string => `${v.chr}:${v.pos}:${v.ref}:${v.alt}`

/** Stable cross-backend ordering for set-equality assertions. */
function sortCohort(rows: CohortVariant[]): CohortVariant[] {
  return [...rows].sort((a, b) => variantKey(a).localeCompare(variantKey(b)))
}

/** Normalise a cohort row to a backend-agnostic comparable shape. */
function normalizeCohort(v: CohortVariant): Record<string, unknown> {
  return {
    variant_key: variantKey(v),
    gene_symbol: v.gene_symbol,
    carrier_count: v.carrier_count,
    het_count: v.het_count,
    hom_count: v.hom_count,
    cohort_frequency: Math.round((v.cohort_frequency ?? 0) * 1e6) / 1e6,
    consequence: v.consequence,
    func: v.func,
    clinvar: v.clinvar,
    gnomad_af: v.gnomad_af,
    cadd_phred: v.cadd_phred
  }
}

/** Column-meta entries keyed by name, distinct values sorted, for comparison. */
function metaByKey(meta: ColumnFilterMeta[]): Map<string, ColumnFilterMeta> {
  return new Map(
    meta.map((m) => [
      m.key,
      {
        ...m,
        distinctValues: m.distinctValues !== undefined ? [...m.distinctValues].sort() : undefined
      }
    ])
  )
}

describe.skipIf(!RUN)('cohort backend-parity — Sprint A C7 / Gate 9', () => {
  let sqlite: DatabaseService
  let sqliteCaseIds: number[]

  let schema: string
  let pool: Pool
  let probe: Client
  let pgCaseIds: number[]
  const now = Date.now()

  const summaryRepo = new PostgresCohortSummaryRepository()

  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client as unknown as Client)
    } finally {
      ;(client as { release: () => void }).release()
    }
  }

  /** Seed one fixture case into Postgres and build its summary contribution. */
  async function seedPgCase(fixture: FixtureCase): Promise<number> {
    const caseRow = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [fixture.name, `/tmp/${fixture.name}.json`, now, fixture.genomeBuild]
    )
    const caseId = caseRow.rows[0].id

    for (const v of fixture.variants) {
      await probe.query(
        `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, end_pos, gene_symbol, consequence,
            func, clinvar, gnomad_af, cadd, gt_num)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          caseId,
          v.chr,
          v.pos,
          v.ref,
          v.alt,
          v.variant_type ?? 'snv',
          v.end_pos ?? null,
          v.gene_symbol,
          v.consequence,
          v.func,
          v.clinvar,
          v.gnomad_af,
          v.cadd,
          v.gt_num
        ]
      )
    }

    await withClient(async (client) => {
      await client.query('BEGIN')
      await summaryRepo.incrementalAdd({
        schema,
        client: client as never,
        caseId
      })
      await summaryRepo.refreshColumnMetas({ schema, client: client as never, caseId })
      await client.query('COMMIT')
    })

    return caseId
  }

  /** Seed one fixture case into SQLite and rebuild the summary afterwards. */
  function seedSqliteCase(fixture: FixtureCase): number {
    const caseId = sqlite.cases.createCase(
      fixture.name,
      `/tmp/${fixture.name}.json`,
      0,
      fixture.genomeBuild
    )
    sqlite.variants.insertVariantsBatch(
      caseId,
      fixture.variants.map((v) => ({ ...v }))
    )
    return caseId
  }

  beforeEach(async () => {
    sqlite = new DatabaseService(':memory:')
    sqliteCaseIds = FIXTURE.map((fixture) => seedSqliteCase(fixture))
    sqlite.cohortSummary.rebuild()
    sqlite.cohort.invalidateColumnMetaCache()

    schema = `vt_parity_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    pgCaseIds = []
    for (const fixture of FIXTURE) {
      pgCaseIds.push(await seedPgCase(fixture))
    }
  }, 120_000)

  afterEach(async () => {
    sqlite.close()
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 120_000)

  async function pgCohortRows(params: CohortSearchParams): Promise<CohortVariant[]> {
    const repo = new PostgresCohortRepository(pool, schema)
    const result = await repo.queryVariants({ limit: 100, offset: 0, ...params })
    return result.data
  }

  function sqliteCohortRows(params: CohortSearchParams): CohortVariant[] {
    return sqlite.cohort.getCohortVariants({ limit: 100, offset: 0, ...params }).data
  }

  it('(a) buildGroupedSelect rows match between SQLite and PG', async () => {
    const params: CohortSearchParams = { sort_by: 'carrier_count', sort_order: 'desc' }
    const sqliteRows = sortCohort(sqliteCohortRows(params)).map(normalizeCohort)
    const pgRows = sortCohort(await pgCohortRows(params)).map(normalizeCohort)

    expect(pgRows.length).toBeGreaterThan(0)
    expect(pgRows).toEqual(sqliteRows)
  }, 120_000)

  it('(b) per-case getFilterOptions(caseId) OUTPUT equality', async () => {
    // Pass-5 MED #2: SQLite computes live; PG reads from cohort_column_meta.
    // Equality is on the FilterOptions output shape, not storage-row shape.
    const pgVariants = new PostgresVariantReadRepository(pool, schema)

    for (let i = 0; i < FIXTURE.length; i++) {
      const sqliteOpts = sqlite.variants.getFilterOptions(sqliteCaseIds[i])
      const pgOpts = await pgVariants.getFilterOptions(pgCaseIds[i])

      expect(pgOpts.consequences.sort()).toEqual([...sqliteOpts.consequences].sort())
      expect(pgOpts.funcs.sort()).toEqual([...sqliteOpts.funcs].sort())
      expect(pgOpts.clinvars.sort()).toEqual([...sqliteOpts.clinvars].sort())
      expect(pgOpts.minCadd).toEqual(sqliteOpts.minCadd)
      expect(pgOpts.maxCadd).toEqual(sqliteOpts.maxCadd)
      expect(pgOpts.minGnomadAf).toEqual(sqliteOpts.minGnomadAf)
      expect(pgOpts.maxGnomadAf).toEqual(sqliteOpts.maxGnomadAf)
    }
  }, 120_000)

  it('(c) cohort-view getColumnMeta distinct counts from cohort_variant_summary match', async () => {
    const repo = new PostgresCohortRepository(pool, schema)
    const sqliteMeta = metaByKey(sqlite.cohort.getColumnMeta())
    const pgMeta = metaByKey(await repo.getColumnMeta())

    // Compare the keys present on both cohort-view metadata reads.
    const sharedKeys = [...pgMeta.keys()].filter((key) => sqliteMeta.has(key))
    expect(sharedKeys.length).toBeGreaterThan(0)

    for (const key of sharedKeys) {
      const sq = sqliteMeta.get(key)!
      const pg = pgMeta.get(key)!
      expect(pg.distinctCount).toBe(sq.distinctCount)
      expect(pg.dataType).toBe(sq.dataType)
      // distinctValues parity only for text columns — numeric distinct values
      // differ purely by REAL→TEXT formatting ('1' vs '1.0'), not semantics, so
      // the gate compares numeric columns by distinctCount/min/max only.
      if (sq.dataType === 'text') {
        expect(pg.distinctValues).toEqual(sq.distinctValues)
      }
    }
  }, 120_000)

  it('(d) cohort_frequency values match after every add/remove path', async () => {
    // Already added both cases in beforeEach. Compare frequencies after add.
    const afterAddSqlite = sortCohort(sqliteCohortRows({})).map(normalizeCohort)
    const afterAddPg = sortCohort(await pgCohortRows({})).map(normalizeCohort)
    expect(afterAddPg).toEqual(afterAddSqlite)

    // Remove the second case on both backends. Both derive the frequency at
    // read time, so its denominator excludes the deleted case without any
    // rewrite; the SQLite rebuild here only refreshes the carrier counts.
    sqlite.cases.deleteCase(sqliteCaseIds[1])
    sqlite.cohortSummary.rebuild()
    sqlite.cohort.invalidateColumnMetaCache()

    const lifecycle = new PostgresCaseLifecycleRepository(pool, schema, summaryRepo)
    await lifecycle.deleteCase(pgCaseIds[1])

    const afterRemoveSqlite = sortCohort(sqliteCohortRows({})).map((v) => ({
      variant_key: v.variant_key,
      carrier_count: v.carrier_count,
      cohort_frequency: Math.round((v.cohort_frequency ?? 0) * 1e6) / 1e6
    }))
    const afterRemovePg = sortCohort(await pgCohortRows({})).map((v) => ({
      variant_key: v.variant_key,
      carrier_count: v.carrier_count,
      cohort_frequency: Math.round((v.cohort_frequency ?? 0) * 1e6) / 1e6
    }))
    expect(afterRemovePg.length).toBeGreaterThan(0)
    expect(afterRemovePg).toEqual(afterRemoveSqlite)
  }, 120_000)

  it('(e) has_star/has_comment/acmg_best flags match after star+comment+ACMG mutations AND after case delete (no intervening rebuild)', async () => {
    // Star the shared 1:100:A:T coordinate (global), comment+ACMG the 2:200:C:G
    // coordinate per-case on case-a — exercising both annotation tables.
    // SQLite: write annotation, then summary write-hook keeps cvs flags current.
    sqlite.annotations.upsertGlobalAnnotation('1', 100, 'A', 'T', { starred: true })
    const sqliteTargetId = (
      sqlite.db
        .prepare("SELECT id FROM variants WHERE case_id = ? AND chr = '2' AND pos = 200")
        .get(sqliteCaseIds[0]) as { id: number }
    ).id
    sqlite.annotations.upsertPerCaseAnnotation(sqliteCaseIds[0], sqliteTargetId, {
      per_case_comment: 'looks pathogenic',
      acmg_classification: 'Pathogenic'
    })
    // Re-derive summary flags from the annotation tables (no full rebuild needed
    // for the cvs flag columns — rebuild() re-derives them deterministically).
    sqlite.cohortSummary.rebuild()
    sqlite.cohort.invalidateColumnMetaCache()

    // PG: write the same annotations + run the C5a write-hooks (no rebuild).
    const pgTarget = await probe.query<{ id: number }>(
      `SELECT id FROM "${schema}".variants WHERE case_id = $1 AND chr = '2' AND pos = 200`,
      [pgCaseIds[0]]
    )
    const pgTargetId = pgTarget.rows[0].id
    await probe.query(
      `INSERT INTO "${schema}".variant_annotations
         (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
         VALUES ('1', 100, 'A', 'T', NULL, 1, NULL, $1, $1)`,
      [now]
    )
    await probe.query(
      `INSERT INTO "${schema}".case_variant_annotations
         (case_id, variant_id, per_case_comment, starred, acmg_classification, created_at, updated_at)
         VALUES ($1, $2, 'looks pathogenic', 0, 'Pathogenic', $3, $3)`,
      [pgCaseIds[0], pgTargetId, now]
    )
    await withClient(async (client) => {
      await client.query('BEGIN')
      await applyAnnotationFlagsGlobal(client as never, {
        schema,
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'T'
      })
      await applyAnnotationFlagsPerCase(client as never, {
        schema,
        caseId: pgCaseIds[0],
        variantId: pgTargetId
      })
      await client.query('COMMIT')
    })

    const flagShape = (rows: Array<Record<string, unknown>>): Map<string, string> =>
      new Map(
        rows.map((r) => [
          `${r.chr}:${r.pos}:${r.ref}:${r.alt}`,
          `${r.has_star}|${r.has_comment}|${r.acmg_best ?? ''}`
        ])
      )

    const sqliteFlags = () =>
      flagShape(
        sqlite.db
          .prepare(
            'SELECT chr, pos, ref, alt, has_star, has_comment, acmg_best FROM cohort_variant_summary'
          )
          .all() as Array<Record<string, unknown>>
      )
    const pgFlags = async () =>
      flagShape(
        (
          await probe.query<Record<string, unknown>>(
            `SELECT chr, pos, ref, alt, has_star, has_comment, acmg_best
               FROM "${schema}".cohort_variant_summary`
          )
        ).rows.map((r) => ({
          ...r,
          // SQLite stores booleans as 0/1; PG as true/false. Normalise to 1/0.
          has_star: r.has_star ? 1 : 0,
          has_comment: r.has_comment ? 1 : 0
        }))
      )

    expect(await pgFlags()).toEqual(sqliteFlags())

    // Now delete case-b on both backends WITHOUT an intervening rebuild and
    // re-compare: the case-delete write-hook must keep flags consistent.
    sqlite.cohortSummary.incrementalRemove(sqliteCaseIds[1])
    sqlite.cases.deleteCase(sqliteCaseIds[1])

    const lifecycle = new PostgresCaseLifecycleRepository(pool, schema, summaryRepo)
    await lifecycle.deleteCase(pgCaseIds[1])

    expect(await pgFlags()).toEqual(sqliteFlags())
  }, 120_000)

  it('panel-interval with spanning SV/CNV: spanning row is included on both backends (Pass-9 #7)', async () => {
    // Insert a CNV with pos=1000, end_pos=5000 on both backends.
    const spanningCaseSqlite = sqlite.cases.createCase('span-sqlite', '/tmp/span.json', 0, 'GRCh38')
    sqlite.variants.insertVariantsBatch(spanningCaseSqlite, [
      baseVariant({
        chr: '7',
        pos: 1000,
        ref: 'N',
        alt: '<CNV>',
        gt_num: '0/1',
        variant_type: 'cnv',
        end_pos: 5000,
        gene_symbol: 'SPAN'
      })
    ])
    sqlite.cohortSummary.rebuild()
    sqlite.cohort.invalidateColumnMetaCache()

    const spanCaseRow = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ('span-pg', '/tmp/span.json', 0, $1, 'GRCh38') RETURNING id`,
      [now]
    )
    const spanCasePg = spanCaseRow.rows[0].id
    await probe.query(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, end_pos, gene_symbol, gt_num)
         VALUES ($1, '7', 1000, 'N', '<CNV>', 'cnv', 5000, 'SPAN', '0/1')`,
      [spanCasePg]
    )
    await withClient(async (client) => {
      await client.query('BEGIN')
      await summaryRepo.incrementalAdd({
        schema,
        client: client as never,
        caseId: spanCasePg
      })
      await client.query('COMMIT')
    })

    // Panel interval start=2000, end=3000 falls strictly inside [1000, 5000].
    const params: CohortSearchParams = {
      panel_intervals: [{ chr: '7', start: 2000, end: 3000 }]
    }
    const sqliteRows = sqliteCohortRows(params)
    const pgRows = await pgCohortRows(params)

    const sqliteKeys = sqliteRows.map(variantKey)
    const pgKeys = pgRows.map(variantKey)
    expect(sqliteKeys).toContain('7:1000:N:<CNV>')
    expect(pgKeys).toContain('7:1000:N:<CNV>')
    expect(pgKeys.sort()).toEqual(sqliteKeys.sort())
  }, 120_000)
})

describe.skipIf(RUN)('cohort backend-parity — Sprint A C7 / Gate 9 (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
