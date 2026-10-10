#!/usr/bin/env node
/**
 * Renderer parity gate (spec §6 layer 3), run by `make agent-check`.
 *
 * Every renderer call of a `desktop-only` or `pending` window.api method (per
 * src/shared/ipc/parity-manifest.ts) must sit in a file that reads the
 * method's capability feature through the capability store, e.g.
 *
 *     if (!canUse('hpoSearch')) return            // capabilityStore
 *     requireCapability('localDatabaseFiles')       // store actions
 *     runtimeFeatureUnavailableReason('hpoSearch')  // utils/runtime-features
 *
 * Call sites are matched as `.<domain>.<method>` member accesses (any
 * receiver: window.api, api, getApi(), …). The manifest is read from its
 * TypeScript sources with the TypeScript compiler API, so this script has no
 * build step. Usage: node scripts/parity/check-renderer-gates.mjs [--json]
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANIFEST_DIR = join(ROOT, 'src/shared/ipc/parity-manifest')
const MANIFEST_INDEX = join(ROOT, 'src/shared/ipc/parity-manifest.ts')
const RENDERER_DIR = join(ROOT, 'src/renderer/src')
const IGNORED_DIRS = new Set(['mocks'])
const GATE_FUNCTIONS = [
  'canUse',
  'requireCapability',
  'capabilityReason',
  'isRuntimeFeatureAvailable',
  'runtimeFeatureUnavailableReason'
]

/** Read `<slice>Manifest = { method: ctor('feature', …) }` objects from one file. */
function readSlices(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
  const slices = new Map()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      let init = decl.initializer
      while (init && (ts.isSatisfiesExpression(init) || ts.isAsExpression(init))) {
        init = init.expression
      }
      if (!init || !ts.isObjectLiteralExpression(init) || !ts.isIdentifier(decl.name)) continue
      const methods = new Map()
      for (const prop of init.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isCallExpression(prop.initializer)) continue
        const call = prop.initializer
        const ctor = call.expression.getText(source)
        const first = call.arguments[0]
        const feature = first && ts.isStringLiteral(first) ? first.text : undefined
        methods.set(prop.name.getText(source), { ctor, feature })
      }
      slices.set(decl.name.text, methods)
    }
  }
  return slices
}

/** Map window.api domain → slice name from the PARITY_MANIFEST literal. */
function readDomainSlices() {
  const text = readFileSync(MANIFEST_INDEX, 'utf8')
  const block = text.slice(text.indexOf('export const PARITY_MANIFEST = {'))
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('} as const'))
  const pairs = [...body.matchAll(/(\w+):\s*(\w+)/g)].map((m) => [m[1], m[2]])
  return new Map(pairs)
}

export function loadGatedMethods() {
  const slices = new Map()
  for (const file of readdirSync(MANIFEST_DIR)) {
    if (file.endsWith('.ts')) {
      for (const [name, methods] of readSlices(join(MANIFEST_DIR, file))) slices.set(name, methods)
    }
  }
  const gated = []
  for (const [domain, sliceName] of readDomainSlices()) {
    const methods = slices.get(sliceName)
    if (methods === undefined) throw new Error(`manifest slice not found: ${sliceName}`)
    for (const [method, { ctor, feature }] of methods) {
      if (ctor === 'desktopOnly' || ctor === 'pending') {
        if (feature === undefined) throw new Error(`${domain}.${method}: no capability feature`)
        gated.push({ domain, method, policy: ctor, feature })
      }
    }
  }
  return gated
}

function listRendererFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return IGNORED_DIRS.has(entry) ? [] : listRendererFiles(path)
    return /\.(ts|vue)$/.test(entry) ? [path] : []
  })
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findUngatedCalls() {
  const gated = loadGatedMethods()
  const files = listRendererFiles(RENDERER_DIR).map((path) => ({
    path: relative(ROOT, path).split(sep).join('/'),
    text: readFileSync(path, 'utf8')
  }))
  const violations = []
  for (const { domain, method, policy, feature } of gated) {
    const call = new RegExp(`\\.${escape(domain)}\\??\\.${escape(method)}\\b`)
    const gate = new RegExp(`\\b(?:${GATE_FUNCTIONS.join('|')})\\(\\s*'${escape(feature)}'`)
    for (const { path, text } of files) {
      if (call.test(text) && !gate.test(text)) {
        violations.push({ file: path, method: `${domain}.${method}`, policy, feature })
      }
    }
  }
  return { gatedMethodCount: gated.length, violations }
}

function main() {
  const { gatedMethodCount, violations } = findUngatedCalls()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ gatedMethodCount, violations }, null, 2))
  }
  if (violations.length > 0) {
    console.error('Renderer parity gate: ungated desktop-only / pending calls')
    for (const v of violations) {
      console.error(`  ${v.file}: ${v.method} (${v.policy}) needs canUse('${v.feature}')`)
    }
    process.exit(1)
  }
  console.log(`Renderer parity gate OK (${gatedMethodCount} desktop-only/pending methods checked)`)
}

const isMain =
  process.argv[1] &&
  (() => {
    try {
      return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    } catch {
      return false
    }
  })()
if (isMain) main()
