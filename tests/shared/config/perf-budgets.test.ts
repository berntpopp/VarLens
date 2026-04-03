import { describe, it, expect } from 'vitest'
import { PERF_BUDGETS } from '../../../src/shared/config/perf-budgets'

describe('PERF_BUDGETS', () => {
  it('defines all expected budget keys', () => {
    expect(PERF_BUDGETS.STARTUP_TO_INTERACTIVE).toBeGreaterThan(0)
    expect(PERF_BUDGETS.CASE_SWITCH).toBeGreaterThan(0)
    expect(PERF_BUDGETS.FILTER_APPLY).toBeGreaterThan(0)
    expect(PERF_BUDGETS.PAGE_NAVIGATE).toBeGreaterThan(0)
    expect(PERF_BUDGETS.ANNOTATION_HYDRATE).toBeGreaterThan(0)
  })

  it('has reasonable ordering (page < filter < case < startup)', () => {
    expect(PERF_BUDGETS.PAGE_NAVIGATE).toBeLessThanOrEqual(PERF_BUDGETS.FILTER_APPLY)
    expect(PERF_BUDGETS.FILTER_APPLY).toBeLessThanOrEqual(PERF_BUDGETS.CASE_SWITCH)
    expect(PERF_BUDGETS.CASE_SWITCH).toBeLessThanOrEqual(PERF_BUDGETS.STARTUP_TO_INTERACTIVE)
  })
})
