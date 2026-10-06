import type { Pool } from 'pg'

import type { StorageSession } from '../../../main/storage/session'
import { createExternalLookupAuditSink } from './audit-sink'
import { BoundedApiCache } from './bounded-api-cache'
import { PostgresExternalLookupPolicyStore } from './policy-store'
import { WebReferenceServices } from './reference-services'

export const REFERENCE_CACHE_MAX_ENTRIES_ENV = 'VARLENS_REFERENCE_CACHE_MAX_ENTRIES'
export const REFERENCE_CACHE_TTL_DAYS_ENV = 'VARLENS_REFERENCE_CACHE_TTL_DAYS'

function positiveInt(env: NodeJS.ProcessEnv, name: string, max: number): number | undefined {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw.trim())
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`)
  }
  return value
}

/** Production wiring: Postgres-persisted policy, synchronous audit rows, bounded cache. */
export function createWebReferenceServices(options: {
  pool: Pool
  schema: string
  session: StorageSession
  env?: NodeJS.ProcessEnv
}): WebReferenceServices {
  const env = options.env ?? process.env
  return new WebReferenceServices({
    policy: new PostgresExternalLookupPolicyStore(options.pool, options.schema),
    audit: createExternalLookupAuditSink(options.session),
    cache: new BoundedApiCache({
      maxEntries: positiveInt(env, REFERENCE_CACHE_MAX_ENTRIES_ENV, 1_000_000),
      maxTtlDays: positiveInt(env, REFERENCE_CACHE_TTL_DAYS_ENV, 90)
    })
  })
}
