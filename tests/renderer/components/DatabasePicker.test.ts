import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import DatabasePicker from '../../../src/renderer/src/components/DatabasePicker.vue'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import type { PostgresConnectionProfilePublic } from '../../../src/shared/types/postgres-profile'
import { createMockApi, type MockApi } from '../../utils/mock-api'

const vuetify = createVuetify({ components, directives })

const POSTGRES_PROFILE: PostgresConnectionProfilePublic = {
  id: 'profile-1',
  name: 'Lab PostgreSQL',
  host: 'localhost',
  port: 5432,
  database: 'varlens',
  username: 'varlens',
  schema: 'public',
  sslMode: 'disable',
  poolMax: 5,
  connectionTimeoutMillis: 5000,
  statementTimeoutMs: 30000,
  lockTimeoutMs: 5000,
  idleInTransactionSessionTimeoutMs: 60000,
  caCertificateConfigured: false
}

describe('DatabasePicker', () => {
  let wrapper: VueWrapper<InstanceType<typeof DatabasePicker>>
  let mockApi: MockApi

  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi = createMockApi()
    mockApi.database.deleteFile = vi.fn().mockResolvedValue({ success: true })
    window.api = mockApi as unknown as typeof window.api
    window.__VARLENS_WEB__ = false
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    window.__VARLENS_WEB__ = false
    vi.restoreAllMocks()
  })

  function mountPicker() {
    wrapper = mount(DatabasePicker, {
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    return wrapper
  }

  async function openPickerMenu() {
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()
    await flushPromises()
  }

  function clickAction(label: string) {
    const button = document.body.querySelector(`button[aria-label="${label}"]`)
    expect(button).toBeInstanceOf(HTMLButtonElement)
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('renders PostgreSQL workspaces separately from recent SQLite databases', async () => {
    const store = useDatabaseStore()
    store.recentDatabases = [{ path: '/tmp/case.sqlite', name: 'case.sqlite', lastOpened: 1 }]
    store.postgresProfiles = [POSTGRES_PROFILE]
    mockApi.database.postgresProfilesList.mockResolvedValue([POSTGRES_PROFILE])

    mountPicker()
    await openPickerMenu()

    const menuText = document.body.textContent ?? ''
    expect(menuText).toContain('Recent Databases')
    expect(menuText).toContain('case.sqlite')
    expect(menuText).toContain('PostgreSQL Workspaces')
    expect(menuText).toContain('Lab PostgreSQL')
    expect(menuText).toContain('localhost:5432/varlens')
  })

  it('opens the PostgreSQL connection dialog from the add action', async () => {
    mountPicker()
    await openPickerMenu()

    clickAction('Add PostgreSQL workspace')
    await flushPromises()

    expect(document.body.textContent).toContain('PostgreSQL Workspace')
    expect(document.body.textContent).toContain('Display Name')
  })

  it('connects to a saved PostgreSQL profile and emits database-switched', async () => {
    const store = useDatabaseStore()
    store.postgresProfiles = [POSTGRES_PROFILE]
    mockApi.database.postgresProfilesList.mockResolvedValue([POSTGRES_PROFILE])
    mockApi.database.postgresProfileOpen.mockResolvedValue({
      success: true,
      info: {
        path: 'postgres://profile-1',
        name: 'Lab PostgreSQL',
        encrypted: false
      }
    })

    mountPicker()
    await openPickerMenu()
    clickAction('Connect PostgreSQL workspace Lab PostgreSQL')
    await flushPromises()

    expect(mockApi.database.postgresProfileOpen).toHaveBeenCalledWith('profile-1')
    expect(wrapper.emitted('database-switched')).toEqual([[]])
  })

  it('emits errors when PostgreSQL profile open fails', async () => {
    const store = useDatabaseStore()
    store.postgresProfiles = [POSTGRES_PROFILE]
    mockApi.database.postgresProfilesList.mockResolvedValue([POSTGRES_PROFILE])
    mockApi.database.postgresProfileOpen.mockRejectedValue(new Error('connection failed'))

    mountPicker()
    await openPickerMenu()
    clickAction('Connect PostgreSQL workspace Lab PostgreSQL')
    await flushPromises()

    expect(wrapper.emitted('database-switched')).toBeUndefined()
    expect(wrapper.emitted('error')).toEqual([['connection failed']])
  })

  it('removes a PostgreSQL profile without deleting any SQLite file', async () => {
    const store = useDatabaseStore()
    store.postgresProfiles = [POSTGRES_PROFILE]
    mockApi.database.postgresProfilesList.mockResolvedValue([POSTGRES_PROFILE])

    mountPicker()
    await openPickerMenu()
    clickAction('Remove PostgreSQL workspace Lab PostgreSQL')
    await flushPromises()

    expect(mockApi.database.postgresProfileRemove).toHaveBeenCalledWith('profile-1')
    expect(mockApi.database.deleteFile).not.toHaveBeenCalled()
  })

  it('hides desktop database actions in web mode', async () => {
    window.__VARLENS_WEB__ = true
    const store = useDatabaseStore()
    store.currentName = 'VarLens Web'
    store.currentPath = 'web:postgres'
    store.recentDatabases = [{ path: '/tmp/case.sqlite', name: 'case.sqlite', lastOpened: 1 }]
    store.postgresProfiles = [POSTGRES_PROFILE]

    mountPicker()
    await openPickerMenu()

    const menuText = document.body.textContent ?? ''
    expect(menuText).toContain('VarLens Web')
    expect(menuText).toContain('web:postgres')
    expect(menuText).not.toContain('Recent Databases')
    expect(menuText).not.toContain('Open...')
    expect(menuText).not.toContain('New...')
    expect(menuText).not.toContain('Add PostgreSQL...')
    expect(mockApi.database.postgresProfilesList).not.toHaveBeenCalled()
  })

  describe('BLOCKER 1: Change Password vs Set Recovery Passphrase gating', () => {
    it('hides "Change Password..." for a key-store-managed encrypted database, showing only "Set Recovery Passphrase..."', async () => {
      const store = useDatabaseStore()
      store.currentPath = '/tmp/managed.db'
      store.currentName = 'managed.db'
      store.isEncrypted = true
      store.keyManaged = true

      mountPicker()
      await openPickerMenu()

      const menuText = document.body.textContent ?? ''
      expect(menuText).toContain('Set Recovery Passphrase...')
      expect(menuText).not.toContain('Change Password...')
    })

    it('shows "Change Password..." for a legacy explicit-password encrypted database with no managed key', async () => {
      const store = useDatabaseStore()
      store.currentPath = '/tmp/legacy.db'
      store.currentName = 'legacy.db'
      store.isEncrypted = true
      store.keyManaged = false

      mountPicker()
      await openPickerMenu()

      const menuText = document.body.textContent ?? ''
      expect(menuText).not.toContain('Set Recovery Passphrase...')
      expect(menuText).toContain('Change Password...')
    })
  })
})
