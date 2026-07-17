import { describe, expect, it } from 'vitest'

import { ROLE_ADMIN, ROLE_USER } from '../../../../src/shared/auth/auth-constants'
import { PostgresPlatformUserStore } from '../../../../src/web/auth/PostgresPlatformUserStore'

interface QueryResponse {
  rows: Array<{ id: string; username: string; role: 'admin' | 'user' }>
  rowCount: number
}

class FakePool {
  queries: Array<{ text: string; values: unknown[] }> = []

  constructor(private readonly response: QueryResponse | Error) {}

  async query(text: string, values: unknown[]): Promise<QueryResponse> {
    this.queries.push({ text, values })
    if (this.response instanceof Error) throw this.response
    return this.response
  }
}

describe('PostgresPlatformUserStore', () => {
  it('creates a disabled-password local binding for an OIDC subject', async () => {
    const pool = new FakePool({
      rows: [{ id: '9', username: 'oidc-subject-1', role: ROLE_USER }],
      rowCount: 1
    })
    const users = new PostgresPlatformUserStore(pool as never, 'instance_alice')

    await expect(
      users.upsert({ subject: 'oidc-subject-1', displayName: 'Alice', role: ROLE_USER })
    ).resolves.toEqual({ id: 9, subject: 'oidc-subject-1', role: ROLE_USER })
    expect(pool.queries[0].values).toEqual([
      'oidc-subject-1',
      'Alice',
      'platform-identity-disabled-local-password',
      ROLE_USER,
      'platform-identity-disabled-local-password'
    ])
    expect(pool.queries[0].text).toContain('"instance_alice"."users"')
    expect(pool.queries[0].text).toContain("auth_source = 'platform'")
    expect(pool.queries[0].text).not.toMatch(/private_db|workspace|secret/i)
  })

  it('refuses to overwrite a local-password user', async () => {
    const users = new PostgresPlatformUserStore(
      new FakePool({ rows: [], rowCount: 0 }) as never,
      'public'
    )

    await expect(
      users.upsert({ subject: 'oidc-subject-1', displayName: 'Alice', role: ROLE_USER })
    ).rejects.toThrow(/cannot overwrite local user/i)
  })

  it('updates an existing OIDC binding role', async () => {
    const pool = new FakePool({
      rows: [{ id: '9', username: 'oidc-subject-1', role: ROLE_ADMIN }],
      rowCount: 1
    })
    const users = new PostgresPlatformUserStore(pool as never, 'public')

    await expect(
      users.upsert({ subject: 'oidc-subject-1', displayName: 'Alice', role: ROLE_ADMIN })
    ).resolves.toMatchObject({ role: ROLE_ADMIN })
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(username\)/)
  })

  it('rejects a second platform subject at the database singleton boundary', async () => {
    const conflict = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_single_platform_identity'
    })
    const users = new PostgresPlatformUserStore(new FakePool(conflict) as never, 'public')

    await expect(
      users.upsert({ subject: 'second-subject', displayName: 'Mallory', role: ROLE_USER })
    ).rejects.toThrow(/already bound to another platform subject/i)
  })
})
