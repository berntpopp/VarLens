import { describe, it, expect, vi, beforeEach } from 'vitest'
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

function makeDeps(ipcMain: { handle: ReturnType<typeof vi.fn> }): {
  ipcMain: typeof ipcMain
  getDb: ReturnType<typeof vi.fn>
  getDbPool: ReturnType<typeof vi.fn>
  getDbManager: ReturnType<typeof vi.fn>
} {
  const execute = vi.fn().mockResolvedValue({ id: 1, importedCount: 0 })
  const getDb = vi.fn().mockReturnValue({ geneLists: {} })
  const getDbManager = vi.fn().mockReturnValue({
    getCurrentSession: vi.fn().mockReturnValue({
      capabilities: { backend: 'sqlite' },
      getWriteExecutor: vi.fn().mockReturnValue({ execute })
    })
  })
  const getDbPool = vi.fn().mockReturnValue(null)
  return { ipcMain, getDb, getDbManager, getDbPool }
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

describe('region-files:importBed IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetAllowlistForTests()
  })

  it('rejects a non-enrolled BED path before reading the file', async () => {
    const ipcMain = makeIpcMain()
    const deps = makeDeps(ipcMain)
    registerGeneListHandlers(deps as never)

    // The path was never enrolled via a dialog this session.
    const result = await invokeHandler(ipcMain, 'region-files:importBed', 1, '/etc/passwd')

    expect(isIpcError(result)).toBe(true)
    expect(
      deps.getDbManager().getCurrentSession().getWriteExecutor().execute
    ).not.toHaveBeenCalled()
  })

  it('rejects a temp path that was never dialog-enrolled', async () => {
    // Filesystem location is not authority: living under temp is not proof
    // the user picked the path through a trusted selector.
    const ipcMain = makeIpcMain()
    const deps = makeDeps(ipcMain)
    registerGeneListHandlers(deps as never)

    const result = await invokeHandler(
      ipcMain,
      'region-files:importBed',
      1,
      '/tmp/not-dialog-enrolled.bed'
    )

    expect(isIpcError(result)).toBe(true)
    expect(
      deps.getDbManager().getCurrentSession().getWriteExecutor().execute
    ).not.toHaveBeenCalled()
  })

  it('accepts a dialog-enrolled BED path and delegates bounded streaming to storage', async () => {
    const ipcMain = makeIpcMain()
    const deps = makeDeps(ipcMain)
    registerGeneListHandlers(deps as never)

    const bedPath = resolve('external', 'regions.bed')
    addAllowedImportPath(bedPath)
    const result = await invokeHandler(ipcMain, 'region-files:importBed', 1, bedPath)

    expect(isIpcError(result)).toBe(false)
    expect(deps.getDbManager().getCurrentSession().getWriteExecutor().execute).toHaveBeenCalledWith(
      {
        type: 'region-files:importBed',
        params: [1, bedPath, { rejectMalformedRows: false }]
      }
    )
  })
})
