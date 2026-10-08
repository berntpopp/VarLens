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

import { makeVariant } from '../../utils/make-variant'

import { DatabaseService } from '../../../src/main/database'
import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'
import { VcfStrategy } from '../../../src/main/import/vcf/VcfStrategy'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
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

describe.skipIf(!RUN)('trio and duplicate-row inheritance filters on both backends', () => {
  type Member = 'proband' | 'father' | 'mother'
  type Row = [member: Member, pos: number, alt: string, gt: string | null]

  let schema: string
  let pool: Pool
  let sqlite: DatabaseService
  let sqliteGroup: number
  let pgGroup: number
  const sqliteIds = {} as Record<Member, number>
  const pgIds = {} as Record<Member, number>

  beforeEach(async () => {
    schema = `varlens_test_trio_gt_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    sqlite = new DatabaseService(':memory:')
    sqliteGroup = sqlite.analysisGroups.createGroup('FAM', 'family').id
    pgGroup = Number(
      (
        await pool.query<{ id: string }>(
          `INSERT INTO "${schema}".analysis_groups (name) VALUES ('FAM') RETURNING id`
        )
      ).rows[0].id
    )
    for (const member of ['proband', 'father', 'mother'] as const) {
      sqliteIds[member] = sqlite.cases.createCase(member, `/${member}.json`, 1)
      sqlite.analysisGroups.addMember(sqliteGroup, sqliteIds[member], member, 'unknown')
      pgIds[member] = Number(
        (
          await pool.query<{ id: string }>(
            `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
             VALUES ($1, '/x.json', 0, 0, 'GRCh38') RETURNING id`,
            [member]
          )
        ).rows[0].id
      )
      await pool.query(
        `INSERT INTO "${schema}".analysis_group_members (group_id, case_id, role)
         VALUES ($1, $2, $3)`,
        [pgGroup, pgIds[member], member]
      )
    }
  }, 60_000)

  afterEach(async () => {
    sqlite?.close()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  }, 60_000)

  /** The same rows in both databases: chr 1, ref A, gene BRCA1. */
  async function seed(rows: Row[]): Promise<void> {
    for (const [member, pos, alt, gt] of rows) {
      sqlite.variants.insertVariantsBatch(sqliteIds[member], [
        makeVariant({ pos, alt, gt_num: gt })
      ])
      await pool.query(
        `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
         VALUES ($1, '1', $2, 'A', $3, 'snv', 'BRCA1', $4)`,
        [pgIds[member], pos, alt, gt]
      )
    }
  }

  /** The proband rows a mode selects, asserted equal on both backends. */
  async function matching(mode: string): Promise<string[]> {
    const key = (v: { pos: number; alt: string }): string => `${v.pos}>${v.alt}`
    const lite = sqlite.variants
      .getVariants(
        { case_id: sqliteIds.proband, inheritance_modes: [mode], analysis_group_id: sqliteGroup },
        50,
        0
      )
      .data.map(key)
      .sort()
    const pg = (
      await new PostgresVariantReadRepository(pool, schema).queryVariants(
        { case_id: pgIds.proband, inheritance_modes: [mode], analysis_group_id: pgGroup },
        50,
        0
      )
    ).data
      .map(key)
      .sort()
    expect(pg, `${mode}: PostgreSQL = SQLite`).toEqual(lite)
    return pg
  }

  it('compound_het: a split 1/2 site inherited from opposite parents, without bystanders', async () => {
    await seed([
      ['proband', 100, 'G', '1/.'],
      ['proband', 100, 'T', './1'],
      ['proband', 200, 'G', '1/.'],
      ['father', 100, 'G', '0/1'],
      ['mother', 100, 'T', '1/0']
    ])
    expect(await matching('compound_het')).toEqual(['100>G', '100>T'])
  }, 60_000)

  it('compound_het: no pair from one parent, from both parents, or with an uncalled parent', async () => {
    await seed([
      ['proband', 100, 'G', '0/1'],
      ['proband', 200, 'G', '0/1'],
      ['proband', 300, 'G', '0/1'],
      ['proband', 400, 'G', '0/1'],
      // 100 and 200: both from the father. 300: both parents. 400: mother, father uncalled.
      ['father', 100, 'G', '0/1'],
      ['father', 200, 'G', '1/1'],
      ['father', 300, 'G', '0/1'],
      ['mother', 300, 'G', '0/1'],
      ['mother', 400, 'G', '0/1'],
      ['father', 400, 'G', './.']
    ])
    expect(await matching('compound_het')).toEqual([])
  }, 60_000)

  it('a variant stored twice is one variant for compound het', async () => {
    await seed([
      ['proband', 100, 'G', '1/.'],
      ['proband', 100, 'G', '1/.'],
      ['father', 100, 'G', '0/1']
    ])
    expect(await matching('compound_het')).toEqual([])
  }, 60_000)

  it('a solo mode works while an analysis group is selected', async () => {
    await seed([
      ['proband', 100, 'G', '1/.'],
      ['proband', 100, 'T', './1'],
      ['proband', 200, 'G', '1/1']
    ])
    expect(await matching('candidate_compound_het')).toEqual(['100>G', '100>T'])
    expect(await matching('homozygous')).toEqual(['200>G'])
  }, 60_000)

  it('candidate compound het counts a variant stored twice once', async () => {
    await seed([
      ['proband', 100, 'G', '1/.'],
      ['proband', 100, 'G', '1/.'],
      ['mother', 100, 'G', '1/.'],
      ['mother', 100, 'T', './1']
    ])
    const candidates = async (member: Member): Promise<string[]> =>
      (
        await new PostgresVariantReadRepository(pool, schema).queryVariants(
          { case_id: pgIds[member], inheritance_modes: ['candidate_compound_het'] },
          50,
          0
        )
      ).data
        .map((v) => `${v.pos}>${v.alt}`)
        .sort()
    expect(await candidates('proband')).toEqual([])
    // Two different ALT alleles at one position stay a candidate pair.
    expect(await candidates('mother')).toEqual(['100>G', '100>T'])
  }, 60_000)

  it('de_novo: a split het neither parent carries; an inherited one is dropped', async () => {
    await seed([
      ['proband', 100, 'G', '1|.'],
      ['proband', 100, 'T', '.|1'],
      ['mother', 100, 'T', './1']
    ])
    expect(await matching('de_novo')).toEqual(['100>G'])
  }, 60_000)

  it('de_novo: every spelling of an uncalled parent withholds it, a reference call does not', async () => {
    const uncalled = ['./.', '.|.', '.', '0/.', '', null]
    const reference = ['0/0', '0|0', '0']
    const rows: Row[] = []
    ;[...uncalled, ...reference].forEach((gt, i) => {
      const pos = 1000 + i
      rows.push(['proband', pos, 'G', '1/.'], ['mother', pos, 'G', '0/0'], ['father', pos, 'G', gt])
    })
    await seed(rows)
    // Positions 1006-1008 are the reference calls.
    expect(await matching('de_novo')).toEqual(['1006>G', '1007>G', '1008>G'])
  }, 60_000)
})

describe.skipIf(!RUN)('a summary that waits for its rebuild is not patched', () => {
  let schema: string
  let pool: Pool
  const repo = new PostgresCohortSummaryRepository()
  const ids: Record<string, number> = {}

  /**
   * An upgraded database: A (`1/.`) and B (`1/1`) carry one variant, and the
   * summary row still holds what the previous version counted for them.
   */
  beforeEach(async () => {
    schema = `varlens_test_stale_patch_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 3 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    const before = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0026')
    await new PostgresMigrationRunner(pool, schema, before).migrate()
    for (const [name, gt] of [
      ['A', '1/.'],
      ['B', '1/1'],
      ['C', '0/1']
    ]) {
      ids[name] = await seedCase(name, gt, name === 'C' ? 'importing' : 'ready')
    }
    await pool.query(
      `INSERT INTO "${schema}".cohort_variant_summary
         (chr, pos, ref, alt, variant_type, genome_build, gene_symbol, variant_key,
          carrier_count, het_count, hom_count)
       VALUES ('1', 100, 'A', 'T', 'snv', 'GRCh38', 'GENEA', '1:100:A:T', 2, 0, 1)`
    )
    await pool.query(
      `UPDATE "${schema}".cohort_summary_state
          SET is_stale = false, stale_reason = NULL, last_rebuilt_at = now() WHERE id = 1`
    )
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  }, 60_000)

  async function seedCase(name: string, gt: string, status: string): Promise<number> {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO "${schema}".cases_all
         (name, file_path, file_size, created_at, genome_build, import_status)
       VALUES ($1, '/x.vcf', 0, 0, 'GRCh38', $2) RETURNING id`,
      [name, status]
    )
    const caseId = Number(inserted.rows[0].id)
    await pool.query(
      `INSERT INTO "${schema}".variants_all
         (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
       VALUES ($1, '1', 100, 'A', 'T', 'snv', 'GENEA', $2)`,
      [caseId, gt]
    )
    return caseId
  }

  const counts = async (): Promise<string> => {
    const res = await pool.query<Record<string, number>>(
      `SELECT carrier_count, het_count, hom_count FROM "${schema}".cohort_variant_summary`
    )
    return res.rows.map((r) => `${r.carrier_count}/${r.het_count}/${r.hom_count}`).join(' ')
  }

  const isStale = async (): Promise<boolean> =>
    (await pool.query(`SELECT is_stale FROM "${schema}".cohort_summary_state WHERE id = 1`)).rows[0]
      .is_stale

  async function inTransaction(fn: (client: never) => Promise<void>): Promise<void> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await fn(client as never)
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  }

  const rebuild = (): Promise<void> => inTransaction((client) => repo.rebuild({ schema, client }))

  it('deleting a case before the rebuild never shows a negative het count', async () => {
    expect(await isStale()).toBe(true)

    await new PostgresCaseLifecycleRepository(pool, schema).hideCase(ids.A)

    // Old counts + new classes would give 1/-1/1. The row waits for the rebuild instead.
    expect(await counts()).toBe('2/0/1')
    expect(await isStale()).toBe(true)
    await rebuild()
    expect(await counts()).toBe('1/0/1')
    expect(await isStale()).toBe(false)
  }, 60_000)

  it('the repository remove and add leave a stale summary to the rebuild', async () => {
    await inTransaction((client) => repo.incrementalRemove({ schema, client, caseId: ids.A }))
    expect(await counts()).toBe('2/0/1')

    await inTransaction((client) =>
      repo.incrementalAdd({ schema, client, caseId: ids.C, includeProvisional: true })
    )
    expect(await counts()).toBe('2/0/1')
    expect(await isStale()).toBe(true)

    await pool.query(`UPDATE "${schema}".cases_all SET import_status = 'ready'`)
    await rebuild()
    // A (1/.) and C (0/1) het, B hom.
    expect(await counts()).toBe('3/2/1')
  }, 60_000)

  it('a current summary is still maintained incrementally', async () => {
    await rebuild()
    expect(await counts()).toBe('2/1/1')
    await new PostgresCaseLifecycleRepository(pool, schema).hideCase(ids.A)
    expect(await counts()).toBe('1/0/1')
    expect(await isStale()).toBe(false)
  }, 60_000)
})

describe.skipIf(RUN)('split multi-allelic genotypes on PostgreSQL (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and a PostgreSQL is reachable', () => {
    expect(RUN).toBe(false)
  })
})
