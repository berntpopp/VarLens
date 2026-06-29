import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { Client } from 'pg'

import {
  assertArgon2idHashMatchesProviderPolicy,
  isLikelyArgon2idHash,
  PostgresWebAuthService
} from '../../../../src/web/auth/PostgresWebAuthService'
import {
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  ROLE_ADMIN,
  ROLE_USER
} from '../../../../src/shared/auth/auth-constants'
import {
  ARGON2_POLICY,
  defaultPasswordProvider,
  type PasswordProvider
} from '../../../../src/main/auth/providers/argon2-provider'
import type { PostgresStorageConfig } from '../../../../src/main/storage/config'
import { createPostgresStorageSession } from '../../../../src/main/storage/postgres/createPostgresStorageSession'

/**
 * PostgresWebAuthService unit tests with a FakePool.
 *
 * Covers SQL shape, parameter binding, branch matrix, atomic lockout,
 * unique-violation translation on createFirstUser race, and the
 * transactional rollback path. Real-instance tests against pg-up are gated by
 * VARLENS_RUN_POSTGRES_E2E=1; this file is the everywhere-runs gate.
 */

// ---- Pool stub --------------------------------------------------------------

interface QueryRecord {
  text: string
  values: unknown[]
  // Whether this query came through `connect().query` (i.e. inside a
  // transactional client) vs `pool.query` (outside). Used to assert
  // createFirstUser actually opens a transaction rather than smearing
  // INSERTs across pool checkouts.
  viaClient: boolean
}

interface CannedRow {
  [key: string]: unknown
}

interface CannedResponse {
  rows: CannedRow[]
  rowCount: number
}

class FakePool {
  queries: QueryRecord[] = []
  released = false
  releasedCount = 0
  // Each enqueueResponse caller can opt into a thrown error rather than
  // a canned row set — used to simulate unique-violation during
  // createFirstUser race translation and INSERT-failure rollback.
  private responses: Array<CannedResponse | { error: Error }> = []

  enqueueResponse(response: CannedResponse): void {
    this.responses.push(response)
  }

  enqueueError(error: Error): void {
    this.responses.push({ error })
  }

  private async runQuery(
    text: string,
    values: unknown[] = [],
    viaClient: boolean
  ): Promise<CannedResponse> {
    this.queries.push({ text, values, viaClient })
    if (this.responses.length === 0) {
      throw new Error(
        `FakePool: no canned response for query #${this.queries.length}:\n${text.slice(0, 200)}`
      )
    }
    const next = this.responses.shift()!
    if ('error' in next) throw next.error
    return next
  }

  async query(text: string, values: unknown[] = []): Promise<CannedResponse> {
    return this.runQuery(text, values, false)
  }

  async connect(): Promise<{
    query: (text: string, values?: unknown[]) => Promise<CannedResponse>
    release: () => void
  }> {
    return {
      query: (text, values = []) => this.runQuery(text, values, true),
      release: () => {
        this.released = true
        this.releasedCount += 1
      }
    }
  }
}

// ---- PasswordProvider stub --------------------------------------------------

const fakePasswordProvider: PasswordProvider = {
  async hashPassword(password: string): Promise<string> {
    return `hashed::${password}`
  },
  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return hash === `hashed::${password}`
  }
}

// ---- Helpers ----------------------------------------------------------------

function pgUserRow(overrides: Partial<CannedRow> = {}): CannedRow {
  return {
    id: '1',
    username: 'alice',
    display_name: 'Alice',
    password_hash: 'hashed::pw',
    role: 'user',
    is_active: true,
    must_change_password: false,
    failed_login_count: 0,
    locked_until: null,
    password_changed_at: new Date('2026-05-01T10:00:00Z'),
    created_at: new Date('2026-05-01T10:00:00Z'),
    created_by: null,
    updated_at: null,
    ...overrides
  }
}

const SCHEMA = 'auth_test'
type SvcOpts = ConstructorParameters<typeof PostgresWebAuthService>[0]
function newSvc(pool: FakePool, readPool?: FakePool): PostgresWebAuthService {
  return new PostgresWebAuthService({
    pool: pool as unknown as SvcOpts['pool'],
    ...(readPool !== undefined
      ? { readPool: readPool as unknown as NonNullable<SvcOpts['readPool']> }
      : {}),
    schema: SCHEMA,
    passwordProvider: fakePasswordProvider
  })
}

