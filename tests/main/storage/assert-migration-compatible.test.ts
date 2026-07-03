import { describe, expect, test, vi } from 'vitest'

import {
  assertPostgresMigrationCompatible,
  expectedPostgresMigrationHead
} from '../../../src/main/storage/postgres/assertMigrationCompatible'

/**
 * A1 — hosted request-time migration-compatibility gate. The hosted router opens
 * workspace DBs WITHOUT running migrations, so it must fail closed when the workspace
 * schema version does not match the app's compiled migration head, instead of serving
 * requests that later blow up as raw `relation does not exist`.
 */
function fakePool(responses: Array<{ rows: unknown[] }>): {
  query: ReturnType<typeof vi.fn>
} {
  const queue = [...responses]
  return {
    query: vi.fn(async () => {
      const next = queue.shift()
      if (next === undefined) throw new Error('unexpected query')
      return next
    })
  }
}

describe('assertPostgresMigrationCompatible', () => {
  const head = expectedPostgresMigrationHead()

  test('resolves when the workspace schema is at the compiled migration head', async () => {
    const pool = fakePool([
      { rows: [{ relation: 'public.schema_migrations' }] },
      { rows: [{ version: head }] }
    ])
    await expect(assertPostgresMigrationCompatible(pool, 'app')).resolves.toBeUndefined()
  })

  test('fails closed when the schema_migrations ledger is missing (unmigrated workspace)', async () => {
    const pool = fakePool([{ rows: [{ relation: null }] }])
    await expect(assertPostgresMigrationCompatible(pool, 'app')).rejects.toThrow(
      /migration.*(missing|not migrated)/i
    )
  })

  test('fails closed when the workspace schema version is older than the app head', async () => {
    const pool = fakePool([
      { rows: [{ relation: 'public.schema_migrations' }] },
      { rows: [{ version: '0001' }] }
    ])
    await expect(assertPostgresMigrationCompatible(pool, 'app')).rejects.toThrow(
      /migration.*incompatible/i
    )
  })

  test('fails closed when the workspace schema is ahead of the app head', async () => {
    const pool = fakePool([
      { rows: [{ relation: 'public.schema_migrations' }] },
      { rows: [{ version: '9999' }] }
    ])
    await expect(assertPostgresMigrationCompatible(pool, 'app')).rejects.toThrow(
      /migration.*incompatible/i
    )
  })

  test('exposes the compiled head as the latest migration version', () => {
    expect(head).toMatch(/^\d{4}$/)
  })
})
