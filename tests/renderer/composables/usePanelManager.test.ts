/**
 * Unit tests for usePanelManager composable
 *
 * Tests panel CRUD operations via mocked IPC API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { usePanelManager, _resetPanelManagerState } from '@renderer/composables/usePanelManager'
import type { PanelListItem } from '@renderer/composables/usePanelManager'
import { logService } from '../../../src/renderer/src/services/LogService'
import { ErrorCode } from '../../../src/shared/types/errors'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    critical: vi.fn()
  }
}))

const mockPanels: PanelListItem[] = [
  {
    id: 1,
    name: 'Epilepsy Panel',
    description: 'Epilepsy genes',
    version: '4.0',
    source: 'panelapp_uk',
    source_id: '123',
    gene_count: 42,
    created_at: 1735689600000,
    updated_at: 1735689600000
  },
  {
    id: 2,
    name: 'Custom Panel',
    description: null,
    version: null,
    source: 'manual',
    source_id: null,
    gene_count: 5,
    created_at: 1738368000000,
    updated_at: 1738368000000
  }
]

describe('usePanelManager', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    _resetPanelManagerState()
    window.api = createMockApi()
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  it('initializes with empty state', () => {
    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    expect(result.panels.value).toEqual([])
    expect(result.loading.value).toBe(false)
    expect(result.error.value).toBeNull()
  })

  it('loads panels from API', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.list.mockResolvedValue(mockPanels)

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    await result.loadPanels()

    expect(result.panels.value).toEqual(mockPanels)
    expect(result.loading.value).toBe(false)
    expect(result.error.value).toBeNull()
  })

  it('sets loading state during loadPanels', async () => {
    let resolveList: (value: PanelListItem[]) => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.list.mockImplementation(
      () =>
        new Promise<PanelListItem[]>((resolve) => {
          resolveList = resolve
        })
    )

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    const promise = result.loadPanels()
    expect(result.loading.value).toBe(true)

    resolveList!(mockPanels)
    await promise

    expect(result.loading.value).toBe(false)
  })

  it('sets error on loadPanels failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.list.mockRejectedValue(new Error('DB error'))

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    await result.loadPanels()

    expect(result.error.value).toBe('DB error')
    expect(result.panels.value).toEqual([])
    expect(logService.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load panels:'),
      'panels'
    )
  })

  it('surfaces SerializableError messages from loadPanels', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.list.mockResolvedValue({
      code: ErrorCode.DB_ERROR,
      message: 'list failed',
      userMessage: 'Could not load panels'
    })

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    await result.loadPanels()

    expect(result.error.value).toBe('Could not load panels')
    expect(logService.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not load panels'),
      'panels'
    )
  })

  it('creates a panel and reloads list', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.create.mockResolvedValue({ id: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.list.mockResolvedValue(mockPanels)

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    const newId = await result.createPanel({
      name: 'New Panel',
      source: 'manual'
    })

    expect(newId).toBe(3)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.api as any).panels.create).toHaveBeenCalledWith({
      name: 'New Panel',
      description: null,
      version: null,
      source: 'manual',
      sourceId: null,
      sourceMetadata: null
    })
    // Reloaded after create
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.api as any).panels.list).toHaveBeenCalled()
    expect(result.panels.value).toEqual(mockPanels)
  })

  it('updates a panel and reloads list', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.list.mockResolvedValue(mockPanels)

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    await result.updatePanel(1, { name: 'Renamed Panel' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.api as any).panels.update).toHaveBeenCalledWith({
      id: 1,
      name: 'Renamed Panel'
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.api as any).panels.list).toHaveBeenCalled()
  })

  it('deletes a panel and reloads list', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.list.mockResolvedValue([mockPanels[1]])

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    await result.deletePanel(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.api as any).panels.delete).toHaveBeenCalledWith(1)
    // List reloaded with only remaining panel
    expect(result.panels.value).toEqual([mockPanels[1]])
  })

  it('duplicates a panel and reloads list', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.duplicate.mockResolvedValue({ id: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.list.mockResolvedValue([
      ...mockPanels,
      { ...mockPanels[0], id: 3, name: 'Copy' }
    ])

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    const newId = await result.duplicatePanel(1, 'Copy')

    expect(newId).toBe(3)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.api as any).panels.duplicate).toHaveBeenCalledWith(1, 'Copy')
    expect(result.panels.value).toHaveLength(3)
  })

  it('sets genes for a panel and reloads list', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.list.mockResolvedValue(mockPanels)

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    const genes = [
      { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
      { hgncId: 'HGNC:1101', symbol: 'BRCA2' }
    ]
    await result.setGenes(1, genes)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.api as any).panels.setGenes).toHaveBeenCalledWith(1, genes)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.api as any).panels.list).toHaveBeenCalled()
  })

  it('gets genes for a panel', async () => {
    // Mock returns PanelGeneRow[] (database format with hgnc_id)
    const apiGenes = [
      { id: 1, panel_id: 1, hgnc_id: 'HGNC:1100', symbol: 'BRCA1' },
      { id: 2, panel_id: 1, hgnc_id: 'HGNC:1101', symbol: 'BRCA2' }
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.api as any).panels.getGenes.mockResolvedValue(apiGenes)

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    const fetched = await result.getGenes(1)

    // Composable maps to PanelGene format (hgncId)
    expect(fetched).toEqual([
      { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
      { hgncId: 'HGNC:1101', symbol: 'BRCA2' }
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.api as any).panels.getGenes).toHaveBeenCalledWith(1)
  })

  it('handles API unavailable gracefully', async () => {
    // @ts-expect-error - Testing undefined case
    delete window.api

    const [result, appInstance] = withSetup(() => usePanelManager())
    app = appInstance

    await result.loadPanels()
    expect(result.panels.value).toEqual([])

    const id = await result.createPanel({ name: 'Test', source: 'manual' })
    expect(id).toBeUndefined()

    const genes = await result.getGenes(1)
    expect(genes).toEqual([])
  })
})
