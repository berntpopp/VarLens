/**
 * Tests for NetworkStatus service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NetworkStatus } from '../../../../src/main/services/network/NetworkStatus'

// Mock Electron's net module
vi.mock('electron', () => ({
  net: {
    isOnline: vi.fn()
  }
}))

describe('NetworkStatus', () => {
  let networkStatus: NetworkStatus

  beforeEach(() => {
    networkStatus = new NetworkStatus()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return true when net.isOnline returns true', async () => {
    const { net } = await import('electron')
    vi.mocked(net.isOnline).mockReturnValue(true)

    const status = networkStatus.getStatus()
    expect(status).toBe(true)
  })

  it('should return false when net.isOnline returns false', async () => {
    const { net } = await import('electron')
    vi.mocked(net.isOnline).mockReturnValue(false)

    const status = networkStatus.getStatus()
    expect(status).toBe(false)
  })

  it('should call net.isOnline on each getStatus call', async () => {
    const { net } = await import('electron')
    vi.mocked(net.isOnline).mockReturnValue(true)

    networkStatus.getStatus()
    networkStatus.getStatus()
    networkStatus.getStatus()

    expect(net.isOnline).toHaveBeenCalledTimes(3)
  })
})
