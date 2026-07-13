import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, parse } from 'node:path'
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

const { cleanupZipTemp } = vi.hoisted(() => ({ cleanupZipTemp: vi.fn() }))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

vi.mock('fs/promises', () => ({
  readdir: vi.fn()
}))

vi.mock('../../../../src/main/import', () => ({
  ZipExtractor: class {
    isEncrypted(): boolean {
      return false
    }
  }
}))

vi.mock('../../../../src/main/ipc/handlers/batch-import-logic', () => ({
  checkDuplicateFiles: vi.fn().mockReturnValue({ files: [], duplicateCount: 0 }),
  startBatchImport: vi.fn().mockResolvedValue({
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: false,
    details: []
  }),
  cancelBatchImport: vi.fn(),
  testZipPassword: vi.fn().mockReturnValue({ success: true }),
  extractZip: vi.fn().mockResolvedValue({ files: [], errors: [], extractionId: 'extraction-id' }),
  cleanupZipTemp
}))

vi.mock('../../../../src/main/ipc/utils/settings-io', () => ({
  loadSettings: vi.fn().mockResolvedValue({}),
  saveSettings: vi.fn().mockResolvedValue(undefined)
}))

import { dialog } from 'electron'
import { readdir } from 'fs/promises'
import { registerBatchImportHandlers } from '../../../../src/main/ipc/handlers/batch-import'
import { saveSettings } from '../../../../src/main/ipc/utils/settings-io'
import {
  checkDuplicateFiles,
  startBatchImport,
  testZipPassword,
  extractZip
} from '../../../../src/main/ipc/handlers/batch-import-logic'
import {
  __resetAllowlistForTests,
  addAllowedImportPath,
  isAllowedImportPath,
  removeAllowedImportPath
} from '../../../../src/main/security/import-path-allowlist'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

const EXTERNAL_ROOT = join(parse(process.cwd()).root, 'varlens-external')

function makeIpcMain(): { handle: ReturnType<typeof vi.fn> } {
  return { handle: vi.fn() }
}

