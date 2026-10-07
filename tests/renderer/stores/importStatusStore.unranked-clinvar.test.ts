import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { logService } from '../../../src/renderer/src/services/LogService'
import { useImportStatusStore } from '../../../src/renderer/src/stores/importStatusStore'

const result = (unrankedClinvar?: string[]) => ({
  succeeded: 1,
  failed: 0,
  skipped: 0,
  cancelled: false,
  details: [
    {
      filePath: '/x/sevA.json',
      fileName: 'sevA.json',
      caseName: 'sevA',
      status: 'success' as const,
      ...(unrankedClinvar !== undefined ? { unrankedClinvar } : {})
    }
  ]
})

describe('importStatusStore: unrecognised ClinVar values in the in-app log (#469)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('logs a finished import once, although the dialog and the shell both report it', () => {
    const warn = vi.spyOn(logService, 'warn').mockImplementation(() => undefined)
    const store = useImportStatusStore()

    store.startImport(1, 'run-1')
    store.importComplete(result(['totally_made_up_term']))
    store.importComplete(result(['totally_made_up_term']))

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a report without details does not use up the one log line', () => {
    const warn = vi.spyOn(logService, 'warn').mockImplementation(() => undefined)
    const store = useImportStatusStore()

    store.startImport(1, 'run-1')
    store.importComplete({ ...result(), details: [] })
    store.importComplete(result(['totally_made_up_term']))

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('logs again for the next import', () => {
    const warn = vi.spyOn(logService, 'warn').mockImplementation(() => undefined)
    const store = useImportStatusStore()

    store.startImport(1, 'run-1')
    store.importComplete(result(['totally_made_up_term']))
    store.startImport(1, 'run-2')
    store.importComplete(result(['totally_made_up_term']))

    expect(warn).toHaveBeenCalledTimes(2)
  })
})
