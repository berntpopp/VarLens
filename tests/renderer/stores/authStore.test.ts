/**
 * Tests for authStore.login()'s IpcResult handling.
 *
 * `wrapHandler` in the main process *resolves* an `IpcResult<T>` on failure
 * (it never rejects). `auth:login`'s handler only reaches `wrapHandler`'s
 * catch when something genuinely breaks (bad params, DB down, etc.) — an
 * ordinary "wrong password" outcome is a resolved `{ success: false, ... }`
 * business-logic result, never a thrown error. Before this fix, authStore's
 * `login()` returned the raw `await api.auth.login(...)` result unexamined,
 * so a backend fault (a `SerializableError` shaped like
 * `{ code, message, userMessage }`) was indistinguishable from invalid
 * credentials once returned to the caller — `result.success` was simply
 * `undefined` in both "wrong password" and "backend down" cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../../../src/renderer/src/stores/authStore'
import { createMockApi } from '../../utils/mock-api'

// Runtime shape of a main-process SerializableError (src/shared/types/errors.ts).
// `isIpcError` discriminates on the presence of `code`/`message`/`userMessage` —
// there is no `__isSerializableError` field.
const fakeBackendFault = {
  code: 'DB_ERROR',
  message: 'boom',
  userMessage: 'Service unavailable'
}

describe('authStore.login', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.api = createMockApi()
  })

  it('distinguishes a backend fault from invalid credentials', async () => {
    window.api.auth.login = vi.fn().mockResolvedValue(fakeBackendFault)

    const store = useAuthStore()
    const result = await store.login('alice', 'wrong-password')

    // Must not treat the error object as a valid session.
    expect(store.currentUser).toBeNull()
    expect(result.success).toBe(false)
    // Distinguishing signal: the real backend message must be surfaced,
    // not silently coerced into "invalid credentials".
    expect(result.error).toBe('Service unavailable')
  })

  it('reports plain invalid credentials without a backend-fault error message', async () => {
    window.api.auth.login = vi.fn().mockResolvedValue({ success: false, locked: false })

    const store = useAuthStore()
    const result = await store.login('alice', 'wrong-password')

    expect(store.currentUser).toBeNull()
    expect(result.success).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('logs in successfully and stores the current user', async () => {
    const user = { id: 1, username: 'alice', role: 'admin' }
    window.api.auth.login = vi.fn().mockResolvedValue({ success: true, user })

    const store = useAuthStore()
    const result = await store.login('alice', 'correct-password')

    expect(result.success).toBe(true)
    expect(store.currentUser).toEqual(user)
  })

  it('preserves the current user when logout resolves a SerializableError', async () => {
    const user = { id: 1, username: 'alice', role: 'admin' }
    window.api.auth.logout = vi.fn().mockResolvedValue(fakeBackendFault)
    const store = useAuthStore()
    store.currentUser = user

    await expect(store.logout()).rejects.toMatchObject({ code: 'DB_ERROR' })

    expect(store.currentUser).toEqual(user)
  })

  it('clears the current user after logout succeeds', async () => {
    const user = { id: 1, username: 'alice', role: 'admin' }
    window.api.auth.logout = vi.fn().mockResolvedValue(undefined)
    const store = useAuthStore()
    store.currentUser = user

    await store.logout()

    expect(store.currentUser).toBeNull()
  })
})
