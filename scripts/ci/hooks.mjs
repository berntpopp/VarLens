import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync
} from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { git } from './process.mjs'
export { outgoingHistory } from './git-history.mjs'

export function parsePushUpdates(input) {
  return input
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const fields = line.trim().split(/\s+/)
      if (
        fields.length !== 4 ||
        !/^[a-f0-9]{40,64}$/.test(fields[1]) ||
        !/^[a-f0-9]{40,64}$/.test(fields[3]) ||
        !fields[2].startsWith('refs/')
      )
        throw new Error('Invalid pre-push ref update input')
      const [localRef, localSha, remoteRef, remoteSha] = fields
      return { localRef, localSha, remoteRef, remoteSha, deleted: /^0+$/.test(localSha) }
    })
}
export async function validatePushTargets(updates, { head, peel }) {
  const targets = []
  for (const update of updates.filter((entry) => !entry.deleted)) {
    const commit = await peel(`${update.localSha}^{commit}`)
    if (commit !== head)
      throw new Error(
        `Push contains ${update.localRef} at ${commit}, but HEAD is ${head}. Check out that commit in its own worktree, run make preflight, then push it there.`
      )
    targets.push({ ...update, commit })
  }
  return targets
}
export function installHooks({ cwd = process.cwd() } = {}) {
  const gitDir = resolve(cwd, git(['rev-parse', '--git-dir'], { cwd }))
  const commonDir = resolve(cwd, git(['rev-parse', '--git-common-dir'], { cwd }))
  const destination = join(gitDir, 'varlens-hooks')
  const source = join(cwd, '.githooks', 'pre-push')
  let configured = ''
  try {
    configured = git(['config', '--get', 'core.hooksPath'], { cwd })
  } catch {
    /* Git exits 1 for absent keys. */
  }
  const defaults = join(commonDir, 'hooks')
  const hasDefaultHooks =
    existsSync(defaults) && readdirSync(defaults).some((name) => !name.endsWith('.sample'))
  const emptyDefault = configured && resolve(cwd, configured) === defaults && !hasDefaultHooks
  if (configured && resolve(cwd, configured) !== destination && !emptyDefault)
    throw new Error(
      `Existing core.hooksPath=${configured}; refusing to replace another hook configuration. Integrate .githooks/pre-push explicitly.`
    )
  if (!configured && hasDefaultHooks)
    throw new Error(
      `Existing hooks in ${defaults}; refusing to replace them. Integrate .githooks/pre-push explicitly.`
    )
  if (!existsSync(source))
    throw new Error(
      'This worktree does not contain .githooks/pre-push; update its branch before installing hooks.'
    )
  mkdirSync(destination, { recursive: true })
  copyFileSync(source, join(destination, 'pre-push'))
  chmodSync(join(destination, 'pre-push'), 0o755)
  git(['config', '--local', 'extensions.worktreeConfig', 'true'], { cwd })
  git(['config', '--worktree', 'core.hooksPath', destination], { cwd })
  return destination
}
export async function prePush({ cwd = process.cwd(), input, remote = 'origin' }) {
  const updates = parsePushUpdates(input)
  if (updates.every((entry) => entry.deleted)) return { deleted: true }
  const head = git(['rev-parse', 'HEAD'], { cwd })
  const targets = await validatePushTargets(updates, {
    head,
    peel: (ref) => git(['rev-parse', '--verify', ref], { cwd })
  })
  const tags = targets.filter((target) => /^refs\/tags\/v/.test(target.remoteRef))
  for (const tag of tags) {
    const pkg = JSON.parse(git(['show', `${tag.commit}:package.json`], { cwd }))
    if (tag.remoteRef !== `refs/tags/v${pkg.version}`)
      throw new Error(`Tag ${tag.remoteRef} does not match package version v${pkg.version}`)
  }
  const { runPreflight } = await import('./run.mjs')
  const result = await runPreflight({
    cwd,
    remote,
    base: `${remote}/main`,
    full: tags.length > 0,
    push: true
  })
  for (const tag of tags) {
    try {
      git(['merge-base', '--is-ancestor', tag.commit, `${remote}/main`], { cwd })
    } catch {
      throw new Error(
        `Version tag ${tag.remoteRef} must point to a commit reachable from freshly fetched ${remote}/main.`
      )
    }
  }
  return result
}
const isMain =
  process.argv[1] &&
  (() => {
    try {
      return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
    } catch {
      return false
    }
  })()
if (isMain) {
  try {
    if (process.argv[2] === 'install')
      process.stdout.write(`Installed worktree hooks: ${installHooks()}\n`)
    else if (process.argv[2] === 'pre-push')
      await prePush({ input: readFileSync(0, 'utf8'), remote: process.argv[3] ?? 'origin' })
    else throw new Error('Usage: node scripts/ci/hooks.mjs install|pre-push [remote]')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
