import type { FastifyReply, FastifyRequest } from 'fastify'

import type { StorageSession } from '../../../main/storage/session'
import type { PostgresWebAuthService } from '../../auth/PostgresWebAuthService'
import type { AuditBuffer } from '../audit-buffer'
import type { JobRunner } from '../../../main/services/jobs/JobRunner'
import type { PostgresCaseDeleteJobs } from '../jobs/case-delete-jobs'
import type { WebEventHub } from '../events'
import type { WebJobRegistry } from '../jobs/web-job-registry'
import type { SessionRevocations } from '../session-revocation'
import type { AppMetrics } from '../metrics'
import type { DownloadGrantRegistry } from '../downloads/download-grants'
import type { ExportArtifactRequest } from '../downloads/export-artifacts'
import type { WebReferenceServices } from '../reference-services/reference-services'
import type { WebAssociationRuns } from '../association/web-association-runs'

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
  /**
   * Background jobs (`jobs:` contract, src/shared/ipc/domains/jobs.ts; the
   * case-delete job contract is src/shared/types/case-delete-job.ts).
   * Absent → `cases:delete` falls back to the synchronous write task.
   */
  /**
   * Signed single-use export download grants (routes/export-download.ts).
   * Absent → one process-wide registry.
   */
  downloadGrants?: DownloadGrantRegistry<ExportArtifactRequest>
  jobs?: {
    runner: JobRunner
    caseDelete: PostgresCaseDeleteJobs
    /** Per-user view (ownership, visibility, owner-checked cancel). */
    registry: WebJobRegistry
  }
  /** Revoked browser-session ids (logout of a stateless cookie session). */
  sessions?: SessionRevocations
  /**
   * External reference lookups behind the admin egress policy
   * (src/web/server/reference-services/). Absent → those methods answer 501.
   */
  referenceServices?: WebReferenceServices
  /** Per-user cohort association runs (Postgres). Absent → 501. */
  association?: WebAssociationRuns
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
