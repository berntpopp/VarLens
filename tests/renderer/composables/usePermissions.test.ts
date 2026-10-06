import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  usePermissions,
  VIEWER_READ_ONLY_MESSAGE
} from '../../../src/renderer/src/composables/usePermissions'
import { useAuthStore } from '../../../src/renderer/src/stores/authStore'

type WebWindow = Window & { __VARLENS_WEB__?: boolean }

describe('usePermissions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    delete (window as WebWindow).__VARLENS_WEB__
  })

  test.each([
    ['viewer', false, false],
    ['analyst', true, false],
    ['admin', true, true],
    ['user', true, false]
  ])('%s → canWrite=%s, canAdmin=%s', (role, canWrite, canAdmin) => {
    const auth = useAuthStore()
    auth.accountsEnabled = true
    auth.currentUser = { id: 1, username: 'u', role }
    const permissions = usePermissions()
    expect(permissions.canWrite.value).toBe(canWrite)
    expect(permissions.canAdmin.value).toBe(canAdmin)
  })

  test('viewers get the read-only reason', () => {
    const auth = useAuthStore()
    auth.currentUser = { id: 1, username: 'v', role: 'viewer' }
    expect(usePermissions().writeBlockedReason.value).toBe(VIEWER_READ_ONLY_MESSAGE)
  })

  test('desktop without accounts is the local principal with every right', () => {
    const permissions = usePermissions()
    expect(permissions.role.value).toBe('admin')
    expect(permissions.canAdmin.value).toBe(true)
  })

  test('web fails closed until the session user is known', () => {
    ;(window as WebWindow).__VARLENS_WEB__ = true
    const permissions = usePermissions()
    expect(permissions.role.value).toBeNull()
    expect(permissions.canWrite.value).toBe(false)
    expect(permissions.writeBlockedReason.value).toMatch(/Checking/)

    useAuthStore().currentUser = { id: 2, username: 'a', role: 'analyst' }
    expect(permissions.canWrite.value).toBe(true)
  })
})
