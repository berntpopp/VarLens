/**
 * Pooled clients carry two 30 s timers (src/main/storage/config.ts): the
 * server's `statement_timeout` and node-postgres' client-side `query_timeout`.
 * Work that legitimately runs longer — a background summary rebuild, hiding a
 * large case, a migration, an export stream — has to lift both. Raising only
 * the server one leaves the client rejecting at 30 s while the server keeps
 * running the statement.
 */
import type { Pool, PoolClient } from 'pg'
import QueryStream from 'pg-query-stream'

/** An export is paced by its consumer (a download); bound an abandoned one. */
const STREAM_STATEMENT_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Lift pg's "Query read timeout" on a checked-out client; call the returned
 * function before releasing it. pg arms that timer from
 * `config.query_timeout || client.connectionParameters.query_timeout`
 * (pg/lib/client.js): a property on the client itself is never read, and a
 * per-query 0 falls through the `||` to the pool's value.
 */
export function liftClientQueryTimeout(client: object): () => void {
  const timeouts = (client as { connectionParameters?: { query_timeout?: number } })
    .connectionParameters
  if (timeouts === undefined) return () => undefined
  const saved = timeouts.query_timeout
  timeouts.query_timeout = 0
  return () => {
    timeouts.query_timeout = saved
  }
}

/**
 * Run `sql` (ROLLBACK, RESET …) keeping the caller's own error. Returns the
 * failure, if any: pass it to `client.release(...)` so the pool destroys a
 * connection that is still inside a transaction instead of handing it out.
 */
export async function runOrDestroy(
  client: Pick<PoolClient, 'query'>,
  sql: string
): Promise<Error | undefined> {
  try {
    await client.query(sql)
    return undefined
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/** Stream a query whose rows may take longer than both timeouts to consume. */
export async function* streamLongQuery(
  pool: Pick<Pool, 'connect'>,
  sql: string,
  values: unknown[]
): AsyncGenerator<Record<string, unknown>> {
  const client: Pick<PoolClient, 'query' | 'release'> = await pool.connect()
  const restoreQueryTimeout = liftClientQueryTimeout(client)
  let failure: Error | undefined
  try {
    // Session-level, not SET LOCAL: an open transaction would sit "idle in
    // transaction" while the consumer drains the last batch.
    await client.query(`SET statement_timeout = ${STREAM_STATEMENT_TIMEOUT_MS}`)
    yield* client.query(new QueryStream(sql, values)) as AsyncIterable<Record<string, unknown>>
  } finally {
    // RESET returns to the value the pool connected with.
    failure = await runOrDestroy(client, 'RESET statement_timeout')
    restoreQueryTimeout()
    client.release(failure)
  }
}
