import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  __resetAllowlistForTests,
  addAllowedImportPath,
  isStrictlyEnrolledPath
} from '../../../src/main/security/import-path-allowlist'
import {
  __resetExportPathAllowlistForTests,
  isAllowedExportRevealPath
} from '../../../src/main/security/export-path-allowlist'

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  exportPostgresVariants: vi.fn(),
  exportPostgresCohort: vi.fn(),
  prepareVariantExport: vi.fn(),
  exportVariants: vi.fn(),
  exportCohort: vi.fn(),
  showItemInFolder: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false }]
  },
  dialog: {
    showSaveDialog: mocks.showSaveDialog
  },
  shell: { showItemInFolder: mocks.showItemInFolder }
}))

vi.mock('../../../src/main/ipc/handlers/export-logic', () => ({
  prepareVariantExport: mocks.prepareVariantExport,
  exportVariants: mocks.exportVariants,
  exportCohort: mocks.exportCohort,
  exportPostgresVariants: mocks.exportPostgresVariants,
  exportPostgresCohort: mocks.exportPostgresCohort
}))

describe('postgres export IPC routing', () => {
  beforeEach(() => {
    __resetAllowlistForTests()
    __resetExportPathAllowlistForTests()
  })

  it('enrolls the export:variants save-dialog result only for export-scoped reveal', async () => {
    const outputPath = '/some/custom/mount/case1_variants.csv'
    const execute = vi.fn().mockResolvedValue(
      (async function* () {
        yield { id: 1 }
      })()
    )
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    }

    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: outputPath })
    mocks.exportPostgresVariants.mockResolvedValue({ success: true, filePath: outputPath })

    const { registerExportHandlers } = await import('../../../src/main/ipc/handlers/export')
    registerExportHandlers({
      ipcMain: ipcMain as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres export:variants')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'postgres' },
          getReadExecutor: () => ({ execute })
        })
      })) as never,
      getDbPool: (() => null) as never
    })

    expect(isStrictlyEnrolledPath(outputPath)).toBe(false)
    const handler = handlers.get('export:variants')
    await handler!(undefined, 5, { gene_symbol: 'BRCA1' }, 'Postgres Case')
    expect(isStrictlyEnrolledPath(outputPath)).toBe(false)
    expect(isAllowedExportRevealPath(outputPath)).toBe(true)

    const revealHandler = handlers.get('export:revealInFolder')
    const revealResult = await revealHandler!(undefined, outputPath)
    expect(revealResult).toEqual({ success: true })
    expect(mocks.showItemInFolder).toHaveBeenCalledWith(outputPath)
  })

  it('does not let import path authority reveal a file through the export capability', async () => {
    const importPath = '/some/custom/mount/imported.vcf'
    addAllowedImportPath(importPath)
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    }
    const { registerExportHandlers } = await import('../../../src/main/ipc/handlers/export')
    registerExportHandlers({
      ipcMain: ipcMain as never,
      getDb: vi.fn() as never,
      getDbManager: vi.fn() as never
    })

    const result = await handlers.get('export:revealInFolder')!(undefined, importPath)

    expect(result).toMatchObject({ code: 'INVALID_PARAMETERS' })
    expect(mocks.showItemInFolder).not.toHaveBeenCalled()
  })

  it('streams postgres variant exports through the active storage read executor', async () => {
    const rows = (async function* () {
      yield { id: 1 }
    })()
    const execute = vi.fn().mockResolvedValue(rows)
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    }

    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/pg-export.csv' })
    mocks.exportPostgresVariants.mockResolvedValue({
      success: true,
      filePath: '/tmp/pg-export.csv'
    })

    const { registerExportHandlers } = await import('../../../src/main/ipc/handlers/export')

    registerExportHandlers({
      ipcMain: ipcMain as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres export:variants')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'postgres' },
          getReadExecutor: () => ({ execute })
        })
      })) as never,
      getDbPool: (() => null) as never
    })

    const handler = handlers.get('export:variants')
    expect(handler).toBeTypeOf('function')

    const result = await handler!(undefined, 5, { gene_symbol: 'BRCA1' }, 'Postgres Case')

    expect(result).toEqual({ success: true, filePath: '/tmp/pg-export.csv' })
    expect(mocks.prepareVariantExport).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'export:variants',
      params: [{ gene_symbol: 'BRCA1', case_id: 5 }]
    })
    expect(mocks.exportPostgresVariants).toHaveBeenCalledWith(
      rows,
      '/tmp/pg-export.csv',
      expect.objectContaining({ onProgress: expect.any(Function) })
    )
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Export Variants to CSV',
        defaultPath: 'Postgres_Case_variants.csv',
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
    )
  })

  it('streams postgres cohort exports through the active storage read executor', async () => {
    const rows = (async function* () {
      yield { chr: '1', pos: 101 }
    })()
    const execute = vi.fn().mockResolvedValue(rows)
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    }

    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/pg-cohort.csv' })
    mocks.exportPostgresCohort.mockResolvedValue({
      success: true,
      filePath: '/tmp/pg-cohort.csv'
    })

    const { registerExportHandlers } = await import('../../../src/main/ipc/handlers/export')

    registerExportHandlers({
      ipcMain: ipcMain as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres export:cohort')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'postgres' },
          getReadExecutor: () => ({ execute })
        })
      })) as never,
      getDbPool: (() => null) as never
    })

    const handler = handlers.get('export:cohort')
    expect(handler).toBeTypeOf('function')

    const params = { gene_symbol: 'BRCA1', limit: 100 }
    const result = await handler!(undefined, params)

    expect(result).toEqual({ success: true, filePath: '/tmp/pg-cohort.csv' })
    expect(execute).toHaveBeenCalledWith({
      type: 'export:cohort',
      params: [params]
    })
    expect(mocks.exportPostgresCohort).toHaveBeenCalledWith(
      rows,
      '/tmp/pg-cohort.csv',
      expect.objectContaining({ onProgress: expect.any(Function) })
    )
    expect(mocks.exportCohort).not.toHaveBeenCalled()
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Export Cohort Variants to CSV',
        defaultPath: expect.stringMatching(/^cohort_variants_\d{4}-\d{2}-\d{2}\.csv$/),
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
    )
  })
})
