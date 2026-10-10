import type { PoolClient } from 'pg'

export interface TransactionCapablePool {
  connect: () => Promise<PoolClient>
}

/**
 * Runs an async operation inside a transaction on a dedicated PoolClient.
 *
 * Automatically manages:
 * - Connecting a client from the pool
 * - BEGIN before operation
 * - COMMIT on success
 * - ROLLBACK on error (catching rollback errors to preserve the original exception)
 * - Releasing the client back to the pool, passing any rollback failure to release(err)
 *   so the pool discards broken connections.
 */
export async function withTransaction<T>(
  pool: TransactionCapablePool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  let rollbackError: unknown = undefined
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rbErr) {
      rollbackError = rbErr
    }
    throw error
  } finally {
    client.release(rollbackError as Error | boolean | undefined)
  }
}
