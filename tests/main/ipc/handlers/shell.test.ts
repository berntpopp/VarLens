import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/nonexistent-electron-app-path')
  },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

vi.mock('../../../../src/main/utils/url-validation', () => ({
  setUserDomains: vi.fn(),
  isUrlSafeForExternal: vi.fn(() => true)
}))

import { registerShellHandlers } from '../../../../src/main/ipc/handlers/shell'
import { setUserDomains } from '../../../../src/main/utils/url-validation'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function makeIpcMain(): { handle: ReturnType<typeof vi.fn> } {
  return {
    handle: vi.fn()
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

describe('shell IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an IPC error when shell:updateUserDomains receives more than 100 domains', async () => {
    const ipcMain = makeIpcMain()
    registerShellHandlers({ ipcMain } as never)
    const domains = Array.from({ length: 101 }, (_, i) => `example-${i}.org`)

    const result = await invokeHandler(ipcMain, 'shell:updateUserDomains', domains)

    expect(isIpcError(result)).toBe(true)
    if (isIpcError(result)) {
      expect(result.code).toBe(ErrorCode.UNKNOWN)
    }
    expect(setUserDomains).not.toHaveBeenCalled()
  })

  it('does not expose a generic file-reveal channel', () => {
    const ipcMain = makeIpcMain()
    registerShellHandlers({ ipcMain } as never)

    expect(ipcMain.handle).not.toHaveBeenCalledWith('shell:showItemInFolder', expect.any(Function))
  })
})
