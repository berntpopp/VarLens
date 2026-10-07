/**
 * Web `batchImport.start`: the server accepts the batch and answers at once
 * with a job id (src/web/server/batch-import-runs.ts); the request is not
 * held open for the batch. The caller still gets a promise of the result, as
 * on desktop. It settles from whichever arrives first:
 *
 *   - `batch-import:complete` for this run id (the result)
 *   - `batch-import:failed` for this run id (the error envelope)
 *   - a `batch-import:status` poll: once whenever the event stream reports it
 *     could not replay what was missed, and on a slow timer in case the
 *     stream died quietly. A poll that is refused (signed out, role removed)
 *     settles the promise with that error, and so do five failed polls in a
 *     row: the caller is never left waiting forever.
 *
 * A reload loses this promise but not the batch: the job keeps running, shows
 * up in the jobs list, can be cancelled there, and its result stays readable
 * through the status call.
 */
import { EVENTS_RESYNC_DOM_EVENT } from '../../shared/ipc/domains/jobs'
import type { BatchResult, DuplicateChoice } from '../../shared/types/api'
import {
  ErrorCode,
  isIpcError,
  type IpcResult,
  type SerializableError
} from '../../shared/types/errors'

/** Safety-net poll while a batch runs; events normally settle it long before. */
export const BATCH_STATUS_POLL_MS = 15_000

type Invoke = (domain: string, method: string, args: unknown[]) => Promise<unknown>
type Subscribe = <T>(type: string, callback: (payload: T) => void) => () => void

interface RunStatus {
  state: 'running' | 'completed' | 'failed' | 'unknown'
  result?: BatchResult
  error?: SerializableError
}

function isAccepted(value: unknown): value is { accepted: true; jobId: string; runId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { accepted?: unknown }).accepted === true
  )
}

const LOST_RUN: SerializableError = {
  code: ErrorCode.UNKNOWN,
  message: 'batch import run is no longer known to the server',
  userMessage:
    'The server no longer knows this import (it may have restarted). Check the case list and import the missing files again.'
}

/** The batch itself is not affected by any of these; only this page stopped following it. */
const STILL_RUNNING =
  'The import may still be running on the server: check the background tasks and the case list.'

const UNREADABLE_RUN: SerializableError = {
  code: ErrorCode.UNKNOWN,
  message: 'batch import status could not be read',
  userMessage: `The state of this import could not be read from the server. ${STILL_RUNNING}`
}

const AUTH_CODES = new Set<string>([ErrorCode.UNAUTHENTICATED, ErrorCode.FORBIDDEN])
/** Consecutive failed status polls after which the promise settles with an error. */
export const MAX_FAILED_POLLS = 5

/** A 401/403 that came back without an error envelope (the transport throws those). */
function authErrorFromTransport(error: unknown): SerializableError | null {
  const status = /: (401|403) /.exec(error instanceof Error ? error.message : '')?.[1]
  if (status === undefined) return null
  const signedOut = status === '401'
  return {
    code: signedOut ? ErrorCode.UNAUTHENTICATED : ErrorCode.FORBIDDEN,
    message: `batch import status refused with HTTP ${status}`,
    userMessage: `${signedOut ? 'You were signed out' : 'You are no longer allowed to follow this import'}. ${STILL_RUNNING}`
  }
}

export async function startBatchImportRun(
  args: [string[], DuplicateChoice, string | undefined, string],
  deps: { invoke: Invoke; subscribe: Subscribe; pollMs?: number }
): Promise<IpcResult<BatchResult>> {
  const runId = args[3]
  let settle: (value: IpcResult<BatchResult>) => void = () => undefined
  const settled = new Promise<IpcResult<BatchResult>>((resolve) => {
    settle = resolve
  })

  // Subscribe before starting: a small batch can finish before the start
  // call has returned.
  const unsubscribe = [
    deps.subscribe<BatchResult & { runId?: string }>('batch-import:complete', (payload) => {
      if (payload.runId !== runId) return
      const result: BatchResult & { runId?: string } = { ...payload }
      delete result.runId
      settle(result)
    }),
    deps.subscribe<{ runId?: string; error?: SerializableError }>(
      'batch-import:failed',
      (payload) => {
        if (payload.runId === runId) settle(payload.error ?? LOST_RUN)
      }
    )
  ]

  let polling = false
  let failedPolls = 0
  const pollFailed = (): void => {
    failedPolls++
    if (failedPolls >= MAX_FAILED_POLLS) settle(UNREADABLE_RUN)
  }
  const poll = async (): Promise<void> => {
    if (polling) return
    polling = true
    try {
      const status = (await deps.invoke('batch-import', 'status', [runId])) as RunStatus
      if (isIpcError(status)) {
        // Signed out or demoted while the batch runs: no later poll can succeed.
        if (AUTH_CODES.has(status.code)) settle(status)
        else pollFailed()
        return
      }
      failedPolls = 0
      if (status.state === 'completed' && status.result !== undefined) settle(status.result)
      else if (status.state === 'failed') settle(status.error ?? LOST_RUN)
      else if (status.state === 'unknown') settle(LOST_RUN)
    } catch (error) {
      const denied = authErrorFromTransport(error)
      if (denied !== null) settle(denied)
      // Offline or the server is restarting: later polls or an event decide,
      // but not forever.
      else pollFailed()
    } finally {
      polling = false
    }
  }
  const onResync = (): void => void poll()
  let timer: ReturnType<typeof setInterval> | undefined
  const cleanup = (): void => {
    for (const off of unsubscribe) off()
    if (timer !== undefined) clearInterval(timer)
    if (typeof window !== 'undefined') window.removeEventListener(EVENTS_RESYNC_DOM_EVENT, onResync)
  }

  try {
    const started = await deps.invoke('batch-import', 'start', args)
    // Refused (validation, another import running, role): nothing was started.
    if (!isAccepted(started)) return started as IpcResult<BatchResult>
    timer = setInterval(() => void poll(), deps.pollMs ?? BATCH_STATUS_POLL_MS)
    if (typeof window !== 'undefined') window.addEventListener(EVENTS_RESYNC_DOM_EVENT, onResync)
    return await settled
  } finally {
    cleanup()
  }
}
