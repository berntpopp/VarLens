/**
 * Sprint A PR-3 C2 — PostgresCohortSummaryRepository.rebuild against a real
 * Postgres.
 *
 * Verifies the deduped CTE rebuild (Pass-2 #4 — duplicate per-case rows count
 * once) and that has_star/has_comment/acmg_best are derived from the existing
 * variant_annotations + case_variant_annotations tables at rebuild time
 * (Pass-9 #8 — without this, every rebuild resets flags to false). Cohort
 * frequency is not stored: readers derive it from carrier_count and the
 * visible cases of the row's genome build, so nothing here maintains it.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { COHORT_FREQUENCY_SELECT, summaryWithFrequencyFrom } from './helpers/cohort-read-frequency'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface SeedVariant {
  caseId: number
  chr: string
  pos: number
  ref: string
  alt: string
  variantType?: string
  geneSymbol?: string | null
  gtNum?: string | null
}

describe.skipIf(!RUN)('PostgresCohortSummaryRepository.rebuild — Sprint A C2', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_cvs_rebuild_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedCase(name: string, genomeBuild = 'GRCh38'): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [name, `/tmp/${name}.json`, now, genomeBuild]
    )
    return res.rows[0].id
  }

  async function seedVariant(v: SeedVariant): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        v.caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.variantType ?? 'snv',
        v.geneSymbol ?? null,
        v.gtNum ?? null
      ]
    )
    return res.rows[0].id
  }

  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client as unknown as Client)
    } finally {
      ;(client as { release: () => void }).release()
    }
  }

  it('TRUNCATEs and reinserts from the deduped CTE', async () => {
    const caseA = await seedCase('case-a')
    const caseB = await seedCase('case-b')
    // Two carriers (het + hom) of the same coordinate, one carrier elsewhere.
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseB, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '1/1' })
    await seedVariant({ caseId: caseA, chr: '2', pos: 200, ref: 'C', alt: 'G', gtNum: '0/1' })

    // Pre-populate with stale data that must be wiped by TRUNCATE.
    await probe.query(
      `INSERT INTO "${schema}".cohort_variant_summary
         (chr, pos, ref, alt, variant_type, genome_build, carrier_count)
         VALUES ('99', 1, 'X', 'Y', 'snv', 'GRCh38', 42)`
    )

    const repo = new PostgresCohortSummaryRepository()
    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    const rows = await probe.query<{
      chr: string
      pos: string
      ref: string
      alt: string
      carrier_count: string
      het_count: string
      hom_count: string
      variant_key: string
      cohort_frequency: number | null
    }>(
      `SELECT cvs.chr, cvs.pos, cvs.ref, cvs.alt, cvs.carrier_count, cvs.het_count,
              cvs.hom_count, cvs.variant_key, ${COHORT_FREQUENCY_SELECT}
         FROM ${summaryWithFrequencyFrom(schema)} ORDER BY cvs.chr, cvs.pos`
    )

    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.some((r) => r.chr === '99')).toBe(false)

    const first = rows.rows.find((r) => r.chr === '1')!
    expect(Number(first.carrier_count)).toBe(2)
    expect(Number(first.het_count)).toBe(1)
    expect(Number(first.hom_count)).toBe(1)
    expect(first.variant_key).toBe('1:100:A:T')
    // Frequency is derived by readers: 2 carriers / 2 GRCh38 cases = 1.0.
    expect(Number(first.cohort_frequency)).toBeCloseTo(1.0)

    const second = rows.rows.find((r) => r.chr === '2')!
    expect(Number(second.carrier_count)).toBe(1)
    // 1 carrier / 2 GRCh38 cases = 0.5.
    expect(Number(second.cohort_frequency)).toBeCloseTo(0.5)
  }, 60_000)

  it('mirrors SQLite deduplication — duplicate per-case rows count once (Pass-2 #4)', async () => {
    const caseA = await seedCase('case-dedup')
    // Same case_id has two rows with identical (chr, pos, ref, alt).
    await seedVariant({ caseId: caseA, chr: '3', pos: 300, ref: 'G', alt: 'A', gtNum: '0/1' })
    await seedVariant({ caseId: caseA, chr: '3', pos: 300, ref: 'G', alt: 'A', gtNum: '0/1' })

    const repo = new PostgresCohortSummaryRepository()
    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    const res = await probe.query<{ carrier_count: string }>(
      `SELECT carrier_count FROM "${schema}".cohort_variant_summary
         WHERE chr = '3' AND pos = 300 AND ref = 'G' AND alt = 'A'`
    )
    expect(res.rows).toHaveLength(1)
    expect(Number(res.rows[0].carrier_count)).toBe(1)
  }, 60_000)

  it('populates has_star/has_comment/acmg_best from existing annotations (Pass-9 #8)', async () => {
    const caseA = await seedCase('case-anno')

    // Global star + comment annotation (variant_annotations).
    const starred = await seedVariant({
      caseId: caseA,
      chr: '4',
      pos: 400,
      ref: 'T',
      alt: 'C',
      gtNum: '0/1'
    })
    void starred
    await probe.query(
      `INSERT INTO "${schema}".variant_annotations
         (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
         VALUES ('4', 400, 'T', 'C', NULL, 1, NULL, $1, $1)`,
      [now]
    )

    // Per-case comment + ACMG (case_variant_annotations) on a second coord.
    const commented = await seedVariant({
      caseId: caseA,
      chr: '5',
      pos: 500,
      ref: 'A',
      alt: 'G',
      gtNum: '0/1'
    })
    await probe.query(
      `INSERT INTO "${schema}".case_variant_annotations
         (case_id, variant_id, per_case_comment, starred, acmg_classification, created_at, updated_at)
         VALUES ($1, $2, 'looks pathogenic', 0, 'Pathogenic', $3, $3)`,
      [caseA, commented, now]
    )

    // A plain variant with no annotations.
    await seedVariant({ caseId: caseA, chr: '6', pos: 600, ref: 'C', alt: 'T', gtNum: '0/1' })

    const repo = new PostgresCohortSummaryRepository()
    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    const rows = await probe.query<{
      chr: string
      has_star: boolean
      has_comment: boolean
      acmg_best: string | null
    }>(
      `SELECT chr, has_star, has_comment, acmg_best
         FROM "${schema}".cohort_variant_summary ORDER BY chr`
    )

    const star = rows.rows.find((r) => r.chr === '4')!
    expect(star.has_star).toBe(true)
    expect(star.has_comment).toBe(false)
    expect(star.acmg_best).toBeNull()

    const comment = rows.rows.find((r) => r.chr === '5')!
    expect(comment.has_comment).toBe(true)
    expect(comment.has_star).toBe(false)
    expect(comment.acmg_best).toBe('Pathogenic')

    const plain = rows.rows.find((r) => r.chr === '6')!
    expect(plain.has_star).toBe(false)
    expect(plain.has_comment).toBe(false)
    expect(plain.acmg_best).toBeNull()
  }, 60_000)

  it('survives an empty variants table (no rows inserted)', async () => {
    const repo = new PostgresCohortSummaryRepository()
    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    const res = await probe.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${schema}".cohort_variant_summary`
    )
    expect(Number(res.rows[0].count)).toBe(0)
  }, 60_000)
})

describe.skipIf(!RUN)('PostgresCohortSummaryRepository.incrementalAdd/Remove — Sprint A C2', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_cvs_incr_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedCase(name: string, genomeBuild = 'GRCh38'): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
           VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [name, `/tmp/${name}.json`, now, genomeBuild]
    )
    return res.rows[0].id
  }

  async function seedVariant(v: SeedVariant): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        v.caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.variantType ?? 'snv',
        v.geneSymbol ?? null,
        v.gtNum ?? null
      ]
    )
    return res.rows[0].id
  }

  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client as unknown as Client)
    } finally {
      ;(client as { release: () => void }).release()
    }
  }

  async function summaryRow(chr: string): Promise<{
    carrier_count: number
    het_count: number
    hom_count: number
    has_star: boolean
    has_comment: boolean
    acmg_best: string | null
  } | null> {
    const res = await probe.query<{
      carrier_count: string
      het_count: string
      hom_count: string
      has_star: boolean
      has_comment: boolean
      acmg_best: string | null
    }>(
      `SELECT carrier_count, het_count, hom_count, has_star, has_comment, acmg_best
           FROM "${schema}".cohort_variant_summary WHERE chr = $1`,
      [chr]
    )
    if (res.rows.length === 0) return null
    const r = res.rows[0]
    return {
      carrier_count: Number(r.carrier_count),
      het_count: Number(r.het_count),
      hom_count: Number(r.hom_count),
      has_star: r.has_star,
      has_comment: r.has_comment,
      acmg_best: r.acmg_best
    }
  }

  const repo = new PostgresCohortSummaryRepository()

  it('incrementalAdd inserts a brand-new row from the deduped CTE', async () => {
    const caseA = await seedCase('add-new-a')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseA, chr: '2', pos: 200, ref: 'C', alt: 'G', gtNum: '1/1' })

    await withClient((client) =>
      repo.incrementalAdd({ schema, client: client as never, caseId: caseA })
    )

    const het = await summaryRow('1')
    expect(het).not.toBeNull()
    expect(het!.carrier_count).toBe(1)
    expect(het!.het_count).toBe(1)
    expect(het!.hom_count).toBe(0)

    const hom = await summaryRow('2')
    expect(hom!.carrier_count).toBe(1)
    expect(hom!.het_count).toBe(0)
    expect(hom!.hom_count).toBe(1)
  }, 60_000)

  it('incrementalAdd bumps all three counters on conflict', async () => {
    const caseA = await seedCase('add-bump-a')
    const caseB = await seedCase('add-bump-b')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseB, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '1/1' })

    await withClient(async (client) => {
      await repo.incrementalAdd({ schema, client: client as never, caseId: caseA })
      await repo.incrementalAdd({ schema, client: client as never, caseId: caseB })
    })

    const row = await summaryRow('1')
    expect(row!.carrier_count).toBe(2)
    expect(row!.het_count).toBe(1)
    expect(row!.hom_count).toBe(1)
  }, 60_000)

  it('incrementalAdd dedups duplicate per-case rows (counts once)', async () => {
    const caseA = await seedCase('add-dedup-a')
    await seedVariant({ caseId: caseA, chr: '3', pos: 300, ref: 'G', alt: 'A', gtNum: '0/1' })
    await seedVariant({ caseId: caseA, chr: '3', pos: 300, ref: 'G', alt: 'A', gtNum: '0/1' })

    await withClient((client) =>
      repo.incrementalAdd({ schema, client: client as never, caseId: caseA })
    )

    const row = await summaryRow('3')
    expect(row!.carrier_count).toBe(1)
  }, 60_000)

  it('combines global and per-case annotations across every carrier of a variant', async () => {
    // One coordinate carried by three cases, annotated in three different
    // places: a global ACMG call, a per-case star on one carrier and a
    // stronger per-case ACMG call plus comment on another.
    const cases = [
      await seedCase('multi-anno-a'),
      await seedCase('multi-anno-b'),
      await seedCase('multi-anno-c')
    ]
    const carriers: number[] = []
    for (const caseId of cases) {
      carriers.push(
        await seedVariant({ caseId, chr: '7', pos: 700, ref: 'G', alt: 'A', gtNum: '0/1' })
      )
    }
    // Same position, different allele: must not inherit anything.
    await seedVariant({ caseId: cases[0], chr: '7', pos: 700, ref: 'G', alt: 'T', gtNum: '0/1' })
    await probe.query(
      `INSERT INTO "${schema}".variant_annotations
         (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
         VALUES ('7', 700, 'G', 'A', NULL, 0, 'Likely benign', $1, $1)`,
      [now]
    )
    await probe.query(
      `INSERT INTO "${schema}".case_variant_annotations
         (case_id, variant_id, per_case_comment, starred, acmg_classification, created_at, updated_at)
         VALUES ($1, $2, NULL, 1, NULL, $5, $5),
                ($3, $4, 'segregates', 0, 'Likely pathogenic', $5, $5)`,
      [cases[1], carriers[1], cases[2], carriers[2], now]
    )

    const repo = new PostgresCohortSummaryRepository()
    const readFlags = async (): Promise<
      Array<{ alt: string; has_star: boolean; has_comment: boolean; acmg_best: string | null }>
    > =>
      (
        await probe.query(
          `SELECT alt, has_star, has_comment, acmg_best
             FROM "${schema}".cohort_variant_summary WHERE chr = '7' ORDER BY alt`
        )
      ).rows
    const expected = [
      { alt: 'A', has_star: true, has_comment: true, acmg_best: 'Likely pathogenic' },
      { alt: 'T', has_star: false, has_comment: false, acmg_best: null }
    ]

    await withClient((client) => repo.rebuild({ schema, client: client as never }))
    expect(await readFlags()).toEqual(expected)

    // The incremental path derives the same flags for brand-new rows.
    await probe.query(`DELETE FROM "${schema}".cohort_variant_summary`)
    await withClient(async (client) => {
      for (const caseId of cases) {
        await repo.incrementalAdd({ schema, client: client as never, caseId })
      }
    })
    expect(await readFlags()).toEqual(expected)
  }, 60_000)

  it('incrementalAdd preserves existing flags (OR semantics, no clear)', async () => {
    const caseA = await seedCase('add-flag-a')
    const caseB = await seedCase('add-flag-b')
    const vA = await seedVariant({
      caseId: caseA,
      chr: '4',
      pos: 400,
      ref: 'T',
      alt: 'C',
      gtNum: '0/1'
    })
    void vA
    // Global star + comment annotation so caseA's add sets the flags true.
    await probe.query(
      `INSERT INTO "${schema}".variant_annotations
           (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
           VALUES ('4', 400, 'T', 'C', 'noted', 1, 'Pathogenic', $1, $1)`,
      [now]
    )
    await seedVariant({ caseId: caseB, chr: '4', pos: 400, ref: 'T', alt: 'C', gtNum: '0/1' })

    await withClient(async (client) => {
      await repo.incrementalAdd({ schema, client: client as never, caseId: caseA })
      // caseB add must not clear the flags set by caseA's add.
      await repo.incrementalAdd({ schema, client: client as never, caseId: caseB })
    })

    const row = await summaryRow('4')
    expect(row!.carrier_count).toBe(2)
    expect(row!.has_star).toBe(true)
    expect(row!.has_comment).toBe(true)
    expect(row!.acmg_best).toBe('Pathogenic')
  }, 60_000)

  it('incrementalRemove subtracts all three counters simultaneously', async () => {
    const caseA = await seedCase('rm-a')
    const caseB = await seedCase('rm-b')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseB, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '1/1' })

    await withClient(async (client) => {
      await repo.incrementalAdd({ schema, client: client as never, caseId: caseA })
      await repo.incrementalAdd({ schema, client: client as never, caseId: caseB })
      // Remove caseB (the hom carrier).
      await repo.incrementalRemove({ schema, client: client as never, caseId: caseB })
    })

    const row = await summaryRow('1')
    expect(row!.carrier_count).toBe(1)
    expect(row!.het_count).toBe(1)
    expect(row!.hom_count).toBe(0)
  }, 60_000)

  it('incrementalRemove deletes rows that drop to zero carriers', async () => {
    const caseA = await seedCase('rm-zero-a')
    await seedVariant({ caseId: caseA, chr: '5', pos: 500, ref: 'A', alt: 'G', gtNum: '0/1' })

    await withClient(async (client) => {
      await repo.incrementalAdd({ schema, client: client as never, caseId: caseA })
      await repo.incrementalRemove({ schema, client: client as never, caseId: caseA })
    })

    const row = await summaryRow('5')
    expect(row).toBeNull()
  }, 60_000)
})

describe.skipIf(!RUN)('refreshColumnMetas + removeColumnMetas — C2', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_cvs_meta_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedCase(name: string, genomeBuild = 'GRCh38'): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
           VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [name, `/tmp/${name}.json`, now, genomeBuild]
    )
    return res.rows[0].id
  }

  async function seedVariant(v: {
    caseId: number
    chr: string
    pos: number
    ref: string
    alt: string
    geneSymbol?: string | null
    gnomadAf?: number | null
    cadd?: number | null
    consequence?: string | null
  }): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gnomad_af, cadd, consequence)
           VALUES ($1, $2, $3, $4, $5, 'snv', $6, $7, $8, $9) RETURNING id`,
      [
        v.caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.geneSymbol ?? null,
        v.gnomadAf ?? null,
        v.cadd ?? null,
        v.consequence ?? null
      ]
    )
    return res.rows[0].id
  }

  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client as unknown as Client)
    } finally {
      ;(client as { release: () => void }).release()
    }
  }

  const repo = new PostgresCohortSummaryRepository()

  it('refreshColumnMetas writes one row per (case_id, column_name) tuple', async () => {
    const caseA = await seedCase('meta-a')
    await seedVariant({
      caseId: caseA,
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      geneSymbol: 'BRCA1',
      gnomadAf: 0.01,
      cadd: 12.5,
      consequence: 'HIGH'
    })
    await seedVariant({
      caseId: caseA,
      chr: '2',
      pos: 200,
      ref: 'C',
      alt: 'G',
      geneSymbol: 'TP53',
      gnomadAf: 0.5,
      cadd: 30,
      consequence: 'MODERATE'
    })

    await withClient((client) =>
      repo.refreshColumnMetas({ schema, client: client as never, caseId: caseA })
    )

    const rows = await probe.query<{
      column_name: string
      min_value: unknown
      max_value: unknown
      distinct_count: number
      distinct_values: unknown
    }>(
      `SELECT column_name, min_value, max_value, distinct_count, distinct_values
         FROM "${schema}".cohort_column_meta WHERE case_id = $1`,
      [caseA]
    )

    // One row per BASE_SORTABLE_COLUMNS key (21 columns).
    expect(rows.rows.length).toBe(21)
    const byName = new Map(rows.rows.map((r) => [r.column_name, r]))

    // Numeric column: min/max populated, distinct_count = 2.
    const gnomad = byName.get('gnomad_af')!
    expect(Number(gnomad.min_value)).toBeCloseTo(0.01)
    expect(Number(gnomad.max_value)).toBeCloseTo(0.5)
    expect(Number(gnomad.distinct_count)).toBe(2)

    const cadd = byName.get('cadd')!
    expect(Number(cadd.min_value)).toBeCloseTo(12.5)
    expect(Number(cadd.max_value)).toBeCloseTo(30)

    // `pos` is BIGINT in the variants table — node-pg returns BIGINT as a JS
    // string, so min/max must be coerced to JSON numbers before storage,
    // matching SQLite's raw-number shape (not a JSON string).
    const pos = byName.get('pos')!
    expect(typeof pos.min_value).toBe('number')
    expect(typeof pos.max_value).toBe('number')
    expect(pos.min_value).toBe(100)
    expect(pos.max_value).toBe(200)

    // Text column: low cardinality → distinct_values populated, no min/max.
    const consequence = byName.get('consequence')!
    expect(Number(consequence.distinct_count)).toBe(2)
    expect(consequence.min_value).toBeNull()
    expect(consequence.max_value).toBeNull()
    expect(consequence.distinct_values).toEqual(['HIGH', 'MODERATE'])

    const gene = byName.get('gene_symbol')!
    expect(Number(gene.distinct_count)).toBe(2)
    expect(gene.distinct_values).toEqual(['BRCA1', 'TP53'])
  }, 60_000)

  it('refreshColumnMetas deletes existing rows before reinserting', async () => {
    const caseA = await seedCase('meta-refresh-a')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', geneSymbol: 'AAA' })

    // Pre-populate a stale row that must be wiped.
    await probe.query(
      `INSERT INTO "${schema}".cohort_column_meta (case_id, column_name, distinct_count)
         VALUES ($1, 'gene_symbol', 999)`,
      [caseA]
    )

    await withClient((client) =>
      repo.refreshColumnMetas({ schema, client: client as never, caseId: caseA })
    )

    const res = await probe.query<{ distinct_count: number }>(
      `SELECT distinct_count FROM "${schema}".cohort_column_meta
         WHERE case_id = $1 AND column_name = 'gene_symbol'`,
      [caseA]
    )
    expect(res.rows).toHaveLength(1)
    expect(Number(res.rows[0].distinct_count)).toBe(1)
  }, 60_000)

  it('removeColumnMetas deletes only the target case rows', async () => {
    const caseA = await seedCase('meta-rm-a')
    const caseB = await seedCase('meta-rm-b')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', geneSymbol: 'AAA' })
    await seedVariant({ caseId: caseB, chr: '2', pos: 200, ref: 'C', alt: 'G', geneSymbol: 'BBB' })

    await withClient(async (client) => {
      await repo.refreshColumnMetas({ schema, client: client as never, caseId: caseA })
      await repo.refreshColumnMetas({ schema, client: client as never, caseId: caseB })
      await repo.removeColumnMetas({ schema, client: client as never, caseId: caseA })
    })

    const aCount = await probe.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${schema}".cohort_column_meta WHERE case_id = $1`,
      [caseA]
    )
    const bCount = await probe.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${schema}".cohort_column_meta WHERE case_id = $1`,
      [caseB]
    )
    expect(Number(aCount.rows[0].count)).toBe(0)
    expect(Number(bCount.rows[0].count)).toBe(21)
  }, 60_000)
})

describe.skipIf(!RUN)('cohort frequency derived at read time', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_cvs_freq_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedCase(name: string, genomeBuild = 'GRCh38'): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
           VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [name, `/tmp/${name}.json`, now, genomeBuild]
    )
    return res.rows[0].id
  }

  async function seedVariant(v: SeedVariant): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        v.caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.variantType ?? 'snv',
        v.geneSymbol ?? null,
        v.gtNum ?? null
      ]
    )
    return res.rows[0].id
  }

  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client as unknown as Client)
    } finally {
      ;(client as { release: () => void }).release()
    }
  }

  async function freqByChr(chr: string, genomeBuild: string): Promise<number | null> {
    const res = await probe.query<{ cohort_frequency: number | null }>(
      `SELECT ${COHORT_FREQUENCY_SELECT} FROM ${summaryWithFrequencyFrom(schema)}
           WHERE cvs.chr = $1 AND cvs.genome_build = $2`,
      [chr, genomeBuild]
    )
    return res.rows.length === 0 ? null : res.rows[0].cohort_frequency
  }

  /** Physical row version: changes whenever the row is rewritten. */
  async function rowVersion(chr: string): Promise<string> {
    const res = await probe.query<{ version: string }>(
      `SELECT xmin::text || ':' || ctid::text AS version
           FROM "${schema}".cohort_variant_summary WHERE chr = $1`,
      [chr]
    )
    return res.rows[0].version
  }

  const repo = new PostgresCohortSummaryRepository()

  it("divides by the cases of the row's own genome build", async () => {
    const case38a = await seedCase('freq-38-a', 'GRCh38')
    await seedCase('freq-38-b', 'GRCh38')
    const case37 = await seedCase('freq-37', 'GRCh37')
    await seedVariant({ caseId: case38a, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: case37, chr: '2', pos: 200, ref: 'C', alt: 'G', gtNum: '0/1' })

    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    // 1 carrier / 2 GRCh38 cases; the GRCh37 case does not dilute it.
    expect(await freqByChr('1', 'GRCh38')).toBeCloseTo(0.5)
    // 1 carrier / 1 GRCh37 case.
    expect(await freqByChr('2', 'GRCh37')).toBeCloseTo(1.0)
  }, 60_000)

  it('stores no frequency: rebuild and incrementalAdd leave the column NULL', async () => {
    const caseA = await seedCase('freq-null-a', 'GRCh38')
    const caseB = await seedCase('freq-null-b', 'GRCh38')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseB, chr: '2', pos: 200, ref: 'C', alt: 'G', gtNum: '0/1' })

    await withClient(async (client) => {
      await repo.rebuild({ schema, client: client as never })
      await repo.incrementalRemove({ schema, client: client as never, caseId: caseB })
      await repo.incrementalAdd({ schema, client: client as never, caseId: caseB })
    })

    const stored = await probe.query<{ stored: string }>(
      `SELECT COUNT(cohort_frequency)::text AS stored FROM "${schema}".cohort_variant_summary`
    )
    expect(stored.rows[0].stored).toBe('0')
    expect(await freqByChr('1', 'GRCh38')).toBeCloseTo(0.5)
    expect(await freqByChr('2', 'GRCh38')).toBeCloseTo(0.5)
  }, 60_000)

  it('adding a case changes the frequency of rows it does not carry without rewriting them', async () => {
    const caseA = await seedCase('freq-grow-a', 'GRCh38')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await withClient((client) =>
      repo.incrementalAdd({ schema, client: client as never, caseId: caseA })
    )
    expect(await freqByChr('1', 'GRCh38')).toBeCloseTo(1.0)
    const before = await rowVersion('1')

    // A second case with a different variant: the first row's frequency
    // halves, but the import must not touch that row.
    const caseB = await seedCase('freq-grow-b', 'GRCh38')
    await seedVariant({ caseId: caseB, chr: '2', pos: 200, ref: 'C', alt: 'G', gtNum: '0/1' })
    await withClient((client) =>
      repo.incrementalAdd({ schema, client: client as never, caseId: caseB })
    )

    expect(await freqByChr('1', 'GRCh38')).toBeCloseTo(0.5)
    expect(await rowVersion('1')).toBe(before)
  }, 60_000)
})

