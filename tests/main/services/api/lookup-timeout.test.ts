/**
 * A stalled lookup must not hold the one-slot limiter (#508): the request
 * times out and the next queued request runs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { ApiCache } from '../../../../src/main/services/api/ApiCache'
import { MyVariantApiClient } from '../../../../src/main/services/api/MyVariantApiClient'
import { API_CONFIG } from '../../../../src/shared/config'

describe('external lookup timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fails a stalled request after the timeout and runs the next queued one', async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE api_cache (
        cache_key TEXT PRIMARY KEY,
        response_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `)
    const realTimeout = AbortSignal.timeout.bind(AbortSignal)
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(20))
    // Like a connection that stalls after connect: settles only when aborted.
    const stalled = (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(stalled)
        .mockImplementation(async () => new Response(JSON.stringify({ _id: 'x' }), { status: 200 }))
    )
    const client = new MyVariantApiClient(new ApiCache(db))

    const first = client.fetchVariantScores('1', 100, 'A', 'T')
    const second = client.fetchVariantScores('1', 200, 'A', 'T')

    expect(await first).toMatchObject({ success: false })
    expect(await second).toMatchObject({ success: true })
    expect(timeout).toHaveBeenCalledWith(API_CONFIG.LOOKUP_TIMEOUT_MS)
    db.close()
  }, 2000)
})
