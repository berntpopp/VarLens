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
import { openImportSummarySession } from '../../../src/main/database/cohort-summary-case-add'
import { openCaseSummaryRemoval } from '../../../src/main/database/cohort-summary-case-removal'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'
import {
  referenceSummary,
  snapshotSummary,
  type SummarySnapshot
} from '../workers/support/summary-reference'
import type { ColumnFilterMeta } from '../../../src/shared/types/column-filters'
import type { CohortSearchParams, CohortVariant } from '../../../src/shared/types/cohort'
import {
  applyAnnotationFlagsGlobal,
  applyAnnotationFlagsPerCase
} from '../../../src/main/storage/postgres/cohort-annotation-flags-sql'
import { clinvarRank, impactRank } from '../../../src/shared/config/severity.config'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresTranscriptsRepository } from '../../../src/main/storage/postgres/PostgresTranscriptsRepository'
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

/**
 * A third case that annotates shared variants differently (#469):
 *  - 1:100 (carried HIGH / Pathogenic by parity-a and parity-b) as MODIFIER with
 *    another gene, a higher CADD and no ClinVar value: it must NOT supply any
 *    transcript-level column, only the CADD maximum;
 *  - 3:300 (carried LOW / Likely benign by parity-b) as MODERATE with another
 *    gene: it supplies the transcript, whole, while ClinVar and CADD stay
 *    parity-b's, and its removal must give the transcript back to parity-b.
 */
const DIFFERING: FixtureCase = {
  name: 'parity-c',
  genomeBuild: 'GRCh38',
  variants: [
    baseVariant({
      chr: '1',
      pos: 100,
      gene_symbol: 'BRCA1-AS1',
      consequence: 'MODIFIER',
      func: 'intron_variant',
      clinvar: null,
      cadd: 40
    }),
    baseVariant({
      chr: '3',
      pos: 300,
      ref: 'G',
      alt: 'A',
      gene_symbol: 'MYH7B',
      consequence: 'MODERATE',
      func: 'missense_variant',
      clinvar: null,
      cadd: 1
    })
  ]
}

