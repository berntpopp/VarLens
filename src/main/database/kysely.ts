/**
 * Kysely instance factory for VarLens database
 *
 * Creates a Kysely instance that wraps an existing better-sqlite3 connection.
 * This allows Kysely and raw better-sqlite3 to share the same database handle.
 *
 * Note: Kysely's SqliteDialect always returns Promises even though better-sqlite3
 * is synchronous under the hood. New code using Kysely should use async/await.
 */
import { Kysely, SqliteDialect } from 'kysely'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { VarlensDatabase } from '../../shared/types/database-schema'

export function createKysely(db: DatabaseType): Kysely<VarlensDatabase> {
  const dialect = new SqliteDialect({ database: db })
  return new Kysely<VarlensDatabase>({ dialect })
}
