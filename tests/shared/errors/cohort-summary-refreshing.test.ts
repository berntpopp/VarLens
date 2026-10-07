import { describe, expect, it } from 'vitest'

import {
  CohortSummaryRefreshingError,
  waitForCurrentCohortSummary
} from '../../../src/shared/errors/cohort-summary-refreshing'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('waitForCurrentCohortSummary', () => {
  it('returns at once when the summary is current', async () => {
    await expect(waitForCurrentCohortSummary(() => false, 0)).resolves.toBeUndefined()
  })

  it('waits for a refresh that finishes within the bound', async () => {
    let polls = 0
    await waitForCurrentCohortSummary(() => ++polls < 4, 5_000, 5)
    expect(polls).toBe(4)
  })

  it('fails with a typed, user-facing error when the refresh outlasts the bound', async () => {
    const failure = await waitForCurrentCohortSummary(() => true, 30, 5).catch((error) => error)
    expect(failure).toBeInstanceOf(CohortSummaryRefreshingError)
    expect(failure).toMatchObject({
      name: 'CohortSummaryRefreshingError',
      code: ErrorCode.CONFLICT,
      userMessage: expect.stringContaining('being refreshed')
    })
  })
})
