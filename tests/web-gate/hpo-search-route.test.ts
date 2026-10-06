import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { buildDispatcher } from '../../src/web/server/dispatcher'
import {
  HPO_TERMS_PATH_ENV,
  loadWebHpoTerms,
  resetWebHpoTermsCache
} from '../../src/web/server/web-hpo-terms'
import { makeDeps } from './helpers/dispatcher-adapters'

/**
 * HPO term search in web mode (parity PR-W7a): served from the bundled
 * ontology term list, so no request ever leaves the server and it is not
 * subject to the external-lookup egress policy.
 */
const realFetch = globalThis.fetch
let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn()
  globalThis.fetch = fetchSpy as unknown as typeof fetch
  resetWebHpoTermsCache()
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env[HPO_TERMS_PATH_ENV]
  resetWebHpoTermsCache()
})

async function search(args: unknown[]) {
  const { deps, reply } = makeDeps()
  const { overrides } = buildDispatcher(deps)
  const result = await overrides['hpo:search'].handle(args, {} as never, reply as never, deps)
  return { result, reply }
}

describe('web hpo:search (bundled ontology)', () => {
  test('loads the bundled term list from the source checkout', () => {
    expect(loadWebHpoTerms().length).toBeGreaterThan(10_000)
  })

  test('finds terms by label without any network request', async () => {
    const { result, reply } = await search(['seizure', 5])
    expect(reply.code).not.toHaveBeenCalled()
    const body = result as { success: boolean; terms: Array<{ id: string; name: string }> }
    expect(body.success).toBe(true)
    expect(body.terms.length).toBeGreaterThan(0)
    expect(body.terms.length).toBeLessThanOrEqual(5)
    expect(body.terms.every((t) => /^HP:\d{7}$/.test(t.id))).toBe(true)
    expect(body.terms.some((t) => /seizure/i.test(t.name))).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('an exact HPO id ranks first and a missing maxResults (JSON null) uses the default', async () => {
    const { result } = await search(['HP:0001250', null])
    const body = result as { success: true; terms: Array<{ id: string; name: string }> }
    expect(body.terms[0]).toEqual({ id: 'HP:0001250', name: 'Seizure' })
  })

  test('queries shorter than two characters return no terms', async () => {
    const { result } = await search(['a'])
    expect(result).toEqual({ success: true, terms: [] })
  })

  test('invalid arguments answer 400', async () => {
    for (const args of [[123], [''], ['seizure', 0], ['seizure', 500], ['x'.repeat(501)]]) {
      const { reply } = await search(args)
      expect(reply.code, JSON.stringify(args).slice(0, 40)).toHaveBeenCalledWith(400)
    }
  })

  test('a missing term file fails loudly with the checked path', () => {
    process.env[HPO_TERMS_PATH_ENV] = '/nonexistent/hpo-terms.json'
    expect(() => loadWebHpoTerms()).toThrow(/nonexistent/)
  })

  test('hpo:clearCache is a no-op success', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    expect(await overrides['hpo:clearCache'].handle([], {} as never, reply as never, deps)).toEqual(
      { success: true }
    )
  })
})
