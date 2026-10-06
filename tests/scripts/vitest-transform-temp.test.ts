import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Repository CLI modules are tested directly.
import { isolateTransformTemp } from '../../scripts/vitest/transform-temp.mjs'
// @ts-expect-error Repository CLI modules are tested directly.
import { installedFingerprint } from '../../scripts/ci/dependencies.mjs'
// @ts-expect-error Repository CLI modules are tested directly.
import { assertCleanSnapshot, snapshotSource } from '../../scripts/ci/receipt.mjs'

const temporary: string[] = []
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
)
function worktree(): string {
  const root = mkdtempSync(join(tmpdir(), 'varlens-vitest-temp-'))
  temporary.push(root)
  mkdirSync(join(root, 'node_modules/example'), { recursive: true })
  writeFileSync(join(root, 'node_modules/example/index.js'), 'module.exports = 1')
  return root
}

describe('per-worktree Vitest transform copies', () => {
  it('moves the runner temp directory into the worktree and keeps tests on the host one', () => {
    const [first, second] = [worktree(), worktree()]
    const env: Record<string, string | undefined> = { TMPDIR: '/host/tmp' }
    const isolated = isolateTransformTemp(first, { env, platform: 'linux' })
    expect(isolated.directory).toBe(join(first, 'node_modules/.vite-temp/vitest'))
    expect(env.TMPDIR).toBe(isolated.directory)
    expect(existsSync(isolated.directory)).toBe(true)
    expect(isolated.workerEnv).toEqual({ TMPDIR: '/host/tmp' })
    expect(isolateTransformTemp(second, { env: {}, platform: 'linux' }).directory).not.toBe(
      isolated.directory
    )
  })

  it('remembers the host directory when the configuration is evaluated again', () => {
    const root = worktree()
    const env: Record<string, string | undefined> = { TMPDIR: '/host/tmp' }
    isolateTransformTemp(root, { env, platform: 'linux' })
    // A watch-mode restart, or a Vitest started by a test, must not hand the
    // transform directory to test code as its temporary directory.
    expect(isolateTransformTemp(root, { env, platform: 'linux' }).workerEnv).toEqual({
      TMPDIR: '/host/tmp'
    })
    expect(
      isolateTransformTemp(root, { env: {}, platform: 'linux', hostTemp: () => '/tmp' }).workerEnv
    ).toEqual({ TMPDIR: '/tmp' })
  })

  it('is inert where TMPDIR does not steer os.tmpdir() or dependencies are absent', () => {
    const root = worktree()
    const env: Record<string, string | undefined> = { TMPDIR: '/host/tmp' }
    expect(isolateTransformTemp(root, { env, platform: 'win32' })).toEqual({ workerEnv: {} })
    rmSync(join(root, 'node_modules'), { recursive: true })
    expect(isolateTransformTemp(root, { env, platform: 'linux' })).toEqual({ workerEnv: {} })
    expect(env.TMPDIR).toBe('/host/tmp')
  })

  it('reclaims only copies abandoned by killed runs', () => {
    const root = worktree()
    const { directory } = isolateTransformTemp(root, { env: {}, platform: 'linux' })
    const abandoned = join(directory, 'abandonedAbandonedAb0')
    const active = join(directory, 'activeActiveActiveAc1')
    for (const run of [abandoned, active]) {
      mkdirSync(join(run, 'ssr'), { recursive: true })
      writeFileSync(join(run, 'ssr', 'module'), 'export {}')
    }
    writeFileSync(join(directory, 'vitest-coverage-0123456789abcdef.lock'), '{}')
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    for (const path of [abandoned, join(abandoned, 'ssr'), active]) utimesSync(path, old, old)
    isolateTransformTemp(root, { env: {}, platform: 'linux' })
    expect(existsSync(abandoned)).toBe(false)
    // A long-lived run keeps writing into its environment directory.
    expect(existsSync(join(active, 'ssr', 'module'))).toBe(true)
    expect(existsSync(join(directory, 'vitest-coverage-0123456789abcdef.lock'))).toBe(true)
  })

  it('stays outside dependency integrity and ignored-source checks', async () => {
    const root = worktree()
    const cache = join(root, 'digests.json')
    const before = await installedFingerprint(root, cache)
    const { directory } = isolateTransformTemp(root, { env: {}, platform: 'linux' })
    mkdirSync(join(directory, 'runRunRunRunRunRunRu2', 'ssr'), { recursive: true })
    writeFileSync(join(directory, 'runRunRunRunRunRunRu2', 'ssr', 'module.ts'), 'export {}')
    expect(await installedFingerprint(root, cache)).toBe(before)

    const { execFileSync } = await import('node:child_process')
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    writeFileSync(join(root, '.gitignore'), 'node_modules\n')
    git('init', '-q')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    git('add', '.')
    git('commit', '-qm', 'fixture')
    const snapshot = snapshotSource(root)
    expect(snapshot.ignoredInputs).toEqual([])
    expect(() => assertCleanSnapshot(snapshot)).not.toThrow()
  })
})
