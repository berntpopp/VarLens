import { describe, it, expect, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { DesktopAuth } from '../../../../src/main/auth/desktop-auth'
import { registerDesktopAuthHandlers } from '../../../../src/main/ipc/handlers/desktop-auth'

function register(desktopAuth: DesktopAuth | undefined): Map<string, (event: unknown) => unknown> {
  const handlers = new Map<string, (event: unknown) => unknown>()
  const ipcMain = {
    handle: (channel: string, listener: (event: unknown) => unknown) => {
      handlers.set(channel, listener)
    }
  } as unknown as IpcMain
  registerDesktopAuthHandlers(ipcMain, () => desktopAuth)
  return handlers
}

describe('desktop auth handlers', () => {
  it('answers the state, runs the sign-in, cancels it and locks', async () => {
    const desktopAuth = {
      status: () => ({ mode: 'platform', state: 'locked', issuer: 'https://idp.example.org' }),
      signIn: async () => ({ outcome: 'enrolled' }),
      cancelSignIn: vi.fn(),
      lock: vi.fn(async () => undefined)
    }
    const handlers = register(desktopAuth as unknown as DesktopAuth)
    expect([...handlers.keys()]).toEqual([
      'auth:desktopStatus',
      'auth:desktopSignIn',
      'auth:desktopCancelSignIn',
      'auth:desktopLock'
    ])
    await expect(handlers.get('auth:desktopStatus')!({})).resolves.toMatchObject({
      state: 'locked'
    })
    await expect(handlers.get('auth:desktopSignIn')!({})).resolves.toEqual({ outcome: 'enrolled' })
    await handlers.get('auth:desktopCancelSignIn')!({})
    expect(desktopAuth.cancelSignIn).toHaveBeenCalledOnce()
    await handlers.get('auth:desktopLock')!({})
    expect(desktopAuth.lock).toHaveBeenCalledWith('user')
  })

  it('reports no sign-in without the admin config file', async () => {
    const handlers = register(undefined)
    await expect(handlers.get('auth:desktopStatus')!({})).resolves.toEqual({ mode: 'none' })
    await expect(handlers.get('auth:desktopSignIn')!({})).resolves.toMatchObject({
      outcome: 'failed'
    })
    await expect(handlers.get('auth:desktopLock')!({})).resolves.toBeUndefined()
  })
})
