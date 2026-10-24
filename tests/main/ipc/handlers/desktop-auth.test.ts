import { describe, it, expect } from 'vitest'
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
  it('answers the sign-in state', async () => {
    const desktopAuth = {
      status: () => ({ mode: 'platform', state: 'locked', issuer: 'https://idp.example.org' })
    }
    const handlers = register(desktopAuth as unknown as DesktopAuth)
    expect([...handlers.keys()]).toEqual(['auth:desktopStatus'])
    await expect(handlers.get('auth:desktopStatus')!({})).resolves.toMatchObject({
      state: 'locked'
    })
  })

  it('reports no sign-in without the admin config file', async () => {
    const handlers = register(undefined)
    await expect(handlers.get('auth:desktopStatus')!({})).resolves.toEqual({ mode: 'none' })
  })
})
