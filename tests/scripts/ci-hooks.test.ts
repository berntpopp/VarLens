import { describe, expect, it } from 'vitest'
// @ts-expect-error Repository CLI modules are tested directly.
import { parsePushUpdates, outgoingHistory, validatePushTargets } from '../../scripts/ci/hooks.mjs'
const a = 'a'.repeat(40)
const b = 'b'.repeat(40)
const zero = '0'.repeat(40)
describe('pre-push ref validation', () => {
  it('retains every new-branch/tag/deletion update from original stdin', () => {
    const updates = parsePushUpdates(
      `refs/heads/feature ${a} refs/heads/feature ${zero}\nrefs/tags/v1.0.0 ${b} refs/tags/v1.0.0 ${zero}\n(delete) ${zero} refs/heads/old ${b}\n`
    )
    expect(updates).toHaveLength(3)
    expect(updates[2].deleted).toBe(true)
    expect(outgoingHistory(a, 'origin')).toBe(`${a} --not --remotes=origin`)
    expect(() => parsePushUpdates('bad input')).toThrow()
  })
  it('peels annotated tags and rejects a different actual pushed commit', async () => {
    const updates = parsePushUpdates(
      `refs/heads/feature ${a} refs/heads/feature ${zero}\nrefs/tags/v1.0.0 ${b} refs/tags/v1.0.0 ${zero}\n`
    )
    const requested: string[] = []
    await expect(
      validatePushTargets(updates, {
        head: a,
        peel: (ref: string) => {
          requested.push(ref)
          return a
        }
      })
    ).resolves.toHaveLength(2)
    expect(requested).toContain(`${b}^{commit}`)
    await expect(
      validatePushTargets(updates, { head: a, peel: (ref: string) => (ref.startsWith(b) ? b : a) })
    ).rejects.toThrow(/checkout|check out/i)
  })
})

it('installs worktree-scoped hooks and refuses an existing foreign configuration', async () => {
  const { mkdtempSync, mkdirSync, copyFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const { installHooks } = await import('../../scripts/ci/hooks.mjs')
  const cwd = mkdtempSync(join(tmpdir(), 'varlens-hooks-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  try {
    git('init', '-q')
    mkdirSync(join(cwd, '.githooks'))
    copyFileSync(resolve('.githooks/pre-push'), join(cwd, '.githooks/pre-push'))
    git('config', '--local', 'core.hooksPath', '/foreign/hooks')
    expect(() => installHooks({ cwd })).toThrow(/refusing/)
    expect(git('config', '--get', 'core.hooksPath')).toBe('/foreign/hooks')
    git('config', '--local', 'core.hooksPath', join(cwd, '.git/hooks'))
    const path = installHooks({ cwd })
    expect(git('config', '--worktree', '--get', 'core.hooksPath')).toBe(path)
    expect(git('config', '--local', '--get', 'core.hooksPath')).toBe(join(cwd, '.git/hooks'))
    expect(git('config', '--local', '--get', 'extensions.worktreeConfig')).toBe('true')
    expect(() =>
      execFileSync(join(path, 'pre-push'), [], { cwd, input: '', stdio: ['pipe', 'pipe', 'pipe'] })
    ).toThrow()
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