// createFirstUser requires a password >= 12 chars
// (MIN_PASSWORD_LENGTH). Test fixtures use a fixed 12-char string so
// the error path tests trip on the actual condition under test
// rather than the policy check.
const FIXTURE_PW = 'pw-1234567890'
const FIXTURE_NEW_PW = 'rotated12345-fixture'
const FIXTURE_ARGON2ID_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0$dmFybGVuc2hhc2hmaXh0dXJl'
const WEAK_ARGON2ID_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$dmFybGVucw'

// Convenience: enqueue the four-query happy path of createFirstUser.
// The recovery-key write was removed, so
// the transaction is now BEGIN → UPSERT accounts_enabled → INSERT
// user → COMMIT (4 queries instead of 5).
function enqueueCreateFirstUserHappyPath(pool: FakePool, userId = '42'): void {
  pool.enqueueResponse({ rows: [], rowCount: 1 }) // BEGIN
  pool.enqueueResponse({ rows: [], rowCount: 1 }) // UPSERT accounts_enabled
  pool.enqueueResponse({ rows: [{ id: userId }], rowCount: 1 }) // INSERT user
  pool.enqueueResponse({ rows: [], rowCount: 0 }) // COMMIT
}

// ---- Tests ------------------------------------------------------------------

describe('PostgresWebAuthService — surface contract', () => {
  it('exports a class instantiable with a pool, schema, and password provider', () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    expect(svc).toBeInstanceOf(PostgresWebAuthService)
  })
})

