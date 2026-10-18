import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installCapabilities } from '../helpers/capabilities'

// The capability store fails closed: install a desktop document.
beforeEach(() => installCapabilities())

const cleanupFn = vi.fn()

// Mock window.api
const mockApi = {
  updater: {
    checkForUpdate: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
    onStatusChange: vi.fn(() => {
      return cleanupFn
    })
  }
}

// Set up window.api before importing the composable
Object.defineProperty(window, 'api', {
  value: mockApi,
  writable: true,
  configurable: true
})

describe('useAutoUpdate', () => {
  let useAutoUpdate: typeof import('../../../src/renderer/src/composables/useAutoUpdate').useAutoUpdate

  beforeEach(async () => {
    vi.clearAllMocks()
    mockApi.updater.checkForUpdate.mockResolvedValue(undefined)
    mockApi.updater.downloadUpdate.mockResolvedValue(undefined)
    mockApi.updater.installUpdate.mockResolvedValue(undefined)
    mockApi.updater.getStatus.mockResolvedValue({ state: 'idle' })
    const mod = await import('../../../src/renderer/src/composables/useAutoUpdate')
    useAutoUpdate = mod.useAutoUpdate
  })

  it('returns reactive updateStatus unwrapped from IpcResult', async () => {
    const { updateStatus } = useAutoUpdate()
    await Promise.resolve()
    expect(updateStatus.value.state).toBe('idle')
  })

  it('does not overwrite updateStatus on getStatus failure', async () => {
    mockApi.updater.getStatus.mockResolvedValue({
      code: 'UNKNOWN',
      message: 'IPC error',
      userMessage: 'Error'
    })
    const { updateStatus } = useAutoUpdate()
    await Promise.resolve()
    expect(updateStatus.value.state).toBe('idle')
  })

  it('provides checkForUpdate method that unwraps IpcResult', async () => {
    const { checkForUpdate } = useAutoUpdate()
    expect(typeof checkForUpdate).toBe('function')
    await checkForUpdate()
    expect(mockApi.updater.checkForUpdate).toHaveBeenCalled()
  })

  it('handles checkForUpdate error safely without throwing', async () => {
    mockApi.updater.checkForUpdate.mockResolvedValue({
      code: 'UNKNOWN',
      message: 'Failed to check',
      userMessage: 'Failed'
    })
    const { checkForUpdate } = useAutoUpdate()
    await expect(checkForUpdate()).resolves.toBeUndefined()
  })

  it('provides downloadUpdate method that unwraps IpcResult', async () => {
    const { downloadUpdate } = useAutoUpdate()
    expect(typeof downloadUpdate).toBe('function')
    await downloadUpdate()
    expect(mockApi.updater.downloadUpdate).toHaveBeenCalled()
  })

  it('handles downloadUpdate error safely without throwing', async () => {
    mockApi.updater.downloadUpdate.mockResolvedValue({
      code: 'UNKNOWN',
      message: 'Failed to download',
      userMessage: 'Failed'
    })
    const { downloadUpdate } = useAutoUpdate()
    await expect(downloadUpdate()).resolves.toBeUndefined()
  })

  it('provides installUpdate method that unwraps IpcResult', async () => {
    const { installUpdate } = useAutoUpdate()
    expect(typeof installUpdate).toBe('function')
    await installUpdate()
    expect(mockApi.updater.installUpdate).toHaveBeenCalled()
  })

  it('handles installUpdate error safely without throwing', async () => {
    mockApi.updater.installUpdate.mockResolvedValue({
      code: 'UNKNOWN',
      message: 'Failed to install',
      userMessage: 'Failed'
    })
    const { installUpdate } = useAutoUpdate()
    await expect(installUpdate()).resolves.toBeUndefined()
  })

  it('provides isUpdateAvailable computed', () => {
    const { isUpdateAvailable } = useAutoUpdate()
    expect(isUpdateAvailable.value).toBe(false)
  })
})
