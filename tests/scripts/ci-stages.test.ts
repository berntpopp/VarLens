import { describe, expect, it } from 'vitest'
// @ts-expect-error Repository CLI modules are tested directly.
import {
  selectStages,
  executeStages,
  stageEnvironment,
  GATE_MANIFEST
} from '../../scripts/ci/stages.mjs'
// @ts-expect-error Repository CLI modules are tested directly.
import { classifyChanges } from '../../scripts/ci/changes.mjs'
describe('preflight composition', () => {
  it('runs setup/build once and serializes Node consumers before Electron', () => {
    const stages = selectStages(classifyChanges(['unknown']), { platform: 'linux' })
    const ids = stages.map((stage: { id: string }) => stage.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of [
      'setup',
      'desktop-tests',
      'web-static',
      'postgres-tests',
      'docker',
      'desktop-build',
      'package',
      'packaged-smoke',
      'docs'
    ])
      expect(ids).toContain(id)
    expect(ids.indexOf('desktop-build')).toBeLessThan(ids.indexOf('desktop-tests'))
    expect(ids.indexOf('postgres-tests')).toBeLessThan(ids.indexOf('electron'))
    expect(ids.indexOf('docker')).toBeLessThan(ids.indexOf('electron'))
    expect(stages.find((stage: { id: string }) => stage.id === 'desktop-tests').env).toMatchObject({
      COVERAGE: '1'
    })
    expect(stages.find((stage: { id: string }) => stage.id === 'package').args).toContain('never')
    expect(
      GATE_MANIFEST.every((gate: { side: string }) =>
        ['both', 'local-only', 'hosted-only'].includes(gate.side)
      )
    ).toBe(true)
  })
  it('aborts dependent work after failure or cancellation', async () => {
    const seen: string[] = []
    await expect(
      executeStages(
        [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
        async (stage: { id: string }) => {
          seen.push(stage.id)
          if (stage.id === 'two') throw new Error('failed stage')
        }
      )
    ).rejects.toThrow('failed stage')
    expect(seen).toEqual(['one', 'two'])
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeStages([{ id: 'one' }], async () => seen.push('unexpected'), {
        signal: controller.signal
      })
    ).rejects.toThrow(/abort/i)
    expect(seen).not.toContain('unexpected')
  })
  it('promotes docs to Electron only on screenshot cache miss', () => {
    const selection = classifyChanges(['docs/guide.md'])
    expect(
      selectStages(selection, { screenshotsMissing: false }).map((s: { id: string }) => s.id)
    ).not.toContain('electron')
    expect(
      selectStages(selection, { screenshotsMissing: true }).map((s: { id: string }) => s.id)
    ).toContain('electron')
  })
})

it('scopes disposable PostgreSQL credentials to database and web UI checks', () => {
  const base = { PATH: '/bin', CI: '1' }
  const postgres = { VARLENS_PG_URL: 'postgres://fixture', VARLENS_RECOVERY_KEY_DIR: '/fixture' }
  const stages = selectStages(classifyChanges(['unknown']), { platform: 'linux' })
  for (const stage of stages) {
    const env = stageEnvironment(stage, base, postgres)
    if (['postgres-tests', 'postgres-storage', 'ui-gates'].includes(stage.id))
      expect(env.VARLENS_PG_URL).toBe(postgres.VARLENS_PG_URL)
    else expect(env).not.toHaveProperty('VARLENS_PG_URL')
  }
  expect(base).toEqual({ PATH: '/bin', CI: '1' })
  const ids = stages.map((stage: { id: string }) => stage.id)
  expect(ids.indexOf('ui-gates')).toBeGreaterThan(ids.indexOf('web-build'))
  expect(ids.indexOf('ui-gates')).toBeLessThan(ids.indexOf('electron'))
  expect(ids.indexOf('interactions')).toBeGreaterThan(ids.indexOf('electron'))
})