describe('PostgresWebAuthService — createFirstUser', () => {
  let pool: FakePool
  let svc: PostgresWebAuthService

  beforeEach(() => {
    pool = new FakePool()
    svc = newSvc(pool)
  })

  it('issues a transactional INSERT with ROLE_ADMIN — never inlines the role string', async () => {
    enqueueCreateFirstUserHappyPath(pool)
    const result = await svc.createFirstUser('alice', 'Alice', FIXTURE_PW)
    expect(result.username).toBe('alice')
    expect(result.role).toBe(ROLE_ADMIN)
    expect(result.id).toBe(42)

    const inserts = pool.queries.filter((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(inserts.length).toBe(1)
    expect(inserts[0].text, 'role must be parameterised, not inlined').not.toMatch(/'admin'/)
    expect(inserts[0].values).toContain(ROLE_ADMIN)
  })

  it('runs every write inside a transactional client (rollback semantics)', async () => {
    enqueueCreateFirstUserHappyPath(pool)
    await svc.createFirstUser('alice', 'Alice', FIXTURE_PW)

    // BEGIN, the two settings INSERTs, the users INSERT, COMMIT — every
    // one of these must be on the connected client (viaClient=true), not
    // on the bare pool. A regression that smears writes across pool
    // checkouts (no real transaction) would fail here.
    const dml = pool.queries.filter((q) => /BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE/i.test(q.text))
    expect(dml.length).toBeGreaterThanOrEqual(4)
    for (const q of dml) {
      expect(
        q.viaClient,
        `query "${q.text.slice(0, 40)}" must run on the transactional client`
      ).toBe(true)
    }
    expect(pool.queries.some((q) => /^BEGIN$/i.test(q.text))).toBe(true)
    expect(pool.queries.some((q) => /^COMMIT$/i.test(q.text))).toBe(true)
  })

  it('quotes the configured schema in every users-touching query', async () => {
    enqueueCreateFirstUserHappyPath(pool)
    await svc.createFirstUser('alice', 'Alice', FIXTURE_PW)
    for (const q of pool.queries) {
      if (/INSERT|UPDATE|SELECT.*users/i.test(q.text)) {
        expect(q.text).toContain(`"${SCHEMA}"`)
      }
    }
  })

  it('rejects passwords shorter than the policy minimum', async () => {
    await expect(svc.createFirstUser('alice', 'Alice', 'short')).rejects.toThrow(
      /at least 12 characters/i
    )
    expect(pool.queries.length, 'no DB writes happen when policy fails').toBe(0)
  })

  it('translates unique_violation (SQLSTATE 23505) into "Admin user already exists"', async () => {
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // BEGIN
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // UPSERT accounts_enabled
    const uniqueViolation = Object.assign(new Error('duplicate key value'), { code: '23505' })
    pool.enqueueError(uniqueViolation) // INSERT user fails on partial unique idx
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // ROLLBACK

    await expect(svc.createFirstUser('alice', 'Alice', FIXTURE_PW)).rejects.toThrow(
      /admin user already exists/i
    )

    expect(
      pool.queries.some((q) => /^ROLLBACK$/i.test(q.text)),
      'rollback must fire'
    ).toBe(true)
    expect(pool.releasedCount, 'client must be released after error').toBe(1)
  })

  it('rolls back and releases the client when a non-unique error fires mid-transaction', async () => {
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // BEGIN
    pool.enqueueError(new Error('disk full')) // UPSERT accounts_enabled fails
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // ROLLBACK

    await expect(svc.createFirstUser('alice', 'Alice', FIXTURE_PW)).rejects.toThrow(/disk full/)
    expect(pool.queries.some((q) => /^ROLLBACK$/i.test(q.text))).toBe(true)
    expect(pool.releasedCount).toBe(1)
  })
})

describe('PostgresWebAuthService — production hash bootstrap', () => {
  it('accepts a precomputed Argon2id hash without rehashing plaintext', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    enqueueCreateFirstUserHappyPath(pool)

    const result = await svc.createFirstUserFromHash('alice', 'Alice', FIXTURE_ARGON2ID_HASH)

    expect(result.role).toBe(ROLE_ADMIN)
    const insert = pool.queries.find((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(insert?.values).toContain(FIXTURE_ARGON2ID_HASH)
    expect(insert?.values).not.toContain(`hashed::${FIXTURE_ARGON2ID_HASH}`)
  })

  it('defaults to must_change_password=TRUE (forced rotation) when the flag is omitted', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    enqueueCreateFirstUserHappyPath(pool)

    await svc.createFirstUserFromHash('alice', 'Alice', FIXTURE_ARGON2ID_HASH)

    const insert = pool.queries.find((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    // must_change_password is the 5th INSERT parameter, parameterised not inlined.
    expect(insert?.text).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, now\(\)\)/)
    expect(insert?.values?.[4], 'forced rotation is the secure default').toBe(true)
  })

  it('honours mustChangePassword=false (dev opt-out) as a parameterised value', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    enqueueCreateFirstUserHappyPath(pool)

    await svc.createFirstUserFromHash('alice', 'Alice', FIXTURE_ARGON2ID_HASH, false)

    const insert = pool.queries.find((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(insert?.text).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, now\(\)\)/)
    expect(insert?.values?.[4], 'opt-out flag flows through to the INSERT').toBe(false)
  })

  it('rejects non-Argon2id bootstrap values before any database write', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)

    await expect(svc.createFirstUserFromHash('alice', 'Alice', 'plaintext')).rejects.toThrow(
      /argon2id hash/i
    )
    expect(pool.queries.length).toBe(0)
    expect(isLikelyArgon2idHash(FIXTURE_ARGON2ID_HASH)).toBe(true)
    expect(isLikelyArgon2idHash('plaintext')).toBe(false)
  })

  it('rejects malformed Argon2id PHC strings before any database write', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    const malformed = '$argon2id$v=19$m=65536,t=3,p=4$abcde$dmFybGVuc2hhc2hmaXh0dXJl'

    expect(isLikelyArgon2idHash(malformed)).toBe(false)
    await expect(svc.createFirstUserFromHash('alice', 'Alice', malformed)).rejects.toThrow(
      /argon2id hash/i
    )
    expect(pool.queries.length).toBe(0)
  })

  it('rejects Argon2id hashes whose parameters do not match the provider policy', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)

    expect(ARGON2_POLICY).toEqual({ memoryCost: 65536, timeCost: 3, parallelism: 4 })
    expect(() => assertArgon2idHashMatchesProviderPolicy(FIXTURE_ARGON2ID_HASH)).not.toThrow()
    await expect(svc.createFirstUserFromHash('alice', 'Alice', WEAK_ARGON2ID_HASH)).rejects.toThrow(
      /provider policy/i
    )
    expect(pool.queries.length).toBe(0)
  })

  it('reports whether an active admin already exists', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [{ '?column?': 1 }], rowCount: 1 })

    await expect(svc.hasAdmin()).resolves.toBe(true)
    expect(pool.queries[0].values).toContain(ROLE_ADMIN)
  })
})

