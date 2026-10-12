// @vitest-environment node
/**
 * E-03: a save dialog that returns the open (or a recent) database, or one of
 * its SQLite sidecar files, must be refused before anything is written.
 */
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  prepareVariantExport: vi.fn(),
  exportVariants: vi.fn(),
  exportCohort: vi.fn(),
  generateBedContent: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false }] },
  dialog: { showSaveDialog: mocks.showSaveDialog },
  shell: { showItemInFolder: vi.fn() }
}))

vi.mock('../../../../src/main/ipc/handlers/export-logic', () => ({
  prepareVariantExport: mocks.prepareVariantExport,
  exportVariants: mocks.exportVariants,
  exportCohort: mocks.exportCohort,
  exportPostgresVariants: vi.fn(),
  exportPostgresCohort: vi.fn(),
  cancelActiveExport: vi.fn()
}))

vi.mock('../../../../src/main/ipc/handlers/panels-logic', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateBedContent: mocks.generateBedContent
}))

vi.mock('../../../../src/main/database/geneReferenceLoader', () => ({
  getGeneReferenceDb: () => null
}))

import { DATABASE_CONFIG } from '../../../../src/shared/config'
import { registerExportHandlers } from '../../../../src/main/ipc/handlers/export'
import { registerPanelHandlers } from '../../../../src/main/ipc/handlers/panels'

type Handler = (...args: unknown[]) => Promise<unknown>

let dir: string
let currentDb: string
let recentDb: string
let handlers: Map<string, Handler>
const DB_BYTES = Buffer.from('encrypted-database-bytes')

function register(): void {
  handlers = new Map()
  const ipcMain = { handle: (channel: string, h: Handler) => handlers.set(channel, h) }
  const deps = {
    ipcMain: ipcMain as never,
    getDb: vi.fn() as never,
    getDbManager: (() => ({
      getCurrentSession: () => ({ capabilities: { backend: 'sqlite' } }),
      getCurrentPath: () => currentDb,
      getRecentDatabases: () => [{ path: recentDb }]
    })) as never,
    getDbPool: (() => null) as never
  }
  registerExportHandlers(deps)
  registerPanelHandlers(deps)
}

const invoke = {
  variants: () => handlers.get('export:variants')!(undefined, 1, {}, 'Case A'),
  cohort: () => handlers.get('export:cohort')!(undefined, {}),
  bed: () =>
    handlers.get('panels:export-bed')!(undefined, { panelId: 1, assembly: 'GRCh38', paddingBp: 0 })
}

describe('export save-path database guard', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-export-guard-'))
    currentDb = join(dir, 'current.db')
    recentDb = join(dir, 'recent.db')
    for (const f of [currentDb, `${currentDb}-wal`, recentDb]) writeFileSync(f, DB_BYTES)
    mocks.prepareVariantExport.mockResolvedValue({ compiled: {} })
    mocks.exportVariants.mockImplementation(async (_g, _c, _f, _n, out: string) => {
      writeFileSync(out, 'xlsx')
      return { success: true, filePath: out }
    })
    mocks.exportCohort.mockImplementation(async (_g, _p, out: string) => {
      writeFileSync(out, 'xlsx')
      return { success: true, filePath: out }
    })
    mocks.generateBedContent.mockReturnValue({
      panelName: 'P',
      geneCount: 1,
      lines: ['chr1\t1\t2']
    })
    register()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  // Table-driven from config: the open database, each sidecar, a recent database.
  const targets = (): Record<string, string> => ({
    'the open database': currentDb,
    ...Object.fromEntries(
      DATABASE_CONFIG.SIDECAR_SUFFIXES.map((suffix) => [`its ${suffix} file`, currentDb + suffix])
    ),
    'a recent database': recentDb,
    'a non-normalised path to it': join(dir, 'sub', '..', 'current.db')
  })
  const labels = [
    'the open database',
    ...DATABASE_CONFIG.SIDECAR_SUFFIXES.map((suffix) => `its ${suffix} file`),
    'a recent database',
    'a non-normalised path to it'
  ]

  for (const channel of ['variants', 'cohort', 'bed'] as const) {
    for (const label of labels) {
      it(`${channel}: refuses ${label} and leaves the bytes untouched`, async () => {
        const target = targets()[label]
        mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
        const result = await invoke[channel]()
        expect(result).toMatchObject({
          code: 'INVALID_PARAMETERS',
          userMessage: DATABASE_CONFIG.MESSAGES.EXPORT_TARGET_IS_DATABASE
        })
        expect(readFileSync(currentDb)).toEqual(DB_BYTES)
        expect(readFileSync(`${currentDb}-wal`)).toEqual(DB_BYTES)
        expect(readFileSync(recentDb)).toEqual(DB_BYTES)
        expect(mocks.exportVariants).not.toHaveBeenCalled()
        expect(mocks.exportCohort).not.toHaveBeenCalled()
      })
    }

    it(`${channel}: refuses a symlink that points at the open database`, async () => {
      const link = join(dir, 'export.xlsx')
      symlinkSync(currentDb, link)
      mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: link })
      expect(await invoke[channel]()).toMatchObject({ code: 'INVALID_PARAMETERS' })
      expect(readFileSync(currentDb)).toEqual(DB_BYTES)
    })

    it(`${channel}: still writes an ordinary file next to the database`, async () => {
      const out = join(dir, `export.${channel === 'bed' ? 'bed' : 'xlsx'}`)
      mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: out })
      const result = await invoke[channel]()
      expect(result).toMatchObject({ success: true })
      expect(readFileSync(out).length).toBeGreaterThan(0)
      expect(readFileSync(currentDb)).toEqual(DB_BYTES)
    })
  }
})
