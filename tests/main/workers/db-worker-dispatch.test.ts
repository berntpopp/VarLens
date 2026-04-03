// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createRepositories } from '../../../src/main/database/createRepositories'
import {
  dispatchTask,
  resolvePanelIntervalsInPlace,
  type DispatchDependencies,
  type PanelAwareFilter
} from '../../../src/main/workers/db-worker-dispatch'

describe('db-worker-dispatch', () => {
  let db: DatabaseType

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  const makeDeps = (): DispatchDependencies => ({
    db,
    repos: createRepositories(db),
    geneRefDb: null
  })

  // ── Task dispatch tests ───────────────────────────────────

  it('cases:list returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), { type: 'cases:list', params: [] })
    expect(result).toEqual([])
  })

  it('tags:list returns empty for fresh DB', () => {
    const result = dispatchTask(makeDeps(), { type: 'tags:list', params: [] })
    expect(result).toEqual([])
  })

  it('cohort:summary returns summary object', () => {
    const result = dispatchTask(makeDeps(), { type: 'cohort:summary', params: [] })
    expect(result).toBeDefined()
  })

  it('cohort:columnMeta returns metadata', () => {
    const result = dispatchTask(makeDeps(), { type: 'cohort:columnMeta', params: [] })
    expect(result).toBeDefined()
  })

  it('gene-lists:list returns empty for fresh DB', () => {
    const result = dispatchTask(makeDeps(), { type: 'gene-lists:list', params: [] })
    expect(result).toEqual([])
  })

  it('region-files:list returns empty for fresh DB', () => {
    const result = dispatchTask(makeDeps(), { type: 'region-files:list', params: [] })
    expect(result).toEqual([])
  })

  it('database:overview returns overview object', () => {
    const result = dispatchTask(makeDeps(), { type: 'database:overview', params: [] })
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('case-metadata:listCohorts returns empty for fresh DB', () => {
    const result = dispatchTask(makeDeps(), { type: 'case-metadata:listCohorts', params: [] })
    expect(result).toEqual([])
  })

  it('case-metadata:distinctPlatforms returns empty for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:distinctPlatforms',
      params: []
    })
    expect(result).toEqual([])
  })

  it('cohort:summaryStatus returns status object', () => {
    const result = dispatchTask(makeDeps(), { type: 'cohort:summaryStatus', params: [] })
    expect(result).toBeDefined()
  })

  it('throws on unknown task type', () => {
    expect(() => dispatchTask(makeDeps(), { type: 'unknown:task' as never, params: [] })).toThrow(
      'Unknown db-worker task type'
    )
  })
})

describe('resolvePanelIntervalsInPlace', () => {
  let db: DatabaseType

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('removes IPC-only fields when no panel IDs', () => {
    const filter: PanelAwareFilter = {
      active_panel_ids: [],
      panel_padding_bp: 5000,
      genome_build: 'GRCh38',
      case_id: 1
    }
    const repos = createRepositories(db)
    resolvePanelIntervalsInPlace(filter, repos, null, db)
    expect(filter.active_panel_ids).toBeUndefined()
    expect(filter.panel_padding_bp).toBeUndefined()
    expect(filter.genome_build).toBeUndefined()
  })

  it('removes IPC-only fields when geneRefDb is null', () => {
    const filter: PanelAwareFilter = {
      active_panel_ids: [1, 2],
      panel_padding_bp: 3000,
      genome_build: 'GRCh37'
    }
    const repos = createRepositories(db)
    resolvePanelIntervalsInPlace(filter, repos, null, db)
    expect(filter.active_panel_ids).toBeUndefined()
    expect(filter.panel_padding_bp).toBeUndefined()
    expect(filter.genome_build).toBeUndefined()
    expect(filter.panel_intervals).toBeUndefined()
  })

  it('removes IPC-only fields when active_panel_ids is undefined', () => {
    const filter: PanelAwareFilter = {
      panel_padding_bp: 5000,
      genome_build: 'GRCh38'
    }
    const repos = createRepositories(db)
    resolvePanelIntervalsInPlace(filter, repos, null, db)
    expect(filter.active_panel_ids).toBeUndefined()
    expect(filter.panel_padding_bp).toBeUndefined()
    expect(filter.genome_build).toBeUndefined()
  })
})
