/**
 * The shared fetch seam (#126): desktop main swaps in Electron's net.fetch
 * (Chromium stack, honours the system proxy and PAC); everything else keeps
 * the global fetch.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiFetch,
  desktopApiFetch,
  setApiFetch
} from '../../../../src/main/services/api/http-fetch'
import { EnsemblApiClient } from '../../../../src/main/services/api/EnsemblApiClient'
import { HpoApiClient } from '../../../../src/main/services/api/HpoApiClient'

const API_DIR = join(__dirname, '../../../../src/main/services/api')

describe('apiFetch', () => {
  afterEach(() => {
    setApiFetch(null)
    vi.unstubAllGlobals()
  })

  it('uses the global fetch looked up at call time by default', async () => {
    const globalFetch = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', globalFetch)
    await apiFetch('https://example.org/a')
    expect(globalFetch).toHaveBeenCalledWith('https://example.org/a', undefined)
  })

  it('routes reference API clients through the installed fetch', async () => {
    const globalFetch = vi.fn(async () => new Response('[0,[],null,[]]'))
    const installed = vi.fn(
      async () => new Response('[1,["HP:0001250"],null,[["HP:0001250","Seizure"]]]')
    )
    vi.stubGlobal('fetch', globalFetch)
    setApiFetch(installed)

    const result = await new HpoApiClient(null).search('seizure-proxy-seam')

    expect(installed).toHaveBeenCalledTimes(1)
    expect(globalFetch).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, terms: [{ id: 'HP:0001250', name: 'Seizure' }] })
  })

  it('leaves no reference API client calling the bare global fetch', () => {
    const offenders = readdirSync(API_DIR)
      .filter((f) => f.endsWith('.ts') && f !== 'http-fetch.ts')
      .filter((f) => /(^|[^.\w])fetch\(/.test(readFileSync(join(API_DIR, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})

/** Electron net.fetch: headers arrive, then an abort fails the body read with a bare AbortError. */
function electronStalledBody(_url: string, init?: RequestInit): Promise<Response> {
  const signal = init?.signal
  const body = new ReadableStream({
    start(controller) {
      signal?.addEventListener('abort', () =>
        controller.error(new DOMException('The operation was aborted.', 'AbortError'))
      )
    }
  })
  return Promise.resolve(new Response(body, { status: 200 }))
}

describe('desktopApiFetch (net.fetch adapter)', () => {
  afterEach(() => {
    setApiFetch(null)
    vi.useRealTimers()
  })

  it('rethrows the signal reason when an abort fails the body read', async () => {
    const controller = new AbortController()
    const response = await desktopApiFetch(electronStalledBody)('https://example.org', {
      signal: controller.signal
    })
    const reading = response.json()
    controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    await expect(reading).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('sends no cookies and keeps the caller init', async () => {
    const netFetch = vi.fn(async () => new Response('{}'))
    await desktopApiFetch(netFetch)('https://example.org', { method: 'POST' })
    expect(netFetch).toHaveBeenCalledWith('https://example.org', {
      method: 'POST',
      credentials: 'omit'
    })
  })

  it('lets Ensembl retry a mid-body timeout on the desktop path', async () => {
    vi.useFakeTimers()
    const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })
    const netFetch = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(electronStalledBody)
      .mockResolvedValueOnce(
        ok({ id: 'ENSG1', start: 1, end: 100, strand: 1, seq_region_name: '22' })
      )
    setApiFetch(desktopApiFetch(netFetch))

    const pending = new EnsemblApiClient(null).fetchGeneStructure('THOC5')
    await vi.runAllTimersAsync()
    await pending

    expect(netFetch).toHaveBeenCalledTimes(2)
  })
})
