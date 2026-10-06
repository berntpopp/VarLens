/**
 * Cross-backend auth policy constants.
 *
 * Both the desktop SQLite AuthService and PostgresWebAuthService import from
 * here. Without a single source of truth the two backends
 * drift on policy — different lockout thresholds, mismatched role
 * enums, divergent CHECK constraints between SQLite migrations.ts v12
 * and Postgres migrations/sql/0008_*.sql.
 *
 * Anything that is *policy* belongs here. SQL fragments, query
 * shape, and row-mapping stay in the per-backend implementation.
 *
 * SECURITY POLICY: changes to the lockout threshold or duration are
 * security-policy changes, not refactors. They affect every operator's
 * exposure to credential-stuffing and brute-force attacks. The pinned-
 * value tests in tests/main/services/auth/auth-constants.test.ts force
 * these edits to be deliberate, but reviewers should treat any PR that
 * touches these constants as a security review, not a routine cleanup.
 */

/**
 * Allowed values for the users.role column, least to most privileged.
 *
 * Data is SHARED across users; the role only gates writes:
 *   - `viewer`  read-only (browse cases, variants, cohorts, audit of an entity)
 *   - `analyst` viewer + classify / comment / tag / import / export / curate
 *   - `admin`   analyst + user management, settings, delete-all, egress config
 *
 * Postgres migration 0020 and SQLite v36 moved the old `'user'` role to
 * `'analyst'` (same write abilities it always had).
 */
export const USER_ROLES = ['viewer', 'analyst', 'admin'] as const
export type UserRole = (typeof USER_ROLES)[number]

/**
 * Named role constants — use these in code paths instead of string
 * literals so a rename of the role enum is a TypeScript-caught change
 * rather than a silent runtime divergence between schema and inserts.
 */
export const ROLE_ADMIN: UserRole = 'admin'
export const ROLE_ANALYST: UserRole = 'analyst'
export const ROLE_VIEWER: UserRole = 'viewer'

/**
 * Pre-0020 / pre-v36 name of the analyst role. Never written any more; only
 * accepted on input (platform entitlements, provisioning CLI, stale cookies)
 * and normalised to {@link ROLE_ANALYST}.
 */
export const LEGACY_ROLE_USER = 'user'

/**
 * Default value for the users.role column and for accounts created without
 * an explicit role: least privilege. Both backends declare
 * `DEFAULT 'viewer'`; the migration-parity tests pin both to this value.
 */
export const DEFAULT_USER_ROLE: UserRole = ROLE_VIEWER

const ROLE_RANK: Readonly<Record<UserRole, number>> = Object.freeze({
  viewer: 0,
  analyst: 1,
  admin: 2
})

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

/** Maps a stored/claimed role to the current enum (`'user'` → analyst); unknown → undefined. */
export function normalizeUserRole(value: unknown): UserRole | undefined {
  if (value === LEGACY_ROLE_USER) return ROLE_ANALYST
  return isUserRole(value) ? value : undefined
}

/** True when `role` grants at least `minimum`. Unknown roles grant nothing. */
export function roleAtLeast(role: unknown, minimum: UserRole): boolean {
  const normalized = normalizeUserRole(role)
  return normalized !== undefined && ROLE_RANK[normalized] >= ROLE_RANK[minimum]
}

/**
 * Minimum length for passwords accepted by the web track. Desktop auth keeps
 * its existing looser behavior; web bootstrap and password rotation share this
 * value so the hash CLI cannot drift from the Postgres auth service.
 */
export const WEB_MIN_PASSWORD_LENGTH = 12

/**
 * After this many consecutive failed login attempts the account is
 * temporarily locked. Matches the desktop AuthService constant.
 */
export const MAX_FAILED_ATTEMPTS = 5

/**
 * How long an account stays locked after exceeding MAX_FAILED_ATTEMPTS.
 * Both backends compute `locked_until = now() + this duration`.
 */
export const LOCKOUT_DURATION_MINUTES = 15
