import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn() } }))
vi.mock('../../../../src/main/database/geneReferenceLoader', () => ({
  getGeneReferenceDb: vi.fn()
}))
vi.mock('../../../../src/main/ipc/handlers/variants', () => ({
  clearPanelIntervalCache: vi.fn()
}))

import { registerPanelHandlers } from '../../../../src/main/ipc/handlers/panels'
import { isIpcError } from '../../../../src/shared/types/errors'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function setup(backend: 'sqlite' | 'postgres'): {
  invoke: (request: unknown) => Promise<unknown>
  execute: ReturnType<typeof vi.fn>
} {
  const status = {
    genomeBuild: 'GRCh37',
    totalGenes: 3,
    unmappedCount: 1,
    unmappedGenes: [{ hgncId: 'HGNC:9', symbol: 'ZZZ1' }]
  }
  const execute = vi.fn().mockResolvedValue(status)
  const ipcMain = { handle: vi.fn() }
  registerPanelHandlers({
    ipcMain,
    getDb: vi.fn(),
    getDbManager: () => ({
      getCurrentSession: () => ({
        capabilities: { backend },
        getReadExecutor: () => ({ execute })
      })
    })
  } as never)
  const call = ipcMain.handle.mock.calls.find(([c]) => c === 'panels:resolutionStatus') as
    [string, HandlerCallback] | undefined
  if (call === undefined) throw new Error('panels:resolutionStatus is not registered')
  return { invoke: (request) => call[1]({}, request), execute }
}

describe('panels:resolutionStatus IPC handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['sqlite', 'postgres'] as const)(
    'serves the %s backend through the session read executor',
    async (backend) => {
      const { invoke, execute } = setup(backend)

      const result = await invoke({ panelIds: [3, 4], caseId: 12 })

      expect(execute).toHaveBeenCalledWith({
        type: 'panels:resolutionStatus',
        params: [{ panelIds: [3, 4], caseId: 12 }]
      })
      expect(result).toMatchObject({
        genomeBuild: 'GRCh37',
        unmappedGenes: [{ hgncId: 'HGNC:9', symbol: 'ZZZ1' }]
      })
    }
  )

  it.each([
    ['no request', undefined],
    ['non-numeric panel ids', { panelIds: ['1'] }],
    ['a non-positive case id', { panelIds: [1], caseId: 0 }],
    ['an empty genome build', { panelIds: [1], genomeBuild: '' }]
  ])('refuses %s without reaching the database', async (_name, request) => {
    const { invoke, execute } = setup('sqlite')

    const result = await invoke(request)

    expect(isIpcError(result)).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })
})
