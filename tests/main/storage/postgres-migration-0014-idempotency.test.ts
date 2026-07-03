import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { describe, expect, test } from 'vitest'

/**
 * A5b — the 0014 hosted-user migration must be idempotent. Its ADD COLUMN and
 * CREATE INDEX statements already use IF NOT EXISTS, but PostgreSQL has no
 * `ADD CONSTRAINT IF NOT EXISTS`, so the CHECK constraint must be guarded by a
 * pg_constraint existence check inside a DO block. Re-applying the file against a
 * schema that already has the constraint (but no ledger row) must not error.
 */
const sqlPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/main/storage/postgres/migrations/sql/0014_hosted_user_private_db.sql'
)
const sql = readFileSync(sqlPath, 'utf8')

describe('0014 hosted_user_private_db migration idempotency', () => {
  test('guards the CHECK constraint with a pg_constraint existence check', () => {
    expect(sql).toMatch(
      /DO \$\$[\s\S]*pg_constraint[\s\S]*conname = 'users_private_db_status_check'[\s\S]*ADD CONSTRAINT users_private_db_status_check[\s\S]*\$\$/
    )
  })

  test('does not add the constraint unconditionally (no bare ADD CONSTRAINT)', () => {
    const withoutGuardedBlock = sql.replace(/DO \$\$[\s\S]*?\$\$;/g, '')
    expect(withoutGuardedBlock).not.toMatch(/ADD CONSTRAINT users_private_db_status_check/)
  })
})
