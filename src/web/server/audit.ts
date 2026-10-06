import type { StorageWriteTask } from '../../main/storage/write-executor'
import type { AuditActionType, AuditEntityType } from '../../shared/types/database'
import type { UserRole } from '../../shared/auth/auth-constants'
import type { DispatcherDeps } from './routes/types'

const AUDITED_OVERRIDE_WRITE_METHODS = new Set<string>([
  'annotations:upsertGlobal',
  'annotations:upsertPerCase',
  'case-metadata:createCohort',
  'import:start',
  'import:startMultiFile',
  'batch-import:start',
  'batch-import:cleanupZipTemp'
])

const READ_AUDIT_EXCLUDED_METHODS = new Set<string>([
  'auth:login',
  'auth:logout',
  'auth:currentUser',
  'auth:isAccountsEnabled',
  'auth:changePassword',
  'auth:createUser',
  'auth:deactivateUser',
  'auth:resetPassword',
  'database:capabilities',
  'database:health',
  'database:info',
  'database:getOverview',
  'database:recentList',
  'database:overview'
])

interface WebAuditEvent {
  action_type: AuditActionType
  entity_type: AuditEntityType
  entity_key: string
  user_name?: string | null
  new_value?: unknown
  metadata?: unknown
}

async function appendWebAudit(deps: DispatcherDeps, event: WebAuditEvent): Promise<void> {
  await deps.session.getWriteExecutor().execute({
    type: 'audit:append',
    params: [
      {
        action_type: event.action_type,
        entity_type: event.entity_type,
        entity_key: event.entity_key,
        old_value: null,
        new_value: event.new_value,
        user_name: event.user_name ?? null,
        metadata: event.metadata
      }
    ]
  } satisfies StorageWriteTask)
}

export function shouldAuditOverrideWrite(key: string): boolean {
  return AUDITED_OVERRIDE_WRITE_METHODS.has(key)
}

export function shouldAuditApiRead(key: string): boolean {
  return !READ_AUDIT_EXCLUDED_METHODS.has(key)
}

export async function recordAuthAudit(
  deps: DispatcherDeps,
  params: {
    action_type: Extract<
      AuditActionType,
      | 'auth_login_success'
      | 'auth_login_failure'
      | 'auth_logout'
      | 'auth_password_change'
      | 'auth_password_reset'
      | 'auth_user_deactivate'
    >
    username: string
    actor?: string | null
    role?: UserRole | string | null
    success: boolean
    reason?: string
    mustChangePassword?: boolean
  }
): Promise<void> {
  const isPublicLoginFailure = params.action_type === 'auth_login_failure'
  await appendWebAudit(deps, {
    action_type: params.action_type,
    entity_type: 'user_account',
    entity_key: isPublicLoginFailure ? 'login-attempt' : params.username,
    user_name: isPublicLoginFailure ? null : (params.actor ?? params.username),
    new_value: {
      success: params.success,
      ...(params.role !== undefined && params.role !== null ? { role: params.role } : {}),
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
      ...(params.mustChangePassword !== undefined
        ? { must_change_password: params.mustChangePassword }
        : {})
    },
    metadata: { source: 'web-auth' }
  })
}

export async function recordApiWriteAudit(
  deps: DispatcherDeps,
  params: { key: string; username?: string | null }
): Promise<void> {
  await appendWebAudit(deps, {
    action_type: 'api_write',
    entity_type: 'api_call',
    entity_key: params.key,
    user_name: params.username ?? null,
    new_value: { success: true, method: params.key },
    metadata: { source: 'web-dispatcher' }
  })
}

/**
 * Read audits are the per-request hot path, so they go through the batched
 * AuditBuffer when one is configured (flushed on interval/size/shutdown).
 * Write and auth audits above stay synchronous: a mutation must not report
 * success without its audit row.
 */
export async function recordApiReadAudit(
  deps: DispatcherDeps,
  params: { key: string; username?: string | null }
): Promise<void> {
  if (deps.auditBuffer !== undefined) {
    await deps.auditBuffer.enqueue({
      action_type: 'api_read',
      entity_type: 'api_call',
      entity_key: params.key,
      old_value: null,
      new_value: { success: true, method: params.key },
      user_name: params.username ?? null,
      metadata: { source: 'web-dispatcher' },
      occurred_at: Date.now()
    })
    return
  }
  await appendWebAudit(deps, {
    action_type: 'api_read',
    entity_type: 'api_call',
    entity_key: params.key,
    user_name: params.username ?? null,
    new_value: { success: true, method: params.key },
    metadata: { source: 'web-dispatcher' }
  })
}
