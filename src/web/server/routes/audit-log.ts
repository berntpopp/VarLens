import type { StorageReadTask } from '../../../main/storage/read-executor'
import type { AuditLogEntry } from '../../../shared/types/database'
import { requireAdmin } from './guards'
import type { OverrideHandler } from './types'

/**
 * Entity types that make up the clinical change history of shared data
 * (who classified / starred / commented a variant). Everyone who can see the
 * variant may see its history.
 */
const CLINICAL_ENTITY_TYPES = new Set<string>(['variant_annotation', 'case_variant_annotation'])

/**
 * Audit-trail reads in web mode (roles in security/operation-security-map.ts):
 *
 *   - `audit:query` browses the whole trail, which includes employee activity
 *     (logins, API access): admin only.
 *   - `audit:getByEntity` serves the Activity panel of one variant: every
 *     role, but non-admins only get clinical entity rows, so a viewer cannot
 *     read login history by asking for a username as the entity key.
 *
 * The dispatcher read-audits both — reading the trail is itself an access.
 */
export function buildAuditLogOverrides(): Record<string, OverrideHandler> {
  return {
    'audit:getByEntity': {
      async handle(args, request, _reply, deps) {
        await deps.auditBuffer?.flush()
        const rows = (await deps.session.getReadExecutor().execute({
          type: 'audit:getByEntity',
          params: args
        } as StorageReadTask)) as AuditLogEntry[]
        if (request.session?.user?.role === 'admin') return rows
        return Array.isArray(rows)
          ? rows.filter((row) => CLINICAL_ENTITY_TYPES.has(row.entity_type))
          : []
      }
    },
    'audit:query': {
      async handle(args, request, reply, deps) {
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }
        // Read audits are buffered; drain them first so an admin's view of the
        // trail includes every access up to this request.
        await deps.auditBuffer?.flush()
        return deps.session
          .getReadExecutor()
          .execute({ type: 'audit:query', params: args } as StorageReadTask)
      }
    }
  }
}
