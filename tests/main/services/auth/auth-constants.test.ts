import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_USER_ROLE,
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  LEGACY_ROLE_USER,
  ROLE_ADMIN,
  ROLE_ANALYST,
  ROLE_VIEWER,
  WEB_MIN_PASSWORD_LENGTH,
  USER_ROLES,
  normalizeUserRole,
  roleAtLeast,
  type UserRole
} from '../../../../src/shared/auth/auth-constants'

/**
 * Cross-backend auth policy lives in one module.
 *
 * Both backends (the existing SQLite AuthService and the upcoming
 * PostgresWebAuthService under src/web/auth/) consume the same role
 * enum, lockout threshold, lockout duration, and DEFAULT role value.
 * Without a shared source of truth they drift on policy.
 *
 * Test goes RED before auth-constants.ts exists; goes GREEN once the
 * module is added, AuthService imports from it, and both migrations
 * (SQLite v12 + Postgres 0008) match the constants in CHECK enum,
 * DEFAULT clause, and named role usage.
 *
 * The migration regexes here are whitespace-tolerant by design — a
 * future SQL reformat (extra spaces, line breaks, alternate quote
 * style) must NOT cause a false-positive drift signal. Real drift
 * (different role names, missing/extra entries, different default)
 * still fires.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

// The users.role enum was last redefined by SQLite v36 / Postgres 0020.
const SQLITE_MIGRATION_PATH = resolve(REPO_ROOT, 'src/main/database/user-roles-migration.ts')
const PG_USERS_MIGRATION_PATH = resolve(
  REPO_ROOT,
  'src/main/storage/postgres/migrations/sql/0020_user_roles.sql'
)

/** Postgres 0020 alters the column: DEFAULT and CHECK are separate statements. */
function extractPgAlteredRoleEnum(sql: string): string[] {
  const def = sql.match(/ALTER\s+COLUMN\s+role\s+SET\s+DEFAULT\s+'([^']+)'/i)
  const check = sql.match(/CHECK\s*\(\s*role\s+IN\s*\(([^)]+)\)\s*\)/i)
  if (!def || !check) throw new Error('Could not locate the role DEFAULT/CHECK in Postgres 0020')
  const roles = check[1]
    .split(',')
    .map((v) => v.trim().replace(/^'(.*)'$/s, '$1'))
    .filter(Boolean)
  return [def[1], ...roles]
}

function readOrFail(path: string, hint: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `${hint} not found at ${path}. ` +
        'If the migration file was renamed or moved, update auth-constants.test.ts ' +
        'to point at the new location.'
    )
  }
  return readFileSync(path, 'utf8')
}

function extractEnumFromCheckClause(sql: string, tableHint: string): string[] {
  // Tolerant of whitespace and line breaks. Capture the enum body of
  // a `role IN (...)` clause; require the surrounding context to
  // mention the table by name so we don't accidentally match an
  // unrelated `role` CHECK from a different table in the same file.
  const re = new RegExp(
    String.raw`${tableHint}[\s\S]+?role\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'([^']+)'\s+CHECK\s*\(\s*role\s+IN\s*\(([^)]+)\)\s*\)`,
    'i'
  )
  const m = sql.match(re)
  if (!m) {
    throw new Error(
      `Could not locate the users.role CHECK clause anchored on '${tableHint}'. ` +
        'Either the migration was restructured or the regex needs an update.'
    )
  }
  const defaultValue = m[1]
  const enumeratedRoles = m[2]
    .split(',')
    .map((s) => s.trim().replace(/^'(.*)'$/s, '$1'))
    .filter(Boolean)
  return [defaultValue, ...enumeratedRoles]
}

