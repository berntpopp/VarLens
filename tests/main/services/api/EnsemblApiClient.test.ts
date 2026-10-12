/**
 * Gene structure from Ensembl: one small gene lookup plus the canonical
 * transcript's exons (not every transcript of the gene), one retry with
 * backoff on a timeout / 5xx, an error that says what failed, and the cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'

import { ApiCache } from '../../../../src/main/services/api/ApiCache'
import { EnsemblApiClient } from '../../../../src/main/services/api/EnsemblApiClient'
import { API_CONFIG } from '../../../../src/shared/config'

const gene = {
  id: 'ENSG00000100296',
  display_name: 'THOC5',
  start: 29_505_000,
  end: 29_555_000,
  strand: -1,
  seq_region_name: '22',
  canonical_transcript: 'ENST00000490103.6'
}
const transcript = {
  id: 'ENST00000490103',
  display_name: 'THOC5-216',
  start: 29_505_000,
  end: 29_555_000,
  strand: -1,
  is_canonical: 1,
  Exon: [
    { start: 29_550_000, end: 29_550_100 },
    { start: 29_506_000, end: 29_506_200 }
  ]
}

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })
const timeoutError = (): DOMException =>
  new DOMException('The operation timed out.', 'TimeoutError')

function cache(): ApiCache {
  const db = new Database(':memory:')
  db.exec(
    'CREATE TABLE api_cache (cache_key TEXT PRIMARY KEY, response_data TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)'
  )
  return new ApiCache(db)
}

describe('EnsemblApiClient.fetchGeneStructure', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const run = async (client: EnsemblApiClient, symbol = 'THOC5') => {
    const pending = client.fetchGeneStructure(symbol)
    await vi.runAllTimersAsync()
    return pending
  }

  it('asks for the gene without expanding every transcript, then only the canonical one', async () => {
    fetchMock.mockResolvedValueOnce(ok(gene)).mockResolvedValueOnce(ok(transcript))
    const result = await run(new EnsemblApiClient(null))

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toContain('/lookup/symbol/homo_sapiens/THOC5')
    expect(urls[0]).not.toContain('expand')
    expect(urls[1]).toContain('/lookup/id/ENST00000490103')
    expect(urls[1]).toContain('expand=1')
    expect(result).toMatchObject({
      success: true,
      geneStructure: {
        chromosome: '22',
        strand: -1,
        transcriptId: 'THOC5-216',
        exons: [
          { start: 29_506_000, end: 29_506_200, rank: 2 },
          { start: 29_550_000, end: 29_550_100, rank: 1 }
        ]
      }
    })
  })

  it('retries once after a timeout and succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(ok(gene))
      .mockResolvedValueOnce(ok(transcript))
    const result = await run(new EnsemblApiClient(null))
    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries a 5xx answer too', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(ok(gene))
      .mockResolvedValueOnce(ok(transcript))
    expect((await run(new EnsemblApiClient(null))).success).toBe(true)
  })

  it('a hanging Ensembl gives up at the shared deadline and frees the limiter slot', async () => {
    // THOC5 and MTMR3 stall like a dead connection (settle only on abort); BRCA1 answers.
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      /BRCA1|ENST00000490103/.test(String(url))
        ? Promise.resolve(ok(String(url).includes('/lookup/id/') ? transcript : gene))
        : new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          })
    )
    const client = new EnsemblApiClient(null)
    const first = client.fetchGeneStructure('THOC5')
    const second = client.fetchGeneStructure('MTMR3')
    const third = client.fetchGeneStructure('BRCA1') // waits for a slot (maxConcurrent 2)
    let thirdDoneAt = 0
    void third.then(() => (thirdDoneAt = Date.now()))
    const start = Date.now()
    await vi.advanceTimersByTimeAsync(3 * API_CONFIG.ENSEMBL_DEADLINE_MS)

    const gaveUp = {
      success: false,
      error: `Ensembl did not answer within ${API_CONFIG.ENSEMBL_DEADLINE_MS / 1000} s`
    }
    expect(await first).toEqual(gaveUp)
    expect(await second).toEqual(gaveUp)
    // The slot came back at the deadline: the queued lookup ran right after it.
    expect((await third).success).toBe(true)
    expect(thirdDoneAt - start).toBeLessThan(API_CONFIG.ENSEMBL_DEADLINE_MS + 2_000)
  })

  it('retries with growing, capped backoff and stops at the attempt limit', async () => {
    fetchMock.mockResolvedValue(new Response('busy', { status: 503 }))
    const result = await run(new EnsemblApiClient(null))
    expect(result).toEqual({ success: false, error: 'Ensembl API error: 503' })
    expect(fetchMock).toHaveBeenCalledTimes(API_CONFIG.ENSEMBL_MAX_ATTEMPTS)
  })

  it('429: waits the Retry-After when it is short, then retries', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(ok(gene))
      .mockResolvedValueOnce(ok(transcript))
    expect((await run(new EnsemblApiClient(null))).success).toBe(true)
  })

  it('429: a long Retry-After is not waited out but named', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 429, headers: { 'Retry-After': '120' } })
    )
    const result = await run(new EnsemblApiClient(null))
    expect(result).toEqual({ success: false, error: 'Ensembl rate limit: retry in 120 s' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('an old expand=1 cache entry (every transcript) still parses', async () => {
    const store = cache()
    const old = {
      ...gene,
      Transcript: [
        {
          ...transcript,
          id: 'ENST1',
          display_name: 'THOC5-201',
          is_canonical: 0,
          Exon: [{ start: 1, end: 2 }]
        },
        { ...transcript, is_canonical: 1 }
      ]
    }
    store.set('ensembl:gene:THOC5', JSON.stringify(old), 90)
    const result = await run(new EnsemblApiClient(store))
    expect(result).toMatchObject({
      success: true,
      geneStructure: { transcriptId: 'THOC5-216' },
      cacheInfo: { cached: true }
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry an answer that will not change (404)', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"not found"}', { status: 404 }))
    const result = await run(new EnsemblApiClient(null), 'NOPE')
    expect(result).toEqual({ success: false, error: 'Ensembl API error: 404' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serves the second request from the cache', async () => {
    const client = new EnsemblApiClient(cache())
    fetchMock.mockResolvedValueOnce(ok(gene)).mockResolvedValueOnce(ok(transcript))
    await run(client)
    const again = await run(client)
    expect(again).toMatchObject({ success: true, cacheInfo: { cached: true } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
