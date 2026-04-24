import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'

describe('databaseStore.fetchInfo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        database: {
          info: vi.fn().mockResolvedValue(null),
          recentList: vi.fn().mockResolvedValue([])
        }
      }
    })
  })

  it('clears stale sqlite metadata when database:info returns null', async () => {
    const store = useDatabaseStore()

    store.currentPath = '/tmp/old.db'
    store.currentName = 'old.db'
    store.isEncrypted = true

    await store.fetchInfo()

    expect(store.currentPath).toBeNull()
    expect(store.currentName).toBe('')
    expect(store.isEncrypted).toBe(false)
  })
})
