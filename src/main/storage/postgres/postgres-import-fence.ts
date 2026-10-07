/**
 * Import recovery fence for one PostgreSQL workspace schema.
 *
 * The workspace import lock (postgres-import-lease.ts) says who may start an
 * import. It cannot stop a worker that is already running: a batch worker
 * checks its coordinator's lease once, at start. If the coordinator's
 * connection is lost, a new owner takes the lock and runs interrupted-import
 * recovery while that worker still writes — and may publish a case recovery
 * is deleting. The fence closes that window with two things:
 *
 *  - an advisory lock. Every transaction of an import worker that changes
 *    import state takes it SHARED (transaction-level). Recovery takes it
 *    EXCLUSIVE (session-level, because recovery commits several transactions)
 *    for its whole duration. Recovery therefore waits for worker transactions
 *    in flight, and none can start while it runs.
 *  - a generation. Recovery advances it while it holds the fence. A worker
 *    carries the generation its operation started under; each of its
 *    transactions compares it after taking the fence and aborts on a
 *    mismatch, before writing anything.
 *
 * So a worker of a superseded operation has either committed a transaction
 * completely before recovery began (a published case is complete, counted
 * and `ready`, and recovery leaves it alone) or can never commit one again.
 *
 * The generation is the `import_generation` row of the workspace's
 * `database_settings` (the existing key/value state of a workspace), written
 * only by recovery, so it needs no migration. Workers read it with a plain
 * SELECT: no row lock, nothing written per transaction. The comparison relies
 * on READ COMMITTED (a statement sees what was committed before it began);
 * a worker transaction under another isolation level is refused.
 *
 * Lock order, for every participant: workspace import lock (session) →
 * fence → cohort summary write lock (transaction) → rows.
 *
 * Waits:
 *  - a worker never waits for the fence. If it is held or requested
 *    exclusively, the worker's operation is being superseded: the transaction
 *    is refused at once with {@link ImportSupersededError}.
 *  - recovery waits `waitMs` per attempt. A holder that outlives an attempt
 *    is a worker of a lost operation (or a cancelled worker whose backend is
 *    still busy); its backend is terminated and the next attempt follows.
 *    After `attempts` the caller gets a `CONFLICT` and nothing was changed.
 *
 * SQLite needs none of this: one process, one writer.
 */
import { AppError, ConflictError } from '../../ipc/errors'
import { ErrorCode } from '../../../shared/types/errors'
import { quoteIdentifier } from './identifiers'

interface Queryable {
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> | unknown[] }>
}

/** The workspace and the import generation one import operation runs under. */
export interface ImportFence {
  schema: string
  generation: number
}

export interface ExclusiveFenceOptions {
  /** Wait per attempt for worker transactions in flight. */
  waitMs?: number
  /** Attempts before giving up; holders are terminated between attempts. */
  attempts?: number
}

export const IMPORT_FENCE_WAIT_MS = 30_000
export const IMPORT_FENCE_ATTEMPTS = 3

export const IMPORT_FENCE_BUSY_MESSAGE =
  'A previous import operation is still finishing in this PostgreSQL workspace'

const SUPERSEDED_USER_MESSAGE =
  'This import was replaced by a newer import operation. Nothing from it was kept.'

/** A worker transaction was refused: its operation is no longer the current one. */
export class ImportSupersededError extends AppError {
  constructor(message: string) {
    super(ErrorCode.CONFLICT, message, SUPERSEDED_USER_MESSAGE)
    this.name = 'ImportSupersededError'
  }
}

/**
 * One advisory-lock call on the fence of schema `$1`. The key is the fence's
 * own class and the schema's namespace oid, so two workspaces of one database
 * can never share a fence (a hash of the schema name could collide). A schema
 * that does not exist yields no row: nothing is locked, a worker is refused,
 * and recovery's next statements fail on the missing schema.
 */
function fenceLockSql(lockFunction: string): string {
  return (
    `SELECT ${lockFunction}(hashtext('varlens-import-fence'), n.oid::int4) AS locked` +
    ` FROM pg_namespace n WHERE n.nspname = $1`
  )
}
const LOCK_NOT_AVAILABLE = '55P03'

const GENERATION_KEY = 'import_generation'

