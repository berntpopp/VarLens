import type { Pool } from 'pg'

import type { StorageSession } from '../../../main/storage/session'
import { createExternalLookupAuditSink } from './audit-sink'
import { PostgresExternalLookupPolicyStore } from './policy-store'
import { WebReferenceServices } from './reference-services'

/** Production wiring: Postgres-persisted policy + synchronous audit rows. */
export function createWebReferenceServices(options: {
  pool: Pool
  schema: string
  session: StorageSession
}): WebReferenceServices {
  return new WebReferenceServices({
    policy: new PostgresExternalLookupPolicyStore(options.pool, options.schema),
    audit: createExternalLookupAuditSink(options.session)
  })
}
