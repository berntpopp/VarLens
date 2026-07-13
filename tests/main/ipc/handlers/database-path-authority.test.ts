/**
 * DB path-authority gate tests (F-path, Part B / S6, Codex F-03).
 *
 * database:open, database:create, database:showInFolder, and
 * database:removeRecent must only accept a path that was picked via a
 * dialog this session (database:selectFile / database:selectSaveLocation,
 * using a database-scoped dialog-enrolled set), already appears in
 * the recent databases list, or is the currently active database. This
 * mirrors the deleteFile precedent (recent-list + active-DB refusal) plus
 * the import-path-allowlist's dialog-enrollment mechanism.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/nonexistent-electron-app-path'),
    isPackaged: false
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  safeStorage: {
    decryptString: vi.fn(),
    encryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(() => true)
  },
  shell: {
    showItemInFolder: vi.fn()
  }
}))

vi.mock('../../../../src/main/ipc/handlers/database-logic', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../src/main/ipc/handlers/database-logic')
  >('../../../../src/main/ipc/handlers/database-logic')
  return {
    ...actual,
    openDatabase: vi
      .fn()
      .mockResolvedValue({ success: true, info: { path: '', name: '', encrypted: false } }),
    createDatabase: vi
      .fn()
      .mockResolvedValue({ success: true, info: { path: '', name: '', encrypted: false } }),
    removeRecentDatabase: vi.fn().mockReturnValue({ success: true })
  }
})

import { dialog, shell } from 'electron'
import { registerDatabaseHandlers } from '../../../../src/main/ipc/handlers/database'
import {
  openDatabase,
  createDatabase,
  removeRecentDatabase
} from '../../../../src/main/ipc/handlers/database-logic'
import {
  addAllowedImportPath,
  __resetAllowlistForTests
} from '../../../../src/main/security/import-path-allowlist'
import {
  __resetDatabasePathAllowlistForTests,
  addAllowedDatabasePath,
  isStrictlyEnrolledDatabasePath
} from '../../../../src/main/security/database-path-allowlist'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function makeIpcMain(): { handle: ReturnType<typeof vi.fn> } {
  return { handle: vi.fn() }
}

function makeDbManager(overrides: {
  currentPath?: string | null
  recentPaths?: string[]
}): ReturnType<typeof vi.fn> {
  return vi.fn().mockReturnValue({
    getCurrentPath: vi.fn().mockReturnValue(overrides.currentPath ?? null),
    getRecentDatabases: vi
      .fn()
      .mockReturnValue(
        (overrides.recentPaths ?? []).map((path) => ({ path, name: path, lastOpened: 0 }))
      )
  })
}

function makeDeps(
  ipcMain: { handle: ReturnType<typeof vi.fn> },
  dbManagerOverrides: { currentPath?: string | null; recentPaths?: string[] } = {}
): {
  ipcMain: typeof ipcMain
  getDb: ReturnType<typeof vi.fn>
  getDbManager: ReturnType<typeof vi.fn>
} {
  return {
    ipcMain,
    getDb: vi.fn(),
    getDbManager: makeDbManager(dbManagerOverrides)
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
    // Path-authority rejections surface as UNKNOWN via wrapHandler's generic
    // Error path (mirrors deleteDbFile's existing precedent).
    expect([ErrorCode.INVALID_PARAMETERS, ErrorCode.UNKNOWN]).toContain(result.code)
  }
}

// Path that is never enrolled and has no database recent/current authority.
const UNAUTHORIZED_PATH = resolve('external', 'unrelated.db')

describe('database path-authority gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetAllowlistForTests()
    __resetDatabasePathAllowlistForTests()
  })

  it.each([
    ['relative', 'relative.db', resolve('relative.db')],
    ['non-normalized', `${tmpdir()}/authority/../database.db`, join(tmpdir(), 'database.db')]
  ])('does not enroll a %s database path', (_label, candidate, resolvedAlias) => {
    addAllowedDatabasePath(candidate)

    expect(isStrictlyEnrolledDatabasePath(candidate)).toBe(false)
    expect(isStrictlyEnrolledDatabasePath(resolvedAlias)).toBe(false)
  })

  const symlinkIt = process.platform === 'win32' ? it.skip : it
  symlinkIt.each(['current', 'recent'])(
    'rejects a retargeted dialog-enrolled symlink instead of falling through to %s authority',
    async (fallback) => {
      const root = mkdtempSync(join(tmpdir(), 'varlens-db-authority-'))
      try {
        const targetA = join(root, 'a.db')
        const targetB = join(root, 'b.db')
        const selectedPath = join(root, 'selected.db')
        writeFileSync(targetA, 'a')
        writeFileSync(targetB, 'b')
        symlinkSync(targetA, selectedPath)
        addAllowedDatabasePath(selectedPath)
        expect(isStrictlyEnrolledDatabasePath(selectedPath)).toBe(true)

        unlinkSync(selectedPath)
        symlinkSync(targetB, selectedPath)

        const ipcMain = makeIpcMain()
        registerDatabaseHandlers(
          makeDeps(ipcMain, {
            currentPath: fallback === 'current' ? selectedPath : null,
            recentPaths: fallback === 'recent' ? [selectedPath] : []
          }) as never
        )

        const result = await invokeHandler(ipcMain, 'database:open', selectedPath)

        expectInvalidParametersResult(result)
        expect(openDatabase).not.toHaveBeenCalled()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  symlinkIt(
    'rejects an unenrolled current path beneath a retargetable symlinked directory',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'varlens-db-authority-'))
      try {
        const targetDir = join(root, 'target')
        const linkedDir = join(root, 'linked')
        const target = join(targetDir, 'database.db')
        mkdirSync(targetDir)
        writeFileSync(target, 'database')
        symlinkSync(targetDir, linkedDir, 'dir')
        const candidate = join(linkedDir, 'database.db')
        const ipcMain = makeIpcMain()
        registerDatabaseHandlers(makeDeps(ipcMain, { currentPath: candidate }) as never)

        const result = await invokeHandler(ipcMain, 'database:open', candidate)

        expectInvalidParametersResult(result)
        expect(openDatabase).not.toHaveBeenCalled()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  symlinkIt.each(['current', 'recent'])(
    'rejects an unenrolled %s database symlink because its target was never pinned',
    async (fallback) => {
      const root = mkdtempSync(join(tmpdir(), 'varlens-db-authority-'))
      try {
        const target = join(root, 'target.db')
        const symlinkPath = join(root, 'selected.db')
        writeFileSync(target, 'database')
        symlinkSync(target, symlinkPath)

        const ipcMain = makeIpcMain()
        registerDatabaseHandlers(
          makeDeps(ipcMain, {
            currentPath: fallback === 'current' ? symlinkPath : null,
            recentPaths: fallback === 'recent' ? [symlinkPath] : []
          }) as never
        )

        const result = await invokeHandler(ipcMain, 'database:open', symlinkPath)

        expectInvalidParametersResult(result)
        expect(openDatabase).not.toHaveBeenCalled()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  it.each(['current', 'recent'])(
    'rejects normalized aliases backed only by a non-normalized %s metadata path',
    async (fallback) => {
      const canonical = resolve('database.db')
      const metadataAlias = `${join(dirname(canonical), 'nested')}/../${basename(canonical)}`
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(
        makeDeps(ipcMain, {
          currentPath: fallback === 'current' ? metadataAlias : null,
          recentPaths: fallback === 'recent' ? [metadataAlias] : []
        }) as never
      )

      const result = await invokeHandler(ipcMain, 'database:open', canonical)

      expectInvalidParametersResult(result)
      expect(openDatabase).not.toHaveBeenCalled()
    }
  )

  describe('database:open', () => {
    it('rejects a path with no dialog/recent/active authority', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'database:open', UNAUTHORIZED_PATH)

      expectInvalidParametersResult(result)
      expect(openDatabase).not.toHaveBeenCalled()
    })

    it('accepts a path selected via database:selectFile this session', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [UNAUTHORIZED_PATH]
      } as never)

      const selected = await invokeHandler(ipcMain, 'database:selectFile')
      expect(selected).toBe(UNAUTHORIZED_PATH)

      const result = await invokeHandler(ipcMain, 'database:open', UNAUTHORIZED_PATH)

      expect(isIpcError(result)).toBe(false)
      expect(openDatabase).toHaveBeenCalled()
    })

    it('accepts a path already in the recent databases list', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain, { recentPaths: [UNAUTHORIZED_PATH] }) as never)

      const result = await invokeHandler(ipcMain, 'database:open', UNAUTHORIZED_PATH)

      expect(isIpcError(result)).toBe(false)
      expect(openDatabase).toHaveBeenCalled()
    })

    it('accepts the currently active database path', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain, { currentPath: UNAUTHORIZED_PATH }) as never)

      const result = await invokeHandler(ipcMain, 'database:open', UNAUTHORIZED_PATH)

      expect(isIpcError(result)).toBe(false)
      expect(openDatabase).toHaveBeenCalled()
    })

    it('rejects a home path that was never dialog-enrolled', async () => {
      // Filesystem location is not database authority: the path also needs
      // dialog, recent-list, or active-session provenance.
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(
        ipcMain,
        'database:open',
        '/nonexistent-electron-app-path/leaked.db'
      )

      expectInvalidParametersResult(result)
      expect(openDatabase).not.toHaveBeenCalled()
    })

    it('rejects a path enrolled only through the import path allowlist', async () => {
      addAllowedImportPath(UNAUTHORIZED_PATH)
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'database:open', UNAUTHORIZED_PATH)

      expectInvalidParametersResult(result)
      expect(openDatabase).not.toHaveBeenCalled()
    })
  })

  describe('database:create', () => {
    it('rejects a path with no dialog authority', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'database:create', UNAUTHORIZED_PATH)

      expectInvalidParametersResult(result)
      expect(createDatabase).not.toHaveBeenCalled()
    })

    it('accepts a path selected via database:selectSaveLocation this session', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({
        canceled: false,
        filePath: UNAUTHORIZED_PATH
      } as never)

      const selected = await invokeHandler(ipcMain, 'database:selectSaveLocation', 'new-db.sqlite')
      expect(selected).toBe(UNAUTHORIZED_PATH)

      const result = await invokeHandler(ipcMain, 'database:create', UNAUTHORIZED_PATH)

      expect(isIpcError(result)).toBe(false)
      expect(createDatabase).toHaveBeenCalled()
    })

    it('rejects a home path that was never dialog-enrolled', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(
        ipcMain,
        'database:create',
        '/nonexistent-electron-app-path/leaked.db'
      )

      expectInvalidParametersResult(result)
      expect(createDatabase).not.toHaveBeenCalled()
    })
  })

  describe('database:removeRecent', () => {
    it('rejects a path with no authority', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'database:removeRecent', UNAUTHORIZED_PATH)

      expectInvalidParametersResult(result)
      expect(removeRecentDatabase).not.toHaveBeenCalled()
    })

    it('accepts a path already in the recent databases list', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain, { recentPaths: [UNAUTHORIZED_PATH] }) as never)

      const result = await invokeHandler(ipcMain, 'database:removeRecent', UNAUTHORIZED_PATH)

      expect(isIpcError(result)).toBe(false)
      expect(removeRecentDatabase).toHaveBeenCalled()
    })
  })

  describe('database:showInFolder', () => {
    it('rejects a path with no authority', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'database:showInFolder', UNAUTHORIZED_PATH)

      expectInvalidParametersResult(result)
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
    })

    it('accepts the currently active database path', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain, { currentPath: UNAUTHORIZED_PATH }) as never)

      const result = await invokeHandler(ipcMain, 'database:showInFolder', UNAUTHORIZED_PATH)

      expect(isIpcError(result)).toBe(false)
      expect(shell.showItemInFolder).toHaveBeenCalledWith(UNAUTHORIZED_PATH)
    })

    it('rejects a home path that was never dialog-enrolled', async () => {
      const ipcMain = makeIpcMain()
      registerDatabaseHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(
        ipcMain,
        'database:showInFolder',
        '/nonexistent-electron-app-path/leaked.db'
      )

      expectInvalidParametersResult(result)
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
    })
  })
})
