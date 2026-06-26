import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { PostgresStorageSession } from '../../../src/main/storage/postgres/PostgresStorageSession'
import { HostedUserDbRouter } from '../../../src/web/hosted-user-db-router'
import type { HostedWebDbTopology } from '../../../src/web/topology'

const RUN_POSTGRES = Boolean(process.env.VARLENS_PG_URL)

function quoteIdent(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

function appUrl(baseUrl: string, role: string, password: string, database: string): string {
  const url = new URL(baseUrl)
  url.username = role
  url.password = password
  url.pathname = `/${database}`
  return url.toString()
}

function request(username: string) {
  return { session: { user: { username } } } as never
}

function topology(workspaceSecretDir: string): HostedWebDbTopology {
  return {
    mode: 'hosted',
    controlReadUrl: process.env.VARLENS_PG_URL!,
    controlStateUrl: process.env.VARLENS_PG_URL!,
    workspaceSecretDir,
    pools: {
      controlPoolMax: 2,
      publicAnnotationPoolMax: 1,
      workspacePoolMax: 1,
      workspacePoolGlobalMax: 4,
      workspacePoolIdleMs: 60_000
    },
    legacySinglePgUrlPresent: true
  }
}

describe.skipIf(!RUN_POSTGRES)('hosted user private DB routing - PostgreSQL integration', () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const aliceDb = `varlens_web11_alice_${suffix}`
  const bobDb = `varlens_web11_bob_${suffix}`
  const aliceRole = `varlens_web11_alice_app_${suffix}`
  const bobRole = `varlens_web11_bob_app_${suffix}`
  const alicePassword = `alice_${suffix}`
  const bobPassword = `bob_${suffix}`

  let admin: Client | undefined
  let workspaceSecretDir: string
  let router: HostedUserDbRouter | undefined

  beforeEach(async () => {
    workspaceSecretDir = await mkdtemp(join(tmpdir(), 'varlens-web11-routing-'))
    admin = new Client({ connectionString: process.env.VARLENS_PG_URL })
    await admin.connect()

    for (const [database, role, password] of [
      [aliceDb, aliceRole, alicePassword],
      [bobDb, bobRole, bobPassword]
    ]) {
      await admin.query(`CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD ${quoteLiteral(password)}`)
      await admin.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(role)}`)
      await admin.query(`REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdent(database)} FROM PUBLIC`)
      await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdent(database)} TO ${quoteIdent(role)}`)
    }

    await writeFile(
      join(workspaceSecretDir, 'alice.pgurl'),
      appUrl(process.env.VARLENS_PG_URL!, aliceRole, alicePassword, aliceDb)
    )
    await writeFile(
      join(workspaceSecretDir, 'bob.pgurl'),
      appUrl(process.env.VARLENS_PG_URL!, bobRole, bobPassword, bobDb)
    )

    const users = new Map([
      [
        'alice',
        {
          username: 'alice',
          is_active: 1,
          private_db_status: 'active',
          private_db_secret_ref: 'alice.pgurl'
        }
      ],
      [
        'bob',
        {
          username: 'bob',
          is_active: 1,
          private_db_status: 'active',
          private_db_secret_ref: 'bob.pgurl'
        }
      ]
    ])

    router = new HostedUserDbRouter({
      topology: topology(workspaceSecretDir),
      authService: {
        getUser: async (username: string) => users.get(username)
      } as never
    })
  })

  afterEach(async () => {
    await router?.close()
    await rm(workspaceSecretDir, { recursive: true, force: true })

    if (!admin) {
      return
    }

    for (const database of [aliceDb, bobDb]) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteLiteral(database)}`
      )
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)}`)
    }
    for (const role of [aliceRole, bobRole]) {
      await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`)
    }
    await admin.end()
    admin = undefined
  })

  test('opens the authenticated user session against the matching private database only', async () => {
    const alice = (await router!.resolveSession(request('alice'))) as PostgresStorageSession
    const bob = (await router!.resolveSession(request('bob'))) as PostgresStorageSession

    await expect(
      alice.getPool().query('SELECT current_database() AS db, current_user AS role')
    ).resolves.toMatchObject({
      rows: [{ db: aliceDb, role: aliceRole }]
    })
    await expect(
      bob.getPool().query('SELECT current_database() AS db, current_user AS role')
    ).resolves.toMatchObject({
      rows: [{ db: bobDb, role: bobRole }]
    })

    const aliceToBob = new Client({
      connectionString: appUrl(process.env.VARLENS_PG_URL!, aliceRole, alicePassword, bobDb)
    })
    await expect(aliceToBob.connect()).rejects.toThrow()
    await aliceToBob.end().catch(() => {})
  })
})