describe.skipIf(!RUN)('cohort_summary_state lifecycle — C2 + C1', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_cvs_state_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedCase(name: string, genomeBuild = 'GRCh38'): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
           VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [name, `/tmp/${name}.json`, now, genomeBuild]
    )
    return res.rows[0].id
  }

  async function seedVariant(v: SeedVariant): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        v.caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.variantType ?? 'snv',
        v.geneSymbol ?? null,
        v.gtNum ?? null
      ]
    )
    return res.rows[0].id
  }

  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client as unknown as Client)
    } finally {
      ;(client as { release: () => void }).release()
    }
  }

  async function stateRow(): Promise<{
    is_stale: boolean
    stale_reason: string | null
    stale_at: Date | null
    last_rebuilt_at: Date | null
    last_incremental_at: Date | null
  }> {
    const res = await probe.query<{
      is_stale: boolean
      stale_reason: string | null
      stale_at: Date | null
      last_rebuilt_at: Date | null
      last_incremental_at: Date | null
    }>(
      `SELECT is_stale, stale_reason, stale_at, last_rebuilt_at, last_incremental_at
         FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    return res.rows[0]
  }

  const repo = new PostgresCohortSummaryRepository()

  it('rebuild() sets is_stale=false, last_rebuilt_at=now()', async () => {
    // Pre-flag stale so the rebuild has something to clear.
    await withClient((client) =>
      repo.markStale({ schema, client: client as never, reason: 'before-rebuild' })
    )
    const before = await stateRow()
    expect(before.is_stale).toBe(true)
    expect(before.last_rebuilt_at).toBeNull()

    const caseA = await seedCase('state-rebuild-a')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })

    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    const after = await stateRow()
    expect(after.is_stale).toBe(false)
    expect(after.stale_reason).toBeNull()
    expect(after.stale_at).toBeNull()
    expect(after.last_rebuilt_at).not.toBeNull()
  }, 60_000)

  it('markStale(reason) sets is_stale=true, stale_reason=<reason>, stale_at=now()', async () => {
    // Establish a non-stale baseline with a recorded rebuild time first.
    await withClient((client) => repo.rebuild({ schema, client: client as never }))
    const baseline = await stateRow()
    expect(baseline.is_stale).toBe(false)
    expect(baseline.last_rebuilt_at).not.toBeNull()

    await withClient((client) =>
      repo.markStale({ schema, client: client as never, reason: 'case_deleted' })
    )

    const after = await stateRow()
    expect(after.is_stale).toBe(true)
    expect(after.stale_reason).toBe('case_deleted')
    expect(after.stale_at).not.toBeNull()
    // markStale must preserve rebuild history (last_rebuilt_at untouched).
    // node-pg deserialises TIMESTAMPTZ to Date, so compare by epoch value.
    expect(new Date(after.last_rebuilt_at!).getTime()).toBe(
      new Date(baseline.last_rebuilt_at!).getTime()
    )
  }, 60_000)

  it('incrementalAdd leaves a stale summary, and its flag, to the rebuild', async () => {
    // Force is_stale=true, then add a case incrementally; the flag must remain.
    await withClient((client) =>
      repo.markStale({ schema, client: client as never, reason: 'pending' })
    )
    const caseA = await seedCase('state-incr-a')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })

    await withClient((client) =>
      repo.incrementalAdd({ schema, client: client as never, caseId: caseA, genomeBuild: 'GRCh38' })
    )

    const after = await stateRow()
    expect(after.is_stale).toBe(true)
    expect(after.stale_reason).toBe('pending')
    // Nothing was patched: the rebuild writes every row (summaryAwaitsRebuild).
    expect(after.last_incremental_at).toBeNull()
    const rows = await probe.query(`SELECT 1 FROM "${schema}".cohort_variant_summary`)
    expect(rows.rowCount).toBe(0)
  }, 60_000)

  it('getState maps TIMESTAMPTZ → epoch ms via EXTRACT(EPOCH)*1000 (Pass-9 #6)', async () => {
    // Pin last_rebuilt_at to a known instant and assert the epoch-ms mapping.
    const fixedIso = '2026-05-01T12:00:00.000Z'
    const fixedMs = Date.parse(fixedIso)
    await probe.query(
      `UPDATE "${schema}".cohort_summary_state
         SET is_stale = false, last_rebuilt_at = $1::timestamptz WHERE id = 1`,
      [fixedIso]
    )

    const state = await withClient((client) => repo.getState({ schema, client: client as never }))
    expect(state.is_stale).toBe(false)
    expect(typeof state.last_rebuilt_at).toBe('number')
    expect(state.last_rebuilt_at).toBe(fixedMs)
  }, 60_000)

  it('getState returns last_rebuilt_at=0 when never rebuilt (NULL coalesce)', async () => {
    // Fresh schema with no variants seeds is_stale=false, last_rebuilt_at NULL.
    const state = await withClient((client) => repo.getState({ schema, client: client as never }))
    expect(state.is_stale).toBe(false)
    expect(state.last_rebuilt_at).toBe(0)
  }, 60_000)
})

describe.skipIf(RUN)('PostgresCohortSummaryRepository.rebuild — Sprint A C2 (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
