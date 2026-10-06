import type { StorageReadTask } from '../../../main/storage/read-executor'
import { requireAdmin } from './guards'
import type { OverrideHandler } from './types'

/**
 * Audit-log reads are admin-only in web mode: the trail contains
 * employee activity (logins, API access), not just clinical change
 * history, so it is restricted to the administrator role. These
 * overrides replace the read-task autoroute entries removed from
 * task-types.ts. The dispatcher still read-audits these calls —
 * reading the audit log is itself an auditable access.
 */
export function buildAuditLogOverrides(): Record<string, OverrideHandler> {
  const adminRead =
    (type: 'audit:getByEntity' | 'audit:query'): OverrideHandler['handle'] =>
    async (args, request, reply, deps) => {
      const admin = requireAdmin(request, reply)
      if (admin === undefined) return { error: 'admin-required' }
      // Read audits are buffered; drain them first so an admin's view of the
      // trail includes every access up to this request.
      await deps.auditBuffer?.flush()
      return deps.session.getReadExecutor().execute({ type, params: args } as StorageReadTask)
    }

  return {
    'audit:getByEntity': { handle: adminRead('audit:getByEntity') },
    'audit:query': { handle: adminRead('audit:query') }
  }
}
