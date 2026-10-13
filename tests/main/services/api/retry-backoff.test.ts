/** One backoff for every external API client that retries: exponential, full jitter, capped. */
import { describe, expect, it } from 'vitest'

import { backoffDelay, retryAfterMs } from '../../../../src/main/services/api/retry-backoff'

const policy = { baseMs: 1000, factor: 2, capMs: 8000 }

describe('backoffDelay', () => {
  it.each([
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [4, 8000],
    [5, 8000] // capped
  ])('retry %i: full jitter in [0, %i] ms', (retry, ceiling) => {
    expect(backoffDelay(retry, policy, () => 0)).toBe(0)
    expect(backoffDelay(retry, policy, () => 0.999999)).toBe(Math.floor(ceiling * 0.999999))
    const sample = backoffDelay(retry, policy)
    expect(sample).toBeGreaterThanOrEqual(0)
    expect(sample).toBeLessThanOrEqual(ceiling)
  })
})

describe('retryAfterMs', () => {
  const now = Date.parse('2026-10-12T12:00:00Z')
  it.each([
    ['5', 5000],
    ['0', 0],
    ['Mon, 12 Oct 2026 12:00:30 GMT', 30_000],
    ['soon', null],
    [null, null]
  ])('%s → %s', (header, expected) => {
    expect(retryAfterMs(header, now)).toBe(expected)
  })
})
