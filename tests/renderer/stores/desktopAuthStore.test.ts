import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCapabilityStore } from '../../../src/renderer/src/stores/capabilityStore'
import { useDesktopAuthStore } from '../../../src/renderer/src/stores/desktopAuthStore'
import { computeCapabilityDocument } from '../../../src/shared/ipc/capability-document'

type TestWindow = Window & { api?: unknown }

function stubApi(
  desktopStatus: () => Promise<unknown>,
  runtime: 'desktop' | 'web' = 'desktop'
): void {
  ;(window as TestWindow).api = {
    system: {
      getCapabilities: () =>
        Promise.resolve(computeCapabilityDocument({ runtime, role: 'admin', storage: null }))
    },
    auth: { desktopStatus }
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

  it('never asks on the web', async () => {
    const desktopStatus = vi.fn()
    stubApi(desktopStatus, 'web')
    await useCapabilityStore().load()
    await useDesktopAuthStore().load()
    expect(desktopStatus).not.toHaveBeenCalled()
  })
})
