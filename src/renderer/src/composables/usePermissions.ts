/**
 * Role-based UI permissions (viewer / analyst / admin).
 *
 * The server is authoritative: every write is role-checked by the web
 * security map (src/web/server/security/operation-security-map.ts). This
 * composable only decides what the UI offers, so a viewer is not shown
 * buttons that would be refused.
 *
 * Fail closed in web mode: until the session user is known, nothing is
 * writable. Desktop without accounts is the local principal (every right).
 *
 * INTEGRATION NOTE: when the role-aware capability document (P-A,
 * `system:capabilities` + capabilityStore) lands, back these computeds with
 * `canUse(...)` instead of reading the role here.
 */
import { computed, type ComputedRef } from 'vue'

import {
  ROLE_ADMIN,
  normalizeUserRole,
  roleAtLeast,
  type UserRole
} from '../../../shared/auth/auth-constants'
import { useAuthStore } from '../stores/authStore'
import { isWebRuntime } from '../utils/runtime-mode'

export const VIEWER_READ_ONLY_MESSAGE =
  'Your account is read-only (viewer). Ask an administrator for the analyst role.'
export const ADMIN_ONLY_MESSAGE = 'Only administrators can do this.'
const LOADING_MESSAGE = 'Checking your permissions…'

export interface Permissions {
  role: ComputedRef<UserRole | null>
  /** Classify, comment, tag, curate, import, export, delete cases. */
  canWrite: ComputedRef<boolean>
  /** Users, settings, delete-all, cache / egress configuration. */
  canAdmin: ComputedRef<boolean>
  /** Why writes are unavailable (null when allowed) — use as tooltip / title. */
  writeBlockedReason: ComputedRef<string | null>
  adminBlockedReason: ComputedRef<string | null>
}

export function usePermissions(): Permissions {
  const auth = useAuthStore()

  const role = computed<UserRole | null>(() => {
    const raw = auth.currentUser?.role
    if (raw !== undefined) return normalizeUserRole(raw) ?? null
    if (!isWebRuntime() && !auth.accountsEnabled) return ROLE_ADMIN
    return null
  })
  const canWrite = computed(() => roleAtLeast(role.value, 'analyst'))
  const canAdmin = computed(() => roleAtLeast(role.value, 'admin'))

  const blocked = (allowed: boolean, message: string): string | null => {
    if (allowed) return null
    return role.value === null ? LOADING_MESSAGE : message
  }

  return {
    role,
    canWrite,
    canAdmin,
    writeBlockedReason: computed(() => blocked(canWrite.value, VIEWER_READ_ONLY_MESSAGE)),
    adminBlockedReason: computed(() => blocked(canAdmin.value, ADMIN_ONLY_MESSAGE))
  }
}
