/**
 * PostgresWebAuthService — Postgres-backed user authentication for the
 * web variant.
 *
 * Mirrors the desktop SQLite AuthService surface one method for one method:
 * Argon2id hashing via PasswordProvider, lockout after MAX_FAILED_ATTEMPTS,
 * the accounts_enabled flag in database_settings, and password rotation.
 *
 * Web-only — never imported by main process. Lives under src/web/ so
 * the desktop AuthService stays a pure SQLite surface and can't be
 * regressed by web-specific concerns.
 *
 * Cross-backend policy values (USER_ROLES, MAX_FAILED_ATTEMPTS,
 * LOCKOUT_DURATION_MINUTES) and web password policy come from
 * src/shared/auth/auth-constants — the constants module is process-agnostic
 * and the only thing the two implementations share.
 */
import type { Pool } from 'pg'

import {
  ARGON2_POLICY,
  defaultPasswordProvider,
  type PasswordProvider
} from '../../main/auth/providers/argon2-provider'
import {
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  ROLE_ADMIN,
  ROLE_USER,
  WEB_MIN_PASSWORD_LENGTH,
  type UserRole
} from '../../shared/auth/auth-constants'

/**
 * Minimum length for any new password set on the web track. Picked at
 * 12 to align with NIST SP 800-63B guidance for memorised secrets in
 * an admin/single-user context. The desktop AuthService keeps its
 * own (laxer) rule because that surface predates this policy.
 */
export const MIN_PASSWORD_LENGTH = WEB_MIN_PASSWORD_LENGTH
const PLATFORM_DISABLED_PASSWORD_HASH = 'platform-identity-disabled-local-password'

/**
 * Server-side validation errors that callers need to discriminate
 * (the standalone login page surfaces them as inline messages, the
 * dispatcher maps them to specific 4xx codes). Distinct from
 * "invalid old password" which is signalled by a `false` return.
 */
export class PasswordPolicyError extends Error {
  readonly name = 'PasswordPolicyError'
  readonly code: 'too-short' | 'same-as-old'
  constructor(code: 'too-short' | 'same-as-old', message: string) {
    super(message)
    this.code = code
  }
}

function assertPasswordMinLength(password: string, label = 'Password'): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      'too-short',
      `${label} must be at least ${MIN_PASSWORD_LENGTH} characters.`
    )
  }
}

/**
 * Shape-check an Argon2id PHC string without invoking the verifier. This
 * rejects plaintext, other hash families, malformed salt/hash segments, and
 * parameter values that do not match the provider policy so bootstrap fails
 * loudly before any database write.
 */
const ARGON2ID_PHC_PATTERN =
  /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/

function isValidPhcBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 !== 1
}

function isLikelyArgon2idHash(value: string): boolean {
  const match = value.match(ARGON2ID_PHC_PATTERN)
  return match !== null && isValidPhcBase64(match[5]) && isValidPhcBase64(match[6])
}

function assertArgon2idHashMatchesProviderPolicy(value: string): void {
  const match = value.match(ARGON2ID_PHC_PATTERN)
  if (match === null || !isValidPhcBase64(match[5]) || !isValidPhcBase64(match[6])) {
    throw new Error(
      'createFirstUserFromHash: passwordHash does not look like an Argon2id hash. ' +
        'Generate one with `npm run varlens:hash-password`.'
    )
  }

  const [, version, memoryCost, timeCost, parallelism] = match
  const mismatches: string[] = []
  if (version !== '19') mismatches.push(`v=${version}`)
  if (Number(memoryCost) !== ARGON2_POLICY.memoryCost) mismatches.push(`m=${memoryCost}`)
  if (Number(timeCost) !== ARGON2_POLICY.timeCost) mismatches.push(`t=${timeCost}`)
  if (Number(parallelism) !== ARGON2_POLICY.parallelism) mismatches.push(`p=${parallelism}`)

  if (mismatches.length > 0) {
    throw new Error(
      'createFirstUserFromHash: passwordHash Argon2id parameters do not match the ' +
        `VarLens provider policy (m=${ARGON2_POLICY.memoryCost},t=${ARGON2_POLICY.timeCost},` +
        `p=${ARGON2_POLICY.parallelism}). Mismatched parameter(s): ${mismatches.join(', ')}.`
    )
  }
}

