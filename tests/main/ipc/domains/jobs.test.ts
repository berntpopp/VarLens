/**
 * Tests for the `jobs:` IPC domain Zod validation (F-path, Part B / Codex F-03).
 *
 * jobs:list/get/progress read from an in-memory Map keyed by job id, but the
 * repo convention is to validate every IPC arg at the boundary. Mirrors the
 * debug IPC domain test's strategy: mock `electron.ipcMain.handle` to capture
 * the registered callbacks and invoke them directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

const list = vi.fn()
const get = vi.fn()
vi.mock('../../../../src/main/services/jobs/runner', () => ({
  jobRunner: {
    list: (...args: unknown[]) => list(...args),
    get: (...args: unknown[]) => get(...args)
  }
}))

import { ipcMain } from 'electron'
import { registerJobsHandlers } from '../../../../src/main/ipc/domains/jobs'
import { JOBS_CHANNELS } from '../../../../src/shared/ipc/domains/jobs'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function getHandler(channel: string): HandlerCallback {
  const mockedHandle = ipcMain.handle as unknown as {
    mock: { calls: Array<[string, HandlerCallback]> }
  }
  const call = mockedHandle.mock.calls.find(([c]) => c === channel)
  if (!call) throw new Error(`No handler registered for channel: ${channel}`)
  return call[1]
}

function expectInvalidParametersResult(result: unknown): void {
  expect(isIpcError(result)).toBe(true)
  if (isIpcError(result)) {
    expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
  }
}

describe('jobs IPC domain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('jobs:list', () => {
    it('returns INVALID_PARAMETERS for a malformed filter', async () => {
      registerJobsHandlers()
      const handler = getHandler(JOBS_CHANNELS.list)

      const result = await handler({}, { kind: 'not_a_real_kind' })

      expectInvalidParametersResult(result)
      expect(list).not.toHaveBeenCalled()
    })

    it('passes a well-formed filter through to jobRunner.list', async () => {
      list.mockReturnValue([])
      registerJobsHandlers()
      const handler = getHandler(JOBS_CHANNELS.list)

      const result = await handler({}, { kind: 'import_batch', status: 'running' })

      expect(result).toEqual([])
      expect(list).toHaveBeenCalledWith({ kind: 'import_batch', status: 'running' })
    })

    it('accepts an absent filter', async () => {
      list.mockReturnValue([])
      registerJobsHandlers()
      const handler = getHandler(JOBS_CHANNELS.list)

      const result = await handler({})

      expect(result).toEqual([])
      expect(list).toHaveBeenCalledWith(undefined)
    })
  })

  describe('jobs:get', () => {
    it('returns INVALID_PARAMETERS for a non-string jobId', async () => {
      registerJobsHandlers()
      const handler = getHandler(JOBS_CHANNELS.get)

      const result = await handler({}, 12345)

      expectInvalidParametersResult(result)
      expect(get).not.toHaveBeenCalled()
    })

    it('returns INVALID_PARAMETERS for an empty jobId', async () => {
      registerJobsHandlers()
      const handler = getHandler(JOBS_CHANNELS.get)

      const result = await handler({}, '')

      expectInvalidParametersResult(result)
      expect(get).not.toHaveBeenCalled()
    })

    it('passes a valid jobId through to jobRunner.get', async () => {
      get.mockReturnValue({ id: 'job-1' })
      registerJobsHandlers()
      const handler = getHandler(JOBS_CHANNELS.get)

      const result = await handler({}, 'job-1')

      expect(result).toEqual({ id: 'job-1' })
      expect(get).toHaveBeenCalledWith('job-1')
    })
  })

  describe('jobs:progress', () => {
    it('returns INVALID_PARAMETERS for a non-string jobId', async () => {
      registerJobsHandlers()
      const handler = getHandler(JOBS_CHANNELS.progress)

      const result = await handler({}, { not: 'a string' })

      expectInvalidParametersResult(result)
      expect(get).not.toHaveBeenCalled()
    })

    it('returns the progress snapshot for a valid jobId', async () => {
      get.mockReturnValue({ id: 'job-1', progress: { current: 1, total: 2 } })
      registerJobsHandlers()
      const handler = getHandler(JOBS_CHANNELS.progress)

      const result = await handler({}, 'job-1')

      expect(result).toEqual({ current: 1, total: 2 })
    })
  })
})
