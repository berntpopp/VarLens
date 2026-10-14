// @vitest-environment node
/**
 * #125: table pages carry the tags of their rows, from one lookup per page.
 * The case view shows the case's own tags; the cohort view the tags of every
 * carrier case. SQLite always runs; the same fixture against a real
 * PostgreSQL is gated by VARLENS_RUN_POSTGRES_E2E=1 (requires `make pg-up`).
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import { DEFAULT_TAGS } from '../../../src/shared/config/default-tags.config'
import { makeVariant } from '../../utils/make-variant'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const SHARED = { chr: '1', pos: 100, ref: 'A', alt: 'G' }
const UNIQUE = { chr: '1', pos: 200, ref: 'C', alt: 'T' }

/** What every backend must return, with tag ids read back as names. */
const EXPECTED = {
  caseA: { '1:100:A:G': ['Alpha'], '1:200:C:T': [] },
  caseB: { '1:100:A:G': ['Alpha', 'Beta'] },
  cohort: { '1:100:A:G': ['Alpha', 'Beta'], '1:200:C:T': [] }
}

type Row = { chr: string; pos: number; ref: string; alt: string; tag_ids?: number[] }

function byLocus(rows: Row[], names: Map<number, string>): Record<string, string[]> {
  return Object.fromEntries(
    rows.map((r) => [
      `${r.chr}:${r.pos}:${r.ref}:${r.alt}`,
      (r.tag_ids ?? []).map((id) => names.get(id) ?? `?${id}`).sort()
    ])
  )
}

describe('table page tag ids on SQLite', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })
  afterEach(() => service.close())

  it('case rows carry their own tags, cohort rows the tags of all carriers', () => {
    const alpha = service.tags.createTag('Alpha', '#F44336').id
    const beta = service.tags.createTag('Beta', '#2196F3').id
    const caseA = service.cases.createCase('a', '/a.vcf', 1)
    const caseB = service.cases.createCase('b', '/b.vcf', 1)
    service.variants.insertVariantsBatch(caseA, [makeVariant(SHARED), makeVariant(UNIQUE)])
    service.variants.insertVariantsBatch(caseB, [makeVariant(SHARED)])
    const idOf = (caseId: number, pos: number): number =>
      (
        service.database
          .prepare('SELECT id FROM variants WHERE case_id = ? AND pos = ?')
          .get(caseId, pos) as { id: number }
      ).id
    service.tags.assignVariantTag(caseA, idOf(caseA, 100), alpha)
    service.tags.assignVariantTag(caseB, idOf(caseB, 100), alpha)
    service.tags.assignVariantTag(caseB, idOf(caseB, 100), beta)
    service.cohortSummary.rebuild()

    const names = new Map(service.tags.listTags().map((t) => [t.id, t.name]))
    const page = (caseId: number): Row[] =>
      service.variants.getVariants({ case_id: caseId }, 50, 0).data
    expect(byLocus(page(caseA), names)).toEqual(EXPECTED.caseA)
    expect(byLocus(page(caseB), names)).toEqual(EXPECTED.caseB)
    expect(byLocus(service.cohort.getCohortVariants({}).data, names)).toEqual(EXPECTED.cohort)
  })
})

describe.skipIf(!RUN)('table page tag ids on PostgreSQL', () => {
  let schema: string
  let pool: Pool
  const caseIds: number[] = []

  beforeAll(async () => {
    schema = `vt_tag_ids_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 3 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const summaryRepo = new PostgresCohortSummaryRepository()
    for (const [index, loci] of [[SHARED, UNIQUE], [SHARED]].entries()) {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build, import_status)
         VALUES ($1, $2, 0, $3, 'GRCh38', 'ready') RETURNING id`,
        [`tags-${index}`, `/tmp/tags-${index}.json`, Date.now()]
      )
      const caseId = Number(created.rows[0].id)
      caseIds.push(caseId)
      for (const v of loci) {
        await pool.query(
          `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gt_num)
           VALUES ($1, $2, $3, $4, $5, 'snv', '0/1')`,
          [caseId, v.chr, v.pos, v.ref, v.alt]
        )
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await summaryRepo.incrementalAdd({
          schema,
          client: client as never,
          caseId,
          genomeBuild: 'GRCh38'
        })
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
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

  it('0038 seeded the default tags', async () => {
    const result = await pool.query(`SELECT name, color FROM "${schema}".tags ORDER BY id`)
    expect(result.rows).toEqual(DEFAULT_TAGS.map(({ name, color }) => ({ name, color })))
  })

  it('case rows carry their own tags, cohort rows the tags of all carriers', async () => {
    const tag = async (name: string): Promise<number> =>
      Number(
        (
          await pool.query<{ id: string }>(
            `INSERT INTO "${schema}".tags (name, color, created_at) VALUES ($1, '#000000', 1) RETURNING id`,
            [name]
          )
        ).rows[0].id
      )
    const alpha = await tag('Alpha')
    const beta = await tag('Beta')
    const assign = (caseId: number, tagId: number): Promise<unknown> =>
      pool.query(
        `INSERT INTO "${schema}".variant_tags (case_id, variant_id, tag_id, created_at)
         SELECT case_id, id, $2, 1 FROM "${schema}".variants WHERE case_id = $1 AND pos = 100`,
        [caseId, tagId]
      )
    await assign(caseIds[0], alpha)
    await assign(caseIds[1], alpha)
    await assign(caseIds[1], beta)

    const names = new Map(
      (await pool.query(`SELECT id, name FROM "${schema}".tags`)).rows.map(
        (t: { id: string; name: string }) => [Number(t.id), t.name] as const
      )
    )
    const variants = new PostgresVariantReadRepository(pool, schema)
    const page = async (caseId: number): Promise<Row[]> =>
      (await variants.queryVariants({ case_id: caseId }, 50, 0)).data
    expect(byLocus(await page(caseIds[0]), names)).toEqual(EXPECTED.caseA)
    expect(byLocus(await page(caseIds[1]), names)).toEqual(EXPECTED.caseB)
    const cohort = await new PostgresCohortRepository(pool, schema).queryVariants({})
    expect(byLocus(cohort.data, names)).toEqual(EXPECTED.cohort)
  })
})
