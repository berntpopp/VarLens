import type { FastifyReply, FastifyRequest } from 'fastify'

import type { StorageSession } from '../../../main/storage/session'
import type { PostgresWebAuthService } from '../../auth/PostgresWebAuthService'
import type { AuditBuffer } from '../audit-buffer'
import type { WebEventHub } from '../events'
import type { AppMetrics } from '../metrics'

export interface DispatcherDeps {
  session: StorageSession
  authService: PostgresWebAuthService
  events: WebEventHub
  metrics?: AppMetrics
  /**
   * Batched writer for `api_read` audit rows. Absent (tests, or
   * VARLENS_AUDIT_FLUSH_INTERVAL_MS=0) → read audits are written synchronously.
   */
  auditBuffer?: AuditBuffer
}

export interface InvokeBodyPayload {
  args?: unknown[]
}

export type InvokeBody = InvokeBodyPayload | null | undefined

export interface OverrideHandler {
  /** True = bypasses the auth preHandler (e.g. login). Default: false. */
  public?: boolean
  /** Receives raw args array + request + deps; returns the value to JSON-encode. */
  handle: (
    args: unknown[],
    request: FastifyRequest,
    reply: FastifyReply,
    deps: DispatcherDeps
  ) => Promise<unknown> | unknown
}