function settingsTable(schema: string): string {
  return `${quoteIdentifier(schema)}."database_settings"`
}

function toGeneration(value: unknown): number {
  const generation = Number(value)
  return typeof value === 'string' && value !== '' && Number.isSafeInteger(generation)
    ? generation
    : Number.NaN
}

/**
 * SQL condition "the import generation is still `$<parameterIndex>`" (bind
 * {@link importGenerationParameter}), for a statement that must only take
 * effect for the current operation.
 */
export function importGenerationUnchangedSql(schema: string, parameterIndex: number): string {
  return (
    `(SELECT value FROM ${settingsTable(schema)} WHERE key = '${GENERATION_KEY}')` +
    ` = $${parameterIndex}`
  )
}

export function importGenerationParameter(fence: ImportFence): string {
  return String(fence.generation)
}

async function readGenerationAndIsolation(
  client: Queryable,
  schema: string
): Promise<{ generation: number; isolation: unknown }> {
  // Two scalars, so the isolation level is reported even before the first
  // recovery has written the generation.
  const result = await client.query(
    `SELECT (SELECT value FROM ${settingsTable(schema)} WHERE key = '${GENERATION_KEY}') AS generation,
            current_setting('transaction_isolation') AS isolation`
  )
  const row = result.rows[0] as { generation?: unknown; isolation?: unknown } | undefined
  return { generation: toGeneration(row?.generation), isolation: row?.isolation }
}

/** The current import generation of the workspace (NaN before the first recovery). */
export async function readImportGeneration(client: Queryable, schema: string): Promise<number> {
  return (await readGenerationAndIsolation(client, schema)).generation
}

/** Recovery only, under the exclusive fence: start the next generation. */
async function advanceImportGeneration(client: Queryable, schema: string): Promise<number> {
  const result = await client.query(
    `INSERT INTO ${settingsTable(schema)} AS s (key, value) VALUES ('${GENERATION_KEY}', '1')
     ON CONFLICT (key) DO UPDATE SET value = (s.value::bigint + 1)::text
     RETURNING value AS generation`
  )
  const generation = toGeneration(
    (result.rows[0] as { generation?: unknown } | undefined)?.generation
  )
  if (Number.isNaN(generation)) throw new Error('Could not advance the import generation')
  return generation
}

/**
 * Start a transaction of an import worker: BEGIN, take the fence in shared
 * mode, verify the generation. On refusal the transaction is rolled back and
 * nothing was written. The caller owns COMMIT / ROLLBACK afterwards.
 *
 * The generation is read in its own statement, after the lock is held, so
 * that under READ COMMITTED it sees every recovery that held the fence
 * before. Inside one statement the read could precede the lock.
 */
