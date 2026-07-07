import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isIpcError } from '../../../../src/shared/types/errors'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn()
}))

import { readFile } from 'node:fs/promises'
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
  const importBedEntries = vi.fn().mockReturnValue({ id: 1, importedCount: 0 })
  const getDb = vi.fn().mockReturnValue({ geneLists: { importBedEntries } })
  const getDbManager = vi.fn().mockReturnValue({
    getCurrentSession: vi.fn().mockReturnValue({ capabilities: { backend: 'sqlite' } })
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

    // Path outside all automatic roots (home/userData/temp) and never
    // enrolled via a dialog this session.
    const result = await invokeHandler(ipcMain, 'region-files:importBed', 1, '/etc/passwd')

    expect(isIpcError(result)).toBe(true)
    expect(readFile).not.toHaveBeenCalled()
    expect(deps.getDb().geneLists.importBedEntries).not.toHaveBeenCalled()
  })

  it('rejects a path under the automatic temp root that was never dialog-enrolled (F-path)', async () => {
    // This gate must use the STRICT enrollment check, not the permissive
    // isAllowedImportPath — a path merely living under the OS temp dir (or
    // home/userData) is not proof the user picked it via a dialog this
    // session. Previously this leaked in via isAllowedImportPath's
    // automatic-root grant, letting a compromised renderer read any file
    // under those roots without dialog enrollment.
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
    expect(readFile).not.toHaveBeenCalled()
    expect(deps.getDb().geneLists.importBedEntries).not.toHaveBeenCalled()
  })

  it('accepts a dialog-enrolled BED path and imports its entries', async () => {
    const ipcMain = makeIpcMain()
    const deps = makeDeps(ipcMain)
    registerGeneListHandlers(deps as never)

    const bedPath = '/some/custom/mount/regions.bed'
    addAllowedImportPath(bedPath)
    vi.mocked(readFile).mockResolvedValue('chr1\t100\t200\tregion1\n')

    const result = await invokeHandler(ipcMain, 'region-files:importBed', 1, bedPath)

    expect(isIpcError(result)).toBe(false)
    expect(readFile).toHaveBeenCalledWith(bedPath, 'utf-8')
    expect(deps.getDb().geneLists.importBedEntries).toHaveBeenCalledWith(1, [
      { chr: 'chr1', start: 100, end: 200, label: 'region1' }
    ])
  })
})
