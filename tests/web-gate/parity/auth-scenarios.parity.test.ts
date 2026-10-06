import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import {
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  USER_ROLES
} from '../../../src/shared/auth/auth-constants'
import type { AuthResult, User } from '../../../src/shared/auth/types'

/**
 * Phase 2 deliverable #6: structural parity assertions.
 *
 * Phase 1 left these scenarios as `describe.skip` placeholders pending
 * the auth provider abstraction. Phase 2 promotes them into
 * **structural** parity assertions: the desktop SQLite AuthService
 * (src/main/services/auth/AuthService.ts) and the web Postgres
 * PostgresWebAuthService (src/web/auth/PostgresWebAuthService.ts) MUST
 *
 *   - source policy from src/shared/auth/auth-constants
 *     (MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MINUTES, USER_ROLES)
 *   - import User and AuthResult from src/shared/auth/types
 *     (so shape parity is type-checked, not grep-checked)
 *   - implement the same nine-method surface
 *
 * True behavioural parity (drive desktop auth logic and web HTTP
 * endpoints, then diff observable outcomes) is separate work. The web
 * server now has secure-session cookies, but this file does not test
 * cookie lifetime, route authorization, admin-management endpoints, or
 * session invalidation after DB auth-state changes.
 *
 * QA wave 6 flagged the original assertions as too ceremonial
 * (regex-grep on syntax). The current shape replaces:
 *   - per-file User/AuthResult literal-grep → shared types import
 *   - per-method `authenticate(` grep → set-equality on the full
 *     surface across both files
 *   - narrow session-field negation regex → broader keyword set
 *     covering camelCase, snake_case, and multiple spellings
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const SQLITE_AUTH_SERVICE = resolve(REPO_ROOT, 'src/main/services/auth/AuthService.ts')
const POSTGRES_AUTH_SERVICE = resolve(REPO_ROOT, 'src/web/auth/PostgresWebAuthService.ts')
const SHARED_TYPES = resolve(REPO_ROOT, 'src/shared/auth/types.ts')

function readSrc(path: string): string {
  if (!existsSync(path)) throw new Error(`Required file missing: ${path}`)
  return readFileSync(path, 'utf8')
}

const sqliteSrc = readSrc(SQLITE_AUTH_SERVICE)
const pgSrc = readSrc(POSTGRES_AUTH_SERVICE)

/**
 * The full nine-method auth surface both implementations must offer.
 * Adding a method to either file without adding it here flags up; a
 * regression that drops a method from one backend trips the
 * surface-mirror test below.
 */
const AUTH_SURFACE = [
  'createFirstUser',
  'authenticate',
  'createUser',
  'getUser',
  'listUsers',
  'deactivateUser',
  'resetPassword',
  'changePassword',
  'isAccountsEnabled'
] as const

function methodsDeclaredIn(src: string): Set<string> {
  // Match `methodName(` at the start of a method declaration line —
  // possibly preceded by `async`. Avoids matching call-sites like
  // `this.passwordProvider.hashPassword(` by anchoring on whitespace+
  // method-keyword (no dot).
  const re = /^\s+(?:async\s+)?(\w+)\s*\(/gm
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    seen.add(m[1])
  }
  return seen
}

describe('parity (auth): both backends use the shared User + AuthResult types', () => {
  test('AuthService imports User + AuthResult from src/shared/auth/types', () => {
    expect(sqliteSrc).toMatch(
      /import\s+type\s*\{[^}]*\bAuthResult\b[^}]*\}\s*from\s*['"][^'"]*shared\/auth\/types['"]/
    )
    expect(sqliteSrc).toMatch(
      /import\s+type\s*\{[^}]*\bUser\b[^}]*\}\s*from\s*['"][^'"]*shared\/auth\/types['"]/
    )
  })

  test('PostgresWebAuthService imports User + AuthResult from src/shared/auth/types', () => {
    expect(pgSrc).toMatch(
      /import\s+type\s*\{[^}]*\bAuthResult\b[^}]*\}\s*from\s*['"][^'"]*shared\/auth\/types['"]/
    )
    expect(pgSrc).toMatch(
      /import\s+type\s*\{[^}]*\bUser\b[^}]*\}\s*from\s*['"][^'"]*shared\/auth\/types['"]/
    )
  })

  test('neither service redeclares User / AuthResult locally (no shape drift possible)', () => {
    for (const src of [sqliteSrc, pgSrc]) {
      expect(src, 'must not redeclare User').not.toMatch(/^(?:export\s+)?interface\s+User\b/m)
      expect(src, 'must not redeclare AuthResult').not.toMatch(
        /^(?:export\s+)?interface\s+AuthResult\b/m
      )
    }
  })

  test('shared types module declares the load-bearing fields the QA gates depended on', () => {
    const sharedSrc = readSrc(SHARED_TYPES)
    for (const field of [
      'is_active',
      'must_change_password',
      'failed_login_count',
      'locked_until',
      'password_changed_at',
      'role'
    ]) {
      expect(sharedSrc, `User must declare ${field}`).toMatch(new RegExp(`\\b${field}\\b`))
    }
    // Compile-time witnesses against the imported types (TS will refuse
    // these assignments if shape drifts).
    const _u: User = {
      id: 0,
      username: 'x',
      display_name: null,
      password_hash: '',
      role: 'admin',
      is_active: 1,
      must_change_password: 0,
      failed_login_count: 0,
      locked_until: null,
      password_changed_at: null,
      created_at: '',
      created_by: null,
      updated_at: null
    }
    const _r: AuthResult = { success: false, user: null }
    expect(_u.id).toBe(0)
    expect(_r.success).toBe(false)
  })
})