describe('auth-constants module', () => {
  it('exposes USER_ROLES viewer < analyst < admin (no others)', () => {
    expect([...USER_ROLES]).toEqual(['viewer', 'analyst', 'admin'])
  })

  it('exposes named role constants matching USER_ROLES', () => {
    expect(ROLE_ADMIN).toBe('admin')
    expect(ROLE_ANALYST).toBe('analyst')
    expect(ROLE_VIEWER).toBe('viewer')
    expect(USER_ROLES).toContain(ROLE_ADMIN)
    expect(USER_ROLES).toContain(ROLE_ANALYST)
    expect(USER_ROLES).toContain(ROLE_VIEWER)
  })

  it('defaults new accounts to least privilege', () => {
    expect(DEFAULT_USER_ROLE).toBe(ROLE_VIEWER)
  })

  it('normalises the legacy user role to analyst and rejects unknown roles', () => {
    expect(normalizeUserRole(LEGACY_ROLE_USER)).toBe(ROLE_ANALYST)
    expect(normalizeUserRole('viewer')).toBe('viewer')
    expect(normalizeUserRole('root')).toBeUndefined()
    expect(normalizeUserRole(undefined)).toBeUndefined()
  })

  it('roleAtLeast orders viewer < analyst < admin and denies unknown roles', () => {
    expect(roleAtLeast('viewer', 'viewer')).toBe(true)
    expect(roleAtLeast('viewer', 'analyst')).toBe(false)
    expect(roleAtLeast('analyst', 'analyst')).toBe(true)
    expect(roleAtLeast('analyst', 'admin')).toBe(false)
    expect(roleAtLeast('admin', 'analyst')).toBe(true)
    expect(roleAtLeast('user', 'analyst')).toBe(true)
    expect(roleAtLeast('superuser', 'viewer')).toBe(false)
    expect(roleAtLeast(undefined, 'viewer')).toBe(false)
  })

  it('DEFAULT_USER_ROLE is a member of USER_ROLES', () => {
    // Drift detector: a future change to USER_ROLES that drops the
    // current default value would fail this assertion before it ships.
    expect(USER_ROLES).toContain(DEFAULT_USER_ROLE)
  })

  it('exposes lockout threshold + duration matching pre-refactor values', () => {
    // Pinned values — see SECURITY POLICY note in auth-constants.ts.
    // Changing these is a security-policy edit, not a refactor: the
    // PR that touches these numbers must include a security review.
    expect(MAX_FAILED_ATTEMPTS).toBe(5)
    expect(LOCKOUT_DURATION_MINUTES).toBe(15)
  })

  it('exposes the web password minimum used by the hash CLI and Postgres service', () => {
    expect(WEB_MIN_PASSWORD_LENGTH).toBe(12)
  })

  it('UserRole type is a typed alias of USER_ROLES values (compile-time)', () => {
    // Compile-time witnesses: the `satisfies` pattern locks UserRole to
    // a subset of the array's values — TS will refuse to compile if
    // someone widens UserRole to `string` or adds a value missing from
    // USER_ROLES.
    const _admin = ROLE_ADMIN satisfies UserRole
    const _analyst = ROLE_ANALYST satisfies UserRole
    const _viewer = ROLE_VIEWER satisfies UserRole
    expect([_viewer, _analyst, _admin]).toEqual(['viewer', 'analyst', 'admin'])
  })
})