describe('PostgresWebAuthService — provisioned user creation', () => {
  it('creates a normal user from a precomputed hash and forces password rotation', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({
      rows: [pgUserRow({ id: '5', username: 'admin', role: ROLE_ADMIN })],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [{ id: '7' }], rowCount: 1 })

    const result = await svc.createUserFromHash('alice', 'Alice', FIXTURE_ARGON2ID_HASH, 'admin')

    expect(result).toEqual({
      id: 7,
      username: 'alice',
      role: ROLE_USER,
      must_change_password: 1
    })
    const insert = pool.queries.find((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(insert?.values).toEqual(['alice', 'Alice', FIXTURE_ARGON2ID_HASH, ROLE_USER, 5])
    expect(insert?.text).toMatch(/must_change_password/)
    expect(insert?.text).toMatch(/TRUE/)
    expect(insert?.values).not.toContain(`hashed::${FIXTURE_ARGON2ID_HASH}`)
  })

  it('rejects plaintext provisioned user passwords before any database write', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)

    await expect(svc.createUserFromHash('alice', 'Alice', 'plaintext', 'admin')).rejects.toThrow(
      /argon2id hash/i
    )
    expect(pool.queries.length).toBe(0)
  })
})

describe('PostgresWebAuthService — platform identity users', () => {
  it('adopts a same-workspace non-admin local user as the platform subject', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // BEGIN
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // no existing platform subject
    pool.enqueueResponse({
      rows: [{ id: '9', username: 'alice', role: ROLE_USER }],
      rowCount: 1
    })
    pool.enqueueResponse({
      rows: [
        {
          id: '9',
          username: 'keycloak-subject-1',
          role: ROLE_USER,
          private_db_status: 'active'
        }
      ],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // COMMIT

    const result = await svc.upsertPlatformUser({
      username: 'keycloak-subject-1',
      displayName: 'Alice',
      role: ROLE_USER,
      privateDbSecretRef: 'alice.pgurl'
    })

    expect(result).toEqual({
      id: 9,
      username: 'keycloak-subject-1',
      role: ROLE_USER,
      private_db_status: 'active'
    })
    const update = pool.queries.find((q) => /SET username = \$1/.test(q.text))
    expect(update?.values).toEqual([
      'keycloak-subject-1',
      'Alice',
      'platform-identity-disabled-local-password',
      ROLE_USER,
      'active',
      null,
      '9'
    ])
    expect(pool.queries.every((q) => q.viaClient)).toBe(true)
    expect(pool.queries.some((q) => /^COMMIT$/i.test(q.text))).toBe(true)
  })

  it('refuses to adopt an admin workspace row', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // BEGIN
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // no existing platform subject
    pool.enqueueResponse({
      rows: [{ id: '1', username: 'admin', role: ROLE_ADMIN }],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // ROLLBACK

    await expect(
      svc.upsertPlatformUser({
        username: 'keycloak-subject-1',
        displayName: 'Admin',
        role: ROLE_USER,
        privateDbSecretRef: 'admin.pgurl'
      })
    ).rejects.toThrow(/admin user workspace/i)
    expect(pool.queries.some((q) => /^ROLLBACK$/i.test(q.text))).toBe(true)
  })
})

const RUN_POSTGRES_AUTH_E2E = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

function makePostgresConfig(schema: string): PostgresStorageConfig {
  return {
    url: PG_URL,
    schema,
    applicationName: 'varlens-auth-e2e',
    sslMode: 'disable',
    connectionTimeoutMillis: 5000,
    statementTimeoutMs: 30_000,
    queryTimeoutMs: 30_000,
    lockTimeoutMs: 5_000,
    idleInTransactionSessionTimeoutMs: 10_000,
    poolMax: 2
  }
}

describe.skipIf(!RUN_POSTGRES_AUTH_E2E)('PostgresWebAuthService — real Postgres', () => {
  it('creates a bootstrap hash with the production provider and logs in', async () => {
    const schema = `varlens_auth_e2e_${Date.now()}_${randomBytes(4).toString('hex')}`
    const password = 'real-postgres-auth-password-2026'
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    const session = await createPostgresStorageSession(makePostgresConfig(schema))
    try {
      const auth = new PostgresWebAuthService({
        pool: session.getPool(),
        schema
      })
      const passwordHash = await defaultPasswordProvider.hashPassword(password)

      expect(isLikelyArgon2idHash(passwordHash)).toBe(true)
      expect(() => assertArgon2idHashMatchesProviderPolicy(passwordHash)).not.toThrow()

      await auth.createFirstUserFromHash('admin', 'Admin', passwordHash)
      const result = await auth.authenticate('admin', password)

      expect(result.success).toBe(true)
      expect(result.user?.username).toBe('admin')
      expect(result.mustChangePassword).toBe(true)
    } finally {
      await session.close()
      const cleaner = new Client({ connectionString: PG_URL })
      await cleaner.connect()
      await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await cleaner.end()
    }
  }, 60_000)
})

describe('PostgresWebAuthService — authenticate', () => {
  let pool: FakePool
  let svc: PostgresWebAuthService

  beforeEach(() => {
    pool = new FakePool()
    svc = newSvc(pool)
  })

  it('returns success: false for unknown username', async () => {
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    const r = await svc.authenticate('ghost', 'pw')
    expect(r.success).toBe(false)
    expect(r.user).toBeNull()
  })

  it('returns success: true with safeUser (no password_hash)', async () => {
    pool.enqueueResponse({ rows: [pgUserRow()], rowCount: 1 })
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // reset failed count
    const r = await svc.authenticate('alice', 'pw')
    expect(r.success).toBe(true)
    expect(r.user).toBeDefined()
    expect(r.user as object).not.toHaveProperty('password_hash')
    expect((r.user as { username: string }).username).toBe('alice')
  })

  it('returns locked: true when locked_until is in the future', async () => {
    const future = new Date(Date.now() + 60_000)
    pool.enqueueResponse({ rows: [pgUserRow({ locked_until: future })], rowCount: 1 })
    const r = await svc.authenticate('alice', 'pw')
    expect(r.success).toBe(false)
    expect(r.locked).toBe(true)
  })

  it('uses an atomic UPDATE+CASE on failed login (no read-modify-write race)', async () => {
    pool.enqueueResponse({
      rows: [pgUserRow({ failed_login_count: MAX_FAILED_ATTEMPTS - 1 })],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 1 })

    await svc.authenticate('alice', 'wrong')

    const update = pool.queries.find((q) =>
      /failed_login_count\s*=\s*failed_login_count\s*\+\s*1/i.test(q.text)
    )
    expect(update, 'failed_login_count must be incremented atomically (server-side)').toBeDefined()
    // CASE expression encodes the lockout threshold without a JS read.
    expect(update!.text).toMatch(/CASE\s+WHEN[\s\S]+failed_login_count\s*\+\s*1\s*>=\s*\$1/i)
    // First param is the threshold, second is the candidate lock-until,
    // third is the user id. Verify the threshold matches the constant.
    expect(update!.values[0]).toBe(MAX_FAILED_ATTEMPTS)
    expect(update!.values[1]).toBeInstanceOf(Date)
    const lockUntil = update!.values[1] as Date
    const deltaMs = lockUntil.getTime() - Date.now()
    expect(deltaMs).toBeGreaterThan((LOCKOUT_DURATION_MINUTES - 1) * 60_000)
    expect(deltaMs).toBeLessThan((LOCKOUT_DURATION_MINUTES + 1) * 60_000)
  })

  it('row-maps PG types to the cross-backend User shape', async () => {
    pool.enqueueResponse({
      rows: [
        pgUserRow({
          id: '7',
          is_active: true,
          must_change_password: true,
          locked_until: null,
          password_changed_at: new Date('2026-05-01T10:00:00Z')
        })
      ],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 1 })

    const r = await svc.authenticate('alice', 'pw')
    expect(r.user).toBeDefined()
    const u = r.user!
    expect(typeof u.id).toBe('number')
    expect(u.id).toBe(7)
    expect(u.is_active).toBe(1)
    expect(u.must_change_password).toBe(1)
    expect(typeof u.password_changed_at).toBe('string')
    expect(u.password_changed_at).toBe('2026-05-01T10:00:00.000Z')
  })

  it('row mapper accepts string-form booleans (custom pg type parsers)', async () => {
    pool.enqueueResponse({
      rows: [pgUserRow({ is_active: 't', must_change_password: 'f' })],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 1 })

    const r = await svc.authenticate('alice', 'pw')
    expect((r.user as { is_active: number }).is_active).toBe(1)
    expect((r.user as { must_change_password: number }).must_change_password).toBe(0)
  })
})

describe('PostgresWebAuthService — createUser', () => {
  it('creates with ROLE_USER, parameterised, attributes creator id', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [pgUserRow({ id: '99', username: 'admin' })], rowCount: 1 }) // getUser(creator)
    pool.enqueueResponse({ rows: [{ id: '7' }], rowCount: 1 }) // INSERT user

    const r = await svc.createUser('bob', 'Bob', FIXTURE_PW, 'admin')
    expect(r.id).toBe(7)
    expect(r.role).toBe(ROLE_USER)
    expect(r.must_change_password).toBe(1)

    const insert = pool.queries.find((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(insert!.text, 'role must be parameterised').not.toMatch(/'user'/)
    expect(insert!.values).toContain(ROLE_USER)
    expect(insert!.values).toContain(99) // creator id propagated
  })

  it('coalesces unknown creator to NULL (parity with SQLite)', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // getUser returns nothing
    pool.enqueueResponse({ rows: [{ id: '7' }], rowCount: 1 })

    await svc.createUser('bob', 'Bob', FIXTURE_PW, 'ghost')
    const insert = pool.queries.find((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(insert!.values).toContain(null)
  })

  it('rejects temporary passwords shorter than the policy minimum before database reads', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)

    await expect(svc.createUser('bob', 'Bob', 'short', 'admin')).rejects.toThrow(
      /at least 12 characters/i
    )
    expect(pool.queries.length).toBe(0)
  })
})