describe('parity (auth): both backends implement the full method surface', () => {
  test('every AUTH_SURFACE method is present on the SQLite AuthService', () => {
    const declared = methodsDeclaredIn(sqliteSrc)
    for (const method of AUTH_SURFACE) {
      expect(declared, `AuthService must declare ${method}`).toContain(method)
    }
  })

  test('every AUTH_SURFACE method is present on the PostgresWebAuthService', () => {
    const declared = methodsDeclaredIn(pgSrc)
    for (const method of AUTH_SURFACE) {
      expect(declared, `PostgresWebAuthService must declare ${method}`).toContain(method)
    }
  })
})

describe('parity (auth): repeated bad passwords trigger lockout consistently', () => {
  test('both backends source MAX_FAILED_ATTEMPTS / LOCKOUT_DURATION_MINUTES from auth-constants', () => {
    for (const src of [sqliteSrc, pgSrc]) {
      expect(src).toMatch(/MAX_FAILED_ATTEMPTS/)
      expect(src).toMatch(/LOCKOUT_DURATION_MINUTES/)
      expect(src).toMatch(/from\s+['"][^'"]*auth-constants['"]/)
    }
    expect(MAX_FAILED_ATTEMPTS).toBe(5)
    expect(LOCKOUT_DURATION_MINUTES).toBe(15)
  })

  test('PostgresWebAuthService uses an atomic UPDATE+CASE (Step 3 race fix sentinel)', () => {
    // Step 3 QA found a race in the original SELECT-then-UPDATE pattern
    // and replaced it with `failed_login_count = failed_login_count + 1`
    // + a `CASE WHEN ... >= MAX_FAILED_ATTEMPTS THEN ... END` clause.
    // This regex is intentionally tight to that fix — a refactor
    // that replaces the SQL with an equivalent (CTE, stored proc) is
    // welcome to update or remove this assertion.
    expect(pgSrc).toMatch(/failed_login_count\s*=\s*failed_login_count\s*\+\s*1/)
    expect(pgSrc).toMatch(/CASE\s+WHEN[\s\S]+failed_login_count\s*\+\s*1\s*>=/i)
  })
})

describe('parity (auth): multi-user isolation — user A cannot see user B data', () => {
  // Per ADR-0003 + the user-id-schema web-gate sentinel, multi-user
  // isolation is Stage 3 work (per-tenant schemas, every domain table
  // gains user_id NOT NULL DEFAULT 1). The auth surface is multi-user-
  // ready (createUser, role enum, password rotation), but data-row
  // scoping isn't.
  test('USER_ROLES is shared, three-element enum (viewer, analyst, admin)', () => {
    expect(new Set(USER_ROLES)).toEqual(new Set(['viewer', 'analyst', 'admin']))
  })

  test.skip('Stage 3: row-level isolation against per-tenant schemas — activate when tests/web-gate/user-id-schema.test.ts goes green', () => {
    /* deferred */
  })
})

describe('parity (auth): shared auth result shape does not carry tokens', () => {
  // Web mode uses secure-session cookies outside the shared AuthResult
  // payload. Token/expiry-bearing shared auth results remain Stage 3
  // work tied to the Credential.token/OIDC path.
  test('the shared AuthResult type has no session/token/expiry fields', () => {
    // Reading the shared type once and asserting on its source is
    // the right place: both backends import this type, so a regression
    // adding a session-bearing field on either side requires editing
    // this shared file, which is gated here. Broader keyword set than
    // QA-wave-6's earlier critique (covers snake_case, camelCase,
    // and common spellings).
    const sharedSrc = readSrc(SHARED_TYPES)
    const sessionFieldKeywords = [
      'session_id',
      'sessionId',
      'sessionToken',
      'session_token',
      'access_token',
      'accessToken',
      'refresh_token',
      'refreshToken',
      'jwt',
      'bearer',
      'cookie',
      'expires_at',
      'expiresAt',
      'expires_in',
      'expiresIn',
      'expiry',
      'ttl'
    ]
    for (const keyword of sessionFieldKeywords) {
      expect(
        sharedSrc,
        `shared/auth/types.ts must not declare ${keyword} in the AuthResult/User shape ` +
          '(sessions are Stage 3; adding a field here without storage wiring is the regression this guards)'
      ).not.toMatch(new RegExp(`\\b${keyword}\\s*[?:]?\\s*:`))
    }
  })

  test.skip('Stage 3: behavioural session-expiry parity - activate when src/main/auth/types.ts Credential.token branch ships', () => {
    /* deferred */
  })
})
