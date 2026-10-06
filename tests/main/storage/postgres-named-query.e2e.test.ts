/**
 * Real-PostgreSQL coverage for prepared-statement name collisions.
 *
 * PostgreSQL truncates statement names to 63 bytes. Two long schema names
 * sharing a prefix used to map the same logical statement to one truncated
 * server-side name, so the second schema's Parse on a shared connection
 * failed with "prepared statement ... already exists" (or, worse, could run
 * against the wrong schema's plan).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires a reachable VARLENS_PG_URL.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runNamed, runNamedDynamic } from '../../../src/main/storage/postgres/named-query'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('Postgres named statements with 60-char schemas — real instance', () => {
  const run = randomBytes(4).toString('hex')
  // 60 chars each; identical except for the last character.
  const prefix = `vl_named_${run}_${'x'.repeat(41)}`
  const schemas = [`${prefix}a`, `${prefix}b`]
  let pool: Pool

  beforeAll(async () => {
    expect(schemas.every((s) => s.length === 60)).toBe(true)
    const admin = new Client({ connectionString: PG_URL })
    await admin.connect()
    for (const [i, schema] of schemas.entries()) {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`CREATE TABLE "${schema}".t (v int)`)
      await admin.query(`INSERT INTO "${schema}".t VALUES (${i + 1})`)
    }
    await admin.end()
    // One connection: every statement is prepared on the same session.
    pool = new Pool({ connectionString: PG_URL, max: 1 })
  }, 60_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const admin = new Client({ connectionString: PG_URL })
    await admin.connect()
    for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.end()
  }, 60_000)

  it('runNamed prepares one statement per schema on a shared connection', async () => {
    for (let round = 0; round < 2; round++) {
      for (const [i, schema] of schemas.entries()) {
        const res = await runNamed<{ v: number }>(pool, {
          name: 'cohort_summary:annotation_flags_on_case_delete:v1',
          text: `SELECT v FROM "${schema}".t`,
          values: [],
          schema
        })
        expect(res.rows[0].v).toBe(i + 1)
      }
    }
  })

  it('runNamedDynamic prepares one statement per schema on a shared connection', async () => {
    for (let round = 0; round < 2; round++) {
      for (const [i, schema] of schemas.entries()) {
        const res = await runNamedDynamic<{ v: number }>(pool, {
          baseName: 'cohort:queryVariants:summary_page',
          text: `SELECT v FROM "${schema}".t WHERE v > $1`,
          values: [0],
          schema
        })
        expect(res.rows[0].v).toBe(i + 1)
      }
    }
  })
})
