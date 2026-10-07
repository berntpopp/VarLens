import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { installCapabilities } from '../helpers/capabilities'

const info = { path: '/db/a.varlens', name: 'a', encrypted: false }

describe('databaseStore.revision', () => {
  const open = vi.fn()
  const databaseInfo = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    installCapabilities()
    open.mockResolvedValue({ success: true, info })
    vi.stubGlobal('window', {
      api: {
        database: { open, info: databaseInfo, recentList: vi.fn().mockResolvedValue([]) },
        system: { getCapabilities: vi.fn().mockRejectedValue(new Error('unused')) }
      }
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('advances whenever a database is opened, including the same path again', async () => {
    const store = useDatabaseStore()
    const start = store.revision

    await store.openDatabase(info.path)
    expect(store.revision).toBe(start + 1)

    await store.openDatabase(info.path)
    expect(store.revision).toBe(start + 2)
  })

  it('does not advance when opening fails', async () => {
    const store = useDatabaseStore()
    const start = store.revision
    open.mockResolvedValue({ success: false, error: 'wrong password' })

    await store.openDatabase(info.path)
    expect(store.revision).toBe(start)
  })

  it('advances when the open database goes away', async () => {
    const store = useDatabaseStore()
    const start = store.revision
    databaseInfo.mockResolvedValue(null)

    await store.fetchInfo()
    expect(store.revision).toBe(start + 1)
  })
})
