/**
 * In-memory registry of web background jobs (contract:
 * src/shared/types/background-job.ts).
 *
 * The registry is the status source for `jobs:get` / `jobs:list`; durable
 * progress lives in the database the job operates on (e.g. a case's
 * import_status='deleting'), so a restart loses only the job *record*, never
 * the work — runners re-create jobs for unfinished work at boot.
 *
 * Terminal jobs are kept for `retentionMs` (default 15 min) and at most
 * `maxRetained` of them, so late pollers still see the outcome.
 */
import { randomUUID } from 'node:crypto'

import {
  type BackgroundJob,
  type BackgroundJobKind,
  type BackgroundJobSubject,
  isTerminalJobStatus
} from '../../../shared/types/background-job'

const DEFAULT_RETENTION_MS = 15 * 60 * 1000
const DEFAULT_MAX_RETAINED = 200

export type BackgroundJobPatch = Partial<
  Pick<BackgroundJob, 'status' | 'progress' | 'error' | 'startedAt' | 'finishedAt'>
>

export type BackgroundJobListener = (job: BackgroundJob, ownerUserId: number | undefined) => void

interface JobRecord {
  job: BackgroundJob
  ownerUserId: number | undefined
}

export class BackgroundJobRegistry {
  private readonly records = new Map<string, JobRecord>()
  private readonly listeners = new Set<BackgroundJobListener>()
  private readonly retentionMs: number
  private readonly maxRetained: number
  private readonly now: () => number

  constructor(options: { retentionMs?: number; maxRetained?: number; now?: () => number } = {}) {
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
    this.maxRetained = options.maxRetained ?? DEFAULT_MAX_RETAINED
    this.now = options.now ?? Date.now
  }

  create(
    kind: BackgroundJobKind,
    subject: BackgroundJobSubject,
    ownerUserId?: number
  ): BackgroundJob {
    this.prune()
    const job: BackgroundJob = {
      id: randomUUID(),
      kind,
      status: 'queued',
      subject,
      progress: { phase: 'queued', done: 0, total: null },
      createdAt: this.now()
    }
    this.records.set(job.id, { job, ownerUserId })
    this.emit(job.id)
    return { ...job }
  }

  update(id: string, patch: BackgroundJobPatch): BackgroundJob | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    record.job = { ...record.job, ...patch }
    this.emit(id)
    return { ...record.job }
  }

  get(id: string): BackgroundJob | undefined {
    this.prune()
    const record = this.records.get(id)
    return record === undefined ? undefined : { ...record.job }
  }

  /** Newest first. */
  list(filter: { kind?: BackgroundJobKind; activeOnly?: boolean } = {}): BackgroundJob[] {
    this.prune()
    return [...this.records.values()]
      .map((record) => record.job)
      .filter((job) => filter.kind === undefined || job.kind === filter.kind)
      .filter((job) => filter.activeOnly !== true || !isTerminalJobStatus(job.status))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((job) => ({ ...job }))
  }

  /** The non-terminal job for a subject, if any (dedupes repeated starts). */
  findActive(kind: BackgroundJobKind, subject: BackgroundJobSubject): BackgroundJob | undefined {
    for (const { job } of this.records.values()) {
      if (
        job.kind === kind &&
        job.subject.type === subject.type &&
        job.subject.id === subject.id &&
        !isTerminalJobStatus(job.status)
      ) {
        return { ...job }
      }
    }
    return undefined
  }

  onUpdate(listener: BackgroundJobListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(id: string): void {
    const record = this.records.get(id)
    if (record === undefined) return
    for (const listener of this.listeners) {
      listener({ ...record.job }, record.ownerUserId)
    }
  }

  private prune(): void {
    const cutoff = this.now() - this.retentionMs
    const terminal: JobRecord[] = []
    for (const [id, record] of this.records) {
      if (!isTerminalJobStatus(record.job.status)) continue
      if ((record.job.finishedAt ?? record.job.createdAt) < cutoff) {
        this.records.delete(id)
      } else {
        terminal.push(record)
      }
    }
    if (terminal.length <= this.maxRetained) return
    terminal
      .sort((a, b) => (a.job.finishedAt ?? 0) - (b.job.finishedAt ?? 0))
      .slice(0, terminal.length - this.maxRetained)
      .forEach((record) => this.records.delete(record.job.id))
  }
}