export async function beginFencedImportTransaction(
  client: Queryable,
  fence: ImportFence
): Promise<void> {
  await client.query('BEGIN')
  try {
    const lock = await client.query(fenceLockSql('pg_try_advisory_xact_lock_shared'), [
      fence.schema
    ])
    if ((lock.rows[0] as { locked?: unknown } | undefined)?.locked !== true) {
      throw new ImportSupersededError(
        `Import superseded: interrupted-import recovery is running for ${fence.schema}`
      )
    }
    const current = await readGenerationAndIsolation(client, fence.schema)
    if (current.isolation !== 'read committed') {
      throw new Error(
        `Import transactions require READ COMMITTED isolation, not ${String(current.isolation)}`
      )
    }
    if (current.generation !== fence.generation) {
      throw new ImportSupersededError(
        `Import superseded: generation ${fence.generation} of ${fence.schema} was replaced by ${current.generation}`
      )
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

/** Run `operation` in one fenced worker transaction and commit it. */
export async function inFencedImportTransaction<T>(
  client: Queryable,
  fence: ImportFence,
  operation: () => Promise<T>
): Promise<T> {
  await beginFencedImportTransaction(client, fence)
  try {
    const result = await operation()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

/** One bounded wait for the exclusive fence. `false`: the bound was reached. */
async function tryTakeExclusiveFence(
  client: Queryable,
  schema: string,
  waitMs: number
): Promise<boolean> {
  // The bound is transaction-local; the lock itself is session-level and
  // survives this COMMIT.
  await client.query('BEGIN')
  try {
    await client.query(`SELECT set_config('lock_timeout', $1, true)`, [`${waitMs}ms`])
    await client.query(fenceLockSql('pg_advisory_lock'), [schema])
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if ((error as { code?: unknown } | null)?.code === LOCK_NOT_AVAILABLE) return false
    throw error
  }
}

/** Suffix of `application_name` on an import connection of one workspace. */
const IMPORT_CONNECTION_TAG_SQL = "' varlens-import:' || n.oid"

/**
 * Mark this connection as an import connection of the workspace: its
 * `application_name` gets the suffix ` varlens-import:<schema oid>`. Recovery
 * terminates only backends that carry it ({@link terminateFenceHolders}).
 * Every import worker calls this once, after connecting.
 */
export async function markImportConnection(client: Queryable, schema: string): Promise<void> {
  // application_name holds 63 bytes; the suffix needs at most 26.
  await client.query(
    `SELECT set_config('application_name',
                       left(current_setting('application_name'), 36) || ${IMPORT_CONNECTION_TAG_SQL},
                       false)
       FROM pg_namespace n WHERE n.nspname = $1`,
    [schema]
  )
}

/**
 * End the import backends of this workspace that still hold the fence in
 * shared mode. Deliberately narrow: only a backend in this database, logged
 * in as the current role (which may always signal its own backends) and
 * marked by {@link markImportConnection} for this schema. Any other holder —
 * an interactive session, another application, another role — is left alone
 * and makes recovery end in its bounded CONFLICT instead.
 */
async function terminateFenceHolders(client: Queryable, schema: string): Promise<void> {
  // Two-key advisory locks are stored as (classid, objid) with objsubid = 2,
  // per database; objid is this schema's namespace oid.
  await client.query(
    `SELECT pg_terminate_backend(a.pid)
       FROM pg_namespace n
       JOIN pg_locks l
         ON l.locktype = 'advisory' AND l.granted AND l.mode = 'ShareLock' AND l.objsubid = 2
        AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND l.classid = hashtext('varlens-import-fence')::oid
        AND l.objid = n.oid
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE n.nspname = $1
        AND a.datname = current_database()
        AND a.usename = current_user
        AND right(a.application_name, length(${IMPORT_CONNECTION_TAG_SQL})) = ${IMPORT_CONNECTION_TAG_SQL}
        AND a.pid <> pg_backend_pid()`,
    [schema]
  )
}

/**
 * Take the fence exclusively, advance the import generation, run `operation`
 * and release the fence — also when `operation` fails.
 *
 * `client` must be a connection the caller owns for the whole call (the
 * import worker's or the batch coordinator's): the lock is session-level.
 * It is released before this function returns; if that release fails, the
 * error is thrown and the caller must end the connection.
 */
export async function withExclusiveImportFence<T>(
  client: Queryable,
  schema: string,
  operation: (generation: number) => Promise<T>,
  options: ExclusiveFenceOptions = {}
): Promise<T> {
  const waitMs = options.waitMs ?? IMPORT_FENCE_WAIT_MS
  const attempts = options.attempts ?? IMPORT_FENCE_ATTEMPTS
  const release = (): Promise<unknown> => client.query(fenceLockSql('pg_advisory_unlock'), [schema])
  let held = false
  try {
    for (let attempt = 1; attempt <= attempts && !held; attempt += 1) {
      held = await tryTakeExclusiveFence(client, schema, waitMs)
      if (!held && attempt < attempts) {
        // A holder that cannot be signalled must not turn the bounded
        // conflict into a raw error: the next attempt decides.
        await terminateFenceHolders(client, schema).catch(() => undefined)
      }
    }
  } catch (error) {
    // The lock may have been granted before the failure (a failed COMMIT).
    await release().catch(() => undefined)
    throw error
  }
  if (!held) throw new ConflictError(IMPORT_FENCE_BUSY_MESSAGE)

  let result: T
  try {
    result = await operation(await advanceImportGeneration(client, schema))
  } catch (error) {
    // Keep the operation's failure; a failed release means a broken
    // connection, which the caller ends (and that frees the lock).
    await release().catch(() => undefined)
    throw error
  }
  await release()
  return result
}
