/**
 * Role-based UI permissions (viewer / analyst / admin), read from the
 * per-session capability document (stores/capabilityStore.ts).
 *
 * The server is authoritative: every write is role-checked by the web
 * security map (src/web/server/security/operation-security-map.ts) and the
 * typed web client refuses role-blocked calls locally. This composable only
 * decides what the UI offers, so a viewer is not shown buttons that would be
 * refused. FAIL CLOSED: until the document is loaded nothing is writable.
 * Desktop documents carry the local principal's role (admin).
 */
import { computed, type ComputedRef } from 'vue'

import { normalizeUserRole, roleAtLeast, type UserRole } from '../../../shared/auth/auth-constants'
import { useCapabilityStore } from '../stores/capabilityStore'

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
  /** Why writes are unavailable (null when allowed) — use as tooltip / subtitle. */
  writeBlockedReason: ComputedRef<string | null>
  adminBlockedReason: ComputedRef<string | null>
}

export function usePermissions(): Permissions {
  const capabilities = useCapabilityStore()

  const role = computed<UserRole | null>(() => normalizeUserRole(capabilities.role) ?? null)
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
