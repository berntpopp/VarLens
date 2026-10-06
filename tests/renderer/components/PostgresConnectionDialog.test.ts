import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import PostgresConnectionDialog from '../../../src/renderer/src/components/PostgresConnectionDialog.vue'
import type {
  PostgresConnectionProfilePublic,
  PostgresConnectionTestResult
} from '../../../src/shared/types/postgres-profile'
import { ErrorCode } from '../../../src/shared/types/errors'
import { createMockApi, type MockApi } from '../../utils/mock-api'
import { installCapabilities } from '../helpers/capabilities'

const vuetify = createVuetify({ components, directives })

const POSTGRES_PROFILE: PostgresConnectionProfilePublic = {
  id: 'profile-1',
  name: 'Lab PostgreSQL',
  host: 'localhost',
  port: 5432,
  database: 'varlens',
  username: 'varlens',
  schema: 'clinical',
  sslMode: 'disable',
  poolMax: 5,
  connectionTimeoutMillis: 5000,
  statementTimeoutMs: 30000,
  lockTimeoutMs: 5000,
  idleInTransactionSessionTimeoutMs: 60000,
  caCertificateConfigured: false
}

describe('PostgresConnectionDialog', () => {
  let wrapper: VueWrapper<InstanceType<typeof PostgresConnectionDialog>>
  let mockApi: MockApi

  beforeEach(() => {
    setActivePinia(createPinia())
    installCapabilities()
    mockApi = createMockApi()
    window.api = mockApi as unknown as typeof window.api
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function mountDialog() {
    wrapper = mount(PostgresConnectionDialog, {
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    return wrapper
  }

  async function showDialog(profile?: PostgresConnectionProfilePublic) {
    mountDialog()
    wrapper.vm.show(profile)
    await wrapper.vm.$nextTick()
    await flushPromises()
  }

  async function setField(testId: string, value: string) {
    const input = document.body.querySelector(`[data-testid="${testId}"] input`)
    expect(input).toBeInstanceOf(HTMLInputElement)
    ;(input as HTMLInputElement).value = value
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()
  }

  async function setValidNewProfile() {
    await setField('postgres-name', 'Lab PostgreSQL')
    await setField('postgres-host', 'db.internal')
    await setField('postgres-database', 'varlens')
    await setField('postgres-username', 'varlens')
    await setField('postgres-password', 'secret')
  }

  function clickAction(label: string) {
    const button = document.body.querySelector(`button[aria-label="${label}"]`)
    expect(button).toBeInstanceOf(HTMLButtonElement)
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('tests a valid connection and shows success status', async () => {
    const testResult: PostgresConnectionTestResult = {
      ok: true,
      serverVersion: '16.2',
      currentUser: 'varlens',
      database: 'varlens',
      schema: 'public'
    }
    mockApi.database.postgresProfileTest.mockResolvedValue(testResult)

    await showDialog()
    await setValidNewProfile()
    clickAction('Test connection')
    await flushPromises()

    expect(mockApi.database.postgresProfileTest).toHaveBeenCalledWith({
      name: 'Lab PostgreSQL',
      host: 'db.internal',
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
      secrets: { password: 'secret' }
    })
    expect(document.body.textContent).toContain('Connection test succeeded')
    expect(document.body.textContent).toContain('16.2')
  })

  it('shows validation errors before testing an incomplete connection', async () => {
    await showDialog()

    clickAction('Test connection')
    await flushPromises()

    expect(mockApi.database.postgresProfileTest).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Display name is required')
  })

  it('shows failed connection status returned by the store action', async () => {
    mockApi.database.postgresProfileTest.mockResolvedValue({
      ok: false,
      schema: 'public',
      message: 'password authentication failed'
    })

    await showDialog()
    await setValidNewProfile()
    clickAction('Test connection')
    await flushPromises()

    expect(document.body.textContent).toContain('password authentication failed')
  })

  it('prefills public profile fields without rendering saved secrets', async () => {
    await showDialog(POSTGRES_PROFILE)

    const nameInput = document.body.querySelector('[data-testid="postgres-name"] input')
    const hostInput = document.body.querySelector('[data-testid="postgres-host"] input')
    expect((nameInput as HTMLInputElement).value).toBe('Lab PostgreSQL')
    expect((hostInput as HTMLInputElement).value).toBe('localhost')
    expect(document.body.textContent).not.toContain('secret')

    const passwordInput = document.body.querySelector('[data-testid="postgres-password"] input')
    expect(passwordInput).toBeInstanceOf(HTMLInputElement)
    expect((passwordInput as HTMLInputElement).value).toBe('')
  })

  it('saves a profile and clears the password field after save', async () => {
    mockApi.database.postgresProfileSave.mockResolvedValue(POSTGRES_PROFILE)

    await showDialog()
    await setValidNewProfile()
    clickAction('Save PostgreSQL workspace')
    await flushPromises()

    expect(mockApi.database.postgresProfileSave).toHaveBeenCalledOnce()
    expect(wrapper.emitted('saved')).toEqual([[POSTGRES_PROFILE]])

    wrapper.vm.show(POSTGRES_PROFILE)
    await wrapper.vm.$nextTick()
    const passwordInput = document.body.querySelector('[data-testid="postgres-password"] input')
    expect((passwordInput as HTMLInputElement).value).toBe('')
  })

  it('saves existing profile public edits without submitting blank secrets', async () => {
    const updatedProfile = { ...POSTGRES_PROFILE, name: 'Renamed PostgreSQL' }
    mockApi.database.postgresProfileSave.mockResolvedValue(updatedProfile)

    await showDialog(POSTGRES_PROFILE)
    await setField('postgres-name', 'Renamed PostgreSQL')
    clickAction('Save PostgreSQL workspace')
    await flushPromises()

    expect(mockApi.database.postgresProfileSave).toHaveBeenCalledWith({
      id: POSTGRES_PROFILE.id,
      name: 'Renamed PostgreSQL',
      host: POSTGRES_PROFILE.host,
      port: POSTGRES_PROFILE.port,
      database: POSTGRES_PROFILE.database,
      username: POSTGRES_PROFILE.username,
      schema: POSTGRES_PROFILE.schema,
      sslMode: POSTGRES_PROFILE.sslMode,
      poolMax: POSTGRES_PROFILE.poolMax,
      connectionTimeoutMillis: POSTGRES_PROFILE.connectionTimeoutMillis,
      statementTimeoutMs: POSTGRES_PROFILE.statementTimeoutMs,
      lockTimeoutMs: POSTGRES_PROFILE.lockTimeoutMs,
      idleInTransactionSessionTimeoutMs: POSTGRES_PROFILE.idleInTransactionSessionTimeoutMs
    })
  })

  it('replaces existing profile password only when a new password is entered', async () => {
    mockApi.database.postgresProfileSave.mockResolvedValue(POSTGRES_PROFILE)

    await showDialog(POSTGRES_PROFILE)
    await setField('postgres-password', 'replacement-secret')
    clickAction('Save PostgreSQL workspace')
    await flushPromises()

    expect(mockApi.database.postgresProfileSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: POSTGRES_PROFILE.id,
        secrets: { password: 'replacement-secret' }
      })
    )
  })

  it('requires a replacement password when replacing CA certificate on edit', async () => {
    mockApi.database.postgresProfileSave.mockResolvedValue(POSTGRES_PROFILE)

    await showDialog({
      ...POSTGRES_PROFILE,
      sslMode: 'require-verify',
      caCertificateConfigured: true
    })
    const textarea = document.body.querySelector('[data-testid="postgres-ca-certificate"] textarea')
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    ;(textarea as HTMLTextAreaElement).value = 'replacement-ca'
    textarea?.dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()
    clickAction('Save PostgreSQL workspace')
    await flushPromises()

    expect(mockApi.database.postgresProfileSave).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(
      'Password is required to replace the CA certificate'
    )
  })

  it('shows IPC user message when saving fails', async () => {
    mockApi.database.postgresProfileSave.mockRejectedValue({
      code: ErrorCode.DB_ERROR,
      message: 'raw save failed',
      userMessage: 'Could not save PostgreSQL workspace'
    })

    await showDialog()
    await setValidNewProfile()
    clickAction('Save PostgreSQL workspace')
    await flushPromises()

    expect(document.body.textContent).toContain('Could not save PostgreSQL workspace')
    expect(document.body.textContent).not.toContain('[object Object]')
  })

  it('shows IPC user message when connect after save fails', async () => {
    mockApi.database.postgresProfileSave.mockResolvedValue(POSTGRES_PROFILE)
    mockApi.database.postgresProfileOpen.mockRejectedValue({
      code: ErrorCode.DB_ERROR,
      message: 'raw open failed',
      userMessage: 'Could not open PostgreSQL workspace'
    })

    await showDialog()
    await setValidNewProfile()
    clickAction('Connect PostgreSQL workspace')
    await flushPromises()

    expect(document.body.textContent).toContain('Could not open PostgreSQL workspace')
    expect(document.body.textContent).not.toContain('[object Object]')
  })
})
