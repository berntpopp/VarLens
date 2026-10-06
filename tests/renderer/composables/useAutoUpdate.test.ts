import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installCapabilities } from '../helpers/capabilities'

// The capability store fails closed: install a desktop document.
beforeEach(() => installCapabilities())

const cleanupFn = vi.fn()

// Mock window.api
const mockApi = {
  updater: {
    checkForUpdate: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
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
    mockApi.updater.getStatus.mockResolvedValue({ state: 'idle' })
    const mod = await import('../../../src/renderer/src/composables/useAutoUpdate')
    useAutoUpdate = mod.useAutoUpdate
  })

  it('returns reactive updateStatus', () => {
    const { updateStatus } = useAutoUpdate()
    expect(updateStatus.value.state).toBe('idle')
  })

  it('provides checkForUpdate method', () => {
    const { checkForUpdate } = useAutoUpdate()
    expect(typeof checkForUpdate).toBe('function')
  })

  it('provides downloadUpdate method', () => {
    const { downloadUpdate } = useAutoUpdate()
    expect(typeof downloadUpdate).toBe('function')
  })

  it('provides installUpdate method', () => {
    const { installUpdate } = useAutoUpdate()
    expect(typeof installUpdate).toBe('function')
  })

  it('provides isUpdateAvailable computed', () => {
    const { isUpdateAvailable } = useAutoUpdate()
    expect(isUpdateAvailable.value).toBe(false)
  })
})
