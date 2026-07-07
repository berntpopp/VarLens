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
import { setUserDomains } from '../../../../src/main/utils/url-validation'
import {
  __resetAllowlistForTests,
  addAllowedImportPath
} from '../../../../src/main/security/import-path-allowlist'

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
    __resetAllowlistForTests()
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

  describe('shell:showItemInFolder', () => {
    it('rejects a path with no dialog authority', async () => {
      const ipcMain = makeIpcMain()
      registerShellHandlers({ ipcMain } as never)

      const result = await invokeHandler(
        ipcMain,
        'shell:showItemInFolder',
        '/some/other/mount/unrelated-export.xlsx'
      )

      expect(isIpcError(result)).toBe(true)
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
    })

    it('accepts a path enrolled via a dialog this session (e.g. an export save location)', async () => {
      const ipcMain = makeIpcMain()
      registerShellHandlers({ ipcMain } as never)
      const filePath = '/some/other/mount/case1_variants.xlsx'
      addAllowedImportPath(filePath)

      const result = await invokeHandler(ipcMain, 'shell:showItemInFolder', filePath)

      expect(isIpcError(result)).toBe(false)
      expect(shell.showItemInFolder).toHaveBeenCalledWith(filePath)
    })

    it('rejects a path under the automatic home root that was never dialog-enrolled (F-path)', async () => {
      // isAllowedImportPath grants app.getPath('home')/userData/temp for the
      // original import flow; this gate must use the STRICT check so a path
      // merely living under the mocked "home" root (but never picked via a
      // dialog this session) is still rejected.
      const ipcMain = makeIpcMain()
      registerShellHandlers({ ipcMain } as never)

      const result = await invokeHandler(
        ipcMain,
        'shell:showItemInFolder',
        '/nonexistent-electron-app-path/leaked-file.xlsx'
      )

      expect(isIpcError(result)).toBe(true)
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
    })
  })
})