/** Transcripts the third case's variants are switched to. */
const SWITCH_AT_100 = {
  transcript_id: 'ENST00000000001',
  gene_symbol: 'AAAS',
  consequence: 'HIGH',
  func: 'frameshift_variant',
  cdna: 'c.1del',
  aa_change: 'p.M1fs',
  hpo_sim_score: null,
  moi: null,
  is_selected: 0
}
const SWITCH_AT_300 = {
  ...SWITCH_AT_100,
  transcript_id: 'ENST00000000003',
  gene_symbol: 'ZZZ3',
  func: 'stop_gained',
  cdna: 'c.3C>T',
  aa_change: 'p.Q1*'
}

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
            func, clinvar, gnomad_af, cadd, gt_num, impact_rank, clinvar_rank)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
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
          v.gt_num,
          // What the import pipeline stores next to the raw strings (#469).
          impactRank(v.consequence),
          clinvarRank(v.clinvar)
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

  it('(c2) more than 50 distinct values are reported as 51 by both backends, bounds stay exact', async () => {
    // 60 genes / positions / CADD scores, 3 consequences: one high-cardinality
    // text column, two numeric ones, and a low-cardinality column next to them.
    const wide: FixtureCase = {
      name: 'parity-wide',
      genomeBuild: 'GRCh38',
      variants: Array.from({ length: 60 }, (_, index) =>
        baseVariant({
          chr: '7',
          pos: 1000 + index,
          gene_symbol: `GENE${String(index).padStart(2, '0')}`,
          consequence: ['HIGH', 'MODERATE', 'LOW'][index % 3],
          cadd: index / 2
        })
      )
    }
    seedSqliteCase(wide)
    sqlite.cohortSummary.rebuild()
    sqlite.cohort.invalidateColumnMetaCache()
    await seedPgCase(wide)

    const sqliteMeta = metaByKey(sqlite.cohort.getColumnMeta())
    const pgMeta = metaByKey(await new PostgresCohortRepository(pool, schema).getColumnMeta())

    for (const key of ['gene_symbol', 'pos', 'cadd_phred']) {
      expect(pgMeta.get(key)?.distinctCount, key).toBe(51)
      expect(sqliteMeta.get(key)?.distinctCount, key).toBe(51)
      expect(pgMeta.get(key)?.distinctValues, key).toBeUndefined()
      expect(sqliteMeta.get(key)?.distinctValues, key).toBeUndefined()
    }
    for (const key of ['pos', 'cadd_phred']) {
      expect(pgMeta.get(key)?.min, key).toBe(sqliteMeta.get(key)?.min)
      expect(pgMeta.get(key)?.max, key).toBe(sqliteMeta.get(key)?.max)
    }
    expect(pgMeta.get('pos')).toMatchObject({ min: 100, max: 1059 })
    expect(pgMeta.get('consequence')?.distinctCount).toBe(
      sqliteMeta.get('consequence')?.distinctCount
    )
    expect(pgMeta.get('consequence')?.distinctValues).toEqual(
      sqliteMeta.get('consequence')?.distinctValues
    )
    expect(pgMeta.get('consequence')?.distinctValues).toEqual(['HIGH', 'LOW', 'MODERATE'])
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

  it('(f) SQLite: a case with a differing annotation, a transcript switch and its removal keep the maintained summary equal to a fresh rebuild (#461, #460)', async () => {
    const snapshot = (): SummarySnapshot => snapshotSummary(sqlite.database)
    const rebuilt = (): SummarySnapshot => referenceSummary(sqlite.database)
    const at = (pos: number): Record<string, unknown> =>
      sqlite.database
        .prepare(
          `SELECT gene_symbol, consequence, func, clinvar, cadd, transcript, carrier_count
           FROM cohort_variant_summary WHERE pos = ?`
        )
        .get(pos) as Record<string, unknown>
    const variantOf = (caseId: number, pos: number): number =>
      (
        sqlite.database
          .prepare('SELECT id FROM variants WHERE case_id = ? AND pos = ?')
          .get(caseId, pos) as { id: number }
      ).id

    // Differing annotation, merged by the import worker's per-file path. The
    // transcript-level columns come from the most severe carrier row, whole;
    // variant-level facts are aggregated over all carriers. The old rule (a
    // bytewise MAX() per column) gave 1:100 consequence = 'MODIFIER' with
    // func = 'stop_gained' and gene 'BRCA1-AS1': a transcript no carrier has,
    // hidden from the cohort filter impact = HIGH (#469).
    const upkeep = openImportSummarySession(sqlite.database, {
      forceRebuild: false,
      rebuild: () => sqlite.cohortSummary.rebuild(),
      onWarning: (warning) => {
        throw new Error(warning)
      }
    })
    const third = seedSqliteCase(DIFFERING)
    upkeep.addCase(third)
    upkeep.finish()
    const highTranscript = {
      gene_symbol: 'BRCA1',
      consequence: 'HIGH',
      func: 'stop_gained',
      transcript: null
    }
    // CADD is a fact of the variant: the highest any carrier has (40).
    expect(at(100)).toMatchObject({
      ...highTranscript,
      clinvar: 'Pathogenic',
      cadd: 40,
      carrier_count: 3
    })
    // The new carrier supplies the transcript; ClinVar and CADD are parity-b's.
    expect(at(300)).toMatchObject({
      gene_symbol: 'MYH7B',
      consequence: 'MODERATE',
      func: 'missense_variant',
      clinvar: 'Likely benign',
      cadd: 5,
      carrier_count: 2
    })
    expect(snapshot()).toEqual(rebuilt())
    expect(sqlite.cohort.getCohortSummary().unique_variants).toBe(3)
    // The cohort filter impact = HIGH finds the variant again.
    expect(
      sqlite.cohort.getCohortVariants({ consequences: ['HIGH'] }).data.map((v) => v.variant_key)
    ).toEqual(['1:100:A:T'])

    // Transcript switches on the new carrier. At 1:100 it becomes HIGH too and
    // loses the bytewise tie-break on func; at 3:300 it supplies the transcript
    // already and the row follows its new annotation.
    sqlite.transcripts.insertTranscriptAndSwitch(variantOf(third, 100), SWITCH_AT_100)
    expect(at(100)).toMatchObject({ ...highTranscript, cadd: 40, carrier_count: 3 })
    expect(snapshot()).toEqual(rebuilt())
    sqlite.transcripts.insertTranscriptAndSwitch(variantOf(third, 300), SWITCH_AT_300)
    expect(at(300)).toMatchObject({
      gene_symbol: 'ZZZ3',
      consequence: 'HIGH',
      func: 'stop_gained',
      transcript: 'ENST00000000003',
      clinvar: 'Likely benign',
      cadd: 5
    })
    expect(snapshot()).toEqual(rebuilt())

    // Removing the carrier that supplies the transcript of 3:300 and the CADD
    // maximum of 1:100.
    await deleteCasesIncrementally(sqlite.database, [third], {
      deletingAll: false,
      isCancelled: () => false,
      onProgress: () => undefined,
      summary: openCaseSummaryRemoval(sqlite.database)
    })
    expect(at(100)).toMatchObject({
      ...highTranscript,
      clinvar: 'Pathogenic',
      cadd: 32.5,
      carrier_count: 2
    })
    expect(at(300)).toMatchObject({
      gene_symbol: 'MYH7',
      consequence: 'LOW',
      func: 'synonymous_variant',
      clinvar: 'Likely benign',
      cadd: 5,
      transcript: null,
      carrier_count: 1
    })
    expect(snapshot()).toEqual(rebuilt())
    expect(sqlite.cohort.getCohortSummary().unique_variants).toBe(3)
  }, 120_000)

  it('(f) PG: the same sequence leaves PG summary rows equal to SQLite’s after every step', async () => {
    const COLUMNS = `chr, pos, ref, alt, variant_type, genome_build, end_pos, gene_symbol, cdna,
       aa_change, consequence, func, clinvar, gnomad_af, cadd, transcript, omim_mim_number,
       impact_rank, clinvar_rank, carrier_count, het_count, hom_count, has_star, has_comment,
       acmg_best, variant_key`
    const ORDER = 'chr, pos, ref, alt, variant_type, genome_build'
    const NUMERIC = ['pos', 'end_pos', 'carrier_count', 'het_count', 'hom_count']
    const normalise = (row: Record<string, unknown>): Record<string, unknown> => ({
      ...row,
      ...Object.fromEntries(
        NUMERIC.map((key) => [key, row[key] === null ? null : Number(row[key])])
      ),
      // SQLite stores booleans as 0/1; PG as true/false.
      has_star: row.has_star === true || row.has_star === 1 ? 1 : 0,
      has_comment: row.has_comment === true || row.has_comment === 1 ? 1 : 0
    })
    const sqliteRows = (): unknown[] =>
      (
        sqlite.database
          .prepare(`SELECT ${COLUMNS} FROM cohort_variant_summary ORDER BY ${ORDER}`)
          .all() as Array<Record<string, unknown>>
      ).map(normalise)
    // ORDER BY under "C": the default PG collation would order 'chr' values differently.
    const pgRows = async (): Promise<unknown[]> =>
      (
        await probe.query<Record<string, unknown>>(
          `SELECT ${COLUMNS} FROM "${schema}".cohort_variant_summary
            ORDER BY chr COLLATE "C", pos, ref COLLATE "C", alt COLLATE "C",
                     variant_type COLLATE "C", genome_build COLLATE "C"`
        )
      ).rows.map(normalise)
    const pgCohort = new PostgresCohortRepository(pool, schema)
    const expectSameSummary = async (step: string): Promise<void> => {
      expect(await pgRows(), `summary rows after ${step}`).toEqual(sqliteRows())
      // Both maintained summaries equal a fresh rebuild on their backend.
      expect(snapshotSummary(sqlite.database), `SQLite rebuild after ${step}`).toEqual(
        referenceSummary(sqlite.database)
      )
      const maintained = await pgRows()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await summaryRepo.rebuild({ schema, client: client as never })
        const rebuilt = await client.query<Record<string, unknown>>(
          `SELECT ${COLUMNS} FROM "${schema}".cohort_variant_summary
            ORDER BY chr COLLATE "C", pos, ref COLLATE "C", alt COLLATE "C",
                     variant_type COLLATE "C", genome_build COLLATE "C"`
        )
        expect(maintained, `PG rebuild after ${step}`).toEqual(rebuilt.rows.map(normalise))
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
      expect((await pgCohort.getSummary()).unique_variants, `unique_variants after ${step}`).toBe(
        sqlite.cohort.getCohortSummary().unique_variants
      )
    }
    await expectSameSummary('the shared fixture')

    // 1. Differing annotation (see DIFFERING).
    const upkeep = openImportSummarySession(sqlite.database, {
      forceRebuild: false,
      rebuild: () => sqlite.cohortSummary.rebuild(),
      onWarning: (warning) => {
        throw new Error(warning)
      }
    })
    const sqliteThird = seedSqliteCase(DIFFERING)
    upkeep.addCase(sqliteThird)
    upkeep.finish()
    const pgThird = await seedPgCase(DIFFERING)
    await expectSameSummary('adding a case with a differing annotation')

    // The scenario of #469 on PostgreSQL: carriers HIGH, HIGH, MODIFIER give a
    // HIGH row that is one carrier's annotation, and impact = HIGH returns it.
    const pgAt100 = await probe.query(
      `SELECT gene_symbol, consequence, func, clinvar, cadd, impact_rank, clinvar_rank
         FROM "${schema}".cohort_variant_summary WHERE pos = 100`
    )
    expect(pgAt100.rows).toEqual([
      {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        func: 'stop_gained',
        clinvar: 'Pathogenic',
        cadd: 40, // a fact of the variant: the highest any carrier has
        impact_rank: 4,
        clinvar_rank: 15
      }
    ])
    const highOnPg = await pgCohort.queryVariants({ consequences: ['HIGH'] })
    expect(highOnPg.data.map((v) => v.variant_key)).toEqual(['1:100:A:T'])
    expect(
      sqlite.cohort.getCohortVariants({ consequences: ['HIGH'] }).data.map((v) => v.variant_key)
    ).toEqual(['1:100:A:T'])

    // 2. Transcript switches on the new carrier: one that does not change the
    //    representative (1:100) and one that rewrites it (3:300).
    const pgTranscripts = new PostgresTranscriptsRepository(pool, schema)
    for (const [pos, transcript] of [
      [100, SWITCH_AT_100],
      [300, SWITCH_AT_300]
    ] as const) {
      const sqliteVariant = (
        sqlite.database
          .prepare('SELECT id FROM variants WHERE case_id = ? AND pos = ?')
          .get(sqliteThird, pos) as { id: number }
      ).id
      sqlite.transcripts.insertTranscriptAndSwitch(sqliteVariant, transcript)
      const pgVariant = await probe.query<{ id: number }>(
        `SELECT id FROM "${schema}".variants WHERE case_id = $1 AND pos = $2`,
        [pgThird, pos]
      )
      await pgTranscripts.insertTranscriptAndSwitch(
        Number(pgVariant.rows[0].id),
        transcript as never
      )
      await expectSameSummary(`a transcript switch at ${pos}`)
    }
    const pgAt300 = await probe.query(
      `SELECT gene_symbol, consequence, func, transcript, impact_rank
         FROM "${schema}".cohort_variant_summary WHERE pos = 300`
    )
    expect(pgAt300.rows).toEqual([
      {
        gene_symbol: 'ZZZ3',
        consequence: 'HIGH',
        func: 'stop_gained',
        transcript: 'ENST00000000003',
        impact_rank: 4
      }
    ])

    // 3. Incremental removal of the carrier that supplies the representative of 3:300.
    await deleteCasesIncrementally(sqlite.database, [sqliteThird], {
      deletingAll: false,
      isCancelled: () => false,
      onProgress: () => undefined,
      summary: openCaseSummaryRemoval(sqlite.database)
    })
    await new PostgresCaseLifecycleRepository(pool, schema, summaryRepo).deleteCase(pgThird)
    await expectSameSummary('removing that case')
  }, 120_000)

  it('(g) impact and ClinVar sort by severity on both backends, in both views (#469)', async () => {
    // A case whose variants cover every impact level, an unknown one and NULL.
    const levels: Array<[number, string | null, string | null]> = [
      [1, 'MODIFIER', 'Uncertain_significance'],
      [2, 'HIGH', 'Benign'],
      [3, null, null],
      [4, 'LOW', 'Pathogenic'],
      [5, 'MODERATE', 'Likely_pathogenic'],
      [6, 'custom_level', 'free text']
    ]
    const sorted: FixtureCase = {
      name: 'parity-sorted',
      genomeBuild: 'GRCh38',
      variants: levels.map(([pos, consequence, clinvar]) =>
        baseVariant({ chr: '9', pos, consequence, clinvar })
      )
    }
    const sqliteCase = seedSqliteCase(sorted)
    sqlite.cohortSummary.rebuild()
    const pgCase = await seedPgCase(sorted)
    const pgVariants = new PostgresVariantReadRepository(pool, schema)

    // Most severe first; unknown text and NULL last in both directions. As
    // text, descending impact would start MODIFIER, MODERATE, LOW, HIGH.
    const expected: Array<[string, 'asc' | 'desc', number[]]> = [
      ['consequence', 'desc', [2, 5, 4, 1, 6, 3]],
      ['consequence', 'asc', [1, 4, 5, 2, 6, 3]],
      ['clinvar', 'desc', [4, 5, 1, 2, 6, 3]],
      ['clinvar', 'asc', [2, 1, 5, 4, 6, 3]]
    ]
    for (const [key, order, positions] of expected) {
      const cohortParams = { column_filters: { chr: { operator: '=' as const, value: '9' } } }
      const sort = { sort_by: key, sort_order: order }
      const label = `${key} ${order}`
      expect(
        sqliteCohortRows({ ...cohortParams, ...sort }).map((v) => v.pos),
        `SQLite cohort, ${label}`
      ).toEqual(positions)
      expect(
        (await pgCohortRows({ ...cohortParams, ...sort })).map((v) => v.pos),
        `PostgreSQL cohort, ${label}`
      ).toEqual(positions)
      expect(
        sqlite.variants
          .getVariants({ case_id: sqliteCase }, 50, 0, [{ key, order }])
          .data.map((v) => v.pos),
        `SQLite case view, ${label}`
      ).toEqual(positions)
      const pgPage = await pgVariants.queryVariants({ case_id: pgCase }, 50, 0, [{ key, order }])
      expect(
        pgPage.data.map((v) => Number(v.pos)),
        `PostgreSQL case view, ${label}`
      ).toEqual(positions)
    }
  }, 120_000)

  it('(h) impact and ClinVar filter by category on both backends, in both views (#469 review)', async () => {
    const spellings: Array<[number, string | null, string | null]> = [
      [1, 'HIGH', 'Pathogenic'],
      [2, 'high', 'pathogenic'],
      [3, 'MODERATE', 'Pathogenic|drug_response'],
      [4, 'MODERATE', 'Likely_pathogenic'],
      [5, 'LOW', 'Pathogenic/Likely_pathogenic'],
      [6, 'MODIFIER', 'P'],
      [7, 'custom_level', 'reviewed: fine'],
      [8, null, null]
    ]
    const spelled: FixtureCase = {
      name: 'parity-spelled',
      genomeBuild: 'GRCh38',
      variants: spellings.map(([pos, consequence, clinvar]) =>
        baseVariant({ chr: '8', pos, consequence, clinvar })
      )
    }
    const sqliteCase = seedSqliteCase(spelled)
    sqlite.cohortSummary.rebuild()
    sqlite.cohort.invalidateColumnMetaCache()
    const pgCase = await seedPgCase(spelled)
    const pgVariants = new PostgresVariantReadRepository(pool, schema)
    const onChr8 = { chr: { operator: '=' as const, value: '8' } }
    const byPos = [{ key: 'pos', order: 'asc' as const }]
    const PRESET = ['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic']
    const column = (key: string, operator: string, value: unknown): Record<string, unknown> => ({
      column_filters: { [key]: { operator, value } }
    })

    const expected: Array<[Record<string, unknown>, number[]]> = [
      [{ clinvars: ['Pathogenic'] }, [1, 2, 3, 5, 6]], // as text: position 1 only; 5 is the P/LP aggregate
      [{ clinvars: ['Likely pathogenic'] }, [4, 5]],
      [{ clinvars: ['Pathogenic/Likely pathogenic'] }, [5]], // the aggregate alone
      [{ clinvars: PRESET }, [1, 2, 3, 4, 5, 6]],
      [{ clinvars: ['reviewed: fine'] }, [7]],
      [{ consequences: ['HIGH'] }, [1, 2]],
      [column('clinvar', 'in', ['Pathogenic']), [1, 2, 3, 5, 6]],
      [column('clinvar', '=', 'Likely pathogenic'), [4, 5]],
      [column('clinvar', '!=', 'Pathogenic'), [4, 7]],
      [column('consequence', 'in', ['MODERATE', 'LOW']), [3, 4, 5]]
    ]
    for (const [filter, positions] of expected) {
      const label = JSON.stringify(filter)
      const cohortFilter = {
        ...filter,
        column_filters: { ...onChr8, ...(filter.column_filters as object | undefined) },
        sort_by: 'pos',
        sort_order: 'asc' as const
      }
      expect(
        sqliteCohortRows(cohortFilter as never).map((v) => v.pos),
        `SQLite cohort ${label}`
      ).toEqual(positions)
      expect(
        (await pgCohortRows(cohortFilter as never)).map((v) => v.pos),
        `PostgreSQL cohort ${label}`
      ).toEqual(positions)
      expect(
        sqlite.variants
          .getVariants({ case_id: sqliteCase, ...filter } as never, 50, 0, byPos)
          .data.map((v) => v.pos),
        `SQLite case view ${label}`
      ).toEqual(positions)
      const pgPage = await pgVariants.queryVariants(
        { case_id: pgCase, ...filter } as never,
        50,
        0,
        byPos
      )
      expect(
        pgPage.data.map((v) => Number(v.pos)),
        `PostgreSQL case view ${label}`
      ).toEqual(positions)
    }

    // Both backends offer the same values for the case: the categories present.
    const offered = [
      'Pathogenic',
      'Pathogenic/Likely pathogenic',
      'Likely pathogenic',
      'reviewed: fine'
    ]
    expect(sqlite.variants.getFilterOptions(sqliteCase).clinvars).toEqual(offered)
    expect((await pgVariants.getFilterOptions(pgCase)).clinvars).toEqual(offered)
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
