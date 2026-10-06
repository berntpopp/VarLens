import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  isReferenceServiceEnabled,
  useReferenceServicesStore
} from '../../../src/renderer/src/stores/referenceServicesStore'
import {
  buildReferenceServicesStatus,
  uniformReferenceServicePolicy
} from '../../../src/shared/ipc/domains/reference-services'
import { createMockApi } from '../../utils/mock-api'

type TestWindow = Window & { api?: unknown; __VARLENS_WEB__?: boolean }
const testWindow = window as TestWindow

describe('referenceServicesStore', () => {
  let api: ReturnType<typeof createMockApi>

  beforeEach(() => {
    api = createMockApi()
    testWindow.api = api
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete testWindow.__VARLENS_WEB__
  })

  it('desktop: every service is available without a reason', () => {
    const store = useReferenceServicesStore()
    expect(store.isEnabled('vep')).toBe(true)
    expect(store.reason('panelapp')).toBeNull()
    expect(isReferenceServiceEnabled('gnomad')).toBe(true)
  })

  it('web: fail-closed until the status loads, then follows the server policy', async () => {
    testWindow.__VARLENS_WEB__ = true
    api.referenceServices.status.mockResolvedValue(
      buildReferenceServicesStatus('web', { ...uniformReferenceServicePolicy(false), vep: true })
    )
    const store = useReferenceServicesStore()
    expect(store.isEnabled('vep')).toBe(false)
    expect(store.reason('vep')).toMatch(/Checking/)

    await store.ensureLoaded()
    expect(store.isEnabled('vep')).toBe(true)
    expect(store.reason('vep')).toBeNull()
    expect(store.isEnabled('myvariant')).toBe(false)
    expect(store.reason('myvariant')).toMatch(/MyVariant\.info lookups are turned off/)
    expect(isReferenceServiceEnabled('vep')).toBe(true)
  })

  it('web: a failed status load keeps everything off with an explicit reason', async () => {
    testWindow.__VARLENS_WEB__ = true
    api.referenceServices.status.mockRejectedValue(new Error('boom'))
    const store = useReferenceServicesStore()
    await store.ensureLoaded()
    expect(store.isEnabled('vep')).toBe(false)
    expect(store.reason('vep')).toMatch(/could not be loaded/)
  })

  it('concurrent ensureLoaded calls share one request', async () => {
    const store = useReferenceServicesStore()
    await Promise.all([store.ensureLoaded(), store.ensureLoaded(), store.ensureLoaded()])
    expect(api.referenceServices.status).toHaveBeenCalledTimes(1)
  })
})
