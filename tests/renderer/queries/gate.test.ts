import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { canQuery, queryApi } from '../../../src/renderer/src/queries/gate'
import { useCapabilityStore } from '../../../src/renderer/src/stores/capabilityStore'
import { MOCK_SQLITE_CAPABILITIES } from '../../../src/renderer/src/mocks/mockApi'
import { installCapabilities } from '../helpers/capabilities'

describe('query gate', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('window', { api: {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is closed until the capability document has loaded', () => {
    expect(canQuery('workflow.tags')).toBe(false)
  })

  it('opens once the document enables the capability', () => {
    installCapabilities()
    expect(canQuery('workflow.tags')).toBe(true)
    expect(canQuery('variants.typesPresent')).toBe(true)
  })

  it('is closed when the storage backend lacks the capability', () => {
    installCapabilities({
      storage: {
        ...MOCK_SQLITE_CAPABILITIES,
        workflow: { ...MOCK_SQLITE_CAPABILITIES.workflow, tags: false }
      }
    })
    expect(canQuery('workflow.tags')).toBe(false)
  })

  it('closes again when the document is lost', () => {
    installCapabilities()
    useCapabilityStore().setDocument(null)
    expect(canQuery('workflow.tags')).toBe(false)
  })

  it('is closed without window.api, and queryApi says why', () => {
    installCapabilities()
    vi.stubGlobal('window', {})
    expect(canQuery('workflow.tags')).toBe(false)
    expect(() => queryApi()).toThrow(/window\.api/)
  })
})
