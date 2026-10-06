import { describe, expect, test } from 'vitest'
import { Pool } from 'pg'

import type { Job } from '../../../src/shared/types/jobs'
import { startWebDriver } from '../helpers/web-driver'

/**
 * Web case deletion runs the shared `case_delete` job
 * (src/shared/types/case-delete-job.ts) on lock-free Postgres phases
 * (blocking audit W-1): `cases:startDelete` returns a job id at once,
 * `jobs:get` reports progress, `cases:delete` waits for the same job, and the
 * case vanishes from reads. Runs against the real Postgres stack in-process.
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

async function waitForJob(
  api: (domain: string, method: string, ...args: unknown[]) => Promise<{ json: () => unknown }>,
  jobId: string
): Promise<Job> {
  for (let i = 0; i < 200; i++) {
    const job = (await api('jobs', 'get', jobId)).json() as Job | null
    if (job !== null && ['completed', 'failed', 'cancelled'].includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`job ${jobId} did not finish`)
}

describe.skipIf(!HAS_PG)('case_delete job (web/Postgres)', () => {
  test('cases:startDelete returns a job id; the job completes and the case is gone', async () => {
    const driver = await startWebDriver()
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      const doomed = await seedCase(pool, driver.schema, 'doomed', 2500)
      const keeper = await seedCase(pool, driver.schema, 'keeper', 10)

      const started = await driver.api('cases', 'startDelete', { mode: 'ids', ids: [doomed] })
      expect(started.statusCode, started.body).toBe(200)
      const { jobId } = started.json() as { jobId: string }
      expect(typeof jobId).toBe('string')

      const job = await waitForJob(driver.api, jobId)
      expect(job, JSON.stringify(job)).toMatchObject({
        kind: 'case_delete',
        status: 'completed',
        params: { mode: 'ids', ids: [doomed] },
        progress: { current: 1, total: 1, message: 'finalizing' }
      })

      const list = await driver.api('cases', 'list')
      const ids = (list.json() as Array<{ id: number }>).map((c) => Number(c.id))
      expect(ids).toContain(keeper)
      expect(ids).not.toContain(doomed)

      const stored = await pool.query(
        `SELECT 1 FROM "${driver.schema}".variants_all WHERE case_id = $1 LIMIT 1`,
        [doomed]
      )
      expect(stored.rows).toHaveLength(0)

      const jobs = await driver.api('jobs', 'list', { kind: 'case_delete' })
      expect((jobs.json() as Job[]).map((j) => j.id)).toContain(jobId)

      // The start is audited synchronously as a write; job polls are not audited.
      const audit = await pool.query<{ action_type: string; entity_key: string }>(
        `SELECT action_type, entity_key FROM varlens_audit.audit_log
          WHERE project_schema = $1 AND entity_key IN ('cases:startDelete', 'jobs:get')`,
        [driver.schema]
      )
      expect(audit.rows).toEqual([{ action_type: 'api_write', entity_key: 'cases:startDelete' }])
    } finally {
      await pool.end()
      await driver.close()
    }
  }, 60_000)

  test('cases:delete and cases:deleteBatch wait for the job', async () => {
    const driver = await startWebDriver()
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      const a = await seedCase(pool, driver.schema, 'a', 100)
      const b = await seedCase(pool, driver.schema, 'b', 100)
      const c = await seedCase(pool, driver.schema, 'c', 100)

      const single = await driver.api('cases', 'delete', a)
      expect(single.statusCode, single.body).toBe(200)
      const batch = await driver.api('cases', 'deleteBatch', [b, c])
      expect(batch.statusCode, batch.body).toBe(200)
      expect(batch.json()).toBe(2)

      const remaining = await pool.query(`SELECT id FROM "${driver.schema}".cases_all`)
      expect(remaining.rows).toHaveLength(0)
    } finally {
      await pool.end()
      await driver.close()
    }
  }, 60_000)

  test('validation: unknown case 404, bad target 400, unknown job null, cancel no-op', async () => {
    const driver = await startWebDriver()
    try {
      const missing = await driver.api('cases', 'delete', 987654)
      expect(missing.statusCode, missing.body).toBe(404)

      const badTarget = await driver.api('cases', 'startDelete', { mode: 'ids', ids: [] })
      expect(badTarget.statusCode).toBe(400)

      const unknown = await driver.api('jobs', 'get', 'NOSUCHJOB')
      expect(unknown.statusCode).toBe(200)
      expect(unknown.json()).toBeNull()

      const cancel = await driver.api('jobs', 'cancel', 'NOSUCHJOB')
      expect(cancel.json()).toEqual({ requested: false })
    } finally {
      await driver.close()
    }
  }, 60_000)
})
