/**
 * Workspace import lock ("lease") for one PostgreSQL schema.
 *
 * Only one import operation may write a workspace at a time, so that
 * interrupted-import recovery never deletes rows of an import that is still
 * running. The lock is a session-level advisory lock, released when its
 * connection ends, so a crashed importer cannot leave it held.
 *
 *  - A single-file import takes it on the worker's own connection.
 *  - A parallel batch takes it once, on the batch coordinator's control
 *    connection, and passes that backend's pid to its workers as their lease.
 *
 * The lock decides who may start. What a worker that is already running may
 * still write once its coordinator is lost is decided by the import fence
 * (postgres-import-fence.ts); the lease carries the generation for it.
 */
import { PostgresVcfImportRepository } from './PostgresVcfImportRepository'
interface Queryable {
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> | unknown[] }>
}

export const WORKSPACE_IMPORT_BUSY_MESSAGE =
  'An import operation is already in progress for this PostgreSQL workspace'

const IMPORT_LOCK_KEYS_SQL = "hashtext($1), hashtext('varlens-import')"

/** Take the workspace import lock on this connection, or fail if it is taken. */
export async function acquireWorkspaceImportLock(client: Queryable, schema: string): Promise<void> {
  const result = await client.query(
    `SELECT pg_try_advisory_lock(${IMPORT_LOCK_KEYS_SQL}) AS locked`,
    [schema]
  )
  if ((result.rows[0] as { locked?: boolean } | undefined)?.locked !== true) {
    throw new Error(WORKSPACE_IMPORT_BUSY_MESSAGE)
  }
}

/** Release the lock taken by {@link acquireWorkspaceImportLock} on this connection. */
export async function releaseWorkspaceImportLock(client: Queryable, schema: string): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEYS_SQL})`, [schema])
}

/**
 * Verify that backend `holderPid` holds this workspace's import lock. A leased
 * worker must fail closed: without the lock nothing stops a second import, or
 * its recovery pass, from running against the rows this worker writes.
 */
export async function assertImportLeaseHeld(
  client: Queryable,
  schema: string,
  holderPid: number
): Promise<void> {
  // Two-key advisory locks are stored as (classid, objid) with objsubid = 2.
  const result = await client.query(
    `SELECT true AS held
       FROM pg_locks
      WHERE locktype = 'advisory' AND granted AND pid = $1 AND objsubid = 2
        AND classid = hashtext($2)::oid
        AND objid = hashtext('varlens-import')::oid`,
    [holderPid, schema]
  )
  if ((result.rows as unknown[]).length === 0) {
    throw new Error(
      `Import lease is not held: backend ${holderPid} does not own the import lock for ${schema}`
    )
  }
}

/** The connection a batch coordinator holds the workspace import lock on. */
export interface ImportLeaseClient extends Queryable {
  connect: () => Promise<unknown>
  end: () => Promise<unknown>
}

export interface ImportLease {
  /** Backend that owns the workspace import lock; workers verify it. */
  holderPid: number
  /** Import generation of this batch; every worker transaction verifies it. */
  generation: number
  /** Clean up after every worker has exited, then release the workspace. */
  close: () => Promise<void>
}

/**
 * Open the lease for a parallel batch: take the workspace import lock on a
 * dedicated connection and recover interrupted imports once, before any
 * worker starts. `close` runs the recovery again, which removes the
 * provisional rows of files that were cancelled or crashed, and ends the
 * connection, which releases the lock.
 *
 * Lock order: workspace import lock, then the fence (inside each recovery).
 * Recovery's wait for the fence is bounded; see postgres-import-fence.ts.
 */
export async function openImportLease(
  client: ImportLeaseClient,
  schema: string
): Promise<ImportLease> {
  const repository = new PostgresVcfImportRepository(schema)
  const recover = (): Promise<number> => repository.recoverInterruptedImports(client as never)
  await client.connect()
  try {
    // Recovery may wait for a dying worker's backend to release its rows.
    await client.query('SET statement_timeout = 0')
    await client.query('SET lock_timeout = 0')
    await acquireWorkspaceImportLock(client, schema)
    const generation = await recover()
    const pidResult = await client.query('SELECT pg_backend_pid() AS pid')
    const holderPid = Number((pidResult.rows[0] as { pid?: unknown } | undefined)?.pid)
    if (!Number.isInteger(holderPid)) throw new Error('Could not determine the lease backend pid')
    return {
      holderPid,
      generation,
      close: async () => {
        try {
          await recover()
        } finally {
          await client.end()
        }
      }
    }
  } catch (error) {
    await client.end().catch(() => undefined)
    throw error
  }
}
