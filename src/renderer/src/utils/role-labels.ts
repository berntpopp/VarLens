/**
 * User-facing names and one-line meanings for the viewer / analyst / admin
 * roles (src/shared/auth/auth-constants.ts). Shared by the account menu and
 * user management so the wording cannot drift.
 */
import { USER_ROLES, normalizeUserRole, type UserRole } from '../../../shared/auth/auth-constants'

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = Object.freeze({
  viewer: 'Viewer',
  analyst: 'Analyst',
  admin: 'Administrator'
})

export const ROLE_DESCRIPTIONS: Readonly<Record<UserRole, string>> = Object.freeze({
  viewer: 'Read-only: browse cases, variants and cohorts.',
  analyst: 'Classify, comment, tag, import and export.',
  admin: 'Analyst rights plus users, settings and delete-all.'
})

export const ROLE_OPTIONS = USER_ROLES.map((value) => ({
  value,
  title: ROLE_LABELS[value],
  subtitle: ROLE_DESCRIPTIONS[value]
}))

/** Label for a stored role string; unknown values are shown verbatim. */
export function roleLabel(role: string | null | undefined): string {
  const normalized = normalizeUserRole(role)
  return normalized === undefined ? (role ?? 'Unknown') : ROLE_LABELS[normalized]
}