export { isLikelyArgon2idHash, assertArgon2idHashMatchesProviderPolicy }
// Cross-backend User + AuthResult shape: both implementations import the same
// types so shape parity is enforced at compile time.
import type { AuthResult, User } from '../../shared/auth/types'

export type { AuthResult, User }

export interface PostgresWebAuthServiceOptions {
  pool: Pool
  readPool?: Pick<Pool, 'query'>
  schema: string
  passwordProvider?: PasswordProvider
}

/**
 * Typed sentinel for the admin-already-exists case. Callers (notably
 * src/web/server.ts maybeBootstrapAdmin) want to distinguish this
 * specific failure from any other createFirstUser error so they can
 * take the env-rotation-ignored warn-and-skip path instead of crashing
 * the boot. The previous regex-on-message detection was brittle to
 * wording changes; this class makes the contract explicit and
 * instanceof-checkable.
 */
export class AdminAlreadyExistsError extends Error {
  readonly name = 'AdminAlreadyExistsError'
  constructor(cause?: unknown) {
    super('Admin user already exists', cause === undefined ? undefined : { cause })
  }
}

export function isAdminAlreadyExists(err: unknown): err is AdminAlreadyExistsError {
  return err instanceof AdminAlreadyExistsError
}

/**
 * Convert a Postgres row (BOOLEAN / TIMESTAMPTZ / BIGINT-as-string) to
 * the cross-backend User shape (number / ISO string / number).
 *
 * Why number for booleans: the desktop AuthService returns 0/1 because
 * SQLite stores them that way. Renderer code already handles 0/1; the
 * web path keeps the same shape so the handler-seam guarantee holds.
 */
function mapPgRowToUser(raw: Record<string, unknown>): User {
  const toIso = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    if (v instanceof Date) return v.toISOString()
    // The migration declares TIMESTAMPTZ; node-postgres returns Date by
    // default. If we get a non-Date, non-null value here, a custom type
    // parser was installed and it's emitting raw PG strings — the User
    // contract advertises ISO 8601, so refuse rather than silently
    // pass through a non-ISO format.
    if (typeof v === 'string') {
      const parsed = new Date(v)
      if (isNaN(parsed.getTime())) {
        throw new Error(`mapPgRowToUser: cannot parse timestamp value: ${v}`)
      }
      return parsed.toISOString()
    }
    throw new Error(
      `mapPgRowToUser: unexpected timestamp type ${typeof v} (${String(v).slice(0, 40)})`
    )
  }
  const toBoolNumber = (v: unknown): number => {
    if (typeof v === 'boolean') return v ? 1 : 0
    if (typeof v === 'number') return v === 0 ? 0 : 1
    // Postgres BOOLEAN under custom type parsers can arrive as 't'/'f'
    // or 'true'/'false'. Whitelist the known truthy strings; treat
    // anything else as false (parity with SQLite which stores 0/1 INT).
    if (v === 't' || v === 'true' || v === '1') return 1
    return 0
  }
  const toNumberOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined) return null
    return Number(v)
  }
  return {
    id: Number(raw.id),
    username: String(raw.username),
    display_name: raw.display_name === null ? null : String(raw.display_name),
    password_hash: String(raw.password_hash),
    role: String(raw.role) as UserRole,
    is_active: toBoolNumber(raw.is_active),
    must_change_password: toBoolNumber(raw.must_change_password),
    failed_login_count: Number(raw.failed_login_count ?? 0),
    locked_until: toIso(raw.locked_until),
    password_changed_at: toIso(raw.password_changed_at),
    created_at: toIso(raw.created_at) ?? '',
    created_by: toNumberOrNull(raw.created_by),
    updated_at: toIso(raw.updated_at),
    private_db_secret_ref:
      raw.private_db_secret_ref === null || raw.private_db_secret_ref === undefined
        ? null
        : String(raw.private_db_secret_ref),
    private_db_status:
      raw.private_db_status === null || raw.private_db_status === undefined
        ? null
        : String(raw.private_db_status),
    public_annotation_snapshot_id:
      raw.public_annotation_snapshot_id === null || raw.public_annotation_snapshot_id === undefined
        ? null
        : String(raw.public_annotation_snapshot_id)
  }
}

