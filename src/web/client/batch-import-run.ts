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
 *     stream died quietly
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
  const poll = async (): Promise<void> => {
    if (polling) return
    polling = true
    try {
      const status = (await deps.invoke('batch-import', 'status', [runId])) as RunStatus
      if (isIpcError(status)) return
      if (status.state === 'completed' && status.result !== undefined) settle(status.result)
      else if (status.state === 'failed') settle(status.error ?? LOST_RUN)
      else if (status.state === 'unknown') settle(LOST_RUN)
    } catch {
      // Offline or the server is restarting: the next poll or event decides.
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
