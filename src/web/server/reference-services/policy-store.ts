/**
 * Persisted external-lookup egress policy for the web server.
 *
 * Stored server-side in the project schema's `database_settings` table
 * (key `external_lookups`, JSON value) so it survives restarts and is shared
 * by every server process. Unknown or missing entries are OFF: a fresh
 * deployment makes no outbound lookup until an administrator enables one.
 */
import type { Pool } from 'pg'

import {
  REFERENCE_SERVICE_IDS,
  isReferenceServiceId,
  uniformReferenceServicePolicy,
  type ReferenceServiceId,
  type ReferenceServicePolicyUpdate
} from '../../../shared/ipc/domains/reference-services'
import { quoteIdentifier } from '../../../main/storage/postgres/identifiers'

export const EXTERNAL_LOOKUPS_SETTING_KEY = 'external_lookups'
/** Other server processes pick up an admin change within this window. */
const POLICY_CACHE_TTL_MS = 5_000

export interface ExternalLookupPolicy {
  services: Record<ReferenceServiceId, boolean>
  updatedAt: number | null
  updatedBy: string | null
}

export interface ExternalLookupPolicySource {
  load: () => Promise<ExternalLookupPolicy>
  save: (update: ReferenceServicePolicyUpdate, actor: string) => Promise<ExternalLookupPolicy>
}

export function defaultExternalLookupPolicy(): ExternalLookupPolicy {
  return { services: uniformReferenceServicePolicy(false), updatedAt: null, updatedBy: null }
}

/** Parse the stored JSON; anything malformed falls back to all-off. */
export function parseExternalLookupPolicy(raw: string | null | undefined): ExternalLookupPolicy {
  const policy = defaultExternalLookupPolicy()
  if (raw === null || raw === undefined || raw.trim() === '') return policy
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return policy
  }
  if (typeof parsed !== 'object' || parsed === null) return policy
  const record = parsed as Record<string, unknown>
  const services = record.services
  if (typeof services === 'object' && services !== null) {
    for (const [id, value] of Object.entries(services as Record<string, unknown>)) {
      if (isReferenceServiceId(id)) policy.services[id] = value === true
    }
  }
  policy.updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : null
  policy.updatedBy = typeof record.updatedBy === 'string' ? record.updatedBy : null
  return policy
}

export class PostgresExternalLookupPolicyStore implements ExternalLookupPolicySource {
  private readonly table: string
  private cached: { policy: ExternalLookupPolicy; at: number } | null = null

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string,
    private readonly now: () => number = Date.now
  ) {
    this.table = `${quoteIdentifier(schema)}."database_settings"`
  }

  async load(): Promise<ExternalLookupPolicy> {
    if (this.cached !== null && this.now() - this.cached.at < POLICY_CACHE_TTL_MS) {
      return this.cached.policy
    }
    const result = await this.pool.query<{ value: string }>(
      `SELECT value FROM ${this.table} WHERE key = $1`,
      [EXTERNAL_LOOKUPS_SETTING_KEY]
    )
    const policy = parseExternalLookupPolicy(result.rows[0]?.value)
    this.cached = { policy, at: this.now() }
    return policy
  }

  async save(update: ReferenceServicePolicyUpdate, actor: string): Promise<ExternalLookupPolicy> {
    this.cached = null
    const current = await this.load()
    const services = { ...current.services }
    for (const id of REFERENCE_SERVICE_IDS) {
      const value = update[id]
      if (typeof value === 'boolean') services[id] = value
    }
    const next: ExternalLookupPolicy = { services, updatedAt: this.now(), updatedBy: actor }
    await this.pool.query(
      `INSERT INTO ${this.table} (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [EXTERNAL_LOOKUPS_SETTING_KEY, JSON.stringify(next)]
    )
    this.cached = { policy: next, at: this.now() }
    return next
  }
}
