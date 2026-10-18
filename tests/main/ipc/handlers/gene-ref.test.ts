import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerGeneRefHandlers } from '../../../../src/main/ipc/handlers/gene-ref'
import type { HandlerDependencies } from '../../../../src/main/ipc/types'
import { isIpcError } from '../../../../src/shared/types/errors'

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app/path'),
    getPath: vi.fn(() => '/mock/user/data'),
    isPackaged: false
  }
}))

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  copyFileSync: vi.fn()
}))

vi.mock('../../../../src/main/database/geneReferenceLoader', () => ({
  getGeneReferenceDb: vi.fn(),
  closeGeneReferenceDb: vi.fn()
}))

import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync, copyFileSync } from 'fs'
import { getGeneReferenceDb, closeGeneReferenceDb } from '../../../../src/main/database/geneReferenceLoader'

type HandlerCallback = (...args: unknown[]) => Promise<unknown>

function makeIpcMain(): { handle: ReturnType<typeof vi.fn>; handlers: Map<string, HandlerCallback> } {
  const handlers = new Map<string, HandlerCallback>()
  const handle = vi.fn((channel: string, callback: HandlerCallback) => {
    handlers.set(channel, callback)
  })
  return { handle, handlers }
}

describe('gene-ref IPC handlers', () => {
  const mockInfo = {
    geneCount: 20000,
    aliasCount: 40000,
    coordinateCount: 60000,
    assemblies: ['GRCh38', 'GRCh37'],
    builtAt: 1700000000
  }

  let ipc: ReturnType<typeof makeIpcMain>

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(app, 'isPackaged', { value: false, configurable: true, writable: true })

    vi.mocked(getGeneReferenceDb).mockReturnValue({
      getInfo: vi.fn(() => mockInfo),
      getAssemblies: vi.fn(() => [{ id: 'GRCh38', display_name: 'GRCh38', aliases: [], source_version: 'v1' }])
    } as never)

    ipc = makeIpcMain()
    registerGeneRefHandlers({ ipcMain: ipc } as unknown as HandlerDependencies)
  })

  describe('gene-ref:info', () => {
    it('reports canUpdate: false when app is packaged', async () => {
      Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
      vi.mocked(existsSync).mockReturnValue(true)

      const handler = ipc.handlers.get('gene-ref:info')!
      const result = await handler({})
      expect(isIpcError(result)).toBe(false)
      expect(result).toMatchObject({
        ...mockInfo,
        canUpdate: false
      })
    })

    it('reports canUpdate: true in development when script exists', async () => {
      Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
      vi.mocked(existsSync).mockReturnValue(true)

      const handler = ipc.handlers.get('gene-ref:info')!
      const result = await handler({})
      expect(isIpcError(result)).toBe(false)
      expect(result).toMatchObject({
        ...mockInfo,
        canUpdate: true
      })
    })

    it('reports canUpdate: false in development when script is absent', async () => {
      Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
      vi.mocked(existsSync).mockReturnValue(false)

      const handler = ipc.handlers.get('gene-ref:info')!
      const result = await handler({})
      expect(isIpcError(result)).toBe(false)
      expect(result).toMatchObject({
        ...mockInfo,
        canUpdate: false
      })
    })
  })

  describe('gene-ref:check-updates', () => {
    it('disables needsUpdate and canUpdate when app is packaged', async () => {
      Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
      vi.mocked(existsSync).mockReturnValue(true)

      const handler = ipc.handlers.get('gene-ref:check-updates')!
      const result = (await handler({})) as { canUpdate: boolean; needsUpdate: boolean }
      expect(result.canUpdate).toBe(false)
      expect(result.needsUpdate).toBe(false)
    })

    it('allows needsUpdate when unpackaged, script exists, and age > 90 days', async () => {
      Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
      vi.mocked(existsSync).mockReturnValue(true)

      const handler = ipc.handlers.get('gene-ref:check-updates')!
      const result = (await handler({})) as { canUpdate: boolean; needsUpdate: boolean }
      expect(result.canUpdate).toBe(true)
      expect(result.needsUpdate).toBe(true)
    })
  })

  describe('gene-ref:update', () => {
    it('refuses to update when app is packaged without invoking execFile', async () => {
      Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
      vi.mocked(existsSync).mockReturnValue(true)

      const handler = ipc.handlers.get('gene-ref:update')!
      const result = (await handler({})) as { success: boolean; message: string }

      expect(result.success).toBe(false)
      expect(result.message).toContain('not available in the packaged app')
      expect(execFile).not.toHaveBeenCalled()
    })

    it('refuses to update when build script does not exist', async () => {
      Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
      vi.mocked(existsSync).mockReturnValue(false)

      const handler = ipc.handlers.get('gene-ref:update')!
      const result = (await handler({})) as { success: boolean; message: string }

      expect(result.success).toBe(false)
      expect(result.message).toContain('not available in the packaged app')
      expect(execFile).not.toHaveBeenCalled()
    })

    it('invokes execFile with shell: true on Windows and completes update', async () => {
      Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
      vi.mocked(existsSync).mockReturnValue(true)

      const originalPlatform = process.platform
      try {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

        vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
          expect(typeof options).toBe('object')
          expect((options as { shell: boolean }).shell).toBe(true)
          if (typeof callback === 'function') {
            callback(null, 'build output', '')
          }
          return {} as never
        })

        const handler = ipc.handlers.get('gene-ref:update')!
        const result = (await handler({})) as { success: boolean; message: string }

        expect(result.success).toBe(true)
        expect(copyFileSync).toHaveBeenCalled()
        expect(closeGeneReferenceDb).toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
      }
    })

    it('invokes execFile with shell: false on non-Windows', async () => {
      Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
      vi.mocked(existsSync).mockReturnValue(true)

      const originalPlatform = process.platform
      try {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

        vi.mocked(execFile).mockImplementation((cmd, _args, options, callback) => {
          expect(cmd).toBe('npx')
          expect((options as { shell: boolean }).shell).toBe(false)
          if (typeof callback === 'function') {
            callback(null, 'build output', '')
          }
          return {} as never
        })

        const handler = ipc.handlers.get('gene-ref:update')!
        const result = (await handler({})) as { success: boolean; message: string }

        expect(result.success).toBe(true)
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
      }
    })
  })
})
