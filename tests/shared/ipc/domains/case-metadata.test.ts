import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('case-metadata preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all case-metadata domain channels without unwrapping in createCaseMetadataApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        affected_status: 'affected',
        sex: 'F',
        notes: 'test'
      })
      .mockResolvedValueOnce({
        affected_status: 'affected',
        sex: 'F',
        notes: 'updated'
      })
      .mockResolvedValueOnce([
        { id: 1, name: 'Cohort A', description: 'Test cohort', case_count: 5 }
      ])
      .mockResolvedValueOnce({
        id: 2,
        name: 'Cohort B',
        description: 'New cohort',
        case_count: 0
      })
      .mockResolvedValueOnce({
        id: 1,
        name: 'Cohort A Updated',
        description: 'Updated description',
        case_count: 5
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 1,
        name: 'Cohort A',
        description: 'Test cohort',
        case_count: 5
      })
      .mockResolvedValueOnce([
        { id: 1, name: 'Cohort A', description: 'Test cohort', case_count: 5 }
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ hpo_id: 'HP:0001197', hpo_label: 'Abnormal palate morphology' }])
      .mockResolvedValueOnce({
        hpo_id: 'HP:0001197',
        hpo_label: 'Abnormal palate morphology'
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        platform: 'Illumina',
        platform_details: null,
        af_filter: '0.01',
        gene_list_filter: null,
        region_filter: null,
        quality_filter: 'PASS',
        data_notes: 'WES',
        gene_list_id: null,
        region_file_id: null
      })
      .mockResolvedValueOnce({
        platform: 'Illumina',
        platform_details: 'NovaSeq',
        af_filter: '0.01',
        gene_list_filter: null,
        region_filter: null,
        quality_filter: 'PASS',
        data_notes: 'WES updated',
        gene_list_id: null,
        region_file_id: null
      })
      .mockResolvedValueOnce([{ id: 1, external_id_type: 'SAMPLE_ID', external_id_value: 'S123' }])
      .mockResolvedValueOnce({
        id: 2,
        external_id_type: 'EXTERNAL_CASE_ID',
        external_id_value: 'EC456'
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { hpo_id: 'HP:0001197', hpo_label: 'Abnormal palate morphology' },
        { hpo_id: 'HP:0000750', hpo_label: 'Delayed speech and language development' }
      ])
      .mockResolvedValueOnce(['Illumina', 'PacBio', '10X'])
      .mockResolvedValueOnce(['SAMPLE_ID', 'EXTERNAL_CASE_ID', 'SUBJECT_ID'])
      .mockResolvedValueOnce({
        metadata: {
          affected_status: 'affected',
          sex: 'F',
          notes: 'test'
        },
        cohorts: [{ id: 1, name: 'Cohort A', description: 'Test cohort', case_count: 5 }],
        hpoTerms: [{ hpo_id: 'HP:0001197', hpo_label: 'Abnormal palate morphology' }],
        dataInfo: {
          platform: 'Illumina',
          platform_details: null,
          af_filter: '0.01',
          gene_list_filter: null,
          region_filter: null,
          quality_filter: 'PASS',
          data_notes: 'WES',
          gene_list_id: null,
          region_file_id: null
        },
        externalIds: [{ id: 1, external_id_type: 'SAMPLE_ID', external_id_value: 'S123' }]
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createCaseMetadataApi } = await import('../../../../src/preload/domains/case-metadata')
    const api = createCaseMetadataApi()

    // Test all 23 channels
    await expect(api.get(1)).resolves.toMatchObject({
      affected_status: 'affected'
    })

    await expect(
      api.upsert(1, { affected_status: 'affected', sex: 'F', notes: 'updated' })
    ).resolves.toMatchObject({
      affected_status: 'affected'
    })

    await expect(api.listCohorts()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 1 })])
    )

    await expect(api.createCohort('Cohort B', 'New cohort')).resolves.toMatchObject({
      id: 2,
      name: 'Cohort B'
    })

    await expect(api.updateCohort(1, { name: 'Cohort A Updated' })).resolves.toMatchObject({
      id: 1,
      name: 'Cohort A Updated'
    })

    await expect(api.deleteCohort(1)).resolves.toBeUndefined()

    await expect(api.getCohortByName('Cohort A')).resolves.toMatchObject({
      id: 1,
      name: 'Cohort A'
    })

    await expect(api.getCaseCohorts(1)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 1 })])
    )

    await expect(api.assignCohort(1, 1)).resolves.toBeUndefined()

    await expect(api.removeCohort(1, 1)).resolves.toBeUndefined()

    await expect(api.setCohorts(1, [1, 2])).resolves.toBeUndefined()

    await expect(api.getHpoTerms(1)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ hpo_id: 'HP:0001197' })])
    )

    await expect(
      api.assignHpoTerm(1, 'HP:0001197', 'Abnormal palate morphology', { key: true })
    ).resolves.toMatchObject({
      hpo_id: 'HP:0001197'
    })

    await expect(api.removeHpoTerm(1, 'HP:0001197')).resolves.toBeUndefined()

    await expect(api.getDataInfo(1)).resolves.toMatchObject({
      platform: 'Illumina'
    })

    await expect(
      api.upsertDataInfo(1, { platform: 'Illumina', platform_details: 'NovaSeq' })
    ).resolves.toMatchObject({
      platform: 'Illumina'
    })

    await expect(api.listExternalIds(1)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 1 })])
    )

    await expect(api.upsertExternalId(1, 'EXTERNAL_CASE_ID', 'EC456')).resolves.toMatchObject({
      id: 2,
      external_id_type: 'EXTERNAL_CASE_ID'
    })

    await expect(api.deleteExternalId(1, 'SAMPLE_ID')).resolves.toBeUndefined()

    await expect(api.distinctHpoTerms()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ hpo_id: 'HP:0001197' })])
    )

    await expect(api.distinctPlatforms()).resolves.toEqual(expect.arrayContaining(['Illumina']))

    await expect(api.distinctExternalIdTypes()).resolves.toEqual(
      expect.arrayContaining(['SAMPLE_ID'])
    )

    await expect(api.getFullMetadata(1)).resolves.toMatchObject({
      metadata: expect.objectContaining({
        affected_status: 'affected'
      })
    })

    // Verify all channels were called
    expect(invoke).toHaveBeenNthCalledWith(1, 'case-metadata:get', 1)
    expect(invoke).toHaveBeenNthCalledWith(2, 'case-metadata:upsert', 1, {
      affected_status: 'affected',
      sex: 'F',
      notes: 'updated'
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'case-metadata:listCohorts')
    expect(invoke).toHaveBeenNthCalledWith(
      4,
      'case-metadata:createCohort',
      'Cohort B',
      'New cohort'
    )
    expect(invoke).toHaveBeenNthCalledWith(5, 'case-metadata:updateCohort', 1, {
      name: 'Cohort A Updated'
    })
    expect(invoke).toHaveBeenNthCalledWith(6, 'case-metadata:deleteCohort', 1)
    expect(invoke).toHaveBeenNthCalledWith(7, 'case-metadata:getCohortByName', 'Cohort A')
    expect(invoke).toHaveBeenNthCalledWith(8, 'case-metadata:getCaseCohorts', 1)
    expect(invoke).toHaveBeenNthCalledWith(9, 'case-metadata:assignCohort', 1, 1)
    expect(invoke).toHaveBeenNthCalledWith(10, 'case-metadata:removeCohort', 1, 1)
    expect(invoke).toHaveBeenNthCalledWith(11, 'case-metadata:setCohorts', 1, [1, 2])
    expect(invoke).toHaveBeenNthCalledWith(12, 'case-metadata:getHpoTerms', 1)
    expect(invoke).toHaveBeenNthCalledWith(
      13,
      'case-metadata:assignHpoTerm',
      1,
      'HP:0001197',
      'Abnormal palate morphology',
      { key: true }
    )
    expect(invoke).toHaveBeenNthCalledWith(14, 'case-metadata:removeHpoTerm', 1, 'HP:0001197')
    expect(invoke).toHaveBeenNthCalledWith(15, 'case-metadata:getDataInfo', 1)
    expect(invoke).toHaveBeenNthCalledWith(16, 'case-metadata:upsertDataInfo', 1, {
      platform: 'Illumina',
      platform_details: 'NovaSeq'
    })
    expect(invoke).toHaveBeenNthCalledWith(17, 'case-metadata:listExternalIds', 1)
    expect(invoke).toHaveBeenNthCalledWith(
      18,
      'case-metadata:upsertExternalId',
      1,
      'EXTERNAL_CASE_ID',
      'EC456'
    )
    expect(invoke).toHaveBeenNthCalledWith(19, 'case-metadata:deleteExternalId', 1, 'SAMPLE_ID')
    expect(invoke).toHaveBeenNthCalledWith(20, 'case-metadata:distinctHpoTerms')
    expect(invoke).toHaveBeenNthCalledWith(21, 'case-metadata:distinctPlatforms')
    expect(invoke).toHaveBeenNthCalledWith(22, 'case-metadata:distinctExternalIdTypes')
    expect(invoke).toHaveBeenNthCalledWith(23, 'case-metadata:getFullMetadata', 1)
  })

  it('preload index preserves case-metadata transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (
        channel === 'case-metadata:get' ||
        channel === 'case-metadata:getDataInfo' ||
        channel === 'case-metadata:getCohortByName'
      ) {
        return {
          code: ErrorCode.DB_ERROR,
          message: `${channel} failed`,
          userMessage: `Could not run ${channel}`
        }
      }
      if (
        channel === 'case-metadata:deleteCohort' ||
        channel === 'case-metadata:removeHpoTerm' ||
        channel === 'case-metadata:deleteExternalId'
      ) {
        return undefined
      }
      if (channel === 'case-metadata:distinctPlatforms') {
        return ['Illumina', 'PacBio']
      }
      return {
        id: 1,
        name: 'test'
      }
    })
    const exposeInMainWorld = vi.fn()

    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        invoke,
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn()
      }
    }))
    ;(process as typeof process & { contextIsolated?: boolean }).contextIsolated = true

    await import('../../../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      caseMetadata: {
        get: (caseId: number) => Promise<unknown>
        getDataInfo: (caseId: number) => Promise<unknown>
        getCohortByName: (name: string) => Promise<unknown>
        deleteCohort: (cohortId: number) => Promise<unknown>
        distinctPlatforms: () => Promise<unknown>
      }
    }

    await expect(api.caseMetadata.get(1)).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'case-metadata:get failed'
    })

    await expect(api.caseMetadata.getDataInfo(1)).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'case-metadata:getDataInfo failed'
    })

    await expect(api.caseMetadata.getCohortByName('Cohort A')).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'case-metadata:getCohortByName failed'
    })

    await expect(api.caseMetadata.deleteCohort(1)).resolves.toBeUndefined()

    await expect(api.caseMetadata.distinctPlatforms()).resolves.toEqual(
      expect.arrayContaining(['Illumina'])
    )

    expect(invoke).toHaveBeenCalledWith('case-metadata:get', 1)
    expect(invoke).toHaveBeenCalledWith('case-metadata:getDataInfo', 1)
    expect(invoke).toHaveBeenCalledWith('case-metadata:getCohortByName', 'Cohort A')
    expect(invoke).toHaveBeenCalledWith('case-metadata:deleteCohort', 1)
    expect(invoke).toHaveBeenCalledWith('case-metadata:distinctPlatforms')
  })
})
