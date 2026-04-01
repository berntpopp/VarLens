/**
 * Unit tests for useAssociation composable
 *
 * Tests association API method delegation and case metadata loading.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useAssociation } from '@renderer/composables/useAssociation'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    critical: vi.fn()
  }
}))

describe('useAssociation', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    window.api = createMockApi()
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  it('runAssociation calls api.cohort.runAssociation with config', async () => {
    const config = { test: 'fisher', caseIds: [1, 2] }
    const mockResult = { results: [], warnings: [] }
    window.api.cohort.runAssociation.mockResolvedValue(mockResult)

    const [result, appInstance] = withSetup(() => useAssociation())
    app = appInstance

    const res = await result.runAssociation(config)
    expect(window.api.cohort.runAssociation).toHaveBeenCalledWith(config)
    expect(res).toBe(mockResult)
  })

  it('cancelAssociation calls api.cohort.cancelAssociation', () => {
    const [result, appInstance] = withSetup(() => useAssociation())
    app = appInstance

    result.cancelAssociation()
    expect(window.api.cohort.cancelAssociation).toHaveBeenCalled()
  })

  it('onAssociationProgress registers callback and returns cleanup', () => {
    const cleanup = vi.fn()
    window.api.cohort.onAssociationProgress.mockReturnValue(cleanup)

    const [result, appInstance] = withSetup(() => useAssociation())
    app = appInstance

    const cb = vi.fn()
    const unsub = result.onAssociationProgress(cb)
    expect(window.api.cohort.onAssociationProgress).toHaveBeenCalledWith(cb)

    unsub()
    expect(cleanup).toHaveBeenCalled()
  })

  it('loadCasesWithMetadata returns case info with cohort IDs', async () => {
    window.api.cases.list.mockResolvedValue([
      { id: 1, name: 'Case A' },
      { id: 2, name: 'Case B' }
    ])
    window.api.caseMetadata.listCohorts.mockResolvedValue([
      { id: 10, name: 'Controls' },
      { id: 20, name: 'Cases' }
    ])
    window.api.caseMetadata.getFullMetadata
      .mockResolvedValueOnce({
        metadata: { affected_status: 'affected', sex: 'male' },
        cohorts: [{ id: 20, name: 'Cases' }],
        hpoTerms: [],
        comments: [],
        metrics: [],
        dataInfo: null,
        externalIds: []
      })
      .mockResolvedValueOnce({
        metadata: { affected_status: 'unaffected', sex: 'female' },
        cohorts: [{ id: 10, name: 'Controls' }],
        hpoTerms: [],
        comments: [],
        metrics: [],
        dataInfo: null,
        externalIds: []
      })

    const [result, appInstance] = withSetup(() => useAssociation())
    app = appInstance

    const data = await result.loadCasesWithMetadata()
    expect(data.cases).toHaveLength(2)
    expect(data.cases[0]).toEqual({
      id: 1,
      name: 'Case A',
      status: 'affected',
      sex: 'male',
      cohortIds: [20]
    })
    expect(data.cases[1]).toEqual({
      id: 2,
      name: 'Case B',
      status: 'unaffected',
      sex: 'female',
      cohortIds: [10]
    })
    expect(data.cohortGroups).toEqual([
      { id: 10, name: 'Controls' },
      { id: 20, name: 'Cases' }
    ])
  })

  it('loadCasesWithMetadata handles metadata failure gracefully', async () => {
    window.api.cases.list.mockResolvedValue([{ id: 1, name: 'Case A' }])
    window.api.caseMetadata.listCohorts.mockResolvedValue([])
    window.api.caseMetadata.getFullMetadata.mockRejectedValue(new Error('DB error'))

    const [result, appInstance] = withSetup(() => useAssociation())
    app = appInstance

    const data = await result.loadCasesWithMetadata()
    expect(data.cases).toHaveLength(1)
    expect(data.cases[0]).toEqual({
      id: 1,
      name: 'Case A',
      status: null,
      sex: null,
      cohortIds: []
    })
  })
})
