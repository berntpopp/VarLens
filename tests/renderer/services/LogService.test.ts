import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { logService } from '../../../src/renderer/src/services/LogService'
import { useLogStore } from '../../../src/renderer/src/stores/logStore'

describe('LogService redaction', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('redacts a colon-form credential before storing a renderer log entry', () => {
    logService.error('password: hunter2', 'database')

    const store = useLogStore()
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0].message).toContain('[REDACTED:KEY]')
    expect(store.entries[0].message).not.toContain('hunter2')
  })
})
