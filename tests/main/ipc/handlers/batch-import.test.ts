/**
 * batch-import IPC handler tests.
 *
 * Covers the two batch-import.ts catch sites from finding C8 / Codex F-05:
 * - `selectFolder`: a directory-read failure must surface as a structured
 *   IPC error, not masquerade as an empty folder (`[]`).
 * - `selectZip` (bonus, same citation): a dialog/settings failure must
 *   surface as an error, not masquerade as "user cancelled" (`null`).
 *
 * `batch-import-logic` is mocked because these two handlers don't delegate
 * to it for the behavior under test — that module has its own dedicated
 * tests (tests/main/handlers/batch-import-logic.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isIpcError } from '../../../../src/shared/types/errors'

const { showOpenDialog, readdir, loadSettings, saveSettings } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  readdir: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog }
}))

vi.mock('fs/promises', () => ({
  readdir
}))

vi.mock('../../../../src/main/ipc/utils/settings-io', () => ({
  loadSettings,
  saveSettings
}))

vi.mock('../../../../src/main/ipc/utils/safeEmit', () => ({
  safeEmit: vi.fn()
}))

vi.mock('../../../../src/main/ipc/handlers/batch-import-logic', () => ({
  checkDuplicateFiles: vi.fn(),
  startBatchImport: vi.fn(),
  cancelBatchImport: vi.fn(),
  testZipPassword: vi.fn(),
  extractZip: vi.fn(),
  cleanupZipTemp: vi.fn()
}))

vi.mock('../../../../src/main/import', () => ({
  ZipExtractor: class {
    isEncrypted(): boolean {
      return false
    }
  }
}))

import { registerBatchImportHandlers } from '../../../../src/main/ipc/handlers/batch-import'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function makeIpcMain(): { handle: ReturnType<typeof vi.fn> } {
  return { handle: vi.fn() }
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

describe('batch-import IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSettings.mockResolvedValue({})
    saveSettings.mockResolvedValue(undefined)
  })

  describe('batch-import:selectFolder', () => {
    it('surfaces a directory-read failure as a structured error, not an empty folder', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/data/import'] })
      readdir.mockRejectedValue(new Error('EACCES: permission denied'))

      const ipcMain = makeIpcMain()
      registerBatchImportHandlers({ ipcMain, getDb: vi.fn() } as never)

      const result = await invokeHandler(ipcMain, 'batch-import:selectFolder')

      expect(isIpcError(result)).toBe(true)
      expect(result).not.toEqual([])
    })

    it('preserves the legitimate outcome: user cancelling the dialog still returns []', async () => {
      showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

      const ipcMain = makeIpcMain()
      registerBatchImportHandlers({ ipcMain, getDb: vi.fn() } as never)

      const result = await invokeHandler(ipcMain, 'batch-import:selectFolder')

      expect(result).toEqual([])
      expect(readdir).not.toHaveBeenCalled()
    })

    it('preserves the legitimate outcome: a genuinely empty folder returns []', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/data/empty'] })
      readdir.mockResolvedValue([])

      const ipcMain = makeIpcMain()
      registerBatchImportHandlers({ ipcMain, getDb: vi.fn() } as never)

      const result = await invokeHandler(ipcMain, 'batch-import:selectFolder')

      expect(result).toEqual([])
    })
  })

  describe('batch-import:selectZip', () => {
    it('surfaces a settings/dialog failure as a structured error, not "user cancelled"', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/data/archive.zip'] })
      saveSettings.mockRejectedValue(new Error('ENOSPC: no space left on device'))

      const ipcMain = makeIpcMain()
      registerBatchImportHandlers({ ipcMain, getDb: vi.fn() } as never)

      const result = await invokeHandler(ipcMain, 'batch-import:selectZip')

      expect(isIpcError(result)).toBe(true)
      expect(result).not.toBeNull()
    })

    it('preserves the legitimate outcome: user cancelling the dialog still returns null', async () => {
      showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

      const ipcMain = makeIpcMain()
      registerBatchImportHandlers({ ipcMain, getDb: vi.fn() } as never)

      const result = await invokeHandler(ipcMain, 'batch-import:selectZip')

      expect(result).toBeNull()
    })
  })
})
