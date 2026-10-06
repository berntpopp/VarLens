/**
 * Shared state for long-running background jobs (import, batch import,
 * export, case deletion, cohort rebuild, association) — the renderer side of
 * the backend-neutral `jobs:` contract (src/shared/ipc/domains/jobs.ts).
 *
 * Desktop pushes `jobs:changed` over IPC, web over SSE; both are hints.
 * Polling `jobs:list` is the source of truth (parity spec §4.5), so the state
 * also refreshes every few seconds while a job is active and whenever the web
 * client reports that missed events could not be replayed.
 *
 * Module-level singleton: every view (case, cohort, case list, settings)
 * shares one subscription and one list.
 */
import { computed, ref } from 'vue'

import { EVENTS_RESYNC_DOM_EVENT } from '../../../shared/ipc/domains/jobs'
import { unwrapIpcResult } from '../../../shared/types/errors'
import type { Job, JobKind, JobStatus } from '../../../shared/types/jobs'
import { logService } from '../services/LogService'
import { formatError } from '../utils/ipc-result'
import { useApiService } from './useApiService'

const ACTIVE: ReadonlySet<JobStatus> = new Set(['queued', 'running'])
const POLL_MS = 3000
/** How long a finished job stays visible before it is dismissed automatically. */
export const FINISHED_JOB_TTL_MS = 8000

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  import_single: 'Import',
  import_batch: 'Batch import',
  export: 'Export',
  case_delete: 'Deleting cases',
  cohort_rebuild: 'Cohort summary rebuild',
  association: 'Association analysis'
}

const PHASE_LABELS: Record<string, string> = {
  deleting: 'Deleting',
  'rebuilding-search-index': 'Rebuilding search index',
  'rebuilding-cohort-summary': 'Rebuilding cohort summary',
  finalizing: 'Finalizing'
}

export function isActiveJob(job: Pick<Job, 'status'>): boolean {
  return ACTIVE.has(job.status)
}

/** Percent 0–100, or null when the job reports no total (indeterminate). */
export function jobPercent(job: Pick<Job, 'progress'>): number | null {
  const progress = job.progress
  if (progress === null || progress.total <= 0) return null
  return Math.min(100, Math.round((progress.current / progress.total) * 100))
}

/** One-line human status for a job. */
export function describeJob(job: Job): string {
  if (job.status === 'completed') return 'Completed'
  if (job.status === 'cancelled') return 'Cancelled'
  if (job.status === 'failed') return `Failed: ${formatError(job.error, 'unknown error')}`
  if (job.status === 'queued' || job.progress === null) return 'Starting…'
  const { current, total, message } = job.progress
  const phase = message === undefined ? undefined : (PHASE_LABELS[message] ?? message)
  const unit = job.kind === 'case_delete' ? ' cases' : job.kind === 'import_batch' ? ' files' : ''
  const count =
    total > 0
      ? `${current.toLocaleString()} of ${total.toLocaleString()}${unit}`
      : current > 0
        ? `${current.toLocaleString()} processed`
        : undefined
  return [phase, count].filter((part) => part !== undefined).join(' · ') || 'Working…'
}

const jobs = ref<Job[]>([])
const dismissed = new Set<string>()
const cancelErrors = ref<Record<string, string>>({})
const cancelling = ref<Record<string, boolean>>({})
let started = false
let unsubscribeChanged: (() => void) | null = null
const onResync = (): void => void refresh()
let pollTimer: ReturnType<typeof setInterval> | null = null
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleDismiss(jobId: string): void {
  if (dismissTimers.has(jobId)) return
  dismissTimers.set(
    jobId,
    setTimeout(() => dismiss(jobId), FINISHED_JOB_TTL_MS)
  )
}

function dismiss(jobId: string): void {
  dismissed.add(jobId)
  const timer = dismissTimers.get(jobId)
  if (timer !== undefined) clearTimeout(timer)
  dismissTimers.delete(jobId)
  jobs.value = jobs.value.filter((job) => job.id !== jobId)
}

/**
 * Merge one snapshot. Unknown finished jobs are ignored (history from before
 * this page loaded); a known job that finishes stays visible briefly.
 */
function upsert(job: Job): void {
  if (dismissed.has(job.id)) return
  const index = jobs.value.findIndex((existing) => existing.id === job.id)
  if (index === -1 && !isActiveJob(job)) return
  const next = [...jobs.value]
  if (index === -1) next.push(job)
  else next[index] = job
  jobs.value = next
  if (!isActiveJob(job)) scheduleDismiss(job.id)
  syncPolling()
}

function syncPolling(): void {
  const anyActive = jobs.value.some(isActiveJob)
  if (anyActive && pollTimer === null) {
    pollTimer = setInterval(() => void refresh(), POLL_MS)
  } else if (!anyActive && pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function refresh(): Promise<void> {
  const { api } = useApiService()
  if (api?.jobs?.list === undefined) return
  try {
    const list = unwrapIpcResult(await api.jobs.list())
    if (Array.isArray(list)) for (const job of list) upsert(job)
  } catch (error) {
    logService.warn(`Failed to refresh background jobs: ${formatError(error)}`, 'jobs')
  }
}

function ensureStarted(): void {
  if (started) return
  const { api } = useApiService()
  if (api?.jobs === undefined) return
  started = true
  unsubscribeChanged = api.jobs.onChanged((job) => upsert(job))
  if (typeof window !== 'undefined') window.addEventListener(EVENTS_RESYNC_DOM_EVENT, onResync)
  void refresh()
}

async function cancel(jobId: string): Promise<void> {
  const { api } = useApiService()
  if (api?.jobs === undefined) return
  cancelling.value = { ...cancelling.value, [jobId]: true }
  const remaining = { ...cancelErrors.value }
  delete remaining[jobId]
  cancelErrors.value = remaining
  try {
    unwrapIpcResult(await api.jobs.cancel(jobId))
  } catch (error) {
    // e.g. 403: the job belongs to another user.
    cancelErrors.value = { ...cancelErrors.value, [jobId]: formatError(error) }
  } finally {
    cancelling.value = { ...cancelling.value, [jobId]: false }
  }
}

/** Test hook: reset the module-level singleton. */
export function resetBackgroundJobsForTesting(): void {
  jobs.value = []
  dismissed.clear()
  cancelErrors.value = {}
  cancelling.value = {}
  started = false
  unsubscribeChanged?.()
  unsubscribeChanged = null
  if (typeof window !== 'undefined') window.removeEventListener(EVENTS_RESYNC_DOM_EVENT, onResync)
  if (pollTimer !== null) clearInterval(pollTimer)
  pollTimer = null
  for (const timer of dismissTimers.values()) clearTimeout(timer)
  dismissTimers.clear()
}

export function useBackgroundJobs(options: { kinds?: readonly JobKind[] } = {}) {
  ensureStarted()
  const visibleJobs = computed(() =>
    options.kinds === undefined
      ? jobs.value
      : jobs.value.filter((job) => options.kinds!.includes(job.kind))
  )
  return {
    jobs: visibleJobs,
    cancelErrors,
    cancelling,
    cancel,
    dismiss,
    refresh,
    /** Exposed for tests and for callers that receive a snapshot directly. */
    upsert
  }
}
