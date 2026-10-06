import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CapabilityUnavailableError,
  useCapabilityStore
} from '../../../src/renderer/src/stores/capabilityStore'
import { computeCapabilityDocument } from '../../../src/shared/ipc/capability-document'
import { ErrorCode } from '../../../src/shared/types/errors'

type TestWindow = Window & { api?: unknown }

function stubApi(getCapabilities: () => Promise<unknown>): void {
  ;(window as TestWindow).api = { system: { getCapabilities } }
}

describe('capabilityStore', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    delete (window as TestWindow).api
  })

  it('fails closed while the document is loading', async () => {
    let resolve: (value: unknown) => void = () => undefined
    stubApi(() => new Promise((r) => (resolve = r)))
    const store = useCapabilityStore()

    const loading = store.load()
    expect(store.canUse('hpoSearch')).toBe(false)
    expect(store.capabilityReason('hpoSearch')).toMatch(/Checking/)

    resolve(computeCapabilityDocument({ runtime: 'desktop', role: 'admin', storage: null }))
    await loading
    expect(store.canUse('hpoSearch')).toBe(true)
    expect(store.capabilityReason('hpoSearch')).toBeNull()
  })

  it('stays closed and reports why when the document fails to load', async () => {
    stubApi(() =>
      Promise.resolve({ code: ErrorCode.UNKNOWN, message: 'boom', userMessage: 'Server down' })
    )
    const store = useCapabilityStore()
    await store.load()
    expect(store.loaded).toBe(false)
    expect(store.canUse('multiFileImport')).toBe(false)
    expect(store.capabilityReason('multiFileImport')).toMatch(/could not be loaded/)
    expect(() => store.requireCapability('multiFileImport')).toThrow(CapabilityUnavailableError)
  })

  it('shares one request between concurrent loads', async () => {
    const getCapabilities = vi.fn(() =>
      Promise.resolve(computeCapabilityDocument({ runtime: 'web', role: 'user', storage: null }))
    )
    stubApi(getCapabilities)
    const store = useCapabilityStore()
    await Promise.all([store.load(), store.load()])
    expect(getCapabilities).toHaveBeenCalledOnce()
    expect(store.runtime).toBe('web')
    expect(store.capabilityReason('localDatabaseFiles')).toMatch(/server workspace/)
  })
})
