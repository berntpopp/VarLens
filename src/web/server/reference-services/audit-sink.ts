import type { StorageSession } from '../../../main/storage/session'
import type { StorageWriteTask } from '../../../main/storage/write-executor'
import type { ReferenceServicePolicyUpdate } from '../../../shared/ipc/domains/reference-services'
import type { ExternalLookupAuditEvent, ExternalLookupAuditSink } from './reference-services'

/** `entity_key` prefix of external-lookup audit rows (one row per lookup). */
export const EXTERNAL_LOOKUP_AUDIT_PREFIX = 'external-lookup:'
const MAX_IDENTIFIER_LENGTH = 500

/**
 * Writes one synchronous audit row per external lookup, before the outbound
 * call. Uses the existing `api_read` / `api_call` audit vocabulary (no audit
 * CHECK-constraint migration): `entity_key` = `external-lookup:<service>`,
 * `new_value` carries method, identifier, outcome and upstream hosts.
 */
export function createExternalLookupAuditSink(session: StorageSession): ExternalLookupAuditSink {
  return async (event: ExternalLookupAuditEvent) => {
    await session.getWriteExecutor().execute({
      type: 'audit:append',
      params: [
        {
          action_type: 'api_read',
          entity_type: 'api_call',
          entity_key: `${EXTERNAL_LOOKUP_AUDIT_PREFIX}${event.service}`,
          old_value: null,
          new_value: {
            service: event.service,
            method: event.method,
            identifier: event.identifier.slice(0, MAX_IDENTIFIER_LENGTH),
            outcome: event.outcome,
            hosts: event.hosts
          },
          user_name: event.username,
          metadata: { source: 'reference-services' }
        }
      ]
    } satisfies StorageWriteTask)
  }
}

/**
 * Synchronous audit row for an admin change to the egress policy: the change
 * must not report success without its audit row.
 */
export async function recordPolicyChangeAudit(
  session: StorageSession,
  actor: string,
  update: ReferenceServicePolicyUpdate
): Promise<void> {
  await session.getWriteExecutor().execute({
    type: 'audit:append',
    params: [
      {
        action_type: 'api_write',
        entity_type: 'api_call',
        entity_key: 'reference-services:setPolicy',
        old_value: null,
        new_value: { method: 'reference-services:setPolicy', update },
        user_name: actor,
        metadata: { source: 'reference-services' }
      }
    ]
  } satisfies StorageWriteTask)
}
