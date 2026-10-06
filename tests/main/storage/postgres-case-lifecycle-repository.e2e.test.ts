/**
 * Sprint A PR-3 C3 (delete half) — PostgresCaseLifecycleRepository.deleteCase
 * against a real Postgres. Complements the mocked ordering unit test in
 * postgres-case-lifecycle-repository.test.ts by proving the 8-step SQL actually
 * executes and maintains the materialised cohort summary correctly:
 *
 *   - the deduped per-case UPDATE subtracts carrier/het/hom together,
 *   - zero-carrier rows are deleted,
 *   - variant_frequency.case_count is rebuilt after the cascade,
 *   - cohort_frequency denominators exclude the deleted case,
 *   - cohort_column_meta rows for the deleted case are gone,
 *   - a sibling case's summary contributions survive.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { rebuildVariantFrequencyForCase } from '../../../src/main/storage/postgres/PostgresJsonImportRepository'

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
  gtNum?: string | null
}

describe.skipIf(!RUN)('PostgresCaseLifecycleRepository.deleteCase — Sprint A C3', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_delete_${Date.now()}_${randomBytes(4).toString('hex')}`
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
         (case_id, chr, pos, ref, alt, variant_type, gt_num)
         VALUES ($1, $2, $3, $4, $5, 'snv', $6) RETURNING id`,
      [v.caseId, v.chr, v.pos, v.ref, v.alt, v.gtNum ?? null]
    )
    return res.rows[0].id
  }

  const summary = new PostgresCohortSummaryRepository()

  async function buildSummaryFor(caseId: number, genomeBuild = 'GRCh38'): Promise<void> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await summary.incrementalAdd({ schema, client: client as never, caseId, genomeBuild })
      await summary.refreshColumnMetas({ schema, client: client as never, caseId })
      // Imports maintain variant_frequency per case; deletion decrements it
      // symmetrically instead of rebuilding the whole table.
      await rebuildVariantFrequencyForCase(client, schema, caseId)
      await client.query('COMMIT')
    } finally {
      ;(client as { release: () => void }).release()
    }
  }

  it('subtracts the deleted case from the summary while keeping the sibling', async () => {
    const caseA = await seedCase('del-a')
    const caseB = await seedCase('del-b')
    // Shared het+hom coordinate (carrier_count 2), plus a caseA-only coordinate.
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseB, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '1/1' })
    await seedVariant({ caseId: caseA, chr: '2', pos: 200, ref: 'C', alt: 'G', gtNum: '0/1' })

    await buildSummaryFor(caseA)
    await buildSummaryFor(caseB)

    const repo = new PostgresCaseLifecycleRepository(pool, schema)
    await repo.deleteCase(caseA)

    // Shared coordinate: caseA (het) removed → carrier 1, het 0, hom 1 (caseB).
    const shared = await probe.query<{
      carrier_count: string
      het_count: string
      hom_count: string
      cohort_frequency: number | null
    }>(
      `SELECT carrier_count, het_count, hom_count, cohort_frequency
         FROM "${schema}".cohort_variant_summary WHERE chr = '1'`
    )
    expect(shared.rows).toHaveLength(1)
    expect(Number(shared.rows[0].carrier_count)).toBe(1)
    expect(Number(shared.rows[0].het_count)).toBe(0)
    expect(Number(shared.rows[0].hom_count)).toBe(1)
    // One carrier / one surviving GRCh38 case = 1.0 (denominator excludes caseA).
    expect(Number(shared.rows[0].cohort_frequency)).toBeCloseTo(1.0)

    // caseA-only coordinate: carrier dropped to zero → row deleted (step 4).
    const gone = await probe.query(
      `SELECT 1 FROM "${schema}".cohort_variant_summary WHERE chr = '2'`
    )
    expect(gone.rows).toHaveLength(0)
  }, 60_000)

  it('collapses intra-case duplicate coordinates to one carrier on delete (Pass-10 blocker)', async () => {
    // A single case can legitimately hold two rows for one coordinate under
    // different gt_num — there is no unique constraint on
    // variants(case_id,chr,pos,ref,alt,variant_type). incrementalAdd collapses
    // these to a single carrier (carrier_count 1 per coordinate per case), so
    // deleteCase must subtract exactly that single carrier, not COUNT(*) = 2.
    const caseA = await seedCase('dup-a')
    const caseB = await seedCase('dup-b')
    // caseA holds the shared coordinate twice under two different genotypes.
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '1/1' })
    // Sibling case carries the same coordinate once (het).
    await seedVariant({ caseId: caseB, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })

    await buildSummaryFor(caseA)
    await buildSummaryFor(caseB)

    // After add: carrier 2 (caseA collapsed to 1 + caseB 1). MAX(gt_num) over the
    // two caseA rows is '1/1' → caseA counted as hom; caseB het. So het 1, hom 1.
    const before = await probe.query<{
      carrier_count: string
      het_count: string
      hom_count: string
    }>(
      `SELECT carrier_count, het_count, hom_count
         FROM "${schema}".cohort_variant_summary WHERE chr = '1'`
    )
    expect(before.rows).toHaveLength(1)
    expect(Number(before.rows[0].carrier_count)).toBe(2)

    const repo = new PostgresCaseLifecycleRepository(pool, schema)
    await repo.deleteCase(caseA)

    // Deleting caseA must leave exactly the sibling's contribution: carrier 1,
    // het 1, hom 0. A COUNT(*)-based delta would over-subtract caseA's two rows
    // (carrier_count 0 → row dropped, het/hom underflowing negative).
    const after = await probe.query<{
      carrier_count: string
      het_count: string
      hom_count: string
      cohort_frequency: number | null
    }>(
      `SELECT carrier_count, het_count, hom_count, cohort_frequency
         FROM "${schema}".cohort_variant_summary WHERE chr = '1'`
    )
    expect(after.rows).toHaveLength(1)
    expect(Number(after.rows[0].carrier_count)).toBe(1)
    expect(Number(after.rows[0].het_count)).toBe(1)
    expect(Number(after.rows[0].hom_count)).toBe(0)
    // One carrier / one surviving GRCh38 case = 1.0.
    expect(Number(after.rows[0].cohort_frequency)).toBeCloseTo(1.0)
  }, 60_000)

  it('decrements variant_frequency and drops the deleted case and its variants', async () => {
    const caseA = await seedCase('vf-a')
    const caseB = await seedCase('vf-b')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseB, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })

    await buildSummaryFor(caseA)
    await buildSummaryFor(caseB)

    const repo = new PostgresCaseLifecycleRepository(pool, schema)
    await repo.deleteCase(caseA)

    // variant_frequency.case_count powers internal_af — must reflect 1 case now.
    const vf = await probe.query<{ case_count: string }>(
      `SELECT case_count FROM "${schema}".variant_frequency
         WHERE chr = '1' AND pos = 100 AND ref = 'A' AND alt = 'T'`
    )
    expect(vf.rows).toHaveLength(1)
    expect(Number(vf.rows[0].case_count)).toBe(1)

    // Case row + cascade-deleted variants gone.
    const caseGone = await probe.query(`SELECT 1 FROM "${schema}".cases WHERE id = $1`, [caseA])
    expect(caseGone.rows).toHaveLength(0)
    const variantsGone = await probe.query(
      `SELECT 1 FROM "${schema}".variants WHERE case_id = $1`,
      [caseA]
    )
    expect(variantsGone.rows).toHaveLength(0)
  }, 60_000)

  it('removes the deleted case column-meta rows but keeps the sibling (step 8)', async () => {
    const caseA = await seedCase('meta-a')
    const caseB = await seedCase('meta-b')
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseB, chr: '2', pos: 200, ref: 'C', alt: 'G', gtNum: '0/1' })

    await buildSummaryFor(caseA)
    await buildSummaryFor(caseB)

    const repo = new PostgresCaseLifecycleRepository(pool, schema)
    await repo.deleteCase(caseA)

    const aMeta = await probe.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${schema}".cohort_column_meta WHERE case_id = $1`,
      [caseA]
    )
    const bMeta = await probe.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${schema}".cohort_column_meta WHERE case_id = $1`,
      [caseB]
    )
    expect(Number(aMeta.rows[0].count)).toBe(0)
    expect(Number(bMeta.rows[0].count)).toBeGreaterThan(0)
  }, 60_000)

  it('handles a case with zero variants cleanly', async () => {
    const empty = await seedCase('empty')

    const repo = new PostgresCaseLifecycleRepository(pool, schema)
    await expect(repo.deleteCase(empty)).resolves.toBeUndefined()

    const gone = await probe.query(`SELECT 1 FROM "${schema}".cases WHERE id = $1`, [empty])
    expect(gone.rows).toHaveLength(0)
  }, 60_000)
})

describe.skipIf(!RUN)('PostgresCaseLifecycleRepository — background deletion phases', () => {
  let schema: string
  let pool: Pool
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_bgdelete_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 3 })
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

  async function seedCaseWithVariants(name: string, count: number): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, variant_count)
         VALUES ($1, '/tmp/x.vcf', 0, 0, $2) RETURNING id`,
      [name, count]
    )
    const caseId = Number(res.rows[0].id)
    await probe.query(
      `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gt_num)
         SELECT $1, '1', g, 'A', 'T', 'snv', '0/1' FROM generate_series(1, $2::int) g`,
      [caseId, count]
    )
    const client = await pool.connect()
    try {
      await rebuildVariantFrequencyForCase(client, schema, caseId)
    } finally {
      client.release()
    }
    return caseId
  }

  it('hideCase makes the case invisible to readers at once and frees its name', async () => {
    const caseId = await seedCaseWithVariants('hide-me', 50)
    const repo = new PostgresCaseLifecycleRepository(pool, schema)

    const hidden = await repo.hideCase(caseId)
    expect(hidden).toMatchObject({ state: 'hidden', variantCount: 50 })

    const visibleCase = await probe.query(`SELECT 1 FROM "${schema}".cases WHERE id = $1`, [caseId])
    const visibleVariants = await probe.query(
      `SELECT 1 FROM "${schema}".variants WHERE case_id = $1`,
      [caseId]
    )
    expect(visibleCase.rows).toHaveLength(0)
    expect(visibleVariants.rows).toHaveLength(0)
    // Rows are still physically present until the purge runs.
    const stored = await probe.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${schema}".variants_all WHERE case_id = $1`,
      [caseId]
    )
    expect(Number(stored.rows[0].n)).toBe(50)
    // variant_frequency already reflects the deletion.
    const vf = await probe.query(`SELECT 1 FROM "${schema}".variant_frequency`)
    expect(vf.rows).toHaveLength(0)

    // The UNIQUE name is free for an immediate re-import.
    await expect(seedCaseWithVariants('hide-me', 1)).resolves.toBeGreaterThan(caseId)
    expect(await repo.getCaseStatus(caseId)).toBe('deleting')
    expect(await repo.listPendingDeletions()).toEqual([
      { caseId, genomeBuild: 'GRCh38', variantCount: 50 }
    ])
  }, 60_000)

  it('purges in batches, resumes after an interruption and finalizes', async () => {
    const caseId = await seedCaseWithVariants('purge-me', 120)
    const repo = new PostgresCaseLifecycleRepository(pool, schema)
    const hidden = await repo.hideCase(caseId)

    const controller = new AbortController()
    let batches = 0
    await expect(
      repo.completeHiddenDeletion(caseId, hidden, {
        batchSize: 25,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === 'purging' && p.done > 0 && ++batches === 2) controller.abort()
        }
      })
    ).rejects.toThrow('interrupted')

    const midway = await probe.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${schema}".variants_all WHERE case_id = $1`,
      [caseId]
    )
    expect(Number(midway.rows[0].n)).toBe(70)

    // Resume path: hideCase reports 'resume' and the deletion completes.
    await repo.deleteCase(caseId, { batchSize: 25 })
    const gone = await probe.query(`SELECT 1 FROM "${schema}".cases_all WHERE id = $1`, [caseId])
    const leftovers = await probe.query(
      `SELECT 1 FROM "${schema}".variants_all WHERE case_id = $1`,
      [caseId]
    )
    expect(gone.rows).toHaveLength(0)
    expect(leftovers.rows).toHaveLength(0)
    expect(await repo.listPendingDeletions()).toEqual([])
  }, 60_000)

  it('purge batches do not block concurrent reads of other cases', async () => {
    const victim = await seedCaseWithVariants('victim', 400)
    const bystander = await seedCaseWithVariants('bystander', 10)
    const repo = new PostgresCaseLifecycleRepository(pool, schema)
    const hidden = await repo.hideCase(victim)

    // Hold a purge-sized delete transaction open, then read another case
    // with a short lock_timeout: an ACCESS EXCLUSIVE lock would fail it.
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query(
        `DELETE FROM "${schema}".variants_all WHERE id IN (
           SELECT id FROM "${schema}".variants_all WHERE case_id = $1 LIMIT 100)`,
        [victim]
      )
      const reader = new Client({ connectionString: PG_URL })
      await reader.connect()
      try {
        await reader.query("SET lock_timeout = '200ms'")
        const res = await reader.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "${schema}".variants v
             LEFT JOIN "${schema}".variant_frequency vf ON vf.coord_hash = v.coord_hash
            WHERE v.case_id = $1`,
          [bystander]
        )
        expect(res.rows[0].n).toBe(10)
      } finally {
        await reader.end()
      }
      await holder.query('ROLLBACK')
    } finally {
      holder.release()
    }
    await repo.completeHiddenDeletion(victim, hidden, { batchSize: 100 })
  }, 60_000)
})

describe.skipIf(RUN)('PostgresCaseLifecycleRepository.deleteCase — Sprint A C3 (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
