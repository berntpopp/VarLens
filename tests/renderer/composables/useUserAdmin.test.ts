import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserAdmin } from '../../../src/renderer/src/composables/useUserAdmin'
import { createMockApi } from '../../utils/mock-api'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('useUserAdmin', () => {
  let api: ReturnType<typeof createMockApi>

  beforeEach(() => {
    api = createMockApi()
    api.auth.listUsers = vi.fn().mockResolvedValue([
      { id: 1, username: 'admin', role: 'admin', is_active: 1 },
      { id: 2, username: 'bob', role: 'user', is_active: 1 }
    ])
    window.api = api as typeof window.api
  })

  it('creates a user, reports success and reloads the list', async () => {
    const admin = useUserAdmin()
    const ok = await admin.createUser('carol', '', 'temporary-password-1')
    expect(ok).toBe(true)
    // Display name falls back to the username (server requires a non-empty value).
    expect(api.auth.createUser).toHaveBeenCalledWith('carol', 'carol', 'temporary-password-1')
    expect(admin.success.value).toMatch(/carol created/)
    expect(admin.users.value).toHaveLength(2)
  })

  it('routes role changes and enable/disable to the right auth methods', async () => {
    const admin = useUserAdmin()
    await admin.setRole('bob', 'admin')
    expect(api.auth.setRole).toHaveBeenCalledWith('bob', 'admin')
    await admin.setActive('bob', false)
    expect(api.auth.deactivateUser).toHaveBeenCalledWith('bob')
    await admin.setActive('bob', true)
    expect(api.auth.reactivateUser).toHaveBeenCalledWith('bob')
  })

  it('surfaces the server userMessage instead of a generic failure', async () => {
    api.auth.setRole = vi.fn().mockResolvedValue({
      code: ErrorCode.UNKNOWN,
      message: 'Cannot demote the last active admin',
      userMessage: 'Cannot demote the last active admin'
    })
    const admin = useUserAdmin()
    const ok = await admin.setRole('admin', 'user')
    expect(ok).toBe(false)
    expect(admin.error.value).toBe('Cannot demote the last active admin')
    expect(admin.busy.value).toBe(false)
  })
})
