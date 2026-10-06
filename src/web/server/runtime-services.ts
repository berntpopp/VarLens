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
import { JobRunner } from '../../main/services/jobs/JobRunner'
import { JOBS_CHANNELS } from '../../shared/ipc/domains/jobs'
import { AuditBuffer, resolveAuditBufferSettings } from './audit-buffer'
import type { WebEventHub } from './events'
import { PostgresCaseDeleteJobs } from './jobs/case-delete-jobs'
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
  jobs: { runner: JobRunner; caseDelete: PostgresCaseDeleteJobs }
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

  // Process-local JobRunner: same class, Job shape and single-flight rules as
  // the desktop main process (track 5a).
  const runner = new JobRunner()
  const staleAnnounced = new Set<string>()
  const caseDelete = new PostgresCaseDeleteJobs({
    lifecycle: new PostgresCaseLifecycleRepository(options.pool, options.schema),
    runner,
    logger: options.logger,
    batchSize: resolveCaseDeleteBatchSize(env),
    onJobChanged: (job, ownerUserId) => {
      if (ownerUserId === undefined) return
      options.events.publish(ownerUserId, JOBS_CHANNELS.changed, job)
      // Cohort views refresh around a delete, as with the old synchronous path.
      if (job.status === 'running' && !staleAnnounced.has(job.id)) {
        staleAnnounced.add(job.id)
        options.events.publish(ownerUserId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: true })
      } else if (job.status === 'completed' || job.status === 'cancelled') {
        staleAnnounced.delete(job.id)
        options.events.publish(ownerUserId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: false })
      } else if (job.status === 'failed') {
        staleAnnounced.delete(job.id)
      }
    }
  })

  return {
    auditBuffer,
    jobs: { runner, caseDelete },
    resumeInterruptedWork() {
      caseDelete.resumePending().then(
        (handle) => handle?.result.catch(() => undefined),
        (err: unknown) => {
          options.logger.error({ event: 'case-delete', action: 'resume-failed', err })
        }
      )
    },
    async close() {
      await caseDelete.close()
      await auditBuffer?.close()
    }
  }
}
