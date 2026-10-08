/**
 * Genotypes of split multi-allelic sites, half-calls and haploid calls on
 * PostgreSQL: the rows the VCF importer writes (taken from a SQLite import of
 * the same fixture) must give the cohort summary, the association dosage and
 * the inheritance filters that SQLite gives
 * (tests/main/database/split-genotype-zygosity.test.ts).
 * Decision record: .planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1 against a real PostgreSQL.
 */
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'
import { VcfStrategy } from '../../../src/main/import/vcf/VcfStrategy'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresAssociationDataBuilder } from '../../../src/main/storage/postgres/PostgresAssociationDataBuilder'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const VCF = resolve(__dirname, '../../test-data/vcf/synthetic-split-genotypes.vcf')
const SAMPLES = ['S1', 'S2', 'S3', 'S4', 'S5'] as const

type Counts = { carrier_count: number; het_count: number; hom_count: number }
type StoredRow = {
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string
  gt_num: string
}

const SUMMARY_SQL = `SELECT chr || ':' || pos || ':' || ref || '>' || alt AS variant,
    carrier_count, het_count, hom_count FROM`

describe.skipIf(!RUN)('split multi-allelic genotypes on PostgreSQL', () => {
  let schema: string
  let pool: Pool
  let sqlite: DatabaseService
  const sqliteIds: Record<string, number> = {}
  const pgIds: Record<string, number> = {}
  const repo = new PostgresCohortSummaryRepository()

  beforeEach(async () => {
    schema = `varlens_test_split_gt_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    // Import the fixture with the real importer, then store its rows in PostgreSQL.
    sqlite = new DatabaseService(':memory:')
    const strategy = new VcfStrategy()
    for (const sample of SAMPLES) {
      const caseId = sqlite.cases.createCase(sample, VCF, 1000)
      sqliteIds[sample] = caseId
      await strategy.import(
        VCF,
        { caseName: sample },
        { db: sqlite, formatInfo: { format: 'vcf', caseKey: '' }, caseId, startTime: Date.now() },
        { selectedSamples: [sample], genomeBuild: 'GRCh38' }
      )
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, 0, 'GRCh38') RETURNING id`,
        [sample, VCF]
      )
      pgIds[sample] = Number(inserted.rows[0].id)
      const rows = sqlite.database
        .prepare('SELECT chr, pos, ref, alt, gene_symbol, gt_num FROM variants WHERE case_id = ?')
        .all(caseId) as StoredRow[]
      for (const row of rows) {
        await pool.query(
          `INSERT INTO "${schema}".variants
             (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
           VALUES ($1, $2, $3, $4, $5, 'snv', $6, $7)`,
          [pgIds[sample], row.chr, row.pos, row.ref, row.alt, row.gene_symbol, row.gt_num]
        )
      }
    }
  }, 60_000)

  afterEach(async () => {
    sqlite?.close()
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  }, 60_000)

  async function withClient<T>(fn: (client: never) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client as never)
    } finally {
      client.release()
    }
  }

  async function pgSummary(): Promise<Record<string, Counts>> {
    const res = await pool.query<{ variant: string } & Record<keyof Counts, string>>(
      `${SUMMARY_SQL} "${schema}".cohort_variant_summary`
    )
    return Object.fromEntries(
      res.rows.map((r) => [
        r.variant,
        {
          carrier_count: Number(r.carrier_count),
          het_count: Number(r.het_count),
          hom_count: Number(r.hom_count)
        }
      ])
    )
  }

  function sqliteSummary(): Record<string, Counts> {
    const rows = sqlite.database.prepare(`${SUMMARY_SQL} cohort_variant_summary`).all() as Array<
      Counts & { variant: string }
    >
    return Object.fromEntries(rows.map(({ variant, ...counts }) => [variant, counts]))
  }

  it('stored the split genotypes the importer writes', async () => {
    const res = await pool.query<{ gt_num: string }>(
      `SELECT gt_num FROM "${schema}".variants WHERE case_id = $1 ORDER BY chr, pos, alt`,
      [pgIds.S1]
    )
    expect(res.rows.map((r) => r.gt_num)).toEqual(['1/.', './1', './1', '1'])
  })

  it('a rebuild counts every split or half-called carrier as het, as SQLite does', async () => {
    await withClient((client) => repo.rebuild({ schema, client }))
    sqlite.cohortSummary.rebuild()

    const summary = await pgSummary()
    expect(summary).toEqual({
      'chr1:1000:A>G': { carrier_count: 4, het_count: 3, hom_count: 1 },
      'chr1:1000:A>T': { carrier_count: 3, het_count: 3, hom_count: 0 },
      'chr1:2000:C>T': { carrier_count: 3, het_count: 3, hom_count: 0 },
      // S1 is hemizygous: a carrier that is neither het nor hom.
      'chrX:5000:G>A': { carrier_count: 3, het_count: 1, hom_count: 1 }
    })
    expect(summary).toEqual(sqliteSummary())
  }, 60_000)

  it('incremental add and remove count like the rebuild', async () => {
    await withClient(async (client) => {
      for (const sample of SAMPLES) {
        await repo.incrementalAdd({ schema, client, caseId: pgIds[sample] })
      }
    })
    sqlite.cohortSummary.rebuild()
    expect(await pgSummary()).toEqual(sqliteSummary())

    await withClient(async (client) => {
      await repo.incrementalRemove({ schema, client, caseId: pgIds.S1 })
      await repo.incrementalRemove({ schema, client, caseId: pgIds.S4 })
    })
    expect(await pgSummary()).toEqual({
      'chr1:1000:A>G': { carrier_count: 2, het_count: 1, hom_count: 1 },
      'chr1:1000:A>T': { carrier_count: 1, het_count: 1, hom_count: 0 },
      'chr1:2000:C>T': { carrier_count: 2, het_count: 2, hom_count: 0 },
      'chrX:5000:G>A': { carrier_count: 2, het_count: 1, hom_count: 1 }
    })
  }, 60_000)

  it('association dosage is one copy per split or half-called allele, as on SQLite', async () => {
    const ids = (map: Record<string, number>): number[] => SAMPLES.map((sample) => map[sample])
    const strip = <T extends { samples: Array<{ dosages: number[] }> }>(genes: T[]): unknown =>
      genes.map((g) => ({ ...g, samples: g.samples.map((s) => s.dosages) }))

    const pg = await new PostgresAssociationDataBuilder(pool, schema).build(
      ids(pgIds).slice(0, 2),
      ids(pgIds).slice(2),
      {},
      []
    )
    const lite = new AssociationDataBuilder(sqlite.database).build(
      ids(sqliteIds).slice(0, 2),
      ids(sqliteIds).slice(2),
      {},
      []
    )
    expect(strip(pg)).toEqual(strip(lite))
    // Variants in key order: chr1:1000 A>G, chr1:1000 A>T, chr1:2000 C>T; samples S1..S5.
    expect(pg.find((g) => g.gene_symbol === 'GENEA')!.samples.map((s) => s.dosages)).toEqual([
      [1, 1, 1],
      [1, 0, 1],
      [2, 0, 0],
      [1, 1, 0],
      [0, 1, 1]
    ])
    expect(pg.find((g) => g.gene_symbol === 'GENEX')!.samples[0].dosages).toEqual([1])
  }, 60_000)

  it('the inheritance filters select the rows SQLite selects', async () => {
    const read = new PostgresVariantReadRepository(pool, schema)
    const key = (v: { chr: string; pos: number; alt: string }): string =>
      `${v.chr}:${v.pos}>${v.alt}`
    for (const mode of ['heterozygous', 'homozygous', 'candidate_compound_het', 'x_hemizygous']) {
      for (const sample of SAMPLES) {
        const pg = await read.queryVariants(
          { case_id: pgIds[sample], inheritance_modes: [mode] },
          50,
          0
        )
        const lite = sqlite.variants.getVariants(
          { case_id: sqliteIds[sample], inheritance_modes: [mode] },
          50,
          0
        )
        expect(pg.data.map(key).sort(), `${mode} ${sample}`).toEqual(lite.data.map(key).sort())
      }
    }
    const s1Het = await read.queryVariants(
      { case_id: pgIds.S1, inheritance_modes: ['heterozygous'] },
      50,
      0
    )
    expect(s1Het.data.map(key).sort()).toEqual(['chr1:1000>G', 'chr1:1000>T', 'chr1:2000>T'])
    const s4Compound = await read.queryVariants(
      { case_id: pgIds.S4, inheritance_modes: ['candidate_compound_het'] },
      50,
      0
    )
    expect(s4Compound.data.map(key).sort()).toEqual(['chr1:1000>G', 'chr1:1000>T'])
  }, 60_000)
})

