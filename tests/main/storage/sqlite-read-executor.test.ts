import { describe, expect, it, vi } from 'vitest'

const geneReference = vi.hoisted(() => ({ getCoordinatesForGenes: vi.fn() }))
vi.mock('../../../src/main/database/geneReferenceLoader', () => ({
  getGeneReferenceDb: () => geneReference
}))

import { SqliteReadExecutor } from '../../../src/main/storage/sqlite/SqliteReadExecutor'
import type { ValidatedCaseSearchParams } from '../../../src/shared/types/ipc-schemas'

describe('SqliteReadExecutor', () => {
  const params: ValidatedCaseSearchParams = {
    limit: 25,
    offset: 0,
    sort_by: 'created_at',
    sort_order: 'desc'
  }

  const caseMetadataReadTasks = [
    {
      task: { type: 'case-metadata:get' as const, params: [1] as [number] },
      metadataMethod: 'getCaseMetadata',
      expectedArgs: [1]
    },
    {
      task: { type: 'case-metadata:listCohorts' as const, params: [] as [] },
      metadataMethod: 'listCohortGroups',
      expectedArgs: []
    },
    {
      task: { type: 'case-metadata:getFullMetadata' as const, params: [1] as [number] },
      metadataMethod: 'getFullCaseMetadata',
      expectedArgs: [1]
    }
  ]

  it('uses the worker read pool for cases:query when a pool exists', async () => {
    const expected = { data: [], total_count: 0 }
    const dbPool = {
      run: vi.fn().mockResolvedValue(expected)
    }
    const databaseService = {
      cases: {
        queryCases: vi.fn()
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, dbPool as never)

    await expect(executor.execute({ type: 'cases:query', params: [params] })).resolves.toBe(
      expected
    )
    expect(dbPool.run).toHaveBeenCalledWith({
      type: 'cases:query',
      params: [params]
    })
    // Note: the SqliteReadExecutor now passes task.params (the tuple)
    // straight through to the pool — no extra wrapping.
    expect(databaseService.cases.queryCases).not.toHaveBeenCalled()
  })

  it('falls back to DatabaseService for cases:query when no pool exists', async () => {
    const expected = { data: [], total_count: 0 }
    const databaseService = {
      cases: {
        queryCases: vi.fn().mockReturnValue(expected)
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, null)

    await expect(executor.execute({ type: 'cases:query', params: [params] })).resolves.toBe(
      expected
    )
    expect(databaseService.cases.queryCases).toHaveBeenCalledWith(params)
  })

  it('uses the worker read pool for cases:availableBuilds when a pool exists', async () => {
    const expected = [{ build: 'GRCh38', caseCount: 2 }]
    const dbPool = {
      run: vi.fn().mockResolvedValue(expected)
    }
    const databaseService = {
      cases: {
        getAvailableGenomeBuilds: vi.fn()
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, dbPool as never)

    await expect(executor.execute({ type: 'cases:availableBuilds', params: [] })).resolves.toBe(
      expected
    )
    expect(dbPool.run).toHaveBeenCalledWith({
      type: 'cases:availableBuilds',
      params: []
    })
    expect(databaseService.cases.getAvailableGenomeBuilds).not.toHaveBeenCalled()
  })

  it('falls back to DatabaseService for cases:availableBuilds when no pool exists', async () => {
    const expected = [{ build: 'GRCh37', caseCount: 1 }]
    const databaseService = {
      cases: {
        getAvailableGenomeBuilds: vi.fn().mockReturnValue(expected)
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, null)

    await expect(executor.execute({ type: 'cases:availableBuilds', params: [] })).resolves.toBe(
      expected
    )
    expect(databaseService.cases.getAvailableGenomeBuilds).toHaveBeenCalledWith()
  })

  it.each(caseMetadataReadTasks)(
    'uses the worker read pool for $task.type when a pool exists',
    async ({ task }) => {
      const expected = { ok: true }
      const dbPool = {
        run: vi.fn().mockResolvedValue(expected)
      }
      const databaseService = {
        metadata: {}
      }
      const executor = new SqliteReadExecutor(databaseService as never, dbPool as never)

      await expect(executor.execute(task)).resolves.toBe(expected)
      expect(dbPool.run).toHaveBeenCalledWith(task)
    }
  )

  it.each(caseMetadataReadTasks)(
    'falls back to DatabaseService metadata for $task.type when no pool exists',
    async ({ task, metadataMethod, expectedArgs }) => {
      const expected = { ok: true }
      const databaseService = {
        metadata: {
          [metadataMethod]: vi.fn().mockReturnValue(expected)
        }
      }
      const executor = new SqliteReadExecutor(databaseService as never, null)

      await expect(executor.execute(task)).resolves.toBe(expected)
      expect(databaseService.metadata[metadataMethod]).toHaveBeenCalledWith(...expectedArgs)
    }
  )

  it('dispatches variant reads through the sqlite worker pool when present', async () => {
    const dbPool = { run: vi.fn().mockResolvedValue({ snv: 1 }) }
    const executor = new SqliteReadExecutor({} as never, dbPool as never)

    await expect(
      executor.execute({ type: 'variants:typeCounts', params: [1] })
    ).resolves.toStrictEqual({ snv: 1 })

    expect(dbPool.run).toHaveBeenCalledWith({ type: 'variants:typeCounts', params: [1] })
  })

  it('dispatches variant reads to DatabaseService when no pool is present', async () => {
    const databaseService = {
      variants: {
        getVariantTypeCounts: vi.fn().mockReturnValue({ snv: 1 }),
        getVariantTypesPresent: vi.fn().mockReturnValue(new Set(['snv'])),
        getGeneSymbols: vi.fn().mockReturnValue(['BRCA1'])
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, null)

    await expect(
      executor.execute({ type: 'variants:typeCounts', params: [1] })
    ).resolves.toStrictEqual({ snv: 1 })
    await expect(
      executor.execute({ type: 'variants:typesPresent', params: [{ caseId: 1 }] })
    ).resolves.toStrictEqual(['snv'])
    await expect(
      executor.execute({ type: 'variants:geneSymbols', params: [1, 'BR', 20] })
    ).resolves.toStrictEqual(['BRCA1'])
  })

  it('uses the worker read pool for transcripts:list when a pool exists', async () => {
    const expected = [{ transcript_id: 'NM_000059.4' }]
    const dbPool = {
      run: vi.fn().mockResolvedValue(expected)
    }
    const databaseService = {
      transcripts: {
        getVariantTranscripts: vi.fn()
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, dbPool as never)

    await expect(executor.execute({ type: 'transcripts:list', params: [42] })).resolves.toBe(
      expected
    )
    expect(dbPool.run).toHaveBeenCalledWith({
      type: 'transcripts:list',
      params: [42]
    })
    expect(databaseService.transcripts.getVariantTranscripts).not.toHaveBeenCalled()
  })

  it('falls back to DatabaseService for transcripts:list when no pool exists', async () => {
    const expected = [{ transcript_id: 'NM_000059.4' }]
    const databaseService = {
      transcripts: {
        getVariantTranscripts: vi.fn().mockReturnValue(expected)
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, null)

    await expect(executor.execute({ type: 'transcripts:list', params: [42] })).resolves.toBe(
      expected
    )
    expect(databaseService.transcripts.getVariantTranscripts).toHaveBeenCalledWith(42)
  })

  describe('panels:resolutionStatus', () => {
    const expected = { genomeBuild: 'x', totalGenes: 1, unmappedCount: 0, unmappedGenes: [] }

    function makeExecutor(caseBuild: string | null | undefined): {
      executor: SqliteReadExecutor
      getResolutionStatus: ReturnType<typeof vi.fn>
      prepare: ReturnType<typeof vi.fn>
    } {
      const getResolutionStatus = vi.fn().mockReturnValue(expected)
      const prepare = vi.fn().mockReturnValue({
        get: vi
          .fn()
          .mockReturnValue(caseBuild === undefined ? undefined : { genome_build: caseBuild })
      })
      const databaseService = { panels: { getResolutionStatus }, database: { prepare } }
      return {
        executor: new SqliteReadExecutor(databaseService as never, null),
        getResolutionStatus,
        prepare
      }
    }

    it('resolves against the genome build of the case', async () => {
      const { executor, getResolutionStatus } = makeExecutor('GRCh37')

      await expect(
        executor.execute({
          type: 'panels:resolutionStatus',
          params: [{ panelIds: [3], caseId: 9 }]
        })
      ).resolves.toBe(expected)
      expect(getResolutionStatus).toHaveBeenCalledWith([3], 'GRCh37', geneReference)
    })

    it('prefers the requested build and does not read the case', async () => {
      const { executor, getResolutionStatus, prepare } = makeExecutor('GRCh37')

      await executor.execute({
        type: 'panels:resolutionStatus',
        params: [{ panelIds: [3], caseId: 9, genomeBuild: 'GRCh38' }]
      })
      expect(getResolutionStatus).toHaveBeenCalledWith([3], 'GRCh38', geneReference)
      expect(prepare).not.toHaveBeenCalled()
    })

    it('falls back to GRCh38 for an unknown case or a case without a build', async () => {
      for (const caseBuild of [undefined, null]) {
        const { executor, getResolutionStatus } = makeExecutor(caseBuild)
        await executor.execute({
          type: 'panels:resolutionStatus',
          params: [{ panelIds: [3], caseId: 9 }]
        })
        expect(getResolutionStatus).toHaveBeenCalledWith([3], 'GRCh38', geneReference)
      }
    })
  })
})
