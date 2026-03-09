import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { Kysely, CompiledQuery } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import { TransactionError } from './errors'

/**
 * Base class for all database repositories.
 *
 * All repositories use the Kysely compile+execute pattern: Kysely builds SQL
 * with full type safety, then `compile()` produces a `CompiledQuery` that is
 * executed synchronously via better-sqlite3's `prepare().all/get/run`.
 */
export class BaseRepository {
  constructor(
    protected db: DatabaseType,
    protected kysely: Kysely<VarlensDatabase>
  ) {}

  /**
   * Compile a Kysely query and execute synchronously via better-sqlite3.
   * Returns all matching rows.
   */
  protected execAll<T>(query: { compile: () => CompiledQuery<T> }): T[] {
    const compiled = query.compile()
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as T[]
  }

  /**
   * Compile a Kysely query and execute synchronously, returning the first row or undefined.
   */
  protected execFirst<T>(query: { compile: () => CompiledQuery<T> }): T | undefined {
    const compiled = query.compile()
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as T | undefined
  }

  /**
   * Compile a Kysely INSERT/UPDATE/DELETE and execute synchronously.
   * Returns the better-sqlite3 RunResult (lastInsertRowid, changes).
   */
  protected execRun(query: { compile: () => CompiledQuery }): {
    lastInsertRowid: number | bigint
    changes: number
  } {
    const compiled = query.compile()
    return this.db.prepare(compiled.sql).run(...compiled.parameters)
  }

  protected runTransaction<T>(fn: () => T): T {
    try {
      const transactionFn = this.db.transaction(fn)
      return transactionFn()
    } catch (error) {
      throw new TransactionError('Transaction failed', error instanceof Error ? error : undefined)
    }
  }
}