describe.skipIf(!RUN)('migration 0026 — genotype classes of the cohort summary', () => {
  let schema: string
  let pool: Pool
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_mig0026_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA "${schema}"`)
    const before = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0026')
    await new PostgresMigrationRunner(pool, schema, before).migrate()
  }, 60_000)

  afterEach(async () => {
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
    await pool.end()
  }, 60_000)

  const migrate = (): Promise<unknown> =>
    new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

  const state = async (): Promise<{ is_stale: boolean; stale_reason: string | null }> =>
    (
      await probe.query<{ is_stale: boolean; stale_reason: string | null }>(
        `SELECT is_stale, stale_reason FROM "${schema}".cohort_summary_state WHERE id = 1`
      )
    ).rows[0]

  const seedSummaryRow = (): Promise<unknown> =>
    probe.query(
      `INSERT INTO "${schema}".cohort_variant_summary
         (chr, pos, ref, alt, variant_type, genome_build, carrier_count)
       VALUES ('1', 100, 'A', 'T', 'snv', 'GRCh38', 1)`
    )

  const setState = (stale: boolean, reason: string | null): Promise<unknown> =>
    probe.query(
      `UPDATE "${schema}".cohort_summary_state SET is_stale = $1, stale_reason = $2 WHERE id = 1`,
      [stale, reason]
    )

  it('flags a populated summary for a rebuild', async () => {
    await seedSummaryRow()
    await setState(false, null)
    await migrate()
    expect(await state()).toEqual({
      is_stale: true,
      stale_reason: 'migration_0026_genotype_classes'
    })
  }, 60_000)

  it('keeps the reason of a summary that already waits for a rebuild', async () => {
    await seedSummaryRow()
    await setState(true, 'earlier')
    await migrate()
    expect(await state()).toEqual({ is_stale: true, stale_reason: 'earlier' })
  }, 60_000)

  it('leaves an empty summary alone', async () => {
    await setState(false, null)
    await migrate()
    expect(await state()).toEqual({ is_stale: false, stale_reason: null })
  }, 60_000)
})

describe.skipIf(RUN)('split multi-allelic genotypes on PostgreSQL (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and a PostgreSQL is reachable', () => {
    expect(RUN).toBe(false)
  })
})
