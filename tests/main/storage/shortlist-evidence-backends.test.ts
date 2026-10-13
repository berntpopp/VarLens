/**
 * Evidence-rule shortlist on PostgreSQL (spec §3.3): same ordered result as
 * SQLite for the same seeded case, and one REPEATABLE READ snapshot across
 * both passes and the starred hydration. Gated by VARLENS_RUN_POSTGRES_E2E=1.
 */
import { randomBytes } from 'node:crypto'

import Database from 'better-sqlite3-multiple-ciphers'
import { Client, Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createRepositories } from '../../../src/main/database/createRepositories'
import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresExportRepository } from '../../../src/main/storage/postgres/PostgresExportRepository'
import { PostgresShortlistService } from '../../../src/main/storage/postgres/PostgresShortlistService'
import type { ShortlistResult } from '../../../src/shared/types/shortlist'
import {
  COMPHET_INDEL_ID,
  COMPHET_SNV_ID,
  EVIDENCE_CONFIG,
  evidenceFixtureRows
} from '../../fixtures/shortlist/evidence-fixture'

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const signature = (r: ShortlistResult): Array<[number, number, string | undefined]> =>
  r.rows.map((row) => [row.id, row.rank_score, row.rank_mode])

function sqliteResult(): ShortlistResult {
  const db = new Database(':memory:')
  try {
    initializeSchema(db)
    runMigrations(db)
    db.prepare(
      `INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at, genome_build)
       VALUES (1, 'evidence', '/t.vcf', 0, 0, 0, 'GRCh38')`
    ).run()
    const insert = db.prepare(
      `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol, moi,
                             gt_num, consequence, func, gnomad_af)
       VALUES (@id, 1, @variant_type, @chr, @pos, @ref, @alt, @gene_symbol, @moi,
               @gt_num, @consequence, @func, @gnomad_af)`
    )
    db.transaction(() => {
      for (const row of evidenceFixtureRows()) insert.run(row)
    })()
    return createRepositories(db).shortlistService.getShortlist(
      { caseId: 1, adHocConfig: EVIDENCE_CONFIG },
      () => null
    )
  } finally {
    db.close()
  }
}

describe.skipIf(!RUN_PG)('evidence shortlist — PostgreSQL', () => {
  let schema: string
  let pool: Pool
  let caseId: number

  const service = (onQuery?: (sql: string) => Promise<void>): PostgresShortlistService => {
    // Lets a test act between statements of the service's own client.
    const connect = async (): Promise<PoolClient> => {
      const client = await pool.connect()
      if (onQuery === undefined) return client
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (prop !== 'query') return Reflect.get(target, prop, receiver)
          return async (...args: Parameters<PoolClient['query']>) => {
            if (typeof args[0] === 'string') await onQuery(args[0])
            return (target.query as (...a: unknown[]) => unknown)(...args)
          }
        }
      })
    }
    return new PostgresShortlistService({
      pool: { query: pool.query.bind(pool), connect } as never,
      schema,
      filterPresets: { getPreset: async () => null },
      rows: new PostgresExportRepository(pool, schema)
    })
  }

  beforeAll(async () => {
    schema = `vt_shortlist_evidence_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 4 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const created = await pool.query<{ id: string }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
       VALUES ('evidence', '/t.vcf', 0, 0, 'GRCh38') RETURNING id`
    )
    caseId = Number(created.rows[0].id)
    const rows = evidenceFixtureRows()
    const col = <K extends keyof (typeof rows)[number]>(k: K): Array<(typeof rows)[number][K]> =>
      rows.map((r) => r[k])
    await pool.query(
      `INSERT INTO "${schema}".variants
         (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol, moi, gt_num, consequence, func, gnomad_af)
       SELECT t.id, $1, t.vt, t.chr, t.pos, t.ref, t.alt, t.gene, t.moi, t.gt, t.csq, t.func, t.af
       FROM unnest($2::bigint[], $3::text[], $4::text[], $5::bigint[], $6::text[], $7::text[],
                   $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::float8[])
         AS t(id, vt, chr, pos, ref, alt, gene, moi, gt, csq, func, af)`,
      [
        caseId,
        col('id'),
        col('variant_type'),
        col('chr'),
        col('pos'),
        col('ref'),
        col('alt'),
        col('gene_symbol'),
        col('moi'),
        col('gt_num'),
        col('consequence'),
        col('func'),
        col('gnomad_af')
      ]
    )
  }, 180_000)

  afterAll(async () => {
    if (pool) await pool.end()
    if (schema !== undefined) {
      const cleaner = new Client({ connectionString: PG_URL })
      await cleaner.connect()
      await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await cleaner.end()
    }
  }, 120_000)

  it('ranks exactly like SQLite (ids, scores, modes, partners)', async () => {
    const pg = await service().getShortlist({ caseId, adHocConfig: EVIDENCE_CONFIG })
    const lite = sqliteResult()
    expect(signature(pg)).toEqual(signature(lite))
    expect(pg.totalCandidates).toBe(lite.totalCandidates)
    expect(pg.rows.find((r) => r.id === COMPHET_SNV_ID)?.rank_partners).toEqual([COMPHET_INDEL_ID])
    expect(pg.rows.find((r) => r.id === COMPHET_INDEL_ID)?.rank_partners).toEqual([COMPHET_SNV_ID])
  }, 120_000)

  it('reads one snapshot: writes between the passes do not change the result', async () => {
    const before = await service().getShortlist({ caseId, adHocConfig: EVIDENCE_CONFIG })
    let declares = 0
    let mutated = false
    const mutate = async (sql: string): Promise<void> => {
      if (!sql.startsWith('DECLARE')) return
      declares += 1
      // Third DECLARE = first query of pass 2 (pass 1 declared snv, indel).
      if (declares !== 3) return
      mutated = true
      // A new third het allele in GENEA, and a star on a low filler.
      await pool.query(
        `INSERT INTO "${schema}".variants
           (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol, moi, gt_num, consequence, func, gnomad_af)
         VALUES (100000, $1, 'snv', '2', 1500, 'G', 'C', 'GENEA', 'AR', '0/1', 'HIGH', 'stop_gained', NULL)`,
        [caseId]
      )
      await pool.query(
        `INSERT INTO "${schema}".case_variant_annotations (case_id, variant_id, starred, created_at, updated_at)
         VALUES ($1, 5, 1, 0, 0)`,
        [caseId]
      )
    }
    const during = await service(mutate).getShortlist({ caseId, adHocConfig: EVIDENCE_CONFIG })
    expect(mutated).toBe(true)
    expect(signature(during)).toEqual(signature(before))
    expect(during.rows.map((r) => r.rank_partners)).toEqual(before.rows.map((r) => r.rank_partners))
    expect(during.rows.some((r) => r.rank_starred_pinned)).toBe(false)

    // The writes are real: a fresh request sees both.
    const after = await service().getShortlist({ caseId, adHocConfig: EVIDENCE_CONFIG })
    expect(after.rows[0]).toMatchObject({ id: 5, rank_starred_pinned: true })
    expect(after.totalCandidates).toBe(before.totalCandidates + 1)
  }, 120_000)
})
