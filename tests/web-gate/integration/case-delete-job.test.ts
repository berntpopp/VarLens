import { describe, expect, test } from 'vitest'
import { Pool } from 'pg'

import type { BackgroundJob } from '../../../src/shared/types/background-job'
import { startWebDriver } from '../helpers/web-driver'

/**
 * Web case deletion is a background job (blocking audit W-1): `cases:delete`
 * returns a queued BackgroundJob at once, `jobs:get` reports progress, the
 * case vanishes from reads, and other users' reads keep working while the
 * purge runs. Runs against the real Postgres stack (buildApp in-process).
 */

const PG_URL = process.env.VARLENS_PG_URL ?? ''
const HAS_PG = PG_URL !== ''

async function seedCase(pool: Pool, schema: string, name: string, n: number): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, variant_count)
       VALUES ($1, '/tmp/seed.vcf', 0, 0, $2) RETURNING id`,
    [name, n]
  )
  const caseId = Number(res.rows[0].id)
  await pool.query(
    `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gt_num)
       SELECT $1, '1', g, 'A', 'T', 'snv', '0/1' FROM generate_series(1, $2::int) g`,
    [caseId, n]
  )
  return caseId
}

describe.skipIf(!HAS_PG)('case delete background job', () => {
  test('cases:delete returns a job, jobs:get reaches succeeded, the case is gone', async () => {
    const driver = await startWebDriver()
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      const doomed = await seedCase(pool, driver.schema, 'doomed', 2500)
      const keeper = await seedCase(pool, driver.schema, 'keeper', 10)

      const del = await driver.api('cases', 'delete', doomed)
      expect(del.statusCode, del.body).toBe(200)
      const job = del.json() as BackgroundJob
      expect(job).toMatchObject({
        kind: 'case-delete',
        subject: { type: 'case', id: doomed }
      })
      expect(['queued', 'running']).toContain(job.status)

      let latest = job
      for (let i = 0; i < 100 && latest.status !== 'succeeded' && latest.status !== 'failed'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        const poll = await driver.api('jobs', 'get', job.id)
        expect(poll.statusCode, poll.body).toBe(200)
        latest = poll.json() as BackgroundJob
      }
      expect(latest.status, JSON.stringify(latest)).toBe('succeeded')
      expect(latest.finishedAt).toBeGreaterThanOrEqual(latest.createdAt)

      const list = await driver.api('cases', 'list')
      const ids = (list.json() as Array<{ id: number }>).map((c) => Number(c.id))
      expect(ids).toContain(keeper)
      expect(ids).not.toContain(doomed)

      const stored = await pool.query(
        `SELECT 1 FROM "${driver.schema}".variants_all WHERE case_id = $1 LIMIT 1`,
        [doomed]
      )
      expect(stored.rows).toHaveLength(0)

      const jobs = await driver.api('jobs', 'list', { kind: 'case-delete' })
      expect((jobs.json() as BackgroundJob[]).map((j) => j.id)).toContain(job.id)

      // The write itself is audited synchronously; job polls are not.
      const audit = await pool.query<{ entity_key: string }>(
        `SELECT entity_key FROM varlens_audit.audit_log
          WHERE project_schema = $1 AND entity_key IN ('cases:delete', 'jobs:get')`,
        [driver.schema]
      )
      expect(audit.rows.map((r) => r.entity_key)).toEqual(['cases:delete'])
    } finally {
      await pool.end()
      await driver.close()
    }
  }, 60_000)

  test('unknown case → 404, malformed job id → 400, unknown job → 404', async () => {
    const driver = await startWebDriver()
    try {
      const missing = await driver.api('cases', 'delete', 987654)
      expect(missing.statusCode, missing.body).toBe(404)

      const badId = await driver.api('jobs', 'get', 'not-a-uuid')
      expect(badId.statusCode).toBe(400)

      const unknown = await driver.api('jobs', 'get', '00000000-0000-4000-8000-000000000000')
      expect(unknown.statusCode).toBe(404)
    } finally {
      await driver.close()
    }
  }, 60_000)
})
