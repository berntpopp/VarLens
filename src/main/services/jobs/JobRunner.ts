import { toSerializableError } from '../../ipc/errorHandler'
import type { SerializableError } from '../../../shared/types/errors'
import type { Job, JobKind } from './types'

/**
 * Context handed to every job handler. The {@link AbortController} is owned by
 * {@link JobRunner}; handlers receive only the read-only signal plus a hook to
 * register teardown callbacks that fire on cancellation.
 */
export interface JobContext {
  signal: AbortSignal
  registerCancel(fn: () => void | Promise<void>): void
  /**
   * Publish a progress snapshot on the tracked job and notify lifecycle
   * listeners (which forward it to the renderer as `jobs:changed`).
   */
  reportProgress(current: number, total: number, message?: string): void
}

/**
 * Synchronously-returned handle for an enqueued job. `result` is the only async
 * surface, so call sites preserve their existing return types via
 * `(await handle.result)`.
 */
export interface JobHandle<R> {
  id: string
  kind: JobKind
  result: Promise<R>
}

/**
 * Per-kind single-flight error messages. These are copied verbatim from the
 * existing wire-site guards so behaviour is identical when the JobRunner is
 * wired into the import/cohort/export paths.
 */
const SINGLE_FLIGHT_MESSAGES: Record<JobKind, string> = {
  import_single: 'An import is already in progress',
  import_batch: 'A batch import is already in progress',
  cohort_rebuild: 'A cohort rebuild is already running',
  association: 'An association analysis is already running',
  export: 'An export is already in progress',
  case_delete: 'A delete operation is already in progress. Please wait for it to finish.'
}

type Listener = (job: Job) => void

// Crockford base32 alphabet (ULID spec) — chronologically sortable.
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let lastIdTime = 0
let lastIdSeq = 0

/**
 * Minimal monotonic, chronologically-sortable id generator. Avoids adding a
 * runtime dependency while preserving the ULID-style sort guarantee documented
 * on {@link Job.id}: the time prefix increases monotonically and a per-ms
 * sequence counter breaks ties within the same millisecond.
 */
function generateId(): string {
  let now = Date.now()
  if (now > lastIdTime) {
    lastIdTime = now
    lastIdSeq = 0
  } else {
    // Same (or clock-skewed-back) ms: keep time monotonic, bump the sequence.
    now = lastIdTime
    lastIdSeq += 1
  }
  let timePart = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    timePart = ULID_ALPHABET[t % 32] + timePart
    t = Math.floor(t / 32)
  }
  let seqPart = ''
  let s = lastIdSeq
  for (let i = 0; i < 6; i++) {
    seqPart = ULID_ALPHABET[s % 32] + seqPart
    s = Math.floor(s / 32)
  }
  return timePart + seqPart
}

/**
 * Tracking wrapper around long-running main-process jobs (import, cohort
 * rebuild, association, export). It owns lifecycle bookkeeping, per-kind
 * single-flight gating, and AbortController-based cancellation. It does NOT
 * intercept progress — existing emitters keep firing through their own paths.
 *
 * Sprint A scope (D2): tracking only. Normalised progress, concurrency cap and
 * persistence are deferred to Sprint C.
 */
export class JobRunner {
  private jobs = new Map<string, Job>()
  private inFlight = new Map<JobKind, Promise<unknown>>()
  private cancelHandlers = new Map<string, Array<() => void | Promise<void>>>()
  private controllers = new Map<string, AbortController>()
  private listeners: Listener[] = []

  /**
   * Enqueue a job. Returns SYNCHRONOUSLY: the single-flight check,
   * AbortController creation and handler kickoff all run inline; only
   * {@link JobHandle.result} is async.
   */
  enqueue<P, R>(
    kind: JobKind,
    params: P,
    handler: (ctx: JobContext, params: P) => Promise<R>
  ): JobHandle<R> {
    if (this.inFlight.has(kind)) {
      throw new Error(SINGLE_FLIGHT_MESSAGES[kind])
    }
    const id = generateId()
    const controller = new AbortController()
    const cancelFns: Array<() => void | Promise<void>> = []
    this.controllers.set(id, controller)
    this.cancelHandlers.set(id, cancelFns)
    const job: Job<P> = {
      id,
      kind,
      status: 'queued',
      params,
      progress: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null
    }
    const ctx: JobContext = {
      signal: controller.signal,
      registerCancel: (fn) => {
        cancelFns.push(fn)
      },
      reportProgress: (current, total, message) => {
        if (job.status !== 'running') return
        job.progress = message === undefined ? { current, total } : { current, total, message }
        this.fireLifecycle(job)
      }
    }
    this.jobs.set(id, job)
    this.fireLifecycle(job)

    job.status = 'running'
    job.startedAt = Date.now()
    this.fireLifecycle(job)

    const resultPromise = handler(ctx, params)
      .then((r) => {
        job.status = 'completed'
        job.finishedAt = Date.now()
        this.fireLifecycle(job)
        return r
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          job.status = 'cancelled'
        } else {
          job.status = 'failed'
          job.error = toSerializableError(err)
        }
        job.finishedAt = Date.now()
        this.fireLifecycle(job)
        throw err
      })
      .finally(() => {
        this.inFlight.delete(kind)
        this.controllers.delete(id)
        this.cancelHandlers.delete(id)
      })

    this.inFlight.set(kind, resultPromise)
    return { id, kind, result: resultPromise }
  }

  /**
   * Cancel a job: abort its signal, then await every registered cancel
   * callback. Cancellation is best-effort — callback failures are swallowed.
   */
  async cancel(jobId: string): Promise<void> {
    const controller = this.controllers.get(jobId)
    if (!controller) return
    controller.abort()
    const fns = this.cancelHandlers.get(jobId) ?? []
    for (const fn of fns) {
      try {
        await fn()
      } catch {
        /* swallow — cancellation is best-effort */
      }
    }
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId)
  }

  list(filter?: { kind?: JobKind; status?: Job['status'] }): Job[] {
    let result = [...this.jobs.values()]
    if (filter?.kind) result = result.filter((j) => j.kind === filter.kind)
    if (filter?.status) result = result.filter((j) => j.status === filter.status)
    return result
  }

  onLifecycle(listener: Listener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private fireLifecycle(job: Job): void {
    for (const l of this.listeners) {
      try {
        l(job)
      } catch {
        /* swallow — a misbehaving listener must not break job tracking */
      }
    }
  }
}

// Re-exported for callers that need the serialized error shape alongside jobs.
export type { SerializableError }
