import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('auth preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all auth domain channels without unwrapping in createAuthApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        user: { id: 1, username: 'admin', role: 'admin' }
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        success: true,
        data: { id: 1, username: 'admin', role: 'admin' }
      })
      .mockResolvedValueOnce({
        success: true,
        data: true
      })
      .mockResolvedValueOnce({
        success: true,
        data: undefined
      })
      .mockResolvedValueOnce({
        success: true,
        data: [
          {
            id: 1,
            username: 'admin',
            display_name: 'Admin User',
            role: 'admin',
            is_active: 1,
            must_change_password: 0,
            failed_login_count: 0,
            created_at: '2024-01-01T00:00:00Z'
          }
        ]
      })
      .mockResolvedValueOnce({
        success: true,
        data: undefined
      })
      .mockResolvedValueOnce({
        success: true,
        data: undefined
      })
      .mockResolvedValueOnce({
        success: true,
        data: undefined
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createAuthApi } = await import('../../../../src/preload/domains/auth')
    const api = createAuthApi()

    await expect(api.login('admin', 'password123')).resolves.toEqual({
      success: true,
      user: { id: 1, username: 'admin', role: 'admin' }
    })
    await expect(api.logout()).resolves.toBeUndefined()
    await expect(api.currentUser()).resolves.toEqual({
      success: true,
      data: { id: 1, username: 'admin', role: 'admin' }
    })
    await expect(api.isAccountsEnabled()).resolves.toEqual({
      success: true,
      data: true
    })
    await expect(api.createUser('user1', 'User One', 'temppass123')).resolves.toEqual({
      success: true,
      data: undefined
    })
    await expect(api.listUsers()).resolves.toEqual({
      success: true,
      data: [
        {
          id: 1,
          username: 'admin',
          display_name: 'Admin User',
          role: 'admin',
          is_active: 1,
          must_change_password: 0,
          failed_login_count: 0,
          created_at: '2024-01-01T00:00:00Z'
        }
      ]
    })
    await expect(api.deactivateUser('user1')).resolves.toEqual({
      success: true,
      data: undefined
    })
    await expect(api.resetPassword('user1', 'newpass456')).resolves.toEqual({
      success: true,
      data: undefined
    })
    await expect(api.changePassword('oldpass123', 'newpass456')).resolves.toEqual({
      success: true,
      data: undefined
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'auth:login', 'admin', 'password123')
    expect(invoke).toHaveBeenNthCalledWith(2, 'auth:logout')
    expect(invoke).toHaveBeenNthCalledWith(3, 'auth:currentUser')
    expect(invoke).toHaveBeenNthCalledWith(4, 'auth:isAccountsEnabled')
    expect(invoke).toHaveBeenNthCalledWith(
      5,
      'auth:createUser',
      'user1',
      'User One',
      'temppass123',
      undefined
    )
    expect(invoke).toHaveBeenNthCalledWith(6, 'auth:listUsers')
    expect(invoke).toHaveBeenNthCalledWith(7, 'auth:deactivateUser', 'user1')
    expect(invoke).toHaveBeenNthCalledWith(8, 'auth:resetPassword', 'user1', 'newpass456')
    expect(invoke).toHaveBeenNthCalledWith(9, 'auth:changePassword', 'oldpass123', 'newpass456')
  })

  it('preload index preserves auth transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'auth:login') {
        return {
          success: false,
          code: ErrorCode.VALIDATION_ERROR,
          message: 'auth:login failed',
          userMessage: 'Invalid credentials'
        }
      }
      if (channel === 'auth:currentUser') {
        return {
          success: true,
          data: { id: 1, username: 'admin', role: 'admin' }
        }
      }
      if (channel === 'auth:logout') {
        return undefined
      }
      return undefined
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
      auth: {
        login: (username: string, password: string) => Promise<unknown>
        currentUser: () => Promise<unknown>
        logout: () => Promise<unknown>
      }
    }

    await expect(api.auth.login('user', 'wrong')).resolves.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'auth:login failed'
    })
    await expect(api.auth.currentUser()).resolves.toMatchObject({
      success: true,
      data: { id: 1, username: 'admin', role: 'admin' }
    })
    await expect(api.auth.logout()).resolves.toBeUndefined()
  })
})