function makeDeps(ipcMain: { handle: ReturnType<typeof vi.fn> }): {
  ipcMain: typeof ipcMain
  getDb: ReturnType<typeof vi.fn>
} {
  return { ipcMain, getDb: vi.fn() }
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

describe('batch-import IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetAllowlistForTests()
  })

  describe('batch-import:checkDuplicates', () => {
    it('returns INVALID_PARAMETERS for malformed args', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'batch-import:checkDuplicates', 'not-an-array')

      expectInvalidParametersResult(result)
      expect(checkDuplicateFiles).not.toHaveBeenCalled()
    })

    it('rejects a non-enrolled file path', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'batch-import:checkDuplicates', ['/etc/passwd'])

      expectInvalidParametersResult(result)
      expect(checkDuplicateFiles).not.toHaveBeenCalled()
    })

    it('accepts a dialog-enrolled file path', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      const filePath = join(EXTERNAL_ROOT, 'case1.json')
      addAllowedImportPath(filePath)

      const result = await invokeHandler(ipcMain, 'batch-import:checkDuplicates', [filePath])

      expect(isIpcError(result)).toBe(false)
      expect(checkDuplicateFiles).toHaveBeenCalledWith(expect.any(Function), [filePath], undefined)
    })

    it('rejects a path under the automatic temp root that was never dialog-enrolled (F-path)', async () => {
      // Strict enrollment gate: a path merely living under an automatic
      // root (home/userData/temp) is not proof of dialog provenance.
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'batch-import:checkDuplicates', [
        '/tmp/not-dialog-enrolled.json'
      ])

      expectInvalidParametersResult(result)
      expect(checkDuplicateFiles).not.toHaveBeenCalled()
    })
  })

  describe('batch-import:start', () => {
    it('returns INVALID_PARAMETERS for malformed duplicateStrategy', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      const filePath = join(EXTERNAL_ROOT, 'case1.json')
      addAllowedImportPath(filePath)

      const result = await invokeHandler(
        ipcMain,
        'batch-import:start',
        [filePath],
        'not-a-real-strategy'
      )

      expectInvalidParametersResult(result)
      expect(startBatchImport).not.toHaveBeenCalled()
    })

    it('rejects a non-enrolled file path', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(
        ipcMain,
        'batch-import:start',
        ['/etc/passwd'],
        'overwrite'
      )

      expectInvalidParametersResult(result)
      expect(startBatchImport).not.toHaveBeenCalled()
    })

    it('accepts a dialog-enrolled file path', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      const filePath = join(EXTERNAL_ROOT, 'case1.json')
      addAllowedImportPath(filePath)

      const result = await invokeHandler(ipcMain, 'batch-import:start', [filePath], 'overwrite')

      expect(isIpcError(result)).toBe(false)
      expect(startBatchImport).toHaveBeenCalled()
    })

    it('rejects a path under the automatic temp root that was never dialog-enrolled (F-path)', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(
        ipcMain,
        'batch-import:start',
        ['/tmp/not-dialog-enrolled.json'],
        'overwrite'
      )

      expectInvalidParametersResult(result)
      expect(startBatchImport).not.toHaveBeenCalled()
    })
  })

  describe('batch-import:testZipPassword', () => {
    it('returns INVALID_PARAMETERS for malformed args', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'batch-import:testZipPassword', 123, 'pw')

      expectInvalidParametersResult(result)
      expect(testZipPassword).not.toHaveBeenCalled()
    })

    it('rejects a non-enrolled zip path', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(
        ipcMain,
        'batch-import:testZipPassword',
        '/etc/passwd',
        'pw'
      )

      expectInvalidParametersResult(result)
      expect(testZipPassword).not.toHaveBeenCalled()
    })

    it('accepts a dialog-enrolled zip path', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      const zipPath = join(EXTERNAL_ROOT, 'batch.zip')
      addAllowedImportPath(zipPath)

      const result = await invokeHandler(ipcMain, 'batch-import:testZipPassword', zipPath, 'pw')

      expect(isIpcError(result)).toBe(false)
      expect(testZipPassword).toHaveBeenCalledWith(zipPath, 'pw')
    })

    it('rejects a zip path under the automatic temp root that was never dialog-enrolled (F-path)', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(
        ipcMain,
        'batch-import:testZipPassword',
        '/tmp/not-dialog-enrolled.zip',
        'pw'
      )

      expectInvalidParametersResult(result)
      expect(testZipPassword).not.toHaveBeenCalled()
    })
  })

  describe('batch-import:extractZip', () => {
    it('rejects a non-enrolled zip path', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'batch-import:extractZip', '/etc/passwd')

      expectInvalidParametersResult(result)
      expect(extractZip).not.toHaveBeenCalled()
    })

    it('accepts a dialog-enrolled zip path', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      const zipPath = join(EXTERNAL_ROOT, 'batch.zip')
      addAllowedImportPath(zipPath)

      const result = await invokeHandler(ipcMain, 'batch-import:extractZip', zipPath)

      expect(isIpcError(result)).toBe(false)
      expect(extractZip).toHaveBeenCalledWith(
        zipPath,
        undefined,
        addAllowedImportPath,
        removeAllowedImportPath
      )
    })

    it('rejects a zip path under the automatic temp root that was never dialog-enrolled (F-path)', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(
        ipcMain,
        'batch-import:extractZip',
        '/tmp/not-dialog-enrolled.zip'
      )

      expectInvalidParametersResult(result)
      expect(extractZip).not.toHaveBeenCalled()
    })
  })

  describe('dialog enrollment', () => {
    it('surfaces a folder read failure instead of reporting an empty folder', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [join(EXTERNAL_ROOT, 'unreadable')]
      } as never)
      vi.mocked(readdir).mockRejectedValueOnce(new Error('EACCES: permission denied'))

      const result = await invokeHandler(ipcMain, 'batch-import:selectFolder')

      expect(isIpcError(result)).toBe(true)
      expect(result).not.toEqual([])
    })

    it('preserves cancellation and a genuinely empty folder as empty selections', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: true,
        filePaths: []
      } as never)

      expect(await invokeHandler(ipcMain, 'batch-import:selectFolder')).toEqual([])

      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: [join(EXTERNAL_ROOT, 'empty')]
      } as never)
      vi.mocked(readdir).mockResolvedValueOnce([])
      expect(await invokeHandler(ipcMain, 'batch-import:selectFolder')).toEqual([])
    })

    it('surfaces ZIP settings failures instead of reporting dialog cancellation', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [join(EXTERNAL_ROOT, 'archive.zip')]
      } as never)
      vi.mocked(saveSettings).mockRejectedValueOnce(new Error('ENOSPC: no space left'))

      const result = await invokeHandler(ipcMain, 'batch-import:selectZip')

      expect(isIpcError(result)).toBe(true)
      expect(result).not.toBeNull()
    })

    it('enrolls files picked via batch-import:selectFiles', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      const filePath = join(EXTERNAL_ROOT, 'case1.json')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [filePath]
      } as never)

      expect(isAllowedImportPath(filePath)).toBe(false)
      const result = await invokeHandler(ipcMain, 'batch-import:selectFiles')

      expect(result).toEqual([filePath])
      expect(isAllowedImportPath(filePath)).toBe(true)
    })

    it('enrolls the zip picked via batch-import:selectZip', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      const zipPath = join(EXTERNAL_ROOT, 'batch.zip')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [zipPath]
      } as never)

      expect(isAllowedImportPath(zipPath)).toBe(false)
      await invokeHandler(ipcMain, 'batch-import:selectZip')

      expect(isAllowedImportPath(zipPath)).toBe(true)
    })

    it('enrolls files discovered when a folder is selected via batch-import:selectFolder', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers(makeDeps(ipcMain) as never)
      const folderPath = join(EXTERNAL_ROOT, 'cases')
      const discoveredFile = join(folderPath, 'case1.json')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [folderPath]
      } as never)
      vi.mocked(readdir).mockResolvedValue([{ name: 'case1.json', isFile: () => true }] as never)

      expect(isAllowedImportPath(discoveredFile)).toBe(false)
      const result = await invokeHandler(ipcMain, 'batch-import:selectFolder')

      expect(result).toEqual([discoveredFile])
      expect(isAllowedImportPath(discoveredFile)).toBe(true)
    })
  })

  describe('batch-import:cleanupZipTemp', () => {
    it('passes extraction-scoped cleanup authority to the logic layer', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers({ ipcMain, getDb: vi.fn() } as never)

      const result = await invokeHandler(
        ipcMain,
        'batch-import:cleanupZipTemp',
        '11111111-1111-4111-8111-111111111111'
      )

      expect(isIpcError(result)).toBe(false)
      expect(cleanupZipTemp).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    })

    it('rejects missing cleanup authority instead of performing global cleanup', async () => {
      const ipcMain = makeIpcMain()
      registerBatchImportHandlers({ ipcMain, getDb: vi.fn() } as never)

      const result = await invokeHandler(ipcMain, 'batch-import:cleanupZipTemp')

      expect(isIpcError(result)).toBe(true)
      expect(cleanupZipTemp).not.toHaveBeenCalled()
    })
  })
})
