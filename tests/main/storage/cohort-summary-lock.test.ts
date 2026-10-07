import { describe, expect, it, vi } from 'vitest'

import {
  lockSummaryForWrite,
  tryLockSummaryForWrite
} from '../../../src/main/storage/postgres/cohort-summary-lock'

describe('cohort summary write lock', () => {
  it('waits by polling the non-blocking lock, so no single query outlives a client timeout', async () => {
    const answers = [false, false, true]
    const query = vi.fn(async () => ({ rows: [{ locked: answers.shift() }] }))

    await lockSummaryForWrite({ query } as never, 'tenant')

    expect(query).toHaveBeenCalledTimes(3)
    for (const [text, values] of query.mock.calls as unknown as Array<[string, unknown[]]>) {
      expect(text).toContain('pg_try_advisory_xact_lock')
      expect(text).not.toContain('pg_advisory_xact_lock(')
      expect(values).toEqual(['tenant'])
    }
  })

  it('reports a refusal only when PostgreSQL says the lock is taken', async () => {
    const taken = { query: vi.fn(async () => ({ rows: [{ locked: false }] })) }
    const free = { query: vi.fn(async () => ({ rows: [{ locked: true }] })) }
    expect(await tryLockSummaryForWrite(taken as never, 'tenant')).toBe(false)
    expect(await tryLockSummaryForWrite(free as never, 'tenant')).toBe(true)
  })
})
