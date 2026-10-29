import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCapabilityStore } from '../../../src/renderer/src/stores/capabilityStore'
import { useDesktopAuthStore } from '../../../src/renderer/src/stores/desktopAuthStore'
import { computeCapabilityDocument } from '../../../src/shared/ipc/capability-document'

type TestWindow = Window & { api?: unknown }

function stubApi(
  desktopStatus: () => Promise<unknown>,
  runtime: 'desktop' | 'web' = 'desktop',
  signIn: {
    desktopSignIn?: () => Promise<unknown>
    desktopCancelSignIn?: () => Promise<unknown>
    desktopLock?: () => Promise<unknown>
  } = {}
): void {
  ;(window as TestWindow).api = {
    system: {
      getCapabilities: () =>
        Promise.resolve(computeCapabilityDocument({ runtime, role: 'admin', storage: null }))
    },
    auth: { desktopStatus, ...signIn }
  }
}

describe('desktopAuthStore', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    delete (window as TestWindow).api
  })

  it('requires nothing without the admin config file', async () => {
    stubApi(() => Promise.resolve({ mode: 'none' }))
    await useCapabilityStore().load()
    const store = useDesktopAuthStore()
    await store.load()
    expect(store.status).toEqual({ mode: 'none' })
    expect(store.required).toBe(false)
  })

  it('requires the sign-in while platform mode is locked or misconfigured', async () => {
    for (const status of [
      { mode: 'platform', state: 'locked', issuer: 'https://k.example.org/realms/varlens' },
      { mode: 'platform', state: 'misconfigured', problem: 'not owned by root' }
    ]) {
      setActivePinia(createPinia())
      stubApi(() => Promise.resolve(status))
      await useCapabilityStore().load()
      const store = useDesktopAuthStore()
      await store.load()
      expect(store.required).toBe(true)
    }
  })

  it('shows the app once signed in', async () => {
    stubApi(() =>
      Promise.resolve({ mode: 'platform', state: 'signed-in', issuer: 'https://k.example.org' })
    )
    await useCapabilityStore().load()
    const store = useDesktopAuthStore()
    await store.load()
    expect(store.required).toBe(false)
  })

  it('keeps the outcome of a sign-in and shows waiting meanwhile', async () => {
    let finish: (value: unknown) => void = () => undefined
    const locked = { mode: 'platform', state: 'locked', issuer: 'https://k' }
    stubApi(() => Promise.resolve(locked), 'desktop', {
      desktopSignIn: () => new Promise((resolve) => (finish = resolve))
    })
    await useCapabilityStore().load()
    const store = useDesktopAuthStore()
    const running = store.signIn()
    expect(store.signingIn).toBe(true)
    finish({ outcome: 'enrolled' })
    await running
    expect(store.signingIn).toBe(false)
    expect(store.lastResult).toEqual({ outcome: 'enrolled' })
  })

  it('turns an IPC failure into a failed outcome', async () => {
    const locked = { mode: 'platform', state: 'locked', issuer: 'https://k' }
    stubApi(() => Promise.resolve(locked), 'desktop', {
      desktopSignIn: () =>
        Promise.resolve({ code: 'INTERNAL', message: 'x', userMessage: 'Broken' })
    })
    await useCapabilityStore().load()
    const store = useDesktopAuthStore()
    await store.signIn()
    expect(store.lastResult).toMatchObject({ outcome: 'failed' })
  })

  it('logs a failed lock or cancel instead of rejecting', async () => {
    const failure = () => Promise.resolve({ code: 'INTERNAL', message: 'x', userMessage: 'Broken' })
    const locked = { mode: 'platform', state: 'signed-in', issuer: 'https://k' }
    stubApi(() => Promise.resolve(locked), 'desktop', {
      desktopLock: failure,
      desktopCancelSignIn: () => Promise.reject(new Error('gone'))
    })
    await useCapabilityStore().load()
    const store = useDesktopAuthStore()
    await expect(store.lock()).resolves.toBeUndefined()
    await expect(store.cancelSignIn()).resolves.toBeUndefined()
  })

  it('never asks on the web', async () => {
    const desktopStatus = vi.fn()
    stubApi(desktopStatus, 'web')
    await useCapabilityStore().load()
    await useDesktopAuthStore().load()
    expect(desktopStatus).not.toHaveBeenCalled()
  })
})
