/**
 * Typed web client coverage (spec §4.3 / §6, Limin L6). The web `window.api`
 * is derived from the parity manifest: every method exists, nothing else does,
 * adapters come from local-api.ts, and desktop-only / pending / disallowed
 * calls are refused before they reach the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { computeCapabilityDocument } from '../../../src/shared/ipc/capability-document'
import { listManifestEntries, PARITY_MANIFEST } from '../../../src/shared/ipc/parity-manifest'
import { ErrorCode } from '../../../src/shared/types/errors'
import { createApi } from '../../../src/web/client/api'
import { setCapabilityDocument, WebCallRefusedError } from '../../../src/web/client/call-policy'
import { LOCAL_API } from '../../../src/web/client/local-api'

type LooseApi = Record<string, Record<string, (...args: unknown[]) => unknown>>

function stubFetch(body: unknown = null): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body)
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('typed web client', () => {
  let api: LooseApi

  beforeEach(() => {
    setCapabilityDocument(null)
    api = createApi() as unknown as LooseApi
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setCapabilityDocument(null)
  })

  it('has exactly one function per manifest method and no other properties', () => {
    const expected = Object.fromEntries(
      Object.entries(PARITY_MANIFEST).map(([domain, methods]) => [
        domain,
        Object.keys(methods).sort()
      ])
    )
    const actual = Object.fromEntries(
      Object.entries(api).map(([domain, methods]) => [domain, Object.keys(methods).sort()])
    )
    expect(actual).toEqual(expected)
    for (const entry of listManifestEntries()) {
      expect(typeof api[entry.domain][entry.method], `${entry.domain}.${entry.method}`).toBe(
        'function'
      )
    }
    // No catch-all: feature detection reflects the contract.
    expect((api.hpo as Record<string, unknown>).notAMethod).toBeUndefined()
    expect((api as Record<string, unknown>).notADomain).toBeUndefined()
  })

  it('implements every adapter method locally and nothing else', () => {
    const adapters = listManifestEntries()
      .filter((entry) => entry.policy.policy.web === 'adapter')
      .map((entry) => `${entry.domain}.${entry.method}`)
      .sort()
    const local = Object.entries(LOCAL_API)
      .flatMap(([domain, methods]) => Object.keys(methods ?? {}).map((m) => `${domain}.${m}`))
      .sort()
    expect(local).toEqual(adapters)
    for (const key of adapters) {
      const [domain, method] = key.split('.')
      expect(api[domain][method]).toBe((LOCAL_API as LooseApi)[domain][method])
    }
  })

  it('refuses desktop-only and pending methods without a request', async () => {
    const fetchMock = stubFetch()
    for (const entry of listManifestEntries()) {
      const web = entry.policy.policy.web
      if (web !== 'desktop-only' && web !== 'pending') continue
      const fn = api[entry.domain][entry.method]
      if (/^on[A-Z]/.test(entry.method)) {
        // An unbridged subscription is a typed error, not a silent no-op.
        expect(() => fn(() => undefined), `${entry.domain}.${entry.method}`).toThrow(
          WebCallRefusedError
        )
        continue
      }
      await expect(fn(), `${entry.domain}.${entry.method}`).resolves.toMatchObject({
        code: ErrorCode.UNSUPPORTED_RUNTIME
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends shared user methods as RPC', async () => {
    const fetchMock = stubFetch([])
    await api.caseMetadata.get(7)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/caseMetadata/get')
    expect(JSON.parse(String(init.body))).toEqual({ args: [7] })
  })

  it('fails closed for admin methods until the capability document grants the role', async () => {
    const fetchMock = stubFetch([])
    await expect(api.auth.listUsers()).resolves.toMatchObject({ code: ErrorCode.FORBIDDEN })
    expect(fetchMock).not.toHaveBeenCalled()

    const asUser = computeCapabilityDocument({ runtime: 'web', role: 'user', storage: null })
    stubFetch(asUser)
    await api.system.getCapabilities()
    const userFetch = stubFetch([])
    await expect(api.auth.listUsers()).resolves.toMatchObject({ code: ErrorCode.FORBIDDEN })
    expect(userFetch).not.toHaveBeenCalled()

    const asAdmin = computeCapabilityDocument({ runtime: 'web', role: 'admin', storage: null })
    stubFetch(asAdmin)
    await api.system.getCapabilities()
    const adminFetch = stubFetch([])
    await expect(api.auth.listUsers()).resolves.toEqual([])
    expect(adminFetch).toHaveBeenCalledTimes(1)
  })
})
