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

import { shell } from 'electron'
import { registerShellHandlers } from '../../../../src/main/ipc/handlers/shell'
import { setUserDomains, isUrlSafeForExternal } from '../../../../src/main/utils/url-validation'

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

  it('opens external URL and returns { success: true } when valid and safe', async () => {
    vi.mocked(isUrlSafeForExternal).mockReturnValueOnce(true)
    const ipcMain = makeIpcMain()
    registerShellHandlers({ ipcMain } as never)

    const result = await invokeHandler(ipcMain, 'shell:openExternal', 'https://example.org')

    expect(result).toEqual({ success: true })
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.org')
  })

  it('returns an IPC error when shell:openExternal receives an unsafe URL', async () => {
    vi.mocked(isUrlSafeForExternal).mockReturnValueOnce(false)
    const ipcMain = makeIpcMain()
    registerShellHandlers({ ipcMain } as never)

    const result = await invokeHandler(ipcMain, 'shell:openExternal', 'http://untrusted-site.com')

    expect(isIpcError(result)).toBe(true)
    if (isIpcError(result)) {
      expect(result.message).toBe('URL not allowed')
    }
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('returns an IPC error when shell:openExternal receives invalid params', async () => {
    const ipcMain = makeIpcMain()
    registerShellHandlers({ ipcMain } as never)

    const result = await invokeHandler(ipcMain, 'shell:openExternal', 12345)

    expect(isIpcError(result)).toBe(true)
    if (isIpcError(result)) {
      expect(result.message).toBe('Invalid parameters')
    }
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('does not expose a generic file-reveal channel', () => {
    const ipcMain = makeIpcMain()
    registerShellHandlers({ ipcMain } as never)

    expect(ipcMain.handle).not.toHaveBeenCalledWith('shell:showItemInFolder', expect.any(Function))
  })
})
