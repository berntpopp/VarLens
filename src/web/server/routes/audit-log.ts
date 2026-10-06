import type { StorageReadTask } from '../../../main/storage/read-executor'
import type { AuditEntityType, AuditLogEntry } from '../../../shared/types/database'
import { requireAdmin } from './guards'
import type { OverrideHandler } from './types'

/**
 * Entity types a non-admin may read through `audit:getByEntity`: the clinical
 * change history of a variant or case variant (ACMG, stars, comments, tags).
 * Account and API-access rows (`user_account`, `api_call`) record employee
 * activity and stay administrator-only (spec P-16, role policy).
 */
const CLINICAL_AUDIT_ENTITY_TYPES: ReadonlySet<AuditEntityType> = new Set<AuditEntityType>([
  'variant_annotation',
  'case_variant_annotation'
])

export function clinicalAuditRows(rows: readonly AuditLogEntry[]): AuditLogEntry[] {
  return rows.filter((row) => CLINICAL_AUDIT_ENTITY_TYPES.has(row.entity_type))
}

/**
 * Audit-log reads in web mode.
 *
 *   audit:getByEntity  every signed-in user (shared data, role-gated writes);
 *                      non-admins see only clinical change rows
 *   audit:query        administrator only: the full trail includes logins and
 *                      API access (employee activity)
 *
 * The dispatcher still read-audits both calls: reading the audit log is itself
 * an auditable access. Read audits are buffered, so the trail is flushed first
 * to include every access up to this request.
 */
export function buildAuditLogOverrides(): Record<string, OverrideHandler> {
  const read = (type: 'audit:getByEntity' | 'audit:query', args: unknown[], deps: Deps) =>
    deps.session.getReadExecutor().execute({ type, params: args } as StorageReadTask)

  return {
    'audit:getByEntity': {
      async handle(args, request, _reply, deps) {
        await deps.auditBuffer?.flush()
        const rows = (await read('audit:getByEntity', args, deps)) as AuditLogEntry[]
        return request.session?.user?.role === 'admin' ? rows : clinicalAuditRows(rows)
      }
    },
    'audit:query': {
      async handle(args, request, reply, deps) {
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }
        await deps.auditBuffer?.flush()
        return await read('audit:query', args, deps)
      }
    }
  }
}

type Deps = Parameters<OverrideHandler['handle']>[3]
