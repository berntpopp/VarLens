import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_AUTH_USER_CACHE_TTL_MS,
  UserLookupCache,
  resolveAuthUserCacheTtlMs
} from '../../../../src/web/auth/user-lookup-cache'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('UserLookupCache', () => {
  it('serves repeated lookups from cache within the TTL', async () => {
    let now = 1000
    const cache = new UserLookupCache<string>({ ttlMs: 5000, now: () => now })
    const load = vi.fn(async () => 'row-v1')

    expect(await cache.get('alice', load)).toBe('row-v1')
    now += 4999
    expect(await cache.get('alice', load)).toBe('row-v1')
    expect(load).toHaveBeenCalledTimes(1)

    now += 2
    expect(await cache.get('alice', load)).toBe('row-v1')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent lookups for the same key into one load (single-flight)', async () => {
    const cache = new UserLookupCache<string>({ ttlMs: 5000 })
    const gate = deferred<string>()
    const load = vi.fn(() => gate.promise)

    const a = cache.get('alice', load)
    const b = cache.get('alice', load)
    gate.resolve('row')

    expect(await Promise.all([a, b])).toEqual(['row', 'row'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('re-reads after invalidate()', async () => {
    const cache = new UserLookupCache<string>({ ttlMs: 5000 })
    const load = vi.fn().mockResolvedValueOnce('active').mockResolvedValueOnce('deactivated')

    expect(await cache.get('bob', load)).toBe('active')
    cache.invalidate('bob')
    expect(await cache.get('bob', load)).toBe('deactivated')
  })

  it('does not let an in-flight load that predates invalidate() repopulate the cache', async () => {
    const cache = new UserLookupCache<string>({ ttlMs: 5000 })
    const stale = deferred<string>()
    const load = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce('fresh')

    const inFlight = cache.get('carol', load)
    cache.invalidate('carol')
    stale.resolve('stale')
    expect(await inFlight).toBe('stale')

    expect(await cache.get('carol', load)).toBe('fresh')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures', async () => {
    const cache = new UserLookupCache<string>({ ttlMs: 5000 })
    const load = vi.fn().mockRejectedValueOnce(new Error('pool exhausted')).mockResolvedValue('ok')

    await expect(cache.get('dave', load)).rejects.toThrow('pool exhausted')
    expect(await cache.get('dave', load)).toBe('ok')
  })

  it('ttlMs = 0 disables caching', async () => {
    const cache = new UserLookupCache<string>({ ttlMs: 0 })
    const load = vi.fn(async () => 'row')
    await cache.get('erin', load)
    await cache.get('erin', load)
    expect(load).toHaveBeenCalledTimes(2)
    expect(cache.enabled).toBe(false)
  })

  it('evicts the oldest entry beyond maxEntries', async () => {
    const cache = new UserLookupCache<string>({ ttlMs: 5000, maxEntries: 2 })
    const load = vi.fn(async () => 'row')
    await cache.get('a', load)
    await cache.get('b', load)
    await cache.get('c', load)
    await cache.get('a', load)
    expect(load).toHaveBeenCalledTimes(4)
  })
})

describe('resolveAuthUserCacheTtlMs', () => {
  it('defaults to 5 s and accepts 0 to disable', () => {
    expect(resolveAuthUserCacheTtlMs({})).toBe(DEFAULT_AUTH_USER_CACHE_TTL_MS)
    expect(DEFAULT_AUTH_USER_CACHE_TTL_MS).toBe(5000)
    expect(resolveAuthUserCacheTtlMs({ VARLENS_AUTH_USER_CACHE_TTL_MS: '0' })).toBe(0)
    expect(resolveAuthUserCacheTtlMs({ VARLENS_AUTH_USER_CACHE_TTL_MS: '2500' })).toBe(2500)
  })

  it('rejects non-integers, negatives and values above 60 s', () => {
    for (const bad of ['abc', '-1', '1.5', '60001']) {
      expect(() => resolveAuthUserCacheTtlMs({ VARLENS_AUTH_USER_CACHE_TTL_MS: bad })).toThrow(
        'VARLENS_AUTH_USER_CACHE_TTL_MS'
      )
    }
  })
})
