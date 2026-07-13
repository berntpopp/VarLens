import { describe, expect, it, vi } from 'vitest'

import { PostgresWriteExecutor } from '../../../src/main/storage/postgres/PostgresWriteExecutor'

function workflowRepositories(): ConstructorParameters<typeof PostgresWriteExecutor>[2] {
  return {
    audit: {} as never,
    tags: {} as never,
    annotations: {} as never,
    commentsMetrics: {} as never,
    panels: {} as never,
    filterPresets: {} as never,
    analysisGroups: {} as never,
    transcripts: {} as never
  }
}

describe('PostgresWriteExecutor', () => {
  it('routes case metadata write tasks to the postgres repository', async () => {
    const repository = {
      upsertCaseMetadata: vi.fn().mockResolvedValue({ case_id: 1 }),
      createCohortGroup: vi.fn(),
      updateCohortGroup: vi.fn(),
      deleteCohortGroup: vi.fn(),
      assignCaseCohort: vi.fn(),
      removeCaseCohort: vi.fn(),
      setCaseCohorts: vi.fn().mockResolvedValue(undefined),
      assignCaseHpoTerm: vi.fn(),
      removeCaseHpoTerm: vi.fn(),
      upsertCaseDataInfo: vi.fn(),
      upsertCaseExternalId: vi.fn(),
      deleteCaseExternalId: vi.fn().mockResolvedValue(undefined)
    }
    const caseLifecycle = {
      deleteCase: vi.fn()
    }
    const executor = new PostgresWriteExecutor(repository, caseLifecycle, workflowRepositories())

    await executor.execute({ type: 'case-metadata:upsert', params: [1, { sex: 'female' }] })
    await executor.execute({ type: 'case-metadata:setCohorts', params: [1, [2, 3]] })
    await executor.execute({ type: 'case-metadata:deleteExternalId', params: [1, 'MRN'] })

    expect(repository.upsertCaseMetadata).toHaveBeenCalledWith(1, { sex: 'female' })
    expect(repository.setCaseCohorts).toHaveBeenCalledWith(1, [2, 3])
    expect(repository.deleteCaseExternalId).toHaveBeenCalledWith(1, 'MRN')
  })

  it('routes cases:delete to the postgres case lifecycle repository', async () => {
    const caseMetadata = {
      upsertCaseMetadata: vi.fn(),
      createCohortGroup: vi.fn(),
      updateCohortGroup: vi.fn(),
      deleteCohortGroup: vi.fn(),
      assignCaseCohort: vi.fn(),
      removeCaseCohort: vi.fn(),
      setCaseCohorts: vi.fn(),
      assignCaseHpoTerm: vi.fn(),
      removeCaseHpoTerm: vi.fn(),
      upsertCaseDataInfo: vi.fn(),
      upsertCaseExternalId: vi.fn(),
      deleteCaseExternalId: vi.fn()
    }
    const caseLifecycle = {
      deleteCase: vi.fn().mockResolvedValue(undefined)
    }
    const executor = new PostgresWriteExecutor(caseMetadata, caseLifecycle, workflowRepositories())

    await executor.execute({ type: 'cases:delete', params: [7] })

    expect(caseLifecycle.deleteCase).toHaveBeenCalledWith(7)
  })

  it('routes workflow write tasks to postgres workflow repositories', async () => {
    const workflow = workflowRepositories()
    workflow.tags = { createTag: vi.fn().mockResolvedValue({ id: 1 }) } as never
    workflow.annotations = {
      upsertPerCaseAnnotation: vi.fn().mockResolvedValue({ case_id: 1, variant_id: 2 }),
      upsertPerCaseAnnotationWithAudit: vi.fn().mockResolvedValue({ case_id: 1, variant_id: 2 })
    } as never
    workflow.panels = { createPanel: vi.fn().mockResolvedValue({ id: 3 }) } as never
    const executor = new PostgresWriteExecutor({} as never, {} as never, workflow)

    await expect(
      executor.execute({ type: 'tags:create', params: ['Review', '#fff'] })
    ).resolves.toEqual({
      id: 1
    })
    await executor.execute({
      type: 'annotations:upsertPerCase',
      params: [1, 2, { acmg_classification: 'VUS' }]
    })
    await executor.execute({
      type: 'annotations:upsertPerCaseWithAudit',
      params: [1, 2, { acmg_classification: 'VUS' }]
    })
    await executor.execute({
      type: 'panels:create',
      params: [{ name: 'Panel', source: 'manual' }]
    })

    expect(workflow.tags.createTag).toHaveBeenCalledWith('Review', '#fff')
    expect(workflow.annotations.upsertPerCaseAnnotation).toHaveBeenCalledWith(1, 2, {
      acmg_classification: 'VUS'
    })
    expect(workflow.annotations.upsertPerCaseAnnotationWithAudit).toHaveBeenCalledWith(1, 2, {
      acmg_classification: 'VUS'
    })
    expect(workflow.panels.createPanel).toHaveBeenCalledWith({ name: 'Panel', source: 'manual' })
  })

  it('routes BED paths and parsing policy without materializing entries', async () => {
    const workflow = workflowRepositories()
    workflow.panels = { importBedFile: vi.fn().mockResolvedValue({ id: 4 }) } as never
    const executor = new PostgresWriteExecutor({} as never, {} as never, workflow)

    await executor.execute({
      type: 'region-files:importBed',
      params: [4, '/tmp/regions.bed', { rejectMalformedRows: true }]
    })

    expect(workflow.panels.importBedFile).toHaveBeenCalledWith(4, '/tmp/regions.bed', {
      rejectMalformedRows: true
    })
  })

  it('routes audit append tasks to the postgres audit repository', async () => {
    const workflow = workflowRepositories()
    workflow.audit = {
      append: vi.fn().mockResolvedValue(undefined)
    } as never
    const executor = new PostgresWriteExecutor({} as never, {} as never, workflow)

    await executor.execute({
      type: 'audit:append',
      params: [
        {
          action_type: 'star',
          entity_type: 'variant_annotation',
          entity_key: '1:100:A:G',
          old_value: null,
          new_value: JSON.stringify({ starred: 1 })
        }
      ]
    })

    expect(workflow.audit.append).toHaveBeenCalledWith({
      action_type: 'star',
      entity_type: 'variant_annotation',
      entity_key: '1:100:A:G',
      old_value: null,
      new_value: JSON.stringify({ starred: 1 })
    })
  })
})
