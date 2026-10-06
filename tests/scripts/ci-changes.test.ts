import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Repository CLI modules are tested directly.
import { classifyChanges, collectChanges, selectionForEvent } from '../../scripts/ci/changes.mjs'
const temporary: string[] = []
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
)
describe('change selection', () => {
  it('limits known planning and docs prose without hiding executable configuration', () => {
    expect(classifyChanges(['.planning/plans/example.md'])).toMatchObject({
      code: false,
      full: false
    })
    expect(classifyChanges(['docs/guide.md'])).toMatchObject({
      docs: true,
      code: false,
      screenshots: false
    })
    for (const path of [
      'docs/.vitepress/config.ts',
      'new-input.xyz',
      'package-lock.json',
      'scripts/new.mjs',
      '.github/workflows/build.yml'
    ]) {
      expect(classifyChanges([path]).full, path).toBe(true)
    }
  })
  it('includes web and screenshots for shared and imported main code', () => {
    for (const path of [
      'src/main/import/VcfMapper.ts',
      'src/shared/types/api.ts',
      'src/renderer/src/App.vue',
      'tests/test-data/file.vcf'
    ]) {
      expect(classifyChanges([path])).toMatchObject({
        code: true,
        web: true,
        docker: true,
        docs: true,
        screenshots: true
      })
    }
  })
  it('selects full on uncertain push history, main and dispatch', () => {
    for (const event of [{ before: '0'.repeat(40) }, { before: 'bad' }]) {
      expect(selectionForEvent('push', event, ['docs/a.md'], false).full).toBe(true)
    }
    expect(selectionForEvent('push', { ref: 'refs/heads/main' }, ['docs/a.md'], true).full).toBe(
      true
    )
    expect(selectionForEvent('workflow_dispatch', {}, [], true).full).toBe(true)
    expect(selectionForEvent('pull_request', {}, ['docs/a.md'], true).code).toBe(false)
  })
  it('sees deleted, renamed, unstaged and untracked filenames with whitespace', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'varlens-changes-'))
    temporary.push(cwd)
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
    git('init', '-q')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    mkdirSync(join(cwd, 'docs'))
    writeFileSync(join(cwd, 'docs', 'old name.md'), 'text')
    git('add', '.')
    git('commit', '-qm', 'initial')
    const base = git('rev-parse', 'HEAD')
    git('mv', 'docs/old name.md', 'unknown\nname.txt')
    writeFileSync(join(cwd, 'new untracked.xyz'), 'new')
    const paths = collectChanges({ cwd, base, head: 'HEAD', workingTree: true })
    expect(paths).toEqual(
      expect.arrayContaining(['docs/old name.md', 'unknown\nname.txt', 'new untracked.xyz'])
    )
    expect(classifyChanges(paths).full).toBe(true)
  })
})
