/**
 * Process-lifetime services the web server owns on top of the storage
 * session: the batched read-audit writer and the background job runners.
 *
 * Kept out of server.ts so the bootstrap stays readable; `close()` is called
 * from the Fastify onClose hook BEFORE the storage session (and its pool)
 * closes, so pending audit rows are flushed on SIGTERM/SIGINT.
 */
import type { Pool } from 'pg'

import { PostgresAuditLogRepository } from '../../main/storage/postgres/PostgresAuditLogRepository'
import { AuditBuffer, type AuditBufferLogger, resolveAuditBufferSettings } from './audit-buffer'

export interface WebRuntimeServices {
  auditBuffer: AuditBuffer | undefined
  close: () => Promise<void>
}

export function createWebRuntimeServices(options: {
  pool: Pool
  schema: string
  logger: AuditBufferLogger
  env?: NodeJS.ProcessEnv
}): WebRuntimeServices {
  const settings = resolveAuditBufferSettings(options.env ?? process.env)
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

  return {
    auditBuffer,
    async close() {
      await auditBuffer?.close()
    }
  }
}
