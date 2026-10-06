import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test } from 'vitest'

import {
  usePermissions,
  VIEWER_READ_ONLY_MESSAGE
} from '../../../src/renderer/src/composables/usePermissions'
import { installCapabilities } from '../helpers/capabilities'

describe('usePermissions (capability document role)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test.each([
    ['viewer', false, false],
    ['analyst', true, false],
    ['admin', true, true],
    ['user', true, false]
  ])('%s → canWrite=%s, canAdmin=%s', (role, canWrite, canAdmin) => {
    installCapabilities({ runtime: 'web', role })
    const permissions = usePermissions()
    expect(permissions.canWrite.value).toBe(canWrite)
    expect(permissions.canAdmin.value).toBe(canAdmin)
  })

  test('viewers get the read-only reason', () => {
    installCapabilities({ runtime: 'web', role: 'viewer' })
    expect(usePermissions().writeBlockedReason.value).toBe(VIEWER_READ_ONLY_MESSAGE)
  })

  test('the desktop document is the local principal with every right', () => {
    installCapabilities()
    expect(usePermissions().canAdmin.value).toBe(true)
  })

  test('fails closed until the capability document is loaded', () => {
    const permissions = usePermissions()
    expect(permissions.role.value).toBeNull()
    expect(permissions.canWrite.value).toBe(false)
    expect(permissions.writeBlockedReason.value).toMatch(/Checking/)
  })
})
