import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'

/**
 * Static gate over the Postgres migrations directory.
 *
 * The original docstring on this file claimed to guard against
 * "forgetting to register a freshly-added .sql file" — but the test
 * only asserted specific migration names. That was misleading: dropping a new
 * `0008_*.sql` into the sql/ dir without a `definitions.ts` entry would
 * still let the test pass, and registering an entry whose file was
 * later deleted would fail only at runtime under VARLENS_RUN_POSTGRES_E2E.
 *
 * This implementation actually closes both directions:
 *   - every `.sql` file on disk MUST have a matching registration entry
 *   - every registration entry MUST have a matching `.sql` file on disk
 *   - registered checksums are non-empty 64-hex (sha256 shape)
 *   - the auth migration (0008 / create_users_and_settings) is present,
 *     also containing the table DDL it claims to ship
 */

const SQL_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/main/storage/postgres/migrations/sql'
)

function listSqlFiles(): string[] {
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

describe('postgres migration registration', () => {
  it('every registered migration has a matching file on disk', () => {
    const onDisk = new Set(listSqlFiles())
    for (const m of POSTGRES_MIGRATIONS) {
      const expectedFile = `${m.version}_${m.name}.sql`
      expect(
        onDisk,
        `registered migration ${m.version}/${m.name} expects ${expectedFile} on disk`
      ).toContain(expectedFile)
    }
  })

  it('every .sql file on disk is registered', () => {
    const registered = new Set(POSTGRES_MIGRATIONS.map((m) => `${m.version}_${m.name}.sql`))
    for (const file of listSqlFiles()) {
      expect(
        registered,
        `${file} sits in sql/ but is not registered in definitions.ts — runner will silently skip it`
      ).toContain(file)
    }
  })

  it('registers the users + database_settings migration', () => {
    const m = POSTGRES_MIGRATIONS.find((x) => x.version === '0008')
    expect(m, 'migration 0008 must be registered').toBeDefined()
    expect(m!.name).toBe('create_users_and_settings')
    // Pin SQL content so an empty/stub file can't slip past.
    expect(m!.sql, 'migration 0008 must declare the users table').toMatch(/CREATE TABLE.+users/i)
    expect(m!.sql, 'migration 0008 must declare the database_settings table').toMatch(
      /CREATE TABLE.+database_settings/i
    )
  })

  it('migration versions are unique and contiguous, one file per version', () => {
    // Parallel branches that each add "the next" migration collide on the
    // number (two 0017_*.sql files once landed side by side). Duplicates or
    // gaps must fail here, not when a deployed schema refuses to migrate.
    const versions = POSTGRES_MIGRATIONS.map((m) => Number(m.version))
    expect(new Set(versions).size, 'duplicate migration version').toBe(versions.length)
    expect(versions, 'migration versions must run 0001..N without gaps').toEqual(
      versions.map((_, index) => index + 1)
    )
    const prefixes = listSqlFiles().map((file) => file.slice(0, 4))
    expect(new Set(prefixes).size, 'two .sql files share a version prefix').toBe(prefixes.length)
  })

  it('registered migrations are sorted by zero-padded version', () => {
    const versions = POSTGRES_MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([...versions].sort())
    // Encoded invariant: zero-padded 4-digit versions. Adding a 5-digit
    // version would silently break lexical sort order.
    for (const v of versions) {
      expect(v, `migration version ${v} must be 4-digit zero-padded`).toMatch(/^\d{4}$/)
    }
  })

  it('every registered migration carries a sha256-shaped checksum', () => {
    for (const m of POSTGRES_MIGRATIONS) {
      expect(m.checksum).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
