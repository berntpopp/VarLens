/**
 * Short-lived worker thread for deferred cohort summary rebuild.
 *
 * Spawned after single case deletes to avoid blocking the main thread.
 * Opens its own database connection, rebuilds summary tables, then exits.
 */
import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DATABASE_CONFIG } from '../../shared/config'
import { assertNotHexLiteralKey } from '../database/sqlcipher-key-guard'
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL
} from '../../shared/sql/cohort-summary-rebuild'

export interface RebuildWorkerRequest {
  dbPath: string
  encryptionKey?: string
}

/**
 * Discrete phases of a cohort summary rebuild. Ordered by execution sequence.
 * The renderer uses these to show which sub-task the worker is currently
 * executing. We deliberately collapse the three real DB operations into three
 * user-facing phases (variant summary / gene burden / analyze) because
 * `UPDATE_META_SQL` is too fast to display meaningfully.
 */
export type RebuildPhase = 'variant_summary' | 'gene_burden' | 'analyze'

export const REBUILD_PHASE_TOTAL = 3

/** Human-readable labels for each phase — kept alongside the enum so renderer + main share the wording. */
export const REBUILD_PHASE_LABELS: Record<RebuildPhase, string> = {
  variant_summary: 'Rebuilding variant summary',
  gene_burden: 'Rebuilding gene burden index',
  analyze: 'Optimizing query planner'
}

export const REBUILD_PHASE_INDEX: Record<RebuildPhase, number> = {
  variant_summary: 1,
  gene_burden: 2,
  analyze: 3
}

export type RebuildWorkerResponse =
  | {
      type: 'progress'
      phase: RebuildPhase
      phase_index: number
      phase_total: number
      label: string
    }
  | { type: 'complete' }
  | { type: 'error'; error: string }

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort

/**
 * Emit a progress event to the parent thread. This is a plain postMessage
 * between SQL statements — it has zero impact on SQL execution time because
 * the worker thread is a separate OS thread, the messages are async, and
 * they fire in the narrow gap between statements. We verified the timing
 * claim by instrumenting a rebuild locally: the message round-trip is
 * sub-millisecond vs. SQL phases that run in the hundreds of ms to seconds.
 */
function emitPhase(phase: RebuildPhase): void {
  const response: RebuildWorkerResponse = {
    type: 'progress',
    phase,
    phase_index: REBUILD_PHASE_INDEX[phase],
    phase_total: REBUILD_PHASE_TOTAL,
    label: REBUILD_PHASE_LABELS[phase]
  }
  port.postMessage(response)
}

port.on('message', (msg: RebuildWorkerRequest) => {
  let db: DatabaseType | null = null
  try {
    if (msg.encryptionKey !== undefined && msg.encryptionKey !== '') {
      assertNotHexLiteralKey(msg.encryptionKey)
    }

    db = new Database(msg.dbPath)

    if (msg.encryptionKey !== undefined && msg.encryptionKey !== '') {
      const safeKey = msg.encryptionKey.split("'").join("''")
      db.pragma(`key='${safeKey}'`)
    }

    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
    db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
    db.pragma('temp_store = MEMORY')
    db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)

    db.transaction(() => {
      // Phase 1/3 — largest phase, the big INSERT-SELECT rebuilding the
      // per-variant cohort summary table. Typically 60-80 % of rebuild time.
      emitPhase('variant_summary')
      db!.exec(REBUILD_VARIANT_SUMMARY_SQL)
      // Part of the same phase: fold per-case stars/comments/ACMG calls into
      // the flags, as CohortSummaryService.rebuild() does.
      db!.exec(UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL)

      // Phase 2/3 — smaller INSERT-SELECT rebuilding the gene-level burden
      // summary table. Typically ~20 % of rebuild time.
      emitPhase('gene_burden')
      db!.exec(REBUILD_GENE_BURDEN_SQL)

      // UPDATE_META_SQL is a handful of UPDATEs and runs in single-digit
      // milliseconds — not worth a phase entry.
      db!.exec(UPDATE_META_SQL)
    })()

    // Phase 3/3 — ANALYZE on both summary tables. Runs outside the
    // transaction so it can release locks sooner. Combined into one phase
    // because both ANALYZE calls together run in ~5 % of rebuild time.
    emitPhase('analyze')
    try {
      db.exec('ANALYZE cohort_variant_summary')
    } catch (e) {
      console.warn(
        '[rebuild-summary-worker] Failed to ANALYZE cohort_variant_summary:',
        e instanceof Error ? e.message : String(e)
      )
    }
    try {
      db.exec('ANALYZE gene_burden_summary')
    } catch (e) {
      console.warn(
        '[rebuild-summary-worker] Failed to ANALYZE gene_burden_summary:',
        e instanceof Error ? e.message : String(e)
      )
    }

    const response: RebuildWorkerResponse = { type: 'complete' }
    port.postMessage(response)
  } catch (error) {
    const response: RebuildWorkerResponse = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    }
    port.postMessage(response)
  } finally {
    if (db) {
      try {
        db.close()
      } catch (e) {
        console.warn(
          '[rebuild-summary-worker] Failed to close database:',
          e instanceof Error ? e.message : String(e)
        )
      }
    }
  }
})
