import { describe, expect, it } from 'vitest'
import {
  DESKTOP_BUDGETS,
  evaluateBudgets,
  gateFailures,
  median,
  type FlowStepLike,
  type LhrLike
} from '../../../scripts/ui-gates/lighthouse-budgets'

function navigation(perf: number, cls: number, a11y = 1, bp = 1): LhrLike {
  return {
    gatherMode: 'navigation',
    categories: {
      performance: { score: perf },
      accessibility: { score: a11y },
      'best-practices': { score: bp }
    },
    audits: { 'cumulative-layout-shift': { numericValue: cls } }
  }
}

function timespan(cls: number): LhrLike {
  return {
    gatherMode: 'timespan',
    categories: {},
    audits: { 'cumulative-layout-shift': { numericValue: cls } }
  }
}

const run = (steps: Array<[string, LhrLike]>): FlowStepLike[] =>
  steps.map(([name, lhr]) => ({ name, lhr }))

describe('lighthouse budgets', () => {
  it('computes the median of odd and even samples', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('gates on the median so one noisy run cannot flip a check', () => {
    const runs = [
      run([['home', navigation(0.99, 0)]]),
      run([['home', navigation(0.81, 0)]]),
      run([['home', navigation(0.97, 0)]])
    ]
    const perf = evaluateBudgets(runs, DESKTOP_BUDGETS, {}).find((r) => r.metric === 'performance')
    expect(perf).toMatchObject({ median: 0.97, status: 'pass' })
  })

  it('fails a regression and keeps the absolute thresholds (perf >= 0.95, a11y/bp = 1, cls <= 0.02)', () => {
    const results = evaluateBudgets(
      [run([['home', navigation(0.94, 0.021, 0.99, 1)]])],
      DESKTOP_BUDGETS,
      {}
    )
    expect(Object.fromEntries(results.map((r) => [r.metric, r.status]))).toEqual({
      performance: 'fail',
      accessibility: 'fail',
      'best-practices': 'pass',
      cls: 'fail'
    })
    expect(gateFailures(results)).toHaveLength(3)
  })

  it('tolerates float noise at the threshold', () => {
    const results = evaluateBudgets(
      [run([['home', navigation(0.9499999999, 0.0200000001)]])],
      DESKTOP_BUDGETS,
      {}
    )
    expect(results.filter((r) => r.status === 'pass').map((r) => r.metric)).toContain('performance')
    expect(results.find((r) => r.metric === 'cls')?.status).toBe('pass')
  })

  it('reports known failures as xfail and fails the gate when they unexpectedly pass', () => {
    const known = { 'lighthouse:switch-cohort:cls': 'track 2' }
    const failing = evaluateBudgets(
      [run([['switch-cohort', timespan(0.08)]])],
      DESKTOP_BUDGETS,
      known
    )
    expect(failing[0]).toMatchObject({ status: 'xfail', note: 'track 2' })
    expect(gateFailures(failing)).toHaveLength(0)

    const fixed = evaluateBudgets([run([['switch-cohort', timespan(0)]])], DESKTOP_BUDGETS, known)
    expect(fixed[0].status).toBe('xpass')
    expect(gateFailures(fixed)).toHaveLength(1)
  })

  it('treats a missing metric as a gate failure', () => {
    const lhr: LhrLike = { gatherMode: 'timespan', categories: {}, audits: {} }
    const results = evaluateBudgets([run([['open-case', lhr]])], DESKTOP_BUDGETS, {})
    expect(results[0].status).toBe('missing')
    expect(gateFailures(results)).toHaveLength(1)
  })
})
