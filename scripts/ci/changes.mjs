import { readFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { git } from './process.mjs'

const LANES = ['code', 'web', 'docker', 'docs', 'screenshots', 'full']
export function classifyChanges(paths) {
  const selection = Object.fromEntries(LANES.map((lane) => [lane, false]))
  selection.reasons = []
  for (const path of [...new Set(paths)]) {
    if (
      /^\.planning\/.*\.(md|txt)$/.test(path) ||
      /^(README|CHANGELOG|LICENSE|CONTRIBUTING)(\.md|\.txt)?$/.test(path)
    ) {
      selection.reasons.push(`prose: ${path}`)
      continue
    }
    if (/^docs\/(?!\.vitepress\/).+\.(md|png|jpe?g|svg|webp|gif)$/.test(path)) {
      selection.docs = true
      selection.reasons.push(`documentation: ${path}`)
      continue
    }
    if (/^(src|tests)\//.test(path)) {
      for (const lane of LANES.filter((lane) => lane !== 'full')) selection[lane] = true
      selection.reasons.push(`application or test input: ${path}`)
      continue
    }
    for (const lane of LANES) selection[lane] = true
    selection.reasons.push(`full validation: ${path}`)
  }
  return selection
}
export function fullSelection(reason) {
  return { ...Object.fromEntries(LANES.map((lane) => [lane, true])), reasons: [reason] }
}
export function collectChanges({ cwd = process.cwd(), base, head = 'HEAD', workingTree = false }) {
  // --no-renames retains both sides as delete+add, including names with newlines.
  const paths = git(['diff', '--name-only', '-z', '--no-renames', base, head, '--'], { cwd })
    .split('\0')
    .filter(Boolean)
  if (workingTree) {
    paths.push(
      ...git(['diff', '--name-only', '-z', '--no-renames', 'HEAD', '--'], { cwd })
        .split('\0')
        .filter(Boolean)
    )
    paths.push(
      ...git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd })
        .split('\0')
        .filter(Boolean)
    )
  }
  return [...new Set(paths)]
}
export function selectionForEvent(eventName, event, paths, validHistory) {
  if (eventName === 'workflow_dispatch' || event?.ref === 'refs/heads/main')
    return fullSelection('main and manual runs retain full validation')
  if (!validHistory || (eventName === 'push' && (!event.before || /^0+$/.test(event.before))))
    return fullSelection('unknown or non-ancestor comparison history')
  return classifyChanges(paths)
}
export function resolveChanges({
  cwd = process.cwd(),
  base = 'origin/main',
  head = 'HEAD',
  workingTree = false,
  eventName,
  event = {}
} = {}) {
  try {
    let comparison = base
    if (eventName === 'pull_request') comparison = event.pull_request?.base?.sha ?? base
    if (eventName === 'push') {
      comparison = event.before
      if (!comparison || /^0+$/.test(comparison))
        return { selection: fullSelection('new push ref'), base: null, paths: [] }
      git(['merge-base', '--is-ancestor', comparison, head], { cwd })
    }
    const mergeBase = git(['merge-base', comparison, head], { cwd })
    const paths = collectChanges({ cwd, base: mergeBase, head, workingTree })
    return {
      selection: eventName
        ? selectionForEvent(eventName, event, paths, true)
        : classifyChanges(paths),
      base: mergeBase,
      paths
    }
  } catch {
    return {
      selection: fullSelection('comparison base unavailable; all lanes required'),
      base: null,
      paths: []
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      'github-output': { type: 'boolean' },
      'working-tree': { type: 'boolean' }
    }
  })
  const eventName = process.env.GITHUB_EVENT_NAME
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    : {}
  const result = resolveChanges({
    base:
      values.base ??
      (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main'),
    head: values.head ?? 'HEAD',
    workingTree: values['working-tree'],
    eventName,
    event
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (values['github-output']) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      LANES.map((key) => `${key}=${result.selection[key]}\n`).join('')
    )
  }
}
