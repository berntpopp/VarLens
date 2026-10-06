/**
 * ReferenceServices facade for the web server (parity spec §4.8).
 *
 * Constructs the same HTTP clients the desktop main process uses
 * (src/main/services/api/*) behind an egress policy:
 *
 *   - every service is OFF until an administrator enables it
 *     (policy-store.ts, persisted in Postgres);
 *   - `authorize()` runs before any client is touched, so a disabled service
 *     can never reach the network;
 *   - every allowed (and every refused) lookup is written to the audit trail
 *     with the user, the service and the identifier BEFORE the outbound call.
 *     If the audit write fails the lookup does not happen (fail closed).
 *
 * Responses are cached process-wide in an in-memory SQLite `api_cache`
 * (the desktop ApiCache class), shared across users, so repeated lookups of
 * the same variant or gene do not leave the server again.
 */
import Database from 'better-sqlite3-multiple-ciphers'

import { AlphaFoldApiClient } from '../../../main/services/api/AlphaFoldApiClient'
import { ApiCache } from '../../../main/services/api/ApiCache'
import { EnsemblApiClient } from '../../../main/services/api/EnsemblApiClient'
import { GnomadApiClient } from '../../../main/services/api/GnomadApiClient'
import { InterProApiClient } from '../../../main/services/api/InterProApiClient'
import { MyVariantApiClient } from '../../../main/services/api/MyVariantApiClient'
import { PanelAppClient } from '../../../main/services/api/PanelAppClient'
import { SpliceAIApiClient } from '../../../main/services/api/SpliceAIApiClient'
import { StringDbClient } from '../../../main/services/api/StringDbClient'
import { UniProtApiClient } from '../../../main/services/api/UniProtApiClient'
import { VepApiClient } from '../../../main/services/api/VepApiClient'
import {
  REFERENCE_SERVICE_CATALOG,
  buildReferenceServicesStatus,
  referenceServiceDisabledReason,
  type ReferenceServiceId,
  type ReferenceServicePolicyUpdate,
  type ReferenceServicesStatus
} from '../../../shared/ipc/domains/reference-services'
import type { ExternalLookupPolicySource } from './policy-store'

export interface ExternalLookupAuditEvent {
  username: string | null
  service: ReferenceServiceId
  /** Dispatcher key, e.g. `vep:fetch`. */
  method: string
  /** What is sent upstream: variant coordinates, gene symbol, keyword … */
  identifier: string
  outcome: 'allowed' | 'blocked'
  hosts: string[]
}

export type ExternalLookupAuditSink = (event: ExternalLookupAuditEvent) => Promise<void>

export class ExternalLookupDisabledError extends Error {
  constructor(
    readonly service: ReferenceServiceId,
    readonly reason: string
  ) {
    super(reason)
    this.name = 'ExternalLookupDisabledError'
  }
}

export interface ReferenceClients {
  /** Fresh per call: VepApiClient aborts its previous in-flight request. */
  vep: () => VepApiClient
  myvariant: () => MyVariantApiClient
  spliceai: () => SpliceAIApiClient
  gnomad: () => GnomadApiClient
  uniprot: () => UniProtApiClient
  interpro: () => InterProApiClient
  alphafold: () => AlphaFoldApiClient
  ensembl: () => EnsemblApiClient
  panelApp: () => PanelAppClient
  stringDb: () => StringDbClient
}

export interface WebReferenceServicesOptions {
  policy: ExternalLookupPolicySource
  audit: ExternalLookupAuditSink
  /** Test seam: replace some or all clients. */
  clients?: Partial<ReferenceClients>
}

export interface LookupContext {
  username: string | null
  method: string
  identifier: string
}

function createMemoryApiCache(): ApiCache {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE api_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL UNIQUE,
      response_data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX idx_api_cache_expires ON api_cache(expires_at);
  `)
  return new ApiCache(db)
}

function memo<T>(create: () => T): () => T {
  let value: T | undefined
  return () => (value ??= create())
}

function defaultClients(getCache: () => ApiCache): ReferenceClients {
  return {
    vep: () => new VepApiClient(getCache()),
    myvariant: memo(() => new MyVariantApiClient(getCache())),
    spliceai: memo(() => new SpliceAIApiClient(getCache())),
    gnomad: memo(() => new GnomadApiClient(getCache())),
    uniprot: memo(() => new UniProtApiClient(getCache())),
    interpro: memo(() => new InterProApiClient(getCache())),
    alphafold: memo(() => new AlphaFoldApiClient(getCache())),
    ensembl: memo(() => new EnsemblApiClient(getCache())),
    panelApp: memo(() => new PanelAppClient()),
    stringDb: memo(() => new StringDbClient())
  }
}

export class WebReferenceServices {
  readonly clients: ReferenceClients
  private readonly policy: ExternalLookupPolicySource
  private readonly audit: ExternalLookupAuditSink

  constructor(options: WebReferenceServicesOptions) {
    this.policy = options.policy
    this.audit = options.audit
    const getCache = memo(createMemoryApiCache)
    this.clients = { ...defaultClients(getCache), ...options.clients }
  }

  async status(): Promise<ReferenceServicesStatus> {
    const policy = await this.policy.load()
    return buildReferenceServicesStatus('web', policy.services, {
      updatedAt: policy.updatedAt,
      updatedBy: policy.updatedBy
    })
  }

  /** Per-service on/off map from the persisted policy. */
  async enabledServices(): Promise<Record<ReferenceServiceId, boolean>> {
    return { ...(await this.policy.load()).services }
  }

  async setPolicy(
    update: ReferenceServicePolicyUpdate,
    actor: string
  ): Promise<ReferenceServicesStatus> {
    const policy = await this.policy.save(update, actor)
    return buildReferenceServicesStatus('web', policy.services, {
      updatedAt: policy.updatedAt,
      updatedBy: policy.updatedBy
    })
  }

  /**
   * Gate + audit one lookup. Throws {@link ExternalLookupDisabledError} when
   * the service is off. Must be awaited before any client call.
   */
  async authorize(service: ReferenceServiceId, ctx: LookupContext): Promise<void> {
    const policy = await this.policy.load()
    const enabled = policy.services[service]
    await this.audit({
      username: ctx.username,
      service,
      method: ctx.method,
      identifier: ctx.identifier,
      outcome: enabled ? 'allowed' : 'blocked',
      hosts: [...REFERENCE_SERVICE_CATALOG[service].hosts]
    })
    if (!enabled) {
      throw new ExternalLookupDisabledError(service, referenceServiceDisabledReason(service))
    }
  }

  /** authorize() then run the lookup. */
  async lookup<T>(
    service: ReferenceServiceId,
    ctx: LookupContext,
    run: (clients: ReferenceClients) => Promise<T>
  ): Promise<T> {
    await this.authorize(service, ctx)
    return await run(this.clients)
  }
}
