import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import { TransactionError } from './errors'

export class BaseRepository {
  constructor(
    protected db: DatabaseType,
    protected kysely: Kysely<VarlensDatabase>,
    protected statementCache: Map<string, Statement>
  ) {}

  protected stmt(sql: string): Statement {
    let statement = this.statementCache.get(sql)
    if (statement === undefined) {
      statement = this.db.prepare(sql)
      this.statementCache.set(sql, statement)
    }
    return statement
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
