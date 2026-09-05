import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Client, Pool } from 'pg'

import { POSTGRES_MIGRATIONS } from '../../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

function runCli(schema: string, subject: string, role = 'user'): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve('out/web/provision-platform-user.cjs'),
        '--subject',
        subject,
        '--display-name',
        `Display ${subject}`,
        '--role',
        role
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VARLENS_PG_URL: PG_URL,
          VARLENS_PG_SCHEMA: schema
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.once('error', reject)
    child.once('close', (code) => resolveResult({ code, stdout, stderr }))
  })
}

describe.skipIf(!RUN)('provision-platform-user built CLI — real PostgreSQL', () => {
  const schema = `platform_cli_${Date.now()}_${randomBytes(4).toString('hex')}`
  let pool: Pool

  beforeAll(async () => {
    const client = new Client({ connectionString: PG_URL })
    await client.connect()
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.end()
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const client = new Client({ connectionString: PG_URL })
    await client.connect()
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await client.end()
  }, 60_000)

  test('allows one subject, updates it, and rejects a concurrent second binding', async () => {
    const firstAttempts = await Promise.all([
      runCli(schema, 'platform-subject-a'),
      runCli(schema, 'platform-subject-b')
    ])
    const successes = firstAttempts.filter((result) => result.code === 0)
    const failures = firstAttempts.filter((result) => result.code !== 0)

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(JSON.parse(successes[0].stdout)).toMatchObject({ ok: true, role: 'user' })
    expect(JSON.parse(failures[0].stderr)).toMatchObject({ ok: false })
    expect(failures[0].stderr).toMatch(/already bound to another platform subject/i)

    const subject = JSON.parse(successes[0].stdout).subject as string
    const update = await runCli(schema, subject, 'admin')
    expect(update.code).toBe(0)
    expect(JSON.parse(update.stdout)).toEqual({ ok: true, subject, role: 'admin' })

    const rows = await pool.query<{
      username: string
      role: string
      auth_source: string
      password_hash: string
    }>(
      `SELECT username, role, auth_source, password_hash
       FROM "${schema}".users WHERE auth_source = 'platform'`
    )
    expect(rows.rows).toEqual([
      {
        username: subject,
        role: 'admin',
        auth_source: 'platform',
        password_hash: 'platform-identity-disabled-local-password'
      }
    ])
  }, 60_000)

  test('deactivates an existing active local admin when provisioning a platform admin', async () => {
    const adminSchema = `platform_admin_${Date.now()}_${randomBytes(4).toString('hex')}`
    const client = new Client({ connectionString: PG_URL })
    await client.connect()
    await client.query(`CREATE SCHEMA "${adminSchema}"`)
    try {
      await new PostgresMigrationRunner(pool, adminSchema, POSTGRES_MIGRATIONS).migrate()
      await client.query(
        `INSERT INTO "${adminSchema}".users (username, password_hash, role, auth_source, is_active)
         VALUES ('local-bootstrap-admin', 'hash', 'admin', 'local', TRUE)`
      )

      const adminCli = await runCli(adminSchema, 'platform-admin-subject', 'admin')
      expect(adminCli.code).toBe(0)
      expect(JSON.parse(adminCli.stdout)).toEqual({
        ok: true,
        subject: 'platform-admin-subject',
        role: 'admin'
      })

      const rows = await client.query<{
        username: string
        role: string
        auth_source: string
        is_active: boolean
      }>(
        `SELECT username, role, auth_source, is_active
         FROM "${adminSchema}".users
         WHERE username IN ('local-bootstrap-admin', 'platform-admin-subject')
         ORDER BY username ASC`
      )
      expect(rows.rows).toEqual([
        {
          username: 'local-bootstrap-admin',
          role: 'admin',
          auth_source: 'local',
          is_active: false
        },
        {
          username: 'platform-admin-subject',
          role: 'admin',
          auth_source: 'platform',
          is_active: true
        }
      ])
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${adminSchema}" CASCADE`)
      await client.end()
    }
  }, 60_000)
})
