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

  it('says what failed when every attempt times out', async () => {
    fetchMock.mockRejectedValue(timeoutError())
    const result = await run(new EnsemblApiClient(null))
    expect(result).toEqual({
      success: false,
      error: `Ensembl did not answer within ${API_CONFIG.ENSEMBL_TIMEOUT_MS / 1000} s (${API_CONFIG.ENSEMBL_RETRIES + 1} attempts)`
    })
    expect(fetchMock).toHaveBeenCalledTimes(API_CONFIG.ENSEMBL_RETRIES + 1)
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
