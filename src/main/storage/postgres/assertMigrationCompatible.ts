import type { Pool } from 'pg'

import { quoteIdentifier } from './identifiers'
import { POSTGRES_MIGRATIONS } from './migrations/definitions'

/**
 * The version string of the newest migration the running app is compiled against.
 * A hosted workspace DB must be at exactly this version to be served.
 */
export function expectedPostgresMigrationHead(): string {
  const head = POSTGRES_MIGRATIONS[POSTGRES_MIGRATIONS.length - 1]
  if (head === undefined) {
    throw new Error('no PostgreSQL migrations are defined')
  }
  return head.version
}

/**
 * A1 — request-time migration compatibility gate for hosted workspace DBs.
 *
 * Hosted request handling opens workspace pools WITHOUT running migrations
 * (`openPostgresStorageSessionWithoutMigrating`). This read-only probe validates
 * that the workspace schema is at the app's compiled migration head and throws a
 * controlled error otherwise, so a stale or mis-provisioned workspace is refused at
 * routing time rather than surfacing as raw `relation does not exist` 500s deep in
 * query handlers. It runs no DDL.
 */
export async function assertPostgresMigrationCompatible(
  pool: Pick<Pool, 'query'>,
  schema: string,
  expectedHead: string = expectedPostgresMigrationHead()
): Promise<void> {
  const schemaName = quoteIdentifier(schema)

  const relation = await pool.query(`SELECT to_regclass($1) AS relation`, [
    `${schemaName}."schema_migrations"`
  ])
  if (relation.rows[0]?.relation == null) {
    throw new Error(
      `workspace migration ledger is missing; schema is not migrated (expected head ${expectedHead})`
    )
  }

  const versionResult = await pool.query(
    `SELECT version FROM ${schemaName}."schema_migrations" ORDER BY version DESC LIMIT 1`
  )
  const current = versionResult.rows[0]?.version as string | undefined
  if (current !== expectedHead) {
    throw new Error(
      `workspace migration incompatible: expected head ${expectedHead}, found ${current ?? 'none'}`
    )
  }
}