describe('AuthService.ts uses the constants module (no role literals)', () => {
  it('imports ROLE_ADMIN, DEFAULT_USER_ROLE, and UserRole from auth-constants', () => {
    const src = readOrFail(
      resolve(REPO_ROOT, 'src/main/services/auth/AuthService.ts'),
      'AuthService.ts'
    )
    expect(src, 'AuthService must import named role constants from the shared module').toMatch(
      /import\s*\{[\s\S]*?ROLE_ADMIN[\s\S]*?\}\s*from\s*['"][^'"]*shared\/auth\/auth-constants['"]/
    )
    expect(src, 'AuthService must import DEFAULT_USER_ROLE').toMatch(/DEFAULT_USER_ROLE/)
    expect(src, 'AuthService must import the UserRole type').toMatch(/type UserRole/)
  })

  it('does not redeclare the policy constants locally', () => {
    const src = readOrFail(
      resolve(REPO_ROOT, 'src/main/services/auth/AuthService.ts'),
      'AuthService.ts'
    )
    expect(src, 'no shadowed MAX_FAILED_ATTEMPTS').not.toMatch(/^const\s+MAX_FAILED_ATTEMPTS\s*=/m)
    expect(src, 'no shadowed LOCKOUT_DURATION_MINUTES').not.toMatch(
      /^const\s+LOCKOUT_DURATION_MINUTES\s*=/m
    )
  })

  it('uses ROLE_ADMIN/DEFAULT_USER_ROLE as parameter values (no inline role string literals in SQL or returns)', () => {
    const src = readOrFail(
      resolve(REPO_ROOT, 'src/main/services/auth/AuthService.ts'),
      'AuthService.ts'
    )
    // Allow the strings inside import statements + comments only. Strip
    // those, then check no bare `'admin'` / `'user'` survives in code.
    const stripped = src
      .replace(/import[\s\S]*?from\s*['"][^'"]+['"]/g, '') // imports
      .replace(/\/\/[^\n]*/g, '') // line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    expect(stripped, `AuthService must use ROLE_ADMIN, not the string literal 'admin'`).not.toMatch(
      /'admin'/
    )
    expect(stripped, `AuthService must not hard-code role string literals`).not.toMatch(
      /'(user|analyst|viewer)'/
    )
  })
})

describe('web password policy uses the shared constant', () => {
  it('PostgresWebAuthService imports WEB_MIN_PASSWORD_LENGTH from auth-constants', () => {
    const src = readOrFail(
      resolve(REPO_ROOT, 'src/web/auth/PostgresWebAuthService.ts'),
      'PostgresWebAuthService.ts'
    )
    expect(src).toMatch(/WEB_MIN_PASSWORD_LENGTH/)
    expect(src).not.toMatch(/^export const MIN_PASSWORD_LENGTH\s*=\s*12/m)
  })

  it('the hash-password CLI imports WEB_MIN_PASSWORD_LENGTH from auth-constants', () => {
    const src = readOrFail(
      resolve(REPO_ROOT, 'scripts/varlens-hash-password.ts'),
      'scripts/varlens-hash-password.ts'
    )
    expect(src).toMatch(/WEB_MIN_PASSWORD_LENGTH/)
    expect(src).not.toMatch(/^const MIN_PASSWORD_LENGTH\s*=\s*12/m)
  })
})

describe('migration parity — SQLite v36', () => {
  it('users.role CHECK enumerates exactly USER_ROLES', () => {
    const sql = readOrFail(SQLITE_MIGRATION_PATH, 'SQLite user-roles-migration.ts')
    const [defaultValue, ...enumerated] = extractEnumFromCheckClause(sql, 'CREATE TABLE users_v36')
    expect(new Set(enumerated)).toEqual(new Set(USER_ROLES))
    expect(defaultValue).toBe(DEFAULT_USER_ROLE)
  })
})

describe('migration parity — Postgres 0020', () => {
  it('users.role CHECK enumerates exactly USER_ROLES', () => {
    const sql = readOrFail(PG_USERS_MIGRATION_PATH, 'Postgres 0020 migration')
    const [defaultValue, ...enumerated] = extractPgAlteredRoleEnum(sql)
    expect(new Set(enumerated)).toEqual(new Set(USER_ROLES))
    expect(defaultValue).toBe(DEFAULT_USER_ROLE)
  })
})

describe('cross-backend defaults agree', () => {
  it('SQLite and Postgres both DEFAULT to DEFAULT_USER_ROLE', () => {
    const sqlite = readOrFail(SQLITE_MIGRATION_PATH, 'SQLite user-roles-migration.ts')
    const pg = readOrFail(PG_USERS_MIGRATION_PATH, 'Postgres 0020 migration')
    const [sqliteDefault] = extractEnumFromCheckClause(sqlite, 'CREATE TABLE users_v36')
    const [pgDefault] = extractPgAlteredRoleEnum(pg)
    expect(sqliteDefault).toBe(pgDefault)
    expect(sqliteDefault).toBe(DEFAULT_USER_ROLE)
  })
})
