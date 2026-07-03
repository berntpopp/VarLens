import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getAppPath: vi.fn(() => '/tmp/varlens'),
    getPath: vi.fn(() => '/tmp/varlens-user-data')
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

vi.mock('../../../../src/main/ipc/dbPoolManager', () => ({
  setWorkerThreads: vi.fn(),
  getWorkerThreads: vi.fn(() => 0)
}))

import { registerSystemHandlers } from '../../../../src/main/ipc/handlers/system'
import { setWorkerThreads } from '../../../../src/main/ipc/dbPoolManager'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function makeIpcMain(): { handle: ReturnType<typeof vi.fn> } {
  return {
    handle: vi.fn()
  }
}

function makeDeps(ipcMain: { handle: ReturnType<typeof vi.fn> }): {
  ipcMain: typeof ipcMain
  getDb: () => unknown
  getDbManager: () => unknown
} {
  return {
    ipcMain,
    getDb: vi.fn(),
    getDbManager: vi.fn()
  }
}

function getHandler(
  ipcMain: { handle: ReturnType<typeof vi.fn> },
  channel: string
): HandlerCallback {
  const call = ipcMain.handle.mock.calls.find(([c]) => c === channel) as
    [string, HandlerCallback] | undefined
  if (!call) throw new Error(`Handler for ${channel} not registered`)
  return call[1]
}

async function invokeHandler(
  ipcMain: { handle: ReturnType<typeof vi.fn> },
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const handler = getHandler(ipcMain, channel)
  return handler({}, ...args)
}

function expectInvalidParametersResult(result: unknown): void {
  expect(isIpcError(result)).toBe(true)
  if (isIpcError(result)) {
    expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
  }
}

describe('system IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([0, 4, 64])('forwards valid system:setWorkerThreads count %s', async (count) => {
    const ipcMain = makeIpcMain()
    registerSystemHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, 'system:setWorkerThreads', count)

    expect(result).toBeUndefined()
    expect(isIpcError(result)).toBe(false)
    expect(setWorkerThreads).toHaveBeenCalledTimes(1)
    expect(setWorkerThreads).toHaveBeenCalledWith(count)
  })

  it.each([-1, 1.5, 65])(
    'returns INVALID_PARAMETERS when system:setWorkerThreads receives %s',
    async (count) => {
      const ipcMain = makeIpcMain()
      registerSystemHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'system:setWorkerThreads', count)

      expectInvalidParametersResult(result)
      expect(setWorkerThreads).not.toHaveBeenCalled()
    }
  )
})
