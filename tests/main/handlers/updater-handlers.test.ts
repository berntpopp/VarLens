import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock AutoUpdater service
const mockCheckForUpdates = vi.fn()
const mockDownloadUpdate = vi.fn()
const mockInstallUpdate = vi.fn()
const mockGetUpdateStatus = vi.fn(() => ({ state: 'idle' }))

vi.mock('../../../src/main/services/AutoUpdater', () => ({
  checkForUpdates: mockCheckForUpdates,
  downloadUpdate: mockDownloadUpdate,
  installUpdate: mockInstallUpdate,
  getUpdateStatus: mockGetUpdateStatus
}))

describe('Updater IPC handlers', () => {
  const mockHandle = vi.fn()
  const mockIpcMain = { handle: mockHandle }

  beforeEach(async () => {
    vi.clearAllMocks()
    const { registerUpdaterHandlers } = await import('../../../src/main/ipc/handlers/updater')
    registerUpdaterHandlers({
      ipcMain: mockIpcMain as never,
      getDb: () => null as never,
      getDbManager: () => null as never
    })
  })

  it('registers updater:check handler', () => {
    const channels = mockHandle.mock.calls.map((call: [string, ...unknown[]]) => call[0])
    expect(channels).toContain('updater:check')
  })

  it('registers updater:download handler', () => {
    const channels = mockHandle.mock.calls.map((call: [string, ...unknown[]]) => call[0])
    expect(channels).toContain('updater:download')
  })

  it('registers updater:install handler', () => {
    const channels = mockHandle.mock.calls.map((call: [string, ...unknown[]]) => call[0])
    expect(channels).toContain('updater:install')
  })

  it('registers updater:status handler', () => {
    const channels = mockHandle.mock.calls.map((call: [string, ...unknown[]]) => call[0])
    expect(channels).toContain('updater:status')
  })

  it('updater:check calls checkForUpdates', async () => {
    const handler = mockHandle.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === 'updater:check'
    )?.[1] as (event: unknown) => Promise<unknown>
    await handler({})
    expect(mockCheckForUpdates).toHaveBeenCalled()
  })

  it('updater:status returns current status', async () => {
    const handler = mockHandle.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === 'updater:status'
    )?.[1] as (event: unknown) => Promise<unknown>
    const result = await handler({})
    expect(result).toEqual({ state: 'idle' })
  })
})