describe('PostgresWebAuthService — getUser / listUsers / isAccountsEnabled', () => {
  it('uses the read pool for read-only control lookups', async () => {
    const statePool = new FakePool()
    const readPool = new FakePool()
    const svc = newSvc(statePool, readPool)
    readPool.enqueueResponse({ rows: [pgUserRow()], rowCount: 1 })
    readPool.enqueueResponse({ rows: [pgUserRow({ id: '2', username: 'bob' })], rowCount: 1 })
    readPool.enqueueResponse({ rows: [{ value: 'true' }], rowCount: 1 })

    await expect(svc.getUser('alice')).resolves.toEqual(
      expect.objectContaining({ username: 'alice' })
    )
    await expect(svc.listUsers()).resolves.toHaveLength(1)
    await expect(svc.isAccountsEnabled()).resolves.toBe(true)

    expect(readPool.queries).toHaveLength(3)
    expect(statePool.queries).toHaveLength(0)
  })

  it('getUser returns undefined when missing', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    expect(await svc.getUser('ghost')).toBeUndefined()
  })

  it('listUsers strips password_hash from every row', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({
      rows: [pgUserRow(), pgUserRow({ id: '2', username: 'bob' })],
      rowCount: 2
    })
    const users = await svc.listUsers()
    expect(users.length).toBe(2)
    for (const u of users) expect(u as object).not.toHaveProperty('password_hash')
  })

  it("isAccountsEnabled returns true when database_settings.accounts_enabled = 'true'", async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [{ value: 'true' }], rowCount: 1 })
    expect(await svc.isAccountsEnabled()).toBe(true)
  })

  it('isAccountsEnabled returns false when missing or any other value', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    expect(await svc.isAccountsEnabled()).toBe(false)
  })
})

