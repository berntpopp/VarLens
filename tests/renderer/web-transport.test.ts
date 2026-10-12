import { afterEach, describe, expect, test, vi } from 'vitest'

import { httpInvoke } from '../../src/web/client/transport'

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('httpInvoke on 401', () => {
  test('reloads into the login wall when the session is gone', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    stubFetch(401, {
      code: 'UNAUTHENTICATED',
      message: 'authentication required',
      userMessage: 'Please log in to continue.'
    })

    await httpInvoke('cases', 'list', [])

    expect(reload).toHaveBeenCalledOnce()
  })

  test('does not reload on a user-mistake 401 (wrong current password)', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    // The real body of auth:changePassword with a wrong current password.
    stubFetch(401, { success: false, error: 'old-password-invalid' })

    await expect(httpInvoke('auth', 'changePassword', ['old', 'new'])).rejects.toThrow(
      'old-password-invalid'
    )

    expect(reload).not.toHaveBeenCalled()
  })
})
