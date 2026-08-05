import { describe, expect, test } from 'vitest'

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