function quoteSchema(schema: string): string {
  // Defence against unsanitised schema names. Postgres identifiers
  // can be arbitrary unicode; the only safe quoting is doubling
  // embedded `"`. A schema with `"` in its name is pathological but
  // valid SQL — we handle it instead of refusing.
  return `"${schema.replace(/"/g, '""')}"`
}

export class PostgresWebAuthService {
  private readonly pool: Pool
  private readonly readPool: Pick<Pool, 'query'>
  private readonly schemaQuoted: string
  private readonly passwordProvider: PasswordProvider

  constructor(options: PostgresWebAuthServiceOptions) {
    this.pool = options.pool
    this.readPool = options.readPool ?? options.pool
    this.schemaQuoted = quoteSchema(options.schema)
    this.passwordProvider = options.passwordProvider ?? defaultPasswordProvider
  }

  // ---------- bootstrap ----------

  /**
   * Cheap pre-check used by server.ts maybeBootstrapAdmin to avoid
   * paying Argon2's ~600ms hashing cost (and reserving an FS path)
   * on every reboot of an already-bootstrapped instance. The
   * createFirstUser race-safety still holds — the partial unique
   * index on `role='admin'` is the source of truth — but skipping
   * the heavy work for the steady-state case keeps restart latency
   * low and avoids the wx-EEXIST trap when the operator hasn't
   * captured/deleted the recovery-key file yet.
   */
  async hasAdmin(): Promise<boolean> {
    const sch = this.schemaQuoted
    const sel = await this.readPool.query(
      `SELECT 1 FROM ${sch}."users" WHERE role = $1 AND is_active = TRUE LIMIT 1`,
      [ROLE_ADMIN]
    )
    return (sel.rowCount ?? 0) > 0
  }

  /**
   * Hash-bootstrap path. Accepts a pre-computed Argon2id hash and
   * does **not** ever see the plaintext. This is the preferred
   * path for production: `VARLENS_ADMIN_PASSWORD_HASH` lives in the
   * operator's `.env` and on the server's `.env`; the plaintext
   * exists only in the operator's memory between typing it and
   * `npm run varlens:hash-password` printing the hash.
   *
   * The recovery-key write (DB + plaintext file) used to live here.
   * It was carried over from the desktop track but no consumer code
   * reads it back, and the on-disk plaintext file was a real
   * footgun (mode 0600 yes, but still a plaintext credential lying
   * around until manually captured + deleted). Removed entirely; if
   * a recovery flow ships later it can issue a key at that point.
   */
  async createFirstUserFromHash(
    username: string,
    displayName: string,
    passwordHash: string,
    mustChangePassword: boolean = true
  ): Promise<{ id: number; username: string; role: UserRole }> {
    if (!isLikelyArgon2idHash(passwordHash)) {
      throw new Error(
        'createFirstUserFromHash: passwordHash does not look like an Argon2id hash. ' +
          'Generate one with `npm run varlens:hash-password`.'
      )
    }
    assertArgon2idHashMatchesProviderPolicy(passwordHash)
    return await this.insertFirstUser(username, displayName, passwordHash, mustChangePassword)
  }

  /**
   * Internal test/helper path. Production web bootstrap refuses
   * plaintext env credentials and calls createFirstUserFromHash().
   */
  async createFirstUser(
    username: string,
    displayName: string,
    password: string
  ): Promise<{ id: number; username: string; role: UserRole }> {
    assertPasswordMinLength(password)
    const passwordHash = await this.passwordProvider.hashPassword(password)
    return await this.insertFirstUser(username, displayName, passwordHash)
  }

