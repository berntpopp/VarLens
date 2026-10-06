import { describe, expect, it, vi } from 'vitest'

import { WebEventHub, type WebEvent } from '../../../../src/web/server/events'
import { revalidateStreamSession } from '../../../../src/web/server/event-stream-session'
import { SessionRevocations } from '../../../../src/web/server/session-revocation'

const ALICE = { userId: 1, role: 'user', sid: 'sid-a1' }
const ADMIN = { userId: 9, role: 'admin', sid: 'sid-root' }

describe('WebEventHub (ids, replay, audiences, revocation)', () => {
  it('stamps every event with a <bootId>.<seq> id', () => {
    const hub = new WebEventHub()
    const seen: WebEvent[] = []
    hub.subscribe(ALICE, (event) => seen.push(event))
    hub.publish(1, 'a', { n: 1 })
    hub.publish(1, 'b', { n: 2 })
    expect(seen.map((e) => e.id)).toEqual([`${hub.bootId}.1`, `${hub.bootId}.2`])
  })

  it('replays only the missed events the viewer may see', () => {
    const hub = new WebEventHub()
    hub.publish(1, 'mine', 1)
    hub.publish(2, 'theirs', 2)
    hub.publishToUserAndAdmins(2, 'jobs:changed', 3)
    hub.publish(1, 'mine', 4)

    const first = `${hub.bootId}.1`
    expect(hub.replaySince(first, ALICE)?.map((e) => e.payload)).toEqual([4])
    expect(hub.replaySince(first, ADMIN)?.map((e) => e.payload)).toEqual([3])
    expect(hub.replaySince(`${hub.bootId}.4`, ALICE)).toEqual([])
  })

  it('reports an unreplayable gap (other boot, garbage, evicted) as undefined', () => {
    const hub = new WebEventHub(2)
    for (let i = 0; i < 5; i++) hub.publish(1, 'x', i)
    expect(hub.replaySince('otherboot.1', ALICE)).toBeUndefined()
    expect(hub.replaySince('garbage', ALICE)).toBeUndefined()
    expect(hub.replaySince(`${hub.bootId}.1`, ALICE)).toBeUndefined()
    expect(hub.replaySince(`${hub.bootId}.3`, ALICE)?.map((e) => e.payload)).toEqual([3, 4])
  })

  it('closeSession closes only that browser session; closeUser closes all of a user', () => {
    const hub = new WebEventHub()
    const closed: string[] = []
    hub.subscribe(
      ALICE,
      () => undefined,
      () => closed.push('a1')
    )
    hub.subscribe(
      { ...ALICE, sid: 'sid-a2' },
      () => undefined,
      () => closed.push('a2')
    )
    hub.subscribe(
      ADMIN,
      () => undefined,
      () => closed.push('root')
    )

    hub.closeSession('sid-a1')
    expect(closed).toEqual(['a1'])
    hub.closeUser(1)
    expect(closed).toEqual(['a1', 'a2'])
    expect(hub.subscriberCount()).toBe(1)
  })
})

describe('SessionRevocations', () => {
  it('revokes sids until they expire', () => {
    let now = 0
    const revocations = new SessionRevocations(1000, 10, () => now)
    revocations.revoke('s1')
    expect(revocations.isRevoked('s1')).toBe(true)
    expect(revocations.isRevoked('s2')).toBe(false)
    expect(revocations.isRevoked(undefined)).toBe(false)
    now = 1001
    expect(revocations.isRevoked('s1')).toBe(false)
  })

  it('stays bounded', () => {
    const revocations = new SessionRevocations(60_000, 3)
    for (const sid of ['a', 'b', 'c', 'd']) revocations.revoke(sid)
    expect(revocations.isRevoked('a')).toBe(false)
    expect(revocations.isRevoked('d')).toBe(true)
  })
})

describe('revalidateStreamSession', () => {
  const live = {
    id: 1,
    username: 'alice',
    role: 'admin',
    is_active: 1,
    password_changed_at: '2026-10-01'
  }
  function request(sid = 'sid-a1') {
    return {
      session: {
        sid,
        user: { id: 1, username: 'alice', role: 'user', passwordChangedAt: '2026-10-01' }
      }
    } as never
  }

  it('returns the live role for a valid session', async () => {
    const auth = { getSessionUser: vi.fn(async () => live) }
    await expect(
      revalidateStreamSession(request(), auth as never, new SessionRevocations())
    ).resolves.toEqual({ role: 'admin' })
  })

  it('closes on logout, deactivation and password change', async () => {
    const revoked = new SessionRevocations()
    revoked.revoke('sid-a1')
    const ok = { getSessionUser: vi.fn(async () => live) }
    expect(await revalidateStreamSession(request(), ok as never, revoked)).toBeUndefined()

    const inactive = { getSessionUser: vi.fn(async () => ({ ...live, is_active: 0 })) }
    expect(
      await revalidateStreamSession(request(), inactive as never, new SessionRevocations())
    ).toBeUndefined()

    const rotated = {
      getSessionUser: vi.fn(async () => ({ ...live, password_changed_at: '2026-10-05' }))
    }
    expect(
      await revalidateStreamSession(request(), rotated as never, new SessionRevocations())
    ).toBeUndefined()
  })
})
