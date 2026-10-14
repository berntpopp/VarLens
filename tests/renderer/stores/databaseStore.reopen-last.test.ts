import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { useSettingsStore } from '../../../src/renderer/src/stores/settingsStore'
import { MOCK_SQLITE_CAPABILITIES } from '../../../src/renderer/src/mocks/mockApi'
import {
  computeCapabilityDocument,
  type CapabilityRuntime
} from '../../../src/shared/ipc/capability-document'

const DEFAULT_INFO = { path: '/user/varlens.db', name: 'varlens.db', encrypted: false }
const LAST_INFO = { path: '/data/last.db', name: 'last.db', encrypted: true }

function installApi(open: ReturnType<typeof vi.fn>, runtime: CapabilityRuntime = 'desktop'): void {
  const capabilities = computeCapabilityDocument({
    runtime,
    role: 'admin',
    storage: runtime === 'desktop' ? MOCK_SQLITE_CAPABILITIES : null
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      system: { getCapabilities: vi.fn().mockResolvedValue(capabilities) },
      database: {
        info: vi.fn().mockResolvedValue(DEFAULT_INFO),
        recentList: vi.fn().mockResolvedValue([]),
        open
      }
    }
  })
}

describe('databaseStore: reopen last database at startup (#575)', () => {
  let open: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    open = vi.fn().mockResolvedValue({ success: true, info: LAST_INFO })
    installApi(open)
  })

  it('does nothing when the option is off (default)', async () => {
    useSettingsStore().lastDatabasePath = LAST_INFO.path
    const store = useDatabaseStore()
    await store.fetchInfo()
    expect(open).not.toHaveBeenCalled()
    expect(store.currentPath).toBe(DEFAULT_INFO.path)
  })

  it('reopens the last database once, after the first info load', async () => {
    const settings = useSettingsStore()
    settings.reopenLastDatabase = true
    settings.lastDatabasePath = LAST_INFO.path
    const store = useDatabaseStore()

    await store.fetchInfo()
    expect(open).toHaveBeenCalledExactlyOnceWith(LAST_INFO.path, undefined)
    expect(store.currentPath).toBe(LAST_INFO.path)
    expect(store.reopenedAtStartup).toBe(true)

    await store.fetchInfo()
    expect(open).toHaveBeenCalledOnce()
  })

  it('never asks for a password: a locked database leaves the default open', async () => {
    open.mockResolvedValue({ success: false, needsPassword: true })
    const settings = useSettingsStore()
    settings.reopenLastDatabase = true
    settings.lastDatabasePath = LAST_INFO.path
    const store = useDatabaseStore()

    await store.fetchInfo()
    // No password argument is ever sent; no state changes that a prompt could hang off.
    expect(open).toHaveBeenCalledExactlyOnceWith(LAST_INFO.path, undefined)
    expect(store.currentPath).toBe(DEFAULT_INFO.path)
    expect(store.reopenedAtStartup).toBe(false)
    expect(settings.lastDatabasePath).toBe(LAST_INFO.path)
  })

  it('stays on the default database when the reopen throws (e.g. file gone)', async () => {
    open.mockRejectedValue(new Error('Failed to read database'))
    const settings = useSettingsStore()
    settings.reopenLastDatabase = true
    settings.lastDatabasePath = LAST_INFO.path
    const store = useDatabaseStore()

    await expect(store.fetchInfo()).resolves.toBeUndefined()
    expect(store.currentPath).toBe(DEFAULT_INFO.path)
    expect(store.reopenedAtStartup).toBe(false)
  })

  it('skips the hosted web workspace', async () => {
    installApi(open, 'web')
    const settings = useSettingsStore()
    settings.reopenLastDatabase = true
    settings.lastDatabasePath = LAST_INFO.path

    await useDatabaseStore().fetchInfo()
    expect(open).not.toHaveBeenCalled()
  })

  it('remembers the database the user opened, not the startup default', async () => {
    const store = useDatabaseStore()
    await store.fetchInfo()
    expect(useSettingsStore().lastDatabasePath).toBeNull()

    await store.openDatabase(LAST_INFO.path)
    expect(useSettingsStore().lastDatabasePath).toBe(LAST_INFO.path)
  })
})