  private async insertFirstUser(
    username: string,
    displayName: string,
    passwordHash: string,
    mustChangePassword: boolean = true
  ): Promise<{ id: number; username: string; role: UserRole }> {
    const sch = this.schemaQuoted
    // Race-safety: the SELECT-outside-transaction pattern in earlier
    // revisions of this method allowed two concurrent first-user calls
    // to both observe "no admin" and both proceed. The partial unique
    // index `users_only_one_active_admin` guarantees at most one active admin
    // row per schema; the second concurrent INSERT trips unique_violation
    // (SQLSTATE 23505) and we translate it into the same friendly error a
    // serial caller would see.
    //
    // The bootstrapped admin defaults to must_change_password=TRUE so the
    // first login forces a rotation before any session-bearing request can
    // reach the application surface. The dispatcher's pre-rotation gate
    // enforces this server-side; the operator never sees an exposure window
    // where the bootstrap credential could call /api/* freely. Callers may
    // pass mustChangePassword=false (dev only, via
    // VARLENS_ADMIN_MUST_CHANGE_PASSWORD) to skip the forced rotation.
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO ${sch}."database_settings" (key, value) VALUES ('accounts_enabled', 'true')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      )
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ${sch}."users"
          (username, display_name, password_hash, role, must_change_password, password_changed_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id`,
        [username, displayName, passwordHash, ROLE_ADMIN, mustChangePassword]
      )
      await client.query('COMMIT')
      return {
        id: Number(inserted.rows[0].id),
        username,
        role: ROLE_ADMIN
      }
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // ignore rollback failures; original error wins
      }
      // Translate unique-violation on the partial admin index into a
      // typed sentinel callers (server.ts maybeBootstrapAdmin) can
      // discriminate from generic create failures.
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
        throw new AdminAlreadyExistsError(err)
      }
      throw err
    } finally {
      client.release()
    }
  }

  // ---------- authenticate ----------

  async authenticate(username: string, password: string): Promise<AuthResult> {
    const sch = this.schemaQuoted
    const sel = await this.readPool.query<Record<string, unknown>>(
      `SELECT * FROM ${sch}."users" WHERE username = $1 AND is_active = TRUE`,
      [username]
    )
    if ((sel.rowCount ?? 0) === 0) {
      return { success: false, user: null }
    }
    const user = mapPgRowToUser(sel.rows[0])

    if (user.locked_until !== null && user.locked_until !== '') {
      if (new Date(user.locked_until).getTime() > Date.now()) {
        return { success: false, user: null, locked: true }
      }
    }

    const valid = await this.passwordProvider.verifyPassword(user.password_hash, password)

    if (!valid) {
      // Atomic increment + conditional lockout, single round trip. The
      // previous SELECT-then-UPDATE pattern was racy under pg's
      // concurrency model: two concurrent failed logins could both read
      // failed_login_count = N-1 and both write N, defeating the
      // MAX_FAILED_ATTEMPTS gate. SQLite's single-writer model hid the
      // race on desktop; the web path needs DB-level atomicity.
      const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000)
      await this.pool.query(
        `UPDATE ${sch}."users"
            SET failed_login_count = failed_login_count + 1,
                locked_until = CASE
                  WHEN failed_login_count + 1 >= $1 THEN $2
                  ELSE locked_until
                END
          WHERE id = $3`,
        [MAX_FAILED_ATTEMPTS, lockUntil, user.id]
      )
      return { success: false, user: null }
    }

    await this.pool.query(
      `UPDATE ${sch}."users" SET failed_login_count = 0, locked_until = NULL WHERE id = $1`,
      [user.id]
    )

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash: _hash, ...safeUser } = user
    return {
      success: true,
      user: safeUser,
      mustChangePassword: user.must_change_password === 1
    }
  }

  // ---------- user management ----------

  async createUser(
    username: string,
    displayName: string,
    tempPassword: string,
    createdByUsername: string
  ): Promise<{ id: number; username: string; role: UserRole; must_change_password: number }> {
    const sch = this.schemaQuoted
    assertPasswordMinLength(tempPassword, 'Temporary password')
    const creator = await this.getUser(createdByUsername)
    const passwordHash = await this.passwordProvider.hashPassword(tempPassword)

    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO ${sch}."users"
        (username, display_name, password_hash, role, must_change_password, created_by, password_changed_at)
       VALUES ($1, $2, $3, $4, TRUE, $5, now())
       RETURNING id`,
      [username, displayName, passwordHash, ROLE_USER, creator?.id ?? null]
    )

