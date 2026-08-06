import { describe, expect, test } from 'vitest'

import { compareBaselines, formatReport } from '../../scripts/perf/compare-build.mjs'
import { STAGES } from '../../scripts/perf/measure-build.mjs'

describe('build perf stage registry', () => {
  test('every stage has a unique id and a command', () => {
    expect(STAGES.length).toBeGreaterThan(0)
    const ids = STAGES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const stage of STAGES) {
      expect(stage.id).toMatch(/^[a-z0-9-]+$/)
      expect(typeof stage.cmd).toBe('string')
      expect(stage.cmd.length).toBeGreaterThan(0)
    }
  })

  test('covers the stages the spec sets targets for', () => {
    const ids = STAGES.map((s) => s.id)
    expect(ids).toContain('rebuild-electron-cold')
    expect(ids).toContain('rebuild-electron-warm')
    expect(ids).toContain('rebuild-node')
    expect(ids).toContain('build')
    expect(ids).toContain('test')
    expect(ids).toContain('typecheck')
    expect(ids).toContain('lint-cold')
    expect(ids).toContain('lint-warm')
    expect(ids).toContain('format-cold')
    expect(ids).toContain('format-warm')
  })

  test('leaves the tree on the Node ABI so `make test` still works afterwards', () => {
    expect(STAGES.at(-1)?.id).toBe('rebuild-node')
  })
})

describe('build perf comparison', () => {
  const before = {
    label: 'before',
    stages: [
      { id: 'rebuild-electron-warm', wallSeconds: 33.57, peakRssMb: 600, exitCode: 0 },
      { id: 'build', wallSeconds: 11.2, peakRssMb: 2067, exitCode: 0 },
      { id: 'gone', wallSeconds: 1, peakRssMb: null, exitCode: 0 }
    ]
  }
  const after = {
    label: 'after',
    stages: [
      { id: 'rebuild-electron-warm', wallSeconds: 1.4, peakRssMb: 170, exitCode: 0 },
      { id: 'build', wallSeconds: 11.2, peakRssMb: 2067, exitCode: 0 }
    ]
  }

  test('classifies each stage and totals both runs', () => {
    const c = compareBaselines(before, after)
    const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]))

    expect(byId['rebuild-electron-warm'].classification).toBe('improved')
    expect(byId['rebuild-electron-warm'].deltaSeconds).toBe(-32.17)
    expect(byId['rebuild-electron-warm'].deltaPercent).toBe(-95.83)
    expect(byId['build'].classification).toBe('unchanged')
    expect(byId['gone'].classification).toBe('missing')

    expect(c.totalBefore).toBe(45.77)
    expect(c.totalAfter).toBe(12.6)
  })

  test('classifies a stage present only in the after run as new, not missing', () => {
    const withNewStage = {
      label: 'after',
      stages: [...after.stages, { id: 'lint-cold', wallSeconds: 3.2, peakRssMb: 210, exitCode: 0 }]
    }
    const row = compareBaselines(before, withNewStage).rows.find((r) => r.id === 'lint-cold')
    expect(row.classification).toBe('new')
    expect(row.beforeSeconds).toBeNull()
    expect(row.afterSeconds).toBe(3.2)
    expect(row.afterPeakRssMb).toBe(210)
  })

  test('flags a regression', () => {
    const worse = {
      label: 'after',
      stages: [{ id: 'build', wallSeconds: 20, peakRssMb: 1, exitCode: 0 }]
    }
    const row = compareBaselines(before, worse).rows.find((r) => r.id === 'build')
    expect(row.classification).toBe('regressed')
  })

  test('renders a markdown table naming both labels', () => {
    const md = formatReport(compareBaselines(before, after), { before: 'before', after: 'after' })
    expect(md).toContain('| Stage |')
    expect(md).toContain('rebuild-electron-warm')
    expect(md).toContain('before')
    expect(md).toContain('after')
  })

  test('classifies a failed stage as failed, never improved, even with a much shorter wall time', () => {
    const crashed = {
      label: 'after',
      stages: [{ id: 'build', wallSeconds: 0.05, peakRssMb: 40, exitCode: 1 }]
    }
    const row = compareBaselines(before, crashed).rows.find((r) => r.id === 'build')
    expect(row.classification).toBe('failed')
    expect(row.classification).not.toBe('improved')
  })

  test('formatReport surfaces a failed stage in the verdict and the summary', () => {
    const crashed = {
      label: 'after',
      stages: [{ id: 'build', wallSeconds: 0.05, peakRssMb: 40, exitCode: 1 }]
    }
    const md = formatReport(compareBaselines(before, crashed), {
      before: 'before',
      after: 'crashed'
    })
    expect(md).toContain('failed')
    expect(md).toContain('Failures')
  })
})
