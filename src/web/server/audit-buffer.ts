/**
 * Buffered, batched writer for high-volume web audit rows.
 *
 * Every authenticated read used to `await` its own `INSERT INTO audit_log`
 * before the response went out — one extra pool round-trip per request
 * (05-blocking-analysis.md, W-5). Read-audit rows (`api_read`) now go through
 * this buffer instead: they are appended in memory and written with one
 * multi-row INSERT when either
 *
 *   - `maxBatchSize` rows are pending (size trigger), or
 *   - `flushIntervalMs` has elapsed since the first pending row (time trigger), or
 *   - the server shuts down (`close()`, wired into Fastify's onClose hook, so
 *     SIGTERM/SIGINT drain the buffer before the pool closes).
 *
 * Durability contract:
 *   - Mutation and authentication audits are NOT buffered — they stay
 *     synchronous and fail the request when the audit insert fails.
 *   - A failed flush puts the batch back at the head of the queue and retries
 *     on the next tick; rows are never dropped while the process lives.
 *   - Backpressure: when `maxPending` rows are queued (e.g. Postgres is down),
 *     `enqueue()` awaits a flush instead of growing memory without bound.
 *   - The only loss window is a hard kill (SIGKILL / OOM) within
 *     `flushIntervalMs` of the request.
 */
import type { AuditAppendParams } from '../../main/storage/audit-log-types'

export const AUDIT_FLUSH_INTERVAL_ENV = 'VARLENS_AUDIT_FLUSH_INTERVAL_MS'
export const AUDIT_BATCH_SIZE_ENV = 'VARLENS_AUDIT_BATCH_SIZE'
export const DEFAULT_AUDIT_FLUSH_INTERVAL_MS = 250
export const DEFAULT_AUDIT_BATCH_SIZE = 200
const DEFAULT_MAX_PENDING = 10_000
const CLOSE_FLUSH_ATTEMPTS = 3

/** An audit row plus the epoch-ms time the audited request happened. */
export type BufferedAuditRow = AuditAppendParams & { occurred_at?: number }

export type AuditSink = (rows: BufferedAuditRow[]) => Promise<void>

export interface AuditBufferLogger {
  warn: (obj: object, msg?: string) => void
  error: (obj: object, msg?: string) => void
}

export interface AuditBufferOptions {
  sink: AuditSink
  flushIntervalMs?: number
  maxBatchSize?: number
  maxPending?: number
  logger?: AuditBufferLogger
}

export class AuditBuffer {
  private readonly sink: AuditSink
  private readonly flushIntervalMs: number
  private readonly maxBatchSize: number
  private readonly maxPending: number
  private readonly logger: AuditBufferLogger | undefined
  private pending: BufferedAuditRow[] = []
  private timer: NodeJS.Timeout | undefined
  private flushing: Promise<void> | undefined
  private closed = false

  constructor(options: AuditBufferOptions) {
    this.sink = options.sink
    this.flushIntervalMs = Math.max(1, options.flushIntervalMs ?? DEFAULT_AUDIT_FLUSH_INTERVAL_MS)
    this.maxBatchSize = Math.max(1, options.maxBatchSize ?? DEFAULT_AUDIT_BATCH_SIZE)
    this.maxPending = Math.max(this.maxBatchSize, options.maxPending ?? DEFAULT_MAX_PENDING)
    this.logger = options.logger
  }

  get pendingCount(): number {
    return this.pending.length
  }

  /**
   * Queue one row. Resolves immediately in the common case; awaits a flush
   * only when the queue is at `maxPending` (backpressure) or after `close()`
   * (late rows are written straight through).
   */
  async enqueue(row: BufferedAuditRow): Promise<void> {
    if (this.closed) {
      await this.sink([row])
      return
    }
    if (this.pending.length >= this.maxPending) {
      await this.flush()
      if (this.pending.length >= this.maxPending) {
        // Postgres is still refusing writes: surface the failure to this
        // request rather than buffering without bound.
        await this.sink([row])
        return
      }
    }
    this.pending.push(row)
    if (this.pending.length >= this.maxBatchSize) {
      void this.flush()
    } else {
      this.schedule()
    }
  }

  /** Write everything queued so far. Single-flight; errors are logged, not thrown. */
  async flush(): Promise<void> {
    while (this.flushing !== undefined) {
      await this.flushing
    }
    if (this.pending.length === 0) return
    this.clearTimer()
    const run = this.drain()
    this.flushing = run
    try {
      await run
    } finally {
      if (this.flushing === run) this.flushing = undefined
      if (this.pending.length > 0 && !this.closed) this.schedule()
    }
  }

  /** Stop the timer and drain the queue (retrying a few times) before shutdown. */
  async close(): Promise<void> {
    this.closed = true
    this.clearTimer()
    for (let attempt = 0; attempt < CLOSE_FLUSH_ATTEMPTS && this.pending.length > 0; attempt++) {
      await this.flush()
    }
    if (this.pending.length > 0) {
      this.logger?.error(
        { event: 'audit-buffer', action: 'close-flush-failed', lostRows: this.pending.length },
        'audit buffer could not be drained during shutdown'
      )
    }
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0, this.maxBatchSize)
      try {
        await this.sink(batch)
      } catch (error) {
        this.pending = batch.concat(this.pending)
        this.logger?.warn(
          {
            event: 'audit-buffer',
            action: 'flush-failed',
            pendingRows: this.pending.length,
            err: error instanceof Error ? { message: error.message } : String(error)
          },
          'audit buffer flush failed; will retry'
        )
        return
      }
    }
  }

  private schedule(): void {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.flushIntervalMs)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }
}

function readBoundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw.trim())
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}; got ${raw}`)
  }
  return value
}

/**
 * Resolve buffer settings from env. `VARLENS_AUDIT_FLUSH_INTERVAL_MS=0`
 * disables buffering (every read audit is written synchronously, the
 * pre-2026-10 behaviour) and returns `null`.
 */
export function resolveAuditBufferSettings(
  env: NodeJS.ProcessEnv = process.env
): { flushIntervalMs: number; maxBatchSize: number } | null {
  const flushIntervalMs = readBoundedInteger(
    env,
    AUDIT_FLUSH_INTERVAL_ENV,
    DEFAULT_AUDIT_FLUSH_INTERVAL_MS,
    0,
    10_000
  )
  if (flushIntervalMs === 0) return null
  const maxBatchSize = readBoundedInteger(
    env,
    AUDIT_BATCH_SIZE_ENV,
    DEFAULT_AUDIT_BATCH_SIZE,
    1,
    1000
  )
  return { flushIntervalMs, maxBatchSize }
}
