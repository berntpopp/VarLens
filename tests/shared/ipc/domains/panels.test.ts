import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('panels preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all panels domain channels without unwrapping in createPanelsApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          name: 'Panel1',
          description: 'Test panel',
          version: '1.0',
          source: 'test',
          sourceId: null,
          sourceMetadata: null,
          created_at: 1000000,
          updated_at: 1000000,
          gene_count: 5
        }
      ])
      .mockResolvedValueOnce({
        id: 1,
        name: 'Panel1',
        description: 'Test panel',
        version: '1.0',
        source: 'test',
        sourceId: null,
        sourceMetadata: null,
        created_at: 1000000,
        updated_at: 1000000,
        genes: [
          { id: 1, panel_id: 1, hgnc_id: 'HGNC:1', symbol: 'GENE1' },
          { id: 2, panel_id: 1, hgnc_id: 'HGNC:2', symbol: 'GENE2' }
        ]
      })
      .mockResolvedValueOnce({
        id: 2,
        name: 'Panel2',
        description: null,
        version: null,
        source: 'manual',
        sourceId: null,
        sourceMetadata: null,
        created_at: 1000000,
        updated_at: 1000000
      })
      .mockResolvedValueOnce({
        id: 1,
        name: 'Panel1 Updated',
        description: 'Updated description',
        version: '1.1',
        source: 'test',
        sourceId: null,
        sourceMetadata: null,
        created_at: 1000000,
        updated_at: 1000001
      })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        id: 3,
        name: 'Panel1 Copy',
        description: 'Test panel',
        version: '1.0',
        source: 'test',
        sourceId: null,
        sourceMetadata: null,
        created_at: 1000000,
        updated_at: 1000000
      })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce([
        { id: 1, panel_id: 1, hgnc_id: 'HGNC:1', symbol: 'GENE1' },
        { id: 2, panel_id: 1, hgnc_id: 'HGNC:2', symbol: 'GENE2' }
      ])
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce([
        { id: 1, panel_id: 1, case_id: 1, hgnc_id: 'HGNC:1', symbol: 'GENE1', padding_bp: 5000 }
      ])
      .mockResolvedValueOnce([
        { hgnc_id: 'HGNC:1', symbol: 'GENE1', valid: true, message: null },
        { hgnc_id: 'HGNC:999', symbol: 'FAKEGENE', valid: false, message: 'Not found' }
      ])
      .mockResolvedValueOnce([
        { hgnc_id: 'HGNC:1', symbol: 'GENE1', priority: 'exact' },
        { hgnc_id: 'HGNC:2', symbol: 'GENE2', priority: 'partial' }
      ])
      .mockResolvedValueOnce([{ id: 1, name: 'Test Panel', version: '1.0', confidence: 'green' }])
      .mockResolvedValueOnce({
        id: 4,
        name: 'Imported Panel',
        description: null,
        version: '2.0',
        source: 'panelapp',
        sourceId: '1',
        sourceMetadata: null,
        created_at: 1000000,
        updated_at: 1000000
      })
      .mockResolvedValueOnce({
        id: 5,
        name: 'StringDB Panel',
        description: null,
        version: null,
        source: 'stringdb',
        sourceId: null,
        sourceMetadata: null,
        created_at: 1000000,
        updated_at: 1000000
      })
      .mockResolvedValueOnce({ success: true, path: '/tmp/export.bed' })
      .mockResolvedValueOnce({
        genomeBuild: 'GRCh37',
        totalGenes: 2,
        unmappedCount: 1,
        unmappedGenes: [{ hgncId: 'HGNC:2', symbol: 'GENE2' }]
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createPanelsApi } = await import('../../../../src/preload/domains/panels')
    const api = createPanelsApi()

    // Test list
    await expect(api.list()).resolves.toMatchObject([
      {
        id: 1,
        name: 'Panel1',
        gene_count: 5
      }
    ])

    // Test get
    await expect(api.get(1)).resolves.toMatchObject({
      id: 1,
      name: 'Panel1'
    })

    // Test create
    await expect(
      api.create({
        name: 'Panel2',
        source: 'manual'
      })
    ).resolves.toMatchObject({
      id: 2,
      name: 'Panel2'
    })

    // Test update
    await expect(
      api.update({
        id: 1,
        name: 'Panel1 Updated',
        description: 'Updated description',
        version: '1.1'
      })
    ).resolves.toMatchObject({
      id: 1,
      name: 'Panel1 Updated'
    })

    // Test delete
    await expect(api.delete(1)).resolves.toMatchObject({
      success: true
    })

    // Test duplicate
    await expect(api.duplicate(1, 'Panel1 Copy')).resolves.toMatchObject({
      id: 3,
      name: 'Panel1 Copy'
    })

    // Test setGenes
    await expect(
      api.setGenes(1, [
        { hgncId: 'HGNC:1', symbol: 'GENE1' },
        { hgncId: 'HGNC:2', symbol: 'GENE2' }
      ])
    ).resolves.toMatchObject({
      success: true
    })

    // Test getGenes
    const genes = await api.getGenes(1)
    expect(genes).toHaveLength(2)
    expect(genes[0]).toMatchObject({ hgnc_id: 'HGNC:1', symbol: 'GENE1' })

    // Test activate
    await expect(api.activate(1, 1, 5000)).resolves.toMatchObject({
      success: true
    })

    // Test deactivate
    await expect(api.deactivate(1, 1)).resolves.toMatchObject({
      success: true
    })

    // Test activeForCase
    await expect(api.activeForCase(1)).resolves.toMatchObject([{ panel_id: 1, case_id: 1 }])

    // Test validateSymbols
    const validationResults = await api.validateSymbols(['GENE1', 'FAKEGENE'])
    expect(validationResults).toHaveLength(2)
    expect(validationResults[0]).toMatchObject({ hgnc_id: 'HGNC:1', symbol: 'GENE1', valid: true })

    // Test autocomplete
    const autocompleteResults = await api.autocomplete('GENE', 10)
    expect(autocompleteResults).toHaveLength(2)
    expect(autocompleteResults[0]).toMatchObject({ hgnc_id: 'HGNC:1', symbol: 'GENE1' })

    // Test searchPanelApp
    await expect(api.searchPanelApp('cancer', 'both')).resolves.toMatchObject([
      { id: 1, name: 'Test Panel' }
    ])

    // Test importPanelApp
    await expect(
      api.importPanelApp({
        panelId: 1,
        region: 'uk',
        confidenceThreshold: 'green'
      })
    ).resolves.toMatchObject({
      id: 4,
      name: 'Imported Panel'
    })

    // Test generateStringDb
    await expect(
      api.generateStringDb({
        seedGenes: ['GENE1'],
        requiredScore: 0.5,
        networkType: 'physical'
      })
    ).resolves.toMatchObject({
      id: 5,
      name: 'StringDB Panel'
    })

    // Test exportBed
    await expect(api.exportBed(1, 'GRCh38', 5000)).resolves.toMatchObject({
      success: true,
      path: '/tmp/export.bed'
    })

    // Verify all channels were invoked correctly
    expect(invoke).toHaveBeenNthCalledWith(1, 'panels:list')
    expect(invoke).toHaveBeenNthCalledWith(2, 'panels:get', 1)
    expect(invoke).toHaveBeenNthCalledWith(3, 'panels:create', {
      name: 'Panel2',
      source: 'manual'
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'panels:update', {
      id: 1,
      name: 'Panel1 Updated',
      description: 'Updated description',
      version: '1.1'
    })
    expect(invoke).toHaveBeenNthCalledWith(5, 'panels:delete', 1)
    expect(invoke).toHaveBeenNthCalledWith(6, 'panels:duplicate', { id: 1, newName: 'Panel1 Copy' })
    expect(invoke).toHaveBeenNthCalledWith(7, 'panels:setGenes', {
      panelId: 1,
      genes: [
        { hgncId: 'HGNC:1', symbol: 'GENE1' },
        { hgncId: 'HGNC:2', symbol: 'GENE2' }
      ]
    })
    expect(invoke).toHaveBeenNthCalledWith(8, 'panels:getGenes', 1)
    expect(invoke).toHaveBeenNthCalledWith(9, 'panels:activate', {
      caseId: 1,
      panelId: 1,
      paddingBp: 5000
    })
    expect(invoke).toHaveBeenNthCalledWith(10, 'panels:deactivate', { caseId: 1, panelId: 1 })
    expect(invoke).toHaveBeenNthCalledWith(11, 'panels:active-for-case', 1)
    expect(invoke).toHaveBeenNthCalledWith(12, 'panels:validate-symbols', {
      symbols: ['GENE1', 'FAKEGENE']
    })
    expect(invoke).toHaveBeenNthCalledWith(13, 'panels:autocomplete', { query: 'GENE', limit: 10 })
    expect(invoke).toHaveBeenNthCalledWith(14, 'panels:search-panelapp', {
      keyword: 'cancer',
      region: 'both'
    })
    expect(invoke).toHaveBeenNthCalledWith(15, 'panels:import-panelapp', {
      panelId: 1,
      region: 'uk',
      confidenceThreshold: 'green'
    })
    expect(invoke).toHaveBeenNthCalledWith(16, 'panels:generate-stringdb', {
      seedGenes: ['GENE1'],
      requiredScore: 0.5,
      networkType: 'physical'
    })
    expect(invoke).toHaveBeenNthCalledWith(17, 'panels:export-bed', 1, 'GRCh38', 5000)

    // resolutionStatus: the request object is forwarded untouched
    await expect(api.resolutionStatus({ panelIds: [1], caseId: 7 })).resolves.toMatchObject({
      unmappedCount: 1,
      unmappedGenes: [{ hgncId: 'HGNC:2', symbol: 'GENE2' }]
    })
    expect(invoke).toHaveBeenNthCalledWith(18, 'panels:resolutionStatus', {
      panelIds: [1],
      caseId: 7
    })
  })

  it('preload index preserves panels transport results when exposing window.api', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        code: ErrorCode.DB_ERROR,
        message: 'panels:list failed',
        userMessage: 'Could not run panels:list'
      })
      .mockResolvedValueOnce({
        code: ErrorCode.DB_ERROR,
        message: 'panels:get failed',
        userMessage: 'Could not run panels:get'
      })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce([])

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
      panels: {
        list: () => Promise<unknown>
        get: (id: number) => Promise<unknown>
        delete: (id: number) => Promise<unknown>
        deactivate: (caseId: number, panelId: number) => Promise<unknown>
        activeForCase: (caseId: number) => Promise<unknown>
      }
    }

    await expect(api.panels.list()).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'panels:list failed'
    })
    await expect(api.panels.get(1)).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'panels:get failed'
    })
    await expect(api.panels.delete(1)).resolves.toMatchObject({
      success: true
    })
    await expect(api.panels.deactivate(1, 1)).resolves.toMatchObject({
      success: true
    })
    await expect(api.panels.activeForCase(1)).resolves.toEqual([])

    expect(invoke).toHaveBeenCalledWith('panels:list')
    expect(invoke).toHaveBeenCalledWith('panels:get', 1)
    expect(invoke).toHaveBeenCalledWith('panels:delete', 1)
    expect(invoke).toHaveBeenCalledWith('panels:deactivate', { caseId: 1, panelId: 1 })
    expect(invoke).toHaveBeenCalledWith('panels:active-for-case', 1)
  })
})