    return {
      id: Number(inserted.rows[0].id),
      username,
      role: ROLE_USER,
      must_change_password: 1
    }
  }

  async assignPrivateDatabase(
    username: string,
    privateDbSecretRef: string,
    publicAnnotationSnapshotId?: string
  ): Promise<void> {
    const sch = this.schemaQuoted
    const result = await this.pool.query(
      `UPDATE ${sch}."users"
          SET private_db_secret_ref = $1,
              private_db_status = 'active',
              public_annotation_snapshot_id = $2,
              updated_at = now()
        WHERE username = $3 AND is_active = TRUE`,
      [privateDbSecretRef, publicAnnotationSnapshotId ?? null, username]
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`User not found or inactive: ${username}`)
    }
  }

  async upsertPlatformUser(input: {
    username: string
    displayName: string
    role: UserRole
    privateDbSecretRef?: string
    privateDbStatus?: 'pending' | 'active' | 'failed' | 'revoked'
    publicAnnotationSnapshotId?: string
  }): Promise<{ id: number; username: string; role: UserRole; private_db_status: string | null }> {
    const sch = this.schemaQuoted
    const result = await this.pool.query<{
      id: string
      username: string
      role: UserRole
      private_db_status: string | null
    }>(
      `INSERT INTO ${sch}."users" AS platform_target
        (username, display_name, password_hash, role, must_change_password, is_active,
         private_db_secret_ref, private_db_status, public_annotation_snapshot_id, password_changed_at)
       VALUES ($1, $2, $3, $4, FALSE, TRUE, $5, $6, $7, now())
       ON CONFLICT (username)
       DO UPDATE SET
          display_name = EXCLUDED.display_name,
          role = EXCLUDED.role,
          is_active = TRUE,
          must_change_password = FALSE,
          private_db_secret_ref = EXCLUDED.private_db_secret_ref,
          private_db_status = EXCLUDED.private_db_status,
          public_annotation_snapshot_id = EXCLUDED.public_annotation_snapshot_id,
          updated_at = now()
       WHERE platform_target.password_hash = $8
       RETURNING id, username, role, private_db_status`,
      [
        input.username,
        input.displayName,
        PLATFORM_DISABLED_PASSWORD_HASH,
        input.role,
        input.privateDbSecretRef ?? null,
        input.privateDbStatus ?? (input.privateDbSecretRef === undefined ? 'pending' : 'active'),
        input.publicAnnotationSnapshotId ?? null,
        PLATFORM_DISABLED_PASSWORD_HASH
      ]
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Platform identity cannot overwrite local user: ${input.username}`)
    }
    const row = result.rows[0]
    return {
      id: Number(row.id),
      username: row.username,
      role: row.role,
      private_db_status: row.private_db_status
    }
  }

  async createUserFromHash(
    username: string,
    displayName: string,
    passwordHash: string,
    createdByUsername: string
  ): Promise<{ id: number; username: string; role: UserRole; must_change_password: number }> {
    const sch = this.schemaQuoted
    if (!isLikelyArgon2idHash(passwordHash)) {
      throw new Error(
        'createUserFromHash: passwordHash does not look like an Argon2id hash. ' +
          'Generate one with `npm run varlens:hash-password`.'
      )
    }
    assertArgon2idHashMatchesProviderPolicy(passwordHash)
    const creator = await this.getUser(createdByUsername)

    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO ${sch}."users"
        (username, display_name, password_hash, role, must_change_password, created_by, password_changed_at)
       VALUES ($1, $2, $3, $4, TRUE, $5, now())
       RETURNING id`,
      [username, displayName, passwordHash, ROLE_USER, creator?.id ?? null]
    )

    return {
      id: Number(inserted.rows[0].id),
      username,
      role: ROLE_USER,
      must_change_password: 1
    }
  }

  async getUser(username: string): Promise<User | undefined> {
    const sch = this.schemaQuoted
    const sel = await this.readPool.query<Record<string, unknown>>(
      `SELECT * FROM ${sch}."users" WHERE username = $1`,
      [username]
    )
    if ((sel.rowCount ?? 0) === 0) return undefined
    return mapPgRowToUser(sel.rows[0])
  }

  async listUsers(): Promise<Omit<User, 'password_hash'>[]> {
    const sch = this.schemaQuoted
    const sel = await this.readPool.query<Record<string, unknown>>(
      `SELECT * FROM ${sch}."users" ORDER BY created_at`
    )
    return sel.rows.map((row) => {
      const u = mapPgRowToUser(row)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password_hash: _hash, ...rest } = u
      return rest
    })
  }

  async deactivateUser(username: string): Promise<void> {
    const sch = this.schemaQuoted
    const existing = await this.readPool.query<{ role: UserRole }>(
      `SELECT role FROM ${sch}."users" WHERE username = $1`,
      [username]
    )
    if ((existing.rowCount ?? 0) === 0) {
      throw new Error(`User not found: ${username}`)
    }
    if (existing.rows[0].role === ROLE_ADMIN) {
      throw new Error('Cannot deactivate an admin user')
    }

    const result = await this.pool.query(
      `UPDATE ${sch}."users" SET is_active = FALSE, updated_at = now() WHERE username = $1`,
      [username]
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`User not found: ${username}`)
    }
  }

  async resetPassword(username: string, newPassword: string): Promise<void> {
    const sch = this.schemaQuoted
    assertPasswordMinLength(newPassword, 'New password')
    const passwordHash = await this.passwordProvider.hashPassword(newPassword)
    await this.pool.query(
      `UPDATE ${sch}."users"
         SET password_hash = $1, must_change_password = TRUE,
             failed_login_count = 0, locked_until = NULL,
             password_changed_at = now(), updated_at = now()
       WHERE username = $2`,
      [passwordHash, username]
    )
  }

  /**
   * Rotate a user's password.
   *
   * Returns `false` when `oldPassword` doesn't verify (caller maps to
   * 401). Throws `PasswordPolicyError` for policy violations the
   * caller can surface as targeted 4xx codes (too short / reused).
   * Other errors propagate as 500.
   *
   * Server-side enforcement of:
   *   - newPassword length >= MIN_PASSWORD_LENGTH (12)
   *   - newPassword !== oldPassword (defence-in-depth even if the
   *     UI also checks; the server is authoritative)
   *
   * On success, must_change_password is cleared and the dispatcher's
   * pre-rotation gate stops blocking other endpoints for this
   * session.
   */
  async changePassword(
    username: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    assertPasswordMinLength(newPassword, 'New password')
    if (newPassword === oldPassword) {
      throw new PasswordPolicyError(
        'same-as-old',
        'New password must differ from the current password.'
      )
    }
    const sch = this.schemaQuoted
    const sel = await this.readPool.query<Record<string, unknown>>(
      `SELECT * FROM ${sch}."users" WHERE username = $1`,
      [username]
    )
    if ((sel.rowCount ?? 0) === 0) return false
    const user = mapPgRowToUser(sel.rows[0])

    const valid = await this.passwordProvider.verifyPassword(user.password_hash, oldPassword)
    if (!valid) return false

    const passwordHash = await this.passwordProvider.hashPassword(newPassword)
    await this.pool.query(
      `UPDATE ${sch}."users"
         SET password_hash = $1, must_change_password = FALSE,
             password_changed_at = now(), updated_at = now()
       WHERE username = $2`,
      [passwordHash, username]
    )
    return true
  }

  // ---------- settings ----------

  async isAccountsEnabled(): Promise<boolean> {
    const sch = this.schemaQuoted
    const sel = await this.readPool.query<{ value: string }>(
      `SELECT value FROM ${sch}."database_settings" WHERE key = 'accounts_enabled'`
    )
    return sel.rows[0]?.value === 'true'
  }
}
