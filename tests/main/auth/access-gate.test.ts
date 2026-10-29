import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { IpcMain } from 'electron'
import {
  CHANNELS_WITHOUT_SESSION,
  LOCAL_ACCOUNT_CHANNELS,
  SERVER_WORKSPACE_CHANNELS,
  gateIpcMainOnAccess,
  getAccessGate,
  passThroughProvider,
  setAccessProvider,
  type AccessProvider
} from '../../../src/main/auth/access-gate'
import { AppError } from '../../../src/main/ipc/errors'
import { ErrorCode, isIpcError } from '../../../src/shared/types/errors'

function provider(unlocked: boolean): AccessProvider {
  return { mode: 'platform', isUnlocked: () => unlocked }
}

function capture(): {
  raw: IpcMain
  registered: Map<string, (...args: unknown[]) => unknown>
} {
  const registered = new Map<string, (...args: unknown[]) => unknown>()
  const raw = {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      registered.set(channel, listener)
    },
    listenerCount: () => 3
  } as unknown as IpcMain
  return { raw, registered }
}

describe('access gate', () => {
  beforeEach(() => setAccessProvider(passThroughProvider))

  it('refuses local accounts and server workspaces in platform mode, signed in or not', () => {
    for (const unlocked of [false, true]) {
      setAccessProvider(provider(unlocked))
      for (const channel of [...LOCAL_ACCOUNT_CHANNELS, ...SERVER_WORKSPACE_CHANNELS]) {
        let error: unknown
        try {
          getAccessGate().assertAllowed(channel)
        } catch (caught) {
          error = caught
        }
        expect((error as AppError).code).toBe(ErrorCode.FORBIDDEN)
      }
    }
  })

  it('lists exactly the channels the local accounts register', async () => {
    const { registerAuthHandlers } = await import('../../../src/main/ipc/handlers/auth')
    const channels: string[] = []
    const ipcMain = { handle: (channel: string) => channels.push(channel) } as unknown as IpcMain
    registerAuthHandlers({ ipcMain, getDb: vi.fn(), getDbManager: vi.fn() } as never)
    expect(channels.sort()).toEqual([...LOCAL_ACCOUNT_CHANNELS].sort())
  })

  it('leaves the local accounts alone without a sign-in mode', () => {
    for (const channel of LOCAL_ACCOUNT_CHANNELS) {
      expect(() => getAccessGate().assertAllowed(channel)).not.toThrow()
    }
  })

  it('answers the sign-in state while locked', () => {
    setAccessProvider(provider(false))
    expect(() => getAccessGate().assertAllowed('auth:desktopStatus')).not.toThrow()
  })

  it('lets everything through without a sign-in mode, exactly as today', () => {
    const gate = getAccessGate()
    expect(gate.requiresSignIn()).toBe(false)
    expect(() => gate.assertAllowed('cases:list')).not.toThrow()
    expect(() => gate.assertAllowed('database:open')).not.toThrow()
  })

  it('refuses data channels while a sign-in mode is locked, allowing only the allowlist', () => {
    setAccessProvider(provider(false))
    const gate = getAccessGate()
    expect(gate.requiresSignIn()).toBe(true)
    for (const channel of CHANNELS_WITHOUT_SESSION) {
      expect(() => gate.assertAllowed(channel)).not.toThrow()
    }
    for (const channel of ['cases:list', 'database:open', 'database:recentList', 'jobs:list']) {
      let error: unknown
      try {
        gate.assertAllowed(channel)
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe(ErrorCode.UNAUTHENTICATED)
    }
  })

  it('opens every channel once the sign-in mode is unlocked', () => {
    setAccessProvider(provider(true))
    expect(getAccessGate().requiresSignIn()).toBe(false)
    expect(() => getAccessGate().assertAllowed('cases:list')).not.toThrow()
  })

  it('keeps the allowlist free of data channels', () => {
    for (const channel of CHANNELS_WITHOUT_SESSION) {
      expect(channel).toMatch(
        /^(system:(capabilities|version)|auth:desktop(Status|SignIn|CancelSignIn))$/
      )
    }
  })
})

describe('gateIpcMainOnAccess', () => {
  beforeEach(() => setAccessProvider(passThroughProvider))

  it('answers a refused channel with the error envelope and never runs its handler', async () => {
    const { raw, registered } = capture()
    const gated = gateIpcMainOnAccess(raw)
    const listener = vi.fn(async () => 'cases')
    gated.handle('cases:list', listener)
    expect(gated.listenerCount('x')).toBe(3)

    setAccessProvider(provider(false))
    const refused = await registered.get('cases:list')!({})
    expect(listener).not.toHaveBeenCalled()
    expect(isIpcError(refused)).toBe(true)
    expect((refused as { code: string }).code).toBe(ErrorCode.UNAUTHENTICATED)

    setAccessProvider(provider(true))
    await expect(registered.get('cases:list')!({})).resolves.toBe('cases')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('checks the provider at call time, so a later lock takes effect on existing handlers', async () => {
    const { raw, registered } = capture()
    const gated = gateIpcMainOnAccess(raw)
    gated.handle('variants:query', async () => 'rows')

    await expect(registered.get('variants:query')!({})).resolves.toBe('rows')
    setAccessProvider(provider(false))
    expect(isIpcError(await registered.get('variants:query')!({}))).toBe(true)
  })

  it('refuses listener registrations that would bypass the per-call check', () => {
    const { raw } = capture()
    const gated = gateIpcMainOnAccess(raw)
    for (const register of [
      gated.on,
      gated.once,
      gated.handleOnce,
      gated.addListener,
      gated.prependListener,
      gated.prependOnceListener
    ]) {
      expect(() => register('cases:list', () => undefined)).toThrow(/bypasses the access gate/)
    }
  })
})
