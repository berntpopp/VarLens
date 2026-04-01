/**
 * Tests for panel interval computation off-thread behaviour.
 *
 * Verifies:
 * 1. When the pool IS available, active_panel_ids are forwarded to the pool
 *    task unchanged (not pre-computed on the main thread).
 * 2. When the pool is NOT available, intervals are computed inline on the
 *    main thread before calling the repository directly.
 * 3. The PanelRepository.computeIntervals helper correctly applies padding
 *    and chr prefix to a stub gene reference DB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createKysely } from '../../../src/main/database/kysely'
import { PanelRepository } from '../../../src/main/database/PanelRepository'
import type { HandlerDependencies } from '../../../src/main/ipc/types'
import type { IpcMain } from 'electron'
import type { DbPool } from '../../../src/main/database/DbPool'
import type { DatabaseManager } from '../../../src/main/services/DatabaseManager'

// ── Test helpers ────────────────────────────────────────────────

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initializeSchema(db)
  runMigrations(db)
  return db
}

// ── Suite 1: Pool-available path ────────────────────────────────

describe('variants:query — pool available path', () => {
  let dbService: DatabaseService
  let poolRunCalls: Array<{ type: string; params: unknown[] }>
  let poolRunSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    dbService = new DatabaseService(':memory:')
    poolRunCalls = []
    poolRunSpy = vi.fn(async (task: { type: string; params: unknown[] }) => {
      poolRunCalls.push(task)
      return { data: [], total_count: 0 }
    })
  })

  afterEach(() => {
    dbService.close()
    vi.restoreAllMocks()
  })

  it('passes active_panel_ids and genome_build to the pool task unchanged', async () => {
    const caseId = dbService.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build) VALUES (?,?,?,?,?,?)'
      )
      .run('test', '/t.vcf', 0, 0, Date.now(), 'GRCh38').lastInsertRowid as number

    const fakePool = { run: poolRunSpy } as unknown as DbPool

    const deps: HandlerDependencies = {
      ipcMain: { handle: vi.fn() } as unknown as IpcMain,
      getDb: () => dbService,
      getDbManager: vi.fn() as unknown as () => DatabaseManager,
      getDbPool: () => fakePool
    }

    const { registerVariantHandlers } = await import('../../../src/main/ipc/handlers/variants')

    let capturedHandler: ((...args: unknown[]) => Promise<unknown>) | null = null
    ;(deps.ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        if (channel === 'variants:query') capturedHandler = handler
      }
    )
    registerVariantHandlers(deps)

    expect(capturedHandler).not.toBeNull()

    const filter = {
      consequences: [],
      active_panel_ids: [1, 2],
      panel_padding_bp: 10000
    }
    await capturedHandler!({} as Electron.IpcMainInvokeEvent, caseId, filter, 0, 50, undefined)

    expect(poolRunSpy).toHaveBeenCalledOnce()
    const task = poolRunCalls[0]
    expect(task.type).toBe('variants:query')

    // The filter passed to the pool should still carry active_panel_ids and genome_build
    const passedFilter = task.params[0] as Record<string, unknown>
    expect(passedFilter.active_panel_ids).toEqual([1, 2])
    expect(passedFilter.genome_build).toBe('GRCh38')

    // panel_intervals should NOT be pre-computed on the main thread
    expect(passedFilter.panel_intervals).toBeUndefined()
  })

  it('does not attach genome_build when no active panels are provided', async () => {
    const caseId = dbService.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build) VALUES (?,?,?,?,?,?)'
      )
      .run('test2', '/t2.vcf', 0, 0, Date.now(), 'GRCh38').lastInsertRowid as number

    const fakePool = { run: poolRunSpy } as unknown as DbPool
    const deps: HandlerDependencies = {
      ipcMain: { handle: vi.fn() } as unknown as IpcMain,
      getDb: () => dbService,
      getDbManager: vi.fn() as unknown as () => DatabaseManager,
      getDbPool: () => fakePool
    }

    const { registerVariantHandlers } = await import('../../../src/main/ipc/handlers/variants')

    let capturedHandler: ((...args: unknown[]) => Promise<unknown>) | null = null
    ;(deps.ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        if (channel === 'variants:query') capturedHandler = handler
      }
    )
    registerVariantHandlers(deps)

    await capturedHandler!({} as Electron.IpcMainInvokeEvent, caseId, {}, 0, 50, undefined)

    const task = poolRunCalls[0]
    const passedFilter = task.params[0] as Record<string, unknown>
    // No panel fields should be present when no panels are active
    expect(passedFilter.active_panel_ids).toBeUndefined()
    expect(passedFilter.genome_build).toBeUndefined()
    expect(passedFilter.panel_intervals).toBeUndefined()
  })
})

// ── Suite 2: No-pool fallback path ──────────────────────────────

describe('variants:query — no pool fallback path', () => {
  let dbService: DatabaseService

  beforeEach(() => {
    dbService = new DatabaseService(':memory:')
  })

  afterEach(() => {
    dbService.close()
    vi.restoreAllMocks()
  })

  it('invokes computePanelIntervals inline when no pool is available', async () => {
    const caseId = dbService.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build) VALUES (?,?,?,?,?,?)'
      )
      .run('test-nopanel', '/t.vcf', 0, 0, Date.now(), 'GRCh38').lastInsertRowid as number

    // Add a panel with a gene
    const panel = dbService.panels.createPanel({ name: 'TestPanel', source: 'manual' })
    dbService.panels.setGenes(panel.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])

    const helperModule = await import('../../../src/main/ipc/handlers/panelIntervalHelper')
    const computeSpy = vi.spyOn(helperModule, 'computePanelIntervals')

    const deps: HandlerDependencies = {
      ipcMain: { handle: vi.fn() } as unknown as IpcMain,
      getDb: () => dbService,
      getDbManager: vi.fn() as unknown as () => DatabaseManager,
      getDbPool: () => null // no pool
    }

    const { registerVariantHandlers } = await import('../../../src/main/ipc/handlers/variants')

    let capturedHandler: ((...args: unknown[]) => Promise<unknown>) | null = null
    ;(deps.ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        if (channel === 'variants:query') capturedHandler = handler
      }
    )
    registerVariantHandlers(deps)

    const filter = {
      active_panel_ids: [panel.id],
      panel_padding_bp: 0
    }

    // The call may succeed or fail depending on whether gene ref DB is present;
    // we only care that computePanelIntervals was invoked on the main thread.
    try {
      await capturedHandler!({} as Electron.IpcMainInvokeEvent, caseId, filter, 0, 50, undefined)
    } catch {
      // Expected if gene ref DB is missing in test environment
    }

    expect(computeSpy).toHaveBeenCalled()
    computeSpy.mockRestore()
  })
})

// ── Suite 3: PanelRepository.computeIntervals (worker-side logic) ──

describe('PanelRepository.computeIntervals — worker-side logic', () => {
  let rawDb: Database.Database
  let panels: PanelRepository

  beforeEach(() => {
    rawDb = createInMemoryDb()
    const kysely = createKysely(rawDb)
    panels = new PanelRepository(rawDb, kysely)
  })

  afterEach(() => {
    rawDb.close()
  })

  it('returns empty array for a panel with no genes (no gene ref DB call needed)', () => {
    const panel = panels.createPanel({ name: 'Empty', source: 'manual' })

    const stubGeneRefDb = {
      getCoordinatesForGenes: () => new Map()
    } as unknown as import('../../../src/main/database/GeneReferenceDb').GeneReferenceDb

    const intervals = panels.computeIntervals([panel.id], 'GRCh38', 5000, stubGeneRefDb, false)
    expect(intervals).toEqual([])
  })

  it('applies padding and chr prefix via stub gene reference DB', () => {
    const panel = panels.createPanel({ name: 'WithGenes', source: 'manual' })
    panels.setGenes(panel.id, [{ hgncId: 'HGNC:TEST1', symbol: 'TESTGENE' }])

    const stubGeneRefDb = {
      getCoordinatesForGenes: () => {
        const m = new Map<
          string,
          {
            hgncId: string
            assembly: string
            chromosome: string
            start_pos: number
            end_pos: number
            strand: string
          }
        >()
        m.set('HGNC:TEST1', {
          hgncId: 'HGNC:TEST1',
          assembly: 'GRCh38',
          chromosome: '17',
          start_pos: 43044295,
          end_pos: 43170245,
          strand: '-'
        })
        return m
      }
    } as unknown as import('../../../src/main/database/GeneReferenceDb').GeneReferenceDb

    // Without chr prefix, no padding
    const withoutPrefix = panels.computeIntervals([panel.id], 'GRCh38', 0, stubGeneRefDb, false)
    expect(withoutPrefix).toHaveLength(1)
    expect(withoutPrefix[0].chr).toBe('17')
    expect(withoutPrefix[0].start).toBe(43044295)
    expect(withoutPrefix[0].end).toBe(43170245)

    // With chr prefix and padding
    const withPrefix = panels.computeIntervals([panel.id], 'GRCh38', 1000, stubGeneRefDb, true)
    expect(withPrefix).toHaveLength(1)
    expect(withPrefix[0].chr).toBe('chr17')
    expect(withPrefix[0].start).toBe(43044295 - 1000)
    expect(withPrefix[0].end).toBe(43170245 + 1000)
  })
})

// ── Suite 4: cohort:variants — pool available path ───────────────

describe('cohort:variants — pool available path', () => {
  let dbService: DatabaseService
  let poolRunCalls: Array<{ type: string; params: unknown[] }>
  let poolRunSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    dbService = new DatabaseService(':memory:')
    poolRunCalls = []
    poolRunSpy = vi.fn(async (task: { type: string; params: unknown[] }) => {
      poolRunCalls.push(task)
      return { data: [], total_count: 0 }
    })
  })

  afterEach(() => {
    dbService.close()
    vi.restoreAllMocks()
  })

  it('passes active_panel_ids and genome_build=GRCh38 to pool for cohort queries', async () => {
    const fakePool = { run: poolRunSpy } as unknown as DbPool

    const deps: HandlerDependencies = {
      ipcMain: { handle: vi.fn() } as unknown as IpcMain,
      getDb: () => dbService,
      getDbManager: vi.fn() as unknown as () => DatabaseManager,
      getDbPool: () => fakePool
    }

    const { registerCohortHandlers } = await import('../../../src/main/ipc/handlers/cohort')

    let capturedHandler: ((...args: unknown[]) => Promise<unknown>) | null = null
    ;(deps.ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        if (channel === 'cohort:variants') capturedHandler = handler
      }
    )
    registerCohortHandlers(deps)

    expect(capturedHandler).not.toBeNull()

    const cohortParams = {
      active_panel_ids: [3, 4],
      panel_padding_bp: 2000
    }
    await capturedHandler!({} as Electron.IpcMainInvokeEvent, cohortParams)

    expect(poolRunSpy).toHaveBeenCalledOnce()
    const task = poolRunCalls[0]
    expect(task.type).toBe('cohort:variants')

    const passedParams = task.params[0] as Record<string, unknown>
    // Panel IDs forwarded to the worker
    expect(passedParams.active_panel_ids).toEqual([3, 4])
    // genome_build defaults to GRCh38 in cohort mode
    expect(passedParams.genome_build).toBe('GRCh38')
    // Intervals NOT pre-computed on the main thread
    expect(passedParams.panel_intervals).toBeUndefined()
  })
})
