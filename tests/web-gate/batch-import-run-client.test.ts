/**
 * Web client side of the job-based batch start (src/web/client/batch-import-run.ts):
 * `window.api.batchImport.start` still resolves with the batch result although
 * the HTTP call that starts it returns at once.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { EVENTS_RESYNC_DOM_EVENT } from '../../src/shared/ipc/domains/jobs'
import { ErrorCode } from '../../src/shared/types/errors'
import { startBatchImportRun } from '../../src/web/client/batch-import-run'

const RESULT = { succeeded: 2, failed: 0, skipped: 0, cancelled: false, details: [] }
const ARGS: [string[], 'skip', undefined, string] = [['web-upload:a'], 'skip', undefined, 'run-1']

function harness(statuses: unknown[] = []): {
  invoke: ReturnType<typeof vi.fn>
  subscribe: <T>(type: string, callback: (payload: T) => void) => () => void
  emit: (type: string, payload: unknown) => void
  listenerCount: () => number
  accept: () => void
  refuse: (value: unknown) => void
} {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let answerStart: (value: unknown) => void = () => undefined
  const started = new Promise<unknown>((resolve) => {
    answerStart = resolve
  })
  const invoke = vi.fn(async (_domain: string, method: string) => {
    if (method === 'start') return started
    return statuses.length > 1 ? statuses.shift() : statuses[0]
  })
  return {
    invoke,
    subscribe: (type, callback) => {
      const set = listeners.get(type) ?? new Set()
      listeners.set(type, set)
      set.add(callback as (payload: unknown) => void)
      return () => set.delete(callback as (payload: unknown) => void)
    },
    emit: (type, payload) => listeners.get(type)?.forEach((listener) => listener(payload)),
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    accept: () => answerStart({ accepted: true, jobId: 'job-1', runId: 'run-1' }),
    refuse: (value) => answerStart(value)
  }
}

describe('startBatchImportRun', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('resolves with the result of the completion event of its own run', async () => {
    const h = harness()
    const pending = startBatchImportRun(ARGS, h)
    h.accept()
    await vi.advanceTimersByTimeAsync(0)

    // Somebody else's (or an earlier) run does not settle this one.
    h.emit('batch-import:complete', { ...RESULT, succeeded: 9, runId: 'other-run' })
    h.emit('batch-import:complete', { ...RESULT, runId: 'run-1' })

    await expect(pending).resolves.toEqual(RESULT)
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.invoke).toHaveBeenCalledWith('batch-import', 'start', ARGS)
    expect(h.listenerCount()).toBe(0)
  })

  test('does not miss a batch that finishes before the start call returns', async () => {
    const h = harness()
    const pending = startBatchImportRun(ARGS, h)
    h.emit('batch-import:complete', { ...RESULT, runId: 'run-1' })
    h.accept()
    await expect(pending).resolves.toEqual(RESULT)
  })

  test('returns a refusal unchanged and stops listening', async () => {
    const refusal = {
      code: ErrorCode.VALIDATION,
      message: 'busy',
      userMessage: 'An import is running.'
    }
    const h = harness()
    const pending = startBatchImportRun(ARGS, h)
    h.refuse(refusal)
    await expect(pending).resolves.toBe(refusal)
    expect(h.listenerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.invoke).toHaveBeenCalledTimes(1)
  })

  test('resolves with the error of a failed run', async () => {
    const error = { code: ErrorCode.UNKNOWN, message: 'boom', userMessage: 'Import failed.' }
    const h = harness()
    const pending = startBatchImportRun(ARGS, h)
    h.accept()
    await vi.advanceTimersByTimeAsync(0)
    h.emit('batch-import:failed', { runId: 'run-1', jobId: 'job-1', error })
    await expect(pending).resolves.toEqual(error)
  })

  test('asks for the status when the event stream could not replay what was missed', async () => {
    const h = harness([
      { state: 'running', jobId: 'job-1' },
      { state: 'completed', jobId: 'job-1', result: RESULT }
    ])
    const pending = startBatchImportRun(ARGS, h)
    h.accept()
    await vi.advanceTimersByTimeAsync(0)

    window.dispatchEvent(new Event(EVENTS_RESYNC_DOM_EVENT))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.invoke).toHaveBeenLastCalledWith('batch-import', 'status', ['run-1'])

    window.dispatchEvent(new Event(EVENTS_RESYNC_DOM_EVENT))
    await expect(pending).resolves.toEqual(RESULT)
  })

  test('polls on a slow timer in case the stream died quietly', async () => {
    const h = harness([
      { state: 'running', jobId: 'job-1' },
      { state: 'completed', jobId: 'job-1', result: RESULT }
    ])
    const pending = startBatchImportRun(ARGS, { ...h, pollMs: 1000 })
    h.accept()
    await vi.advanceTimersByTimeAsync(999)
    expect(h.invoke).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.invoke).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toEqual(RESULT)
    // Settled: no further polls.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.invoke).toHaveBeenCalledTimes(3)
  })

  test('keeps waiting through a failed poll and reports a run the server lost', async () => {
    const h = harness()
    h.invoke.mockImplementation(async (_domain: string, method: string) => {
      if (method === 'start') return { accepted: true, jobId: 'job-1', runId: 'run-1' }
      if (h.invoke.mock.calls.length === 2) throw new Error('network down')
      return { state: 'unknown' }
    })
    const pending = startBatchImportRun(ARGS, { ...h, pollMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toMatchObject({
      code: ErrorCode.UNKNOWN,
      userMessage: expect.stringContaining('no longer knows this import')
    })
  })
  describe('a status poll that fails', () => {
    function pollingWith(answer: () => unknown): {
      pending: ReturnType<typeof startBatchImportRun>
      invoke: ReturnType<typeof vi.fn>
    } {
      const h = harness()
      h.invoke.mockImplementation(async (_domain: string, method: string) => {
        if (method === 'start') return { accepted: true, jobId: 'job-1', runId: 'run-1' }
        return answer()
      })
      return { pending: startBatchImportRun(ARGS, { ...h, pollMs: 1000 }), invoke: h.invoke }
    }

    test.each([
      ['an expired session (error envelope)', ErrorCode.UNAUTHENTICATED],
      ['a role that no longer allows it (error envelope)', ErrorCode.FORBIDDEN]
    ])('settles at once on %s', async (_, code) => {
      const denied = { code, message: 'denied', userMessage: 'Please sign in again.' }
      const { pending, invoke } = pollingWith(() => denied)
      await vi.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toEqual(denied)
      // Settled: the wizard is not left spinning and nothing polls on.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(invoke).toHaveBeenCalledTimes(2)
    })

    test.each([401, 403])('settles at once on a bare HTTP %i', async (status) => {
      const { pending } = pollingWith(() => {
        throw new Error(`web rpc batch-import.status: ${status} Denied: `)
      })
      await vi.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toMatchObject({
        code: status === 401 ? ErrorCode.UNAUTHENTICATED : ErrorCode.FORBIDDEN,
        userMessage: expect.stringContaining('may still be running')
      })
    })

    test('gives up after five consecutive failures of any other kind', async () => {
      let calls = 0
      const { pending, invoke } = pollingWith(() => {
        calls++
        if (calls % 2 === 0) throw new Error('network down')
        return { code: ErrorCode.UNKNOWN, message: 'boom', userMessage: 'Server error.' }
      })
      await vi.advanceTimersByTimeAsync(4000)
      let settled = false
      void pending.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toMatchObject({
        code: ErrorCode.UNKNOWN,
        userMessage: expect.stringContaining('could not be read')
      })
      expect(invoke).toHaveBeenCalledTimes(6)
    })

    test('a successful poll resets the failure count', async () => {
      let calls = 0
      const { pending } = pollingWith(() => {
        calls++
        if (calls === 4) return { state: 'running', jobId: 'job-1' }
        if (calls === 9) return { state: 'completed', jobId: 'job-1', result: RESULT }
        throw new Error('network down')
      })
      await vi.advanceTimersByTimeAsync(9000)
      await expect(pending).resolves.toEqual(RESULT)
    })
  })
})
