import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Repository CLI modules are tested directly.
import { materializeFixtures } from '../../scripts/ci/fixtures.mjs'
import {
  GENERATED_FIXTURES,
  assertCleanSnapshot,
  assertUnchanged,
  snapshotSource
  // @ts-expect-error Repository CLI modules are tested directly.
} from '../../scripts/ci/receipt.mjs'

type Snapshot = { commit: string; generatedFixtures: [string, string][] }
type Manifest = {
  fixtures: Array<{
    enabledByDefault?: boolean
    source: { path?: string; files?: Array<{ path: string }> }
    transforms?: Array<{
      output?: string
      outputs?: Record<string, string>
      files?: Array<{ output: string }>
    }>
  }>
}

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts/data-fixtures/sources.json'), 'utf8')
) as Manifest
const defaults = manifest.fixtures.filter((fixture) => fixture.enabledByDefault === true)
const temporary: string[] = []
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
)

/** A committed checkout holding the real generator and its tracked sources, with no generated fixtures. */
function freshWorktree(): {
  cwd: string
  execute: (command: string, args: string[]) => Promise<{ stdout: string }>
} {
  const cwd = mkdtempSync(join(tmpdir(), 'varlens-fixtures-'))
  temporary.push(cwd)
  cpSync(join(process.cwd(), 'scripts/data-fixtures'), join(cwd, 'scripts/data-fixtures'), {
    recursive: true
  })
  const sources = defaults.flatMap((fixture) => [
    ...(fixture.source.path ? [fixture.source.path] : []),
    ...(fixture.source.files ?? []).map((file) => file.path)
  ])
  for (const source of new Set(sources)) {
    mkdirSync(dirname(join(cwd, source)), { recursive: true })
    cpSync(join(process.cwd(), source), join(cwd, source))
  }
  writeFileSync(join(cwd, '.gitignore'), 'tests/.cache/\n')
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  git('add', '.')
  git('commit', '-qm', 'fixture')
  return {
    cwd,
    execute: async (command, args) => ({
      stdout: execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    })
  }
}

describe('generated fixtures and the source snapshot', () => {
  it('binds exactly the outputs of the default fixture manifest', () => {
    const outputs = defaults.flatMap((fixture) =>
      (fixture.transforms ?? []).flatMap((transform) => [
        ...(transform.output ? [transform.output] : []),
        ...Object.values(transform.outputs ?? {}),
        ...(transform.files ?? []).map((file) => file.output)
      ])
    )
    expect([...new Set(outputs)].sort()).toEqual([...GENERATED_FIXTURES].sort())
  })

  it('reproduces the fresh-worktree failure when a later stage generates the fixtures', async () => {
    const { cwd, execute } = freshWorktree()
    const before = snapshotSource(cwd) as Snapshot
    expect(before.generatedFixtures).toEqual([])
    // What the web-static stage does through tests/web-gate/data-fixtures.test.ts.
    await execute(process.execPath, ['scripts/data-fixtures/prepare-fixtures.mjs'])
    const after = snapshotSource(cwd) as Snapshot
    expect(after.commit).toBe(before.commit)
    expect(() => assertCleanSnapshot(after)).not.toThrow()
    expect(() => assertUnchanged(before, after)).toThrow(/Source changed during preflight/)
  })

  it('materializes verified fixtures before the binding snapshot so a regenerating stage is a no-op', async () => {
    const { cwd, execute } = freshWorktree()
    const ready = (await materializeFixtures({
      cwd,
      execute,
      initial: snapshotSource(cwd)
    })) as Snapshot
    expect(ready.generatedFixtures.map(([path]) => path)).toEqual([...GENERATED_FIXTURES].sort())
    // Regeneration is byte-deterministic: later mtimes, identical bytes.
    rmSync(join(cwd, 'tests/.cache'), { recursive: true })
    await execute(process.execPath, ['scripts/data-fixtures/prepare-fixtures.mjs'])
    expect(() => assertUnchanged(ready, snapshotSource(cwd))).not.toThrow()
  })

  it('still fails when fixture bytes change or disappear after the binding snapshot', async () => {
    const { cwd, execute } = freshWorktree()
    const ready = await materializeFixtures({ cwd, execute, initial: snapshotSource(cwd) })
    const fixture = join(cwd, GENERATED_FIXTURES[0])
    appendFileSync(fixture, '\n')
    expect(() => assertUnchanged(ready, snapshotSource(cwd))).toThrow(/Source changed/)
    rmSync(fixture)
    expect(() => assertUnchanged(ready, snapshotSource(cwd))).toThrow(/Source changed/)
  })

  it('repairs a tampered fixture before binding and refuses an unverifiable one', async () => {
    const { cwd, execute } = freshWorktree()
    const initial = snapshotSource(cwd)
    const ready = (await materializeFixtures({ cwd, execute, initial })) as Snapshot
    writeFileSync(join(cwd, GENERATED_FIXTURES[0]), 'tampered')
    const repaired = (await materializeFixtures({ cwd, execute, initial })) as Snapshot
    expect(repaired.generatedFixtures).toEqual(ready.generatedFixtures)
    // A tracked source which no longer matches its pinned checksum cannot be certified.
    const source = defaults[0].source.path!
    appendFileSync(join(cwd, source), 'drift')
    await expect(materializeFixtures({ cwd, execute, initial })).rejects.toThrow()
  })

  it('refuses a source change or an incomplete inventory during preparation', async () => {
    const { cwd, execute } = freshWorktree()
    const initial = snapshotSource(cwd)
    await expect(
      materializeFixtures({
        cwd,
        initial,
        execute: async (command: string, args: string[]) => {
          writeFileSync(join(cwd, 'scripts/data-fixtures/injected.mjs'), 'export {}')
          return execute(command, args)
        }
      })
    ).rejects.toThrow(/clean/)
    const drifted = freshWorktree()
    await expect(
      materializeFixtures({
        cwd: drifted.cwd,
        initial: snapshotSource(drifted.cwd),
        execute: async () => ({ stdout: '' })
      })
    ).rejects.toThrow(/Generated fixtures are missing/)
    expect(existsSync(join(drifted.cwd, 'tests/.cache'))).toBe(false)
  })
})
