import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Repository CLI modules are tested directly.
import {
  writeReceipt,
  readReceipt,
  matchesReceipt,
  digestPaths
} from '../../scripts/ci/receipt.mjs'
const temporary: string[] = []
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
)
describe('deterministic successful receipts', () => {
  it('binds exact commit, merge base, stages, policy, toolchain, dependencies and outputs', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'varlens-receipt-'))
    temporary.push(cwd)
    writeFileSync(join(cwd, 'output'), 'built')
    const inputs = {
      commit: 'abc',
      tree: 'tree',
      base: 'base',
      policy: 'policy',
      toolchain: 'tools',
      dependencies: 'deps',
      stages: ['quality']
    }
    const outputs = await digestPaths(cwd, ['output'])
    const receipt = { inputs, outputs, stages: [{ id: 'quality', status: 'passed' }] }
    const path = join(cwd, 'record.json')
    writeReceipt(path, receipt)
    expect(await matchesReceipt(readReceipt(path), inputs, { cwd })).toBe(true)
    for (const field of [
      'commit',
      'tree',
      'base',
      'policy',
      'toolchain',
      'dependencies',
      'stages'
    ]) {
      expect(await matchesReceipt(receipt, { ...inputs, [field]: 'changed' }, { cwd }), field).toBe(
        false
      )
    }
    writeFileSync(join(cwd, 'output'), 'corrupt')
    expect(await matchesReceipt(receipt, inputs, { cwd })).toBe(false)
    writeFileSync(path, '{broken')
    expect(readReceipt(path)).toBeNull()
  })
  it('never accepts missing output or incomplete stages', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'varlens-receipt-'))
    temporary.push(cwd)
    await expect(digestPaths(cwd, ['missing'])).rejects.toThrow()
    const inputs = { stages: ['one', 'two'] }
    expect(
      await matchesReceipt(
        { inputs, outputs: {}, stages: [{ id: 'one', status: 'passed' }] },
        inputs,
        { cwd }
      )
    ).toBe(false)
  })
})

describe('receipt readiness boundaries', () => {
  it('rejects omitted expected outputs and changed source snapshots', async () => {
    const { assertUnchanged } = await import('../../scripts/ci/receipt.mjs')
    const inputs = { stages: ['build'], requiredOutputs: ['out/main'] }
    expect(
      await matchesReceipt(
        { inputs, outputs: {}, stages: [{ id: 'build', status: 'passed' }] },
        inputs
      )
    ).toBe(false)
    expect(() =>
      assertUnchanged(
        { commit: 'a', tree: 'a', status: '' },
        { commit: 'b', tree: 'b', status: '' }
      )
    ).toThrow(/changed/)
    expect(() => assertUnchanged({ status: '' }, { status: ' M source.ts' })).toThrow(/clean/)
  })
  it('repairs a changed installed tree exactly once, while ignoring generated caches', async () => {
    const { mkdirSync } = await import('node:fs')
    const { ensureDependencies } = await import('../../scripts/ci/dependencies.mjs')
    const cwd = mkdtempSync(join(tmpdir(), 'varlens-dependencies-'))
    temporary.push(cwd)
    mkdirSync(join(cwd, 'scripts/native'), { recursive: true })
    for (const path of [
      'package.json',
      'package-lock.json',
      '.nvmrc',
      'scripts/native/rebuild-native.mjs'
    ])
      writeFileSync(join(cwd, path), 'fixture')
    let installs = 0
    const execute = async (_command: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: '11.11.0' }
      installs++
      mkdirSync(join(cwd, 'node_modules/example'), { recursive: true })
      writeFileSync(join(cwd, 'node_modules/example/index.js'), 'good')
      return { stdout: '' }
    }
    const options = { cwd, stateDir: join(cwd, 'state'), env: {}, execute }
    await ensureDependencies(options)
    await ensureDependencies(options)
    expect(installs).toBe(1)
    mkdirSync(join(cwd, 'node_modules/.vitest'), { recursive: true })
    writeFileSync(join(cwd, 'node_modules/.vitest/cache'), 'generated')
    await ensureDependencies(options)
    expect(installs).toBe(1)
    writeFileSync(join(cwd, 'node_modules/example/index.js'), 'evil')
    await ensureDependencies(options)
    expect(installs).toBe(2)
  })
})
