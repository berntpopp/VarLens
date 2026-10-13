/**
 * The shared fetch seam (#126): desktop main swaps in Electron's net.fetch
 * (Chromium stack, honours the system proxy and PAC); everything else keeps
 * the global fetch.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, setApiFetch } from '../../../../src/main/services/api/http-fetch'
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
