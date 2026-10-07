/**
 * Real-PostgreSQL lock behaviour of the import recovery fence (plan item C1):
 * who waits for whom, what a refused worker transaction looks like, and that
 * no connection keeps the exclusive (session-level) fence after recovery.
 *
 * Waits are observed through `pg_locks` (a condition, not a sleep).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires a reachable VARLENS_PG_URL.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import {
  beginFencedImportTransaction,
  IMPORT_FENCE_BUSY_MESSAGE,
  markImportConnection,
  readImportGeneration
} from '../../../src/main/storage/postgres/postgres-import-fence'
import { PostgresVcfImportRepository } from '../../../src/main/storage/postgres/PostgresVcfImportRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const SUPERSEDED = { name: 'ImportSupersededError', code: 'CONFLICT' }

describe.skipIf(!RUN)('import recovery fence — locks on a real instance', () => {
  const schema = `varlens_test_fence_locks_${Date.now()}_${randomBytes(4).toString('hex')}`
  let probe: Client
  const opened: Client[] = []

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString: PG_URL })
    // A terminated backend surfaces as an 'error' event on an idle client.
    client.on('error', () => undefined)
    await client.connect()
    opened.push(client)
    return client
  }

  /** Fence locks of this workspace, as PostgreSQL sees them. */
  async function fenceLocks(): Promise<Array<{ pid: number; mode: string; granted: boolean }>> {
    const result = await probe.query<{ pid: number; mode: string; granted: boolean }>(
      `SELECT pid, mode, granted FROM pg_locks
        WHERE locktype = 'advisory' AND objsubid = 2
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid = hashtext('varlens-import-fence')::oid
          AND objid = (SELECT oid FROM pg_namespace WHERE nspname = $1)
        ORDER BY pid`,
      [schema]
    )
    return result.rows
  }

  async function until(condition: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 15_000
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error('condition was not reached')
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  async function backendPid(client: Client): Promise<number> {
    const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    return result.rows[0].pid
  }

  beforeAll(async () => {
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA "${schema}"`)
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    await pool.end()
  }, 60_000)

  afterEach(async () => {
    for (const client of opened.splice(0)) await client.end().catch(() => undefined)
    // Nothing may outlive a test; a backend that was just ended needs a moment.
    await until(async () => (await fenceLocks()).length === 0)
  })

  afterAll(async () => {
    if (!probe) return
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
  }, 60_000)

  it('schedule 3: recovery waits for a worker transaction in flight; a later worker transaction is refused at once', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const worker = await connect()
    const lateWorker = await connect()
    const owner = await connect()
    const generation = await repo.recoverInterruptedImports(owner as never)
    const fence = { schema, generation }

    // A worker transaction in flight: it holds the fence in shared mode.
    await beginFencedImportTransaction(worker, fence)
    const provisional = await repo.beginProvisionalImport(worker as never, {
      caseName: 'in-flight',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 1,
      genomeBuild: 'GRCh38'
    })

    let recovered = false
    const recovery = repo.recoverInterruptedImports(owner as never).then((next) => {
      recovered = true
      return next
    })
    await until(async () => (await fenceLocks()).some((lock) => !lock.granted))
    expect(recovered).toBe(false)

    // Recovery is queued for the fence: a transaction that starts now must
    // not slip in front of it, and it does not wait either.
    const startedAt = Date.now()
    await expect(beginFencedImportTransaction(lateWorker, fence)).rejects.toMatchObject(SUPERSEDED)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(recovered).toBe(false)

    // The transaction in flight finishes normally; only then recovery runs.
    await worker.query('COMMIT')
    const nextGeneration = await recovery
    expect(nextGeneration).toBeGreaterThan(generation)
    expect(await readImportGeneration(probe, schema)).toBe(nextGeneration)
    // The case it committed was still `importing`, so recovery removed it.
    const left = await probe.query(`SELECT id FROM "${schema}"."cases_all" WHERE id = $1`, [
      provisional.caseId
    ])
    expect(left.rows).toEqual([])

    // After recovery the fence is free again, but the old generation is not.
    await expect(beginFencedImportTransaction(worker, fence)).rejects.toMatchObject(SUPERSEDED)
    await beginFencedImportTransaction(worker, { schema, generation: nextGeneration })
    await worker.query('COMMIT')
  }, 60_000)

  it('keys the fence by the schema itself, so two workspaces can never share one', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const owner = await connect()
    const generation = await repo.recoverInterruptedImports(owner as never)
    const worker = await connect()
    await beginFencedImportTransaction(worker, { schema, generation })

    const held = await probe.query<{ objid: string; namespace: string }>(
      `SELECT l.objid::text AS objid,
              (SELECT oid::text FROM pg_namespace WHERE nspname = $2) AS namespace
         FROM pg_locks l WHERE l.pid = $1 AND l.locktype = 'advisory'`,
      [await backendPid(worker), schema]
    )
    expect(held.rows).toHaveLength(1)
    expect(held.rows[0].objid).toBe(held.rows[0].namespace)
    await worker.query('COMMIT')

    // A schema that does not exist has no fence: the transaction is refused.
    await expect(
      beginFencedImportTransaction(worker, { schema: `${schema}_missing`, generation })
    ).rejects.toMatchObject(SUPERSEDED)
  }, 60_000)

  it('schedule 3: a worker transaction that starts while recovery holds the fence is refused without writing', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const worker = await connect()
    const owner = await connect()
    const generation = await repo.recoverInterruptedImports(owner as never)

    // Hold recovery inside the fence: it blocks on a row this test has locked.
    const blocker = await connect()
    const stuck = await repo.beginProvisionalImport(probe as never, {
      caseName: 'stuck',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 1,
      genomeBuild: 'GRCh38'
    })
    await blocker.query('BEGIN')
    await blocker.query(`SELECT id FROM "${schema}"."cases_all" WHERE id = $1 FOR UPDATE`, [
      stuck.caseId
    ])
    const recovery = repo.recoverInterruptedImports(owner as never)
    await until(async () =>
      (await fenceLocks()).some((lock) => lock.granted && lock.mode === 'ExclusiveLock')
    )

    await expect(
      beginFencedImportTransaction(worker, { schema, generation })
    ).rejects.toMatchObject(SUPERSEDED)
    // The refused transaction was rolled back: the session is usable and idle.
    const state = await worker.query<{ txid: string | null }>(
      'SELECT txid_current_if_assigned()::text AS txid'
    )
    expect(state.rows[0].txid).toBeNull()

    await blocker.query('ROLLBACK')
    await recovery
  }, 60_000)

  it('bounds the wait for the exclusive fence: a holder that never finishes is terminated', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const owner = await connect()
    const generation = await repo.recoverInterruptedImports(owner as never)
    const orphan = await connect()
    await markImportConnection(orphan, schema)
    const orphanPid = await backendPid(orphan)
    await beginFencedImportTransaction(orphan, { schema, generation })

    const next = await repo.recoverInterruptedImports(owner as never, { waitMs: 200, attempts: 2 })

    expect(next).toBeGreaterThan(generation)
    await until(async () => {
      const alive = await probe.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [orphanPid])
      return alive.rows.length === 0
    })
  }, 60_000)

  it('never terminates a holder that is not an import connection of this workspace', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const owner = await connect()
    const generation = await repo.recoverInterruptedImports(owner as never)
    // Holds the fence, but is not marked as an import connection (an
    // interactive session, another application).
    const stranger = await connect()
    const strangerPid = await backendPid(stranger)
    await beginFencedImportTransaction(stranger, { schema, generation })

    await expect(
      repo.recoverInterruptedImports(owner as never, { waitMs: 100, attempts: 3 })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: IMPORT_FENCE_BUSY_MESSAGE })

    const alive = await probe.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [strangerPid])
    expect(alive.rows).toHaveLength(1)
    await stranger.query('ROLLBACK')
  }, 60_000)

  it('ends in the bounded conflict when the holder runs under another role', async (context) => {
    const role = `varlens_fence_other_${randomBytes(4).toString('hex')}`
    try {
      await probe.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'fence-test'`)
    } catch (error) {
      // Needs CREATEROLE; the mocked test covers the failing terminate call.
      if ((error as { code?: string }).code === '42501') return context.skip()
      throw error
    }
    try {
      await probe.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
      await probe.query(`GRANT SELECT ON "${schema}"."database_settings" TO "${role}"`)
      const repo = new PostgresVcfImportRepository(schema)
      const owner = await connect()
      const generation = await repo.recoverInterruptedImports(owner as never)
      const url = new URL(PG_URL)
      url.username = role
      url.password = 'fence-test'
      const other = new Client({ connectionString: url.toString() })
      other.on('error', () => undefined)
      await other.connect()
      opened.push(other)
      await markImportConnection(other, schema)
      const otherPid = await backendPid(other)
      await beginFencedImportTransaction(other, { schema, generation })

      await expect(
        repo.recoverInterruptedImports(owner as never, { waitMs: 100, attempts: 3 })
      ).rejects.toMatchObject({ code: 'CONFLICT', message: IMPORT_FENCE_BUSY_MESSAGE })

      const alive = await probe.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [otherPid])
      expect(alive.rows).toHaveLength(1)
      await other.query('ROLLBACK')
      await other.end()
    } finally {
      await probe.query(`DROP OWNED BY "${role}"`)
      await probe.query(`DROP ROLE "${role}"`)
    }
  }, 60_000)

  it('gives up with a busy conflict when the fence cannot be taken, and holds nothing afterwards', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const owner = await connect()
    const generation = await repo.recoverInterruptedImports(owner as never)
    const holder = await connect()
    await beginFencedImportTransaction(holder, { schema, generation })

    // attempts: 1 — a single bounded wait, no termination.
    await expect(
      repo.recoverInterruptedImports(owner as never, { waitMs: 100, attempts: 1 })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: IMPORT_FENCE_BUSY_MESSAGE })
    expect(await readImportGeneration(probe, schema)).toBe(generation)
    expect((await fenceLocks()).map((lock) => lock.mode)).toEqual(['ShareLock'])
    await holder.query('COMMIT')
  }, 60_000)

  it('a damaged generation value fails recovery with a typed error and does not poison the session', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const owner = await connect()
    const generation = await repo.recoverInterruptedImports(owner as never)
    await probe.query(
      `UPDATE "${schema}"."database_settings" SET value = 'not-a-number' WHERE key = 'import_generation'`
    )
    try {
      await expect(repo.recoverInterruptedImports(owner as never)).rejects.toMatchObject({
        name: 'ImportGenerationInvalidError',
        code: 'CONFLICT'
      })
      // No worker can run on a generation nobody can read.
      await expect(
        beginFencedImportTransaction(owner, { schema, generation })
      ).rejects.toMatchObject(SUPERSEDED)
    } finally {
      await probe.query(
        `UPDATE "${schema}"."database_settings" SET value = $1 WHERE key = 'import_generation'`,
        [String(generation)]
      )
    }
    // Repaired by hand: the same connection recovers again.
    expect(await repo.recoverInterruptedImports(owner as never)).toBe(generation + 1)
  }, 60_000)

  it('schedule 6: no connection keeps the session-level fence after recovery, whether it succeeds or fails', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const pool = new Pool({ connectionString: PG_URL, max: 1 })
    try {
      const first = await pool.connect()
      const pid = (await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid
      await repo.recoverInterruptedImports(first)

      // A recovery that fails half-way must release the fence too.
      await repo.beginProvisionalImport(first, {
        caseName: 'fails-in-recovery',
        filePath: '/tmp/a.vcf.gz',
        fileSize: 1,
        genomeBuild: 'GRCh38'
      })
      const failing = {
        query: async (sql: string | { text: string }, values?: unknown[]) => {
          const text = typeof sql === 'string' ? sql : sql.text
          if (text.includes('DELETE FROM')) throw new Error('recovery failed half-way')
          return first.query(sql as never, values as never)
        }
      }
      await expect(repo.recoverInterruptedImports(failing as never)).rejects.toThrow(
        'recovery failed half-way'
      )
      first.release()

      // max: 1 — the pool hands out the same backend again.
      const again = await pool.connect()
      const held = await again.query(
        `SELECT locktype, mode FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'`
      )
      expect((await again.query('SELECT pg_backend_pid() AS pid')).rows[0].pid).toBe(pid)
      expect(held.rows).toEqual([])
      await repo.recoverInterruptedImports(again)
      again.release()
    } finally {
      await pool.end()
    }
  }, 60_000)
})
