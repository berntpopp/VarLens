import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

import { isIpcError } from '../../../../src/shared/types/errors'
import { registerGeneListHandlers } from '../../../../src/main/ipc/handlers/gene-lists'
import {
  __resetAllowlistForTests,
  addAllowedImportPath
} from '../../../../src/main/security/import-path-allowlist'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function makeIpcMain(): { handle: ReturnType<typeof vi.fn> } {
  return { handle: vi.fn() }
}

function makeDeps(ipcMain: { handle: ReturnType<typeof vi.fn> }) {
  const execute = vi.fn().mockResolvedValue({ id: 1, region_count: 1 })
  const getDbManager = vi.fn().mockReturnValue({
    getCurrentSession: vi.fn().mockReturnValue({
      capabilities: { backend: 'sqlite' },
      getWriteExecutor: () => ({ execute })
    })
  })
  return {
    deps: {
      ipcMain,
      getDb: vi.fn(),
      getDbPool: vi.fn().mockReturnValue(null),
      getDbManager
    },
    execute
  }
}

function getHandler(
  ipcMain: { handle: ReturnType<typeof vi.fn> },
  channel: string
): HandlerCallback {
  const call = ipcMain.handle.mock.calls.find(([registered]) => registered === channel) as
    [string, HandlerCallback] | undefined
  if (call === undefined) throw new Error(`Handler for ${channel} not registered`)
  return call[1]
}

describe('region-files:importBed IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetAllowlistForTests()
  })

  it.each(['/etc/passwd', '/tmp/not-dialog-enrolled.bed'])(
    'rejects non-enrolled renderer path %s before storage',
    async (filePath) => {
      const ipcMain = makeIpcMain()
      const { deps, execute } = makeDeps(ipcMain)
      registerGeneListHandlers(deps as never)

      const result = await getHandler(ipcMain, 'region-files:importBed')({}, 1, filePath)

      expect(isIpcError(result)).toBe(true)
      expect(execute).not.toHaveBeenCalled()
    }
  )

  it('routes a strictly dialog-enrolled BED path to streaming storage', async () => {
    const ipcMain = makeIpcMain()
    const { deps, execute } = makeDeps(ipcMain)
    registerGeneListHandlers(deps as never)
    const bedPath = resolve('external', 'regions.bed')
    addAllowedImportPath(bedPath)

    const result = await getHandler(ipcMain, 'region-files:importBed')({}, 1, bedPath)

    expect(isIpcError(result)).toBe(false)
    expect(execute).toHaveBeenCalledWith({
      type: 'region-files:importBed',
      params: [1, bedPath, { rejectMalformedRows: false }]
    })
  })
})
