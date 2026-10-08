/**
 * Admin-only user mutations for the Postgres web auth store that are not
 * part of the login/rotation hot path: role changes and re-activation.
 *
 * Kept out of PostgresWebAuthService to hold that file under the
 * LLM-sustainable size budget; the service exposes thin delegating methods.
 * `schemaQuoted` is the already-quoted schema identifier the service owns.
 */
import type { Pool } from 'pg'

import { ROLE_ADMIN, isUserRole, type UserRole } from '../../shared/auth/auth-constants'

export class UserAdminError extends Error {
  constructor(
    readonly code: 'user-not-found' | 'invalid-role' | 'last-admin',
    message: string
  ) {
    super(message)
    this.name = 'UserAdminError'
  }
}

/**
 * Advisory-lock key that serialises every change to the set of active admins:
 * the first-admin bootstrap and role changes take it in their transaction.
 */
export function adminSetLockKey(schemaQuoted: string): string {
  return `${schemaQuoted}:first-admin-bootstrap`
}

async function requireExistingRole(
  db: Pick<Pool, 'query'>,
  schemaQuoted: string,
  username: string
): Promise<UserRole> {
  const existing = await db.query<{ role: UserRole }>(
    `SELECT role FROM ${schemaQuoted}."users" WHERE username = $1`,
    [username]
  )
  if ((existing.rowCount ?? 0) === 0) {
    throw new UserAdminError('user-not-found', `User not found: ${username}`)
  }
  return existing.rows[0].role
}

/**
 * Change a user's role. Refuses to demote the last active admin so the
 * deployment can never lock itself out of user management. The "other active
 * admins" check and the UPDATE run in one transaction under the admin-set
 * advisory lock: without it two admins demoting each other both pass the check.
 */
export async function setUserRole(
  pool: Pool,
  schemaQuoted: string,
  username: string,
  role: UserRole
): Promise<void> {
  if (!isUserRole(role)) throw new UserAdminError('invalid-role', `Invalid role: ${role}`)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      adminSetLockKey(schemaQuoted)
    ])
    const current = await requireExistingRole(client, schemaQuoted, username)
    if (current !== role) {
      if (current === ROLE_ADMIN) {
        const others = await client.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM ${schemaQuoted}."users"
            WHERE role = $1 AND is_active = TRUE AND username <> $2`,
          [ROLE_ADMIN, username]
        )
        if (Number(others.rows[0]?.c ?? 0) === 0) {
          throw new UserAdminError('last-admin', 'Cannot demote the last active admin')
        }
      }
      await client.query(
        `UPDATE ${schemaQuoted}."users" SET role = $1, updated_at = now() WHERE username = $2`,
        [role, username]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback failures; original error wins
    }
    throw err
  } finally {
    client.release()
  }
}

/** Re-enable a deactivated account and clear any lockout state. */
export async function reactivateUser(
  pool: Pool,
  schemaQuoted: string,
  username: string
): Promise<void> {
  await requireExistingRole(pool, schemaQuoted, username)
  await pool.query(
    `UPDATE ${schemaQuoted}."users"
        SET is_active = TRUE, failed_login_count = 0, locked_until = NULL, updated_at = now()
      WHERE username = $1`,
    [username]
  )
}

/** Throws `user-not-found` unless the account exists (used before password resets). */
export async function assertUserExists(
  pool: Pool,
  schemaQuoted: string,
  username: string
): Promise<void> {
  await requireExistingRole(pool, schemaQuoted, username)
}
