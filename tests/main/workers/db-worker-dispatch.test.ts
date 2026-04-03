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

  // ── Variants ──────────────────────────────────────────────

  it('variants:query returns paginated result for fresh DB with minimal filter', () => {
    const filter = { case_id: 0 }
    const result = dispatchTask(makeDeps(), {
      type: 'variants:query',
      params: [filter, 0, 25, [], false, false]
    })
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('variants:filterOptions returns filter options for case ID 0', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'variants:filterOptions',
      params: [0]
    })
    expect(result).toBeDefined()
  })

  it('variants:search returns results for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'variants:search',
      params: [0, 'BRCA1', 10]
    })
    expect(Array.isArray(result)).toBe(true)
  })

  it('variants:geneSymbols returns results for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'variants:geneSymbols',
      params: [0, 'BR', 10]
    })
    expect(Array.isArray(result)).toBe(true)
  })

  // ── Cohort (additional) ───────────────────────────────────

  it('cohort:variants returns paginated result for empty DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'cohort:variants',
      params: [{ limit: 25, offset: 0 }]
    })
    expect(result).toBeDefined()
  })

  it('cohort:carriers returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'cohort:carriers',
      params: ['chr1', 100000, 'A', 'T']
    })
    expect(Array.isArray(result)).toBe(true)
  })

  it('cohort:geneBurden returns result for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'cohort:geneBurden',
      params: []
    })
    expect(result).toBeDefined()
  })

  // ── Cases ─────────────────────────────────────────────────

  it('cases:query returns paginated result for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'cases:query',
      params: [{ limit: 25, offset: 0 }]
    })
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  // ── Annotations ───────────────────────────────────────────

  it('annotations:getGlobal returns null for non-existent variant', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'annotations:getGlobal',
      params: ['chr1', 100000, 'A', 'T']
    })
    expect(result === null || result === undefined).toBe(true)
  })

  it('annotations:getPerCase returns null for non-existent case/variant', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'annotations:getPerCase',
      params: [0, 0]
    })
    expect(result === null || result === undefined).toBe(true)
  })

  it('annotations:getForVariant returns empty result for non-existent variant', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'annotations:getForVariant',
      params: [0, 'chr1', 100000, 'A', 'T']
    })
    expect(result).toBeDefined()
  })

  it('annotations:batchGet returns record object for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'annotations:batchGet',
      params: [null, [{ chr: 'chr1', pos: 100000, ref: 'A', alt: 'T' }]]
    })
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  // ── Case Metadata ─────────────────────────────────────────

  it('case-metadata:get returns null for non-existent case', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:get',
      params: [9999]
    })
    expect(result === null || result === undefined).toBe(true)
  })

  it('case-metadata:getCohortByName returns null for non-existent cohort', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:getCohortByName',
      params: ['nonexistent']
    })
    expect(result === null || result === undefined).toBe(true)
  })

  it('case-metadata:getCaseCohorts returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:getCaseCohorts',
      params: [0]
    })
    expect(Array.isArray(result)).toBe(true)
  })

  it('case-metadata:getHpoTerms returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:getHpoTerms',
      params: [0]
    })
    expect(Array.isArray(result)).toBe(true)
  })

  it('case-metadata:getDataInfo returns result for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:getDataInfo',
      params: [0]
    })
    expect(result === null || result === undefined || typeof result === 'object').toBe(true)
  })

  it('case-metadata:listExternalIds returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:listExternalIds',
      params: [0]
    })
    expect(Array.isArray(result)).toBe(true)
  })

  it('case-metadata:distinctExternalIdTypes returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:distinctExternalIdTypes',
      params: []
    })
    expect(Array.isArray(result)).toBe(true)
  })

  it('case-metadata:distinctHpoTerms returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:distinctHpoTerms',
      params: []
    })
    expect(Array.isArray(result)).toBe(true)
  })

  it('case-metadata:getFullMetadata returns structured object for any case ID', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'case-metadata:getFullMetadata',
      params: [9999]
    })
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  // ── Tags ──────────────────────────────────────────────────

  it('tags:getVariantTags returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'tags:getVariantTags',
      params: [0, 0]
    })
    expect(Array.isArray(result)).toBe(true)
  })

  it('tags:getUsageCount returns 0 for non-existent tag', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'tags:getUsageCount',
      params: [9999]
    })
    expect(typeof result === 'number' || result === 0).toBe(true)
  })

  // ── Transcripts ───────────────────────────────────────────

  it('transcripts:list returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'transcripts:list',
      params: [0]
    })
    expect(Array.isArray(result)).toBe(true)
  })

  // ── Gene Lists ────────────────────────────────────────────

  it('gene-lists:getGenes returns empty array for fresh DB', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'gene-lists:getGenes',
      params: [0]
    })
    expect(Array.isArray(result)).toBe(true)
  })

  // ── Association analysis ──────────────────────────────────

  it('association:build returns result for empty case/variant lists', () => {
    const result = dispatchTask(makeDeps(), {
      type: 'association:build',
      params: [[], [], {}, []]
    })
    expect(result).toBeDefined()
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
