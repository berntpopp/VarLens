/**
 * Process-lifetime services the web server owns on top of the storage
 * session: the batched read-audit writer and the background job runners.
 *
 * Kept out of server.ts so the bootstrap stays readable. `close()` is called
 * from the Fastify onClose hook BEFORE the storage session (and its pool)
 * closes: job runners stop between batches (interrupted work resumes at the
 * next boot) and pending audit rows are flushed on SIGTERM/SIGINT.
 */
import type { Pool } from 'pg'

import { PostgresAuditLogRepository } from '../../main/storage/postgres/PostgresAuditLogRepository'
import { PostgresCaseLifecycleRepository } from '../../main/storage/postgres/PostgresCaseLifecycleRepository'
import { BACKGROUND_JOB_UPDATED_EVENT } from '../../shared/types/background-job'
import { AuditBuffer, resolveAuditBufferSettings } from './audit-buffer'
import type { WebEventHub } from './events'
import { BackgroundJobRegistry } from './jobs/background-job-registry'
import { CaseDeleteJobRunner } from './jobs/case-delete-jobs'
import { WEB_EVENT_COHORT_SUMMARY_REBUILT } from './web-event-types'

export const CASE_DELETE_BATCH_SIZE_ENV = 'VARLENS_PG_DELETE_BATCH_SIZE'
const DEFAULT_CASE_DELETE_BATCH_SIZE = 5000

export interface RuntimeLogger {
  info: (obj: object, msg?: string) => void
  warn: (obj: object, msg?: string) => void
  error: (obj: object, msg?: string) => void
}

export interface WebRuntimeServices {
  auditBuffer: AuditBuffer | undefined
  jobs: { registry: BackgroundJobRegistry; caseDelete: CaseDeleteJobRunner }
  /** Re-queue work interrupted by a previous shutdown/crash (fire-and-forget). */
  resumeInterruptedWork: () => void
  close: () => Promise<void>
}

export function resolveCaseDeleteBatchSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[CASE_DELETE_BATCH_SIZE_ENV]
  if (raw === undefined || raw.trim() === '') return DEFAULT_CASE_DELETE_BATCH_SIZE
  const value = Number(raw.trim())
  if (!Number.isInteger(value) || value < 100 || value > 100_000) {
    throw new Error(`${CASE_DELETE_BATCH_SIZE_ENV} must be an integer between 100 and 100000`)
  }
  return value
}

export function createWebRuntimeServices(options: {
  pool: Pool
  schema: string
  events: WebEventHub
  logger: RuntimeLogger
  env?: NodeJS.ProcessEnv
}): WebRuntimeServices {
  const env = options.env ?? process.env
  const settings = resolveAuditBufferSettings(env)
  const auditRepository = new PostgresAuditLogRepository(options.pool, options.schema)
  const auditBuffer =
    settings === null
      ? undefined
      : new AuditBuffer({
          sink: (rows) => auditRepository.appendMany(rows),
          flushIntervalMs: settings.flushIntervalMs,
          maxBatchSize: settings.maxBatchSize,
          logger: options.logger
        })

  const registry = new BackgroundJobRegistry()
  registry.onUpdate((job, ownerUserId) => {
    if (ownerUserId !== undefined) {
      options.events.publish(ownerUserId, BACKGROUND_JOB_UPDATED_EVENT, job)
    }
  })
  const caseDelete = new CaseDeleteJobRunner({
    lifecycle: new PostgresCaseLifecycleRepository(options.pool, options.schema),
    registry,
    logger: options.logger,
    batchSize: resolveCaseDeleteBatchSize(env),
    onSettled: (job, ownerUserId) => {
      if (job.status !== 'succeeded' || ownerUserId === undefined) return
      options.events.publish(ownerUserId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: true })
      options.events.publish(ownerUserId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: false })
    }
  })

  return {
    auditBuffer,
    jobs: { registry, caseDelete },
    resumeInterruptedWork() {
      caseDelete.resumePending().catch((err: unknown) => {
        options.logger.error({ event: 'case-delete', action: 'resume-failed', err })
      })
    },
    async close() {
      await caseDelete.close()
      await auditBuffer?.close()
    }
  }
}