describe('PostgresWebAuthService — deactivateUser / resetPassword / changePassword', () => {
  it('keeps auth mutations on the state pool after read-pool lookups', async () => {
    const statePool = new FakePool()
    const readPool = new FakePool()
    const svc = newSvc(statePool, readPool)
    readPool.enqueueResponse({
      rows: [pgUserRow({ password_hash: `hashed::${FIXTURE_PW}` })],
      rowCount: 1
    })
    statePool.enqueueResponse({ rows: [], rowCount: 1 })

    await expect(svc.changePassword('alice', FIXTURE_PW, FIXTURE_NEW_PW)).resolves.toBe(true)

    expect(readPool.queries).toHaveLength(1)
    expect(readPool.queries[0].text).toMatch(/SELECT \* FROM[\s\S]+"users"/i)
    expect(statePool.queries).toHaveLength(1)
    expect(statePool.queries[0].text).toMatch(/UPDATE[\s\S]+"users"/i)
  })

  it('deactivateUser throws when user not found', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    await expect(svc.deactivateUser('ghost')).rejects.toThrow(/user not found/i)
  })

  it('deactivateUser refuses to deactivate an admin user', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [{ role: ROLE_ADMIN }], rowCount: 1 })

    await expect(svc.deactivateUser('admin')).rejects.toThrow(/cannot deactivate an admin/i)
    expect(pool.queries).toHaveLength(1)
  })

  it('deactivateUser issues UPDATE is_active = FALSE for non-admin users', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [{ role: ROLE_USER }], rowCount: 1 })
    pool.enqueueResponse({ rows: [], rowCount: 1 })
    await svc.deactivateUser('alice')
    const upd = pool.queries[1]
    expect(upd.text).toMatch(/UPDATE[\s\S]+users[\s\S]+is_active\s*=\s*FALSE/i)
    expect(upd.values).toContain('alice')
  })

  it('resetPassword clears lockout state and forces password change', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 1 })
    await svc.resetPassword('alice', FIXTURE_NEW_PW)
    const upd = pool.queries[0]
    expect(upd.text).toMatch(/must_change_password\s*=\s*TRUE/i)
    expect(upd.text).toMatch(/failed_login_count\s*=\s*0/i)
    expect(upd.text).toMatch(/locked_until\s*=\s*NULL/i)
  })

  it('resetPassword rejects new passwords shorter than the policy minimum', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)

    await expect(svc.resetPassword('alice', 'short')).rejects.toThrow(/at least 12 characters/i)
    expect(pool.queries.length).toBe(0)
  })

  it('changePassword returns false for unknown user', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    expect(await svc.changePassword('ghost', 'old-pwd-1234', FIXTURE_NEW_PW)).toBe(false)
  })

  it('changePassword returns false when old password does not verify', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({
      rows: [pgUserRow({ password_hash: 'hashed::differentpw' })],
      rowCount: 1
    })
    expect(await svc.changePassword('alice', 'wrong-pwd-12', FIXTURE_NEW_PW)).toBe(false)
  })

  it('changePassword updates hash and clears must_change_password on valid old password', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    // Pretend the stored hash matches `FIXTURE_PW` under the fake provider.
    pool.enqueueResponse({
      rows: [pgUserRow({ password_hash: `hashed::${FIXTURE_PW}` })],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 1 })
    expect(await svc.changePassword('alice', FIXTURE_PW, FIXTURE_NEW_PW)).toBe(true)
    const upd = pool.queries[1]
    expect(upd.text).toMatch(/must_change_password\s*=\s*FALSE/i)
    expect(upd.values).toContain(`hashed::${FIXTURE_NEW_PW}`)
  })

  it('changePassword rejects new passwords shorter than the policy minimum', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    await expect(svc.changePassword('alice', FIXTURE_PW, 'short')).rejects.toThrow(
      /at least 12 characters/i
    )
    expect(pool.queries.length, 'no DB read either when policy fails').toBe(0)
  })

  it('changePassword rejects new === old', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    await expect(svc.changePassword('alice', FIXTURE_PW, FIXTURE_PW)).rejects.toThrow(
      /must differ from/i
    )
  })
})

afterAll(() => {
  // Sanity: no real Pool leaks into other suites.
})
