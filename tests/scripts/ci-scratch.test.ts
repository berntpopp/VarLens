import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Repository CLI modules are tested directly.
import { createScratch, scratchRoot } from '../../scripts/ci/scratch.mjs'
// @ts-expect-error Repository CLI modules are tested directly.
import { gateEnvironment } from '../../scripts/ci/process.mjs'

const temporary: string[] = []
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
)
function root(): string {
  const directory = mkdtempSync(join(tmpdir(), 'varlens-scratch-test-'))
  temporary.push(directory)
  return directory
}
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', ''])
  return child.pid
}

describe('disk-backed gate scratch space', () => {
  it('defaults beside the tool cache instead of the possibly RAM-backed temporary directory', () => {
    expect(scratchRoot({})).toBe(join(homedir(), '.cache', 'varlens-ci', 'scratch'))
    expect(scratchRoot({ TMPDIR: '/dev/shm/elsewhere' })).toBe(
      join(homedir(), '.cache', 'varlens-ci', 'scratch')
    )
  })

  it('respects an explicit absolute override and propagates it to gate children', () => {
    const explicit = root()
    expect(scratchRoot({ VARLENS_CI_SCRATCH_DIR: explicit })).toBe(explicit)
    expect(() => scratchRoot({ VARLENS_CI_SCRATCH_DIR: 'relative/scratch' })).toThrow(/absolute/)
    expect(gateEnvironment({ VARLENS_CI_SCRATCH_DIR: explicit })).toMatchObject({
      VARLENS_CI_SCRATCH_DIR: explicit
    })
  })

  it('allocates a private run directory and removes it idempotently', async () => {
    const explicit = join(root(), 'nested', 'scratch')
    const scratch = createScratch('trivy', { env: { VARLENS_CI_SCRATCH_DIR: explicit } })
    expect(dirname(scratch.directory)).toBe(explicit)
    expect(basename(scratch.directory)).toContain(`-${process.pid}-`)
    writeFileSync(join(scratch.directory, 'export.tar'), 'layer')
    await scratch.close()
    await scratch.close()
    expect(readdirSync(explicit)).toEqual([])
  })

  it('reclaims scratch abandoned by a killed run without touching live or foreign entries', async () => {
    const explicit = root()
    const env = { VARLENS_CI_SCRATCH_DIR: explicit }
    const live = createScratch('trivy', { env })
    const abandoned = join(
      explicit,
      basename(live.directory).replace(`-${process.pid}-`, `-${deadPid()}-`)
    )
    const otherHost = join(
      explicit,
      basename(abandoned).replace(/^(varlens-ci-trivy-)[0-9a-f]{8}/, '$1ffffffff')
    )
    for (const directory of [abandoned, otherHost, join(explicit, 'unrelated')]) {
      mkdirSync(directory)
      writeFileSync(join(directory, 'payload'), 'data')
    }
    const next = createScratch('builder', { env })
    expect(existsSync(abandoned)).toBe(false)
    expect(existsSync(live.directory)).toBe(true)
    expect(existsSync(otherHost)).toBe(true)
    expect(existsSync(join(explicit, 'unrelated'))).toBe(true)
    await live.close()
    await next.close()
  })
})
