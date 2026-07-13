import { describe, expect, it, vi } from 'vitest'

import { SqliteWriteExecutor } from '../../../src/main/storage/sqlite/SqliteWriteExecutor'

describe('SqliteWriteExecutor', () => {
  it('delegates case-metadata:upsert and returns the repository result', async () => {
    const expected = { case_id: 1, sex: 'female' }
    const databaseService = {
      metadata: {
        upsertCaseMetadata: vi.fn().mockReturnValue(expected)
      }
    }
    const executor = new SqliteWriteExecutor(databaseService as never)

    await expect(
      executor.execute({ type: 'case-metadata:upsert', params: [1, { sex: 'female' }] })
    ).resolves.toBe(expected)
    expect(databaseService.metadata.upsertCaseMetadata).toHaveBeenCalledWith(1, { sex: 'female' })
  })

  it('delegates case-metadata:setCohorts and resolves undefined', async () => {
    const databaseService = {
      metadata: {
        setCaseCohorts: vi.fn()
      }
    }
    const executor = new SqliteWriteExecutor(databaseService as never)

    await expect(
      executor.execute({ type: 'case-metadata:setCohorts', params: [1, [2, 3]] })
    ).resolves.toBeUndefined()
    expect(databaseService.metadata.setCaseCohorts).toHaveBeenCalledWith(1, [2, 3])
  })

  it('delegates case-metadata:deleteExternalId and resolves undefined', async () => {
    const databaseService = {
      metadata: {
        deleteCaseExternalId: vi.fn()
      }
    }
    const executor = new SqliteWriteExecutor(databaseService as never)

    await expect(
      executor.execute({ type: 'case-metadata:deleteExternalId', params: [1, 'MRN'] })
    ).resolves.toBeUndefined()
    expect(databaseService.metadata.deleteCaseExternalId).toHaveBeenCalledWith(1, 'MRN')
  })

  it('rejects audit metadata instead of silently dropping it', async () => {
    const databaseService = {
      auditLog: {
        appendEntry: vi.fn()
      }
    }
    const executor = new SqliteWriteExecutor(databaseService as never)

    await expect(
      executor.execute({
        type: 'audit:append',
        params: [
          {
            action_type: 'star',
            entity_type: 'variant_annotation',
            entity_key: '1:100:A:G',
            metadata: { source: 'postgres-only' }
          }
        ]
      })
    ).rejects.toThrow('SQLite audit append does not support metadata')
    expect(databaseService.auditLog.appendEntry).not.toHaveBeenCalled()
  })

  it('routes BED paths and parsing policy without materializing entries', async () => {
    const databaseService = {
      geneLists: {
        importBedFile: vi.fn().mockResolvedValue({ id: 4 })
      }
    }
    const executor = new SqliteWriteExecutor(databaseService as never)

    await executor.execute({
      type: 'region-files:importBed',
      params: [4, '/tmp/regions.bed', { rejectMalformedRows: false }]
    })

    expect(databaseService.geneLists.importBedFile).toHaveBeenCalledWith(4, '/tmp/regions.bed', {
      rejectMalformedRows: false
    })
  })

  it('serializes later writes behind in-flight streamed BED persistence', async () => {
    let finishImport!: () => void
    const importPending = new Promise<void>((resolve) => {
      finishImport = resolve
    })
    const databaseService = {
      geneLists: {
        importBedFile: vi.fn().mockReturnValue(importPending),
        createRegionFile: vi.fn().mockReturnValue({ id: 5 })
      }
    }
    const executor = new SqliteWriteExecutor(databaseService as never)

    const first = executor.execute({
      type: 'region-files:importBed',
      params: [4, '/tmp/regions.bed', { rejectMalformedRows: false }]
    })
    const second = executor.execute({ type: 'region-files:create', params: ['Next', null] })

    await Promise.resolve()
    expect(databaseService.geneLists.createRegionFile).not.toHaveBeenCalled()
    finishImport()
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, { id: 5 }])
    expect(databaseService.geneLists.createRegionFile).toHaveBeenCalledWith('Next', null)
  })
})
