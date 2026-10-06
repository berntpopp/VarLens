import { describe, expect, test } from 'vitest'

import { BoundedApiCache } from '../../src/web/server/reference-services/bounded-api-cache'

/** Web reference-lookup cache: shared, bounded by size (LRU) and TTL. */
describe('BoundedApiCache', () => {
  test('evicts the least recently used entry beyond maxEntries', () => {
    let clock = 1_000
    const cache = new BoundedApiCache({ maxEntries: 2, now: () => clock++ })
    cache.set('uniprot:A', '"a"')
    cache.set('uniprot:B', '"b"')
    expect(cache.get('uniprot:A')?.data).toBe('"a"') // A becomes most recently used
    cache.set('uniprot:C', '"c"')

    expect(cache.size()).toBe(2)
    expect(cache.get('uniprot:B')).toBeNull()
    expect(cache.get('uniprot:A')?.data).toBe('"a"')
    expect(cache.get('uniprot:C')?.data).toBe('"c"')
  })

  test('caps the TTL a client asks for', () => {
    const cache = new BoundedApiCache({ maxTtlDays: 0 })
    cache.set('gnomad:TP53', '{}', 30)
    // TTL capped to 0 days (± jitter of zero) → already expired.
    expect(cache.get('gnomad:TP53')).toBeNull()
  })

  test('clearByPrefix still works (desktop ApiCache interface)', () => {
    const cache = new BoundedApiCache()
    cache.set('clinvar:BRCA1', '[]')
    cache.set('uniprot:BRCA1', '[]')
    expect(cache.clearByPrefix('clinvar:')).toBe(1)
    expect(cache.size()).toBe(1)
  })
})
