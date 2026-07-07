import { describe, expect, test } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { resolve } from 'path'
import { Project, SyntaxKind } from 'ts-morph'

/**
 * Handler-seam gate.
 *
 * The web dispatcher is split into per-domain route override modules.
 * This gate keeps those modules wired through dispatcher.ts and prevents
 * route handlers from reaching around storage executors into Postgres.
 *
 * Intentionally-flat handlers (no domain-module pattern) are excluded
 * per AGENTS.md: shell, shortlist, system, updater.
 */

const SHARED_DIR = 'src/shared/ipc/domains'
const PRELOAD_DIR = 'src/preload/domains'
const MAIN_DIR = 'src/main/ipc/domains'
const DISPATCHER_PATH = 'src/web/server/dispatcher.ts'
const TASK_TYPES_PATH = 'src/web/server/task-types.ts'
const WEB_ROUTES_DIR = 'src/web/server/routes'

const FLAT_HANDLERS = new Set(['shell', 'shortlist', 'system', 'updater'])
const SHARED_DOMAIN_HELPERS = new Set(['batch-import-schemas', 'import-schemas', 'jobs-schemas'])
const ROUTE_OVERRIDE_LOGIC_EXCEPTIONS: Record<string, string> = {
  'analysis-groups.ts': 'thin storage-executor adapters with web-only argument validation',
  'audit-log.ts': 'admin-gated audit-trail read adapters over the storage read executor',
  'auth.ts': 'web-only session cookie/auth boundary backed by PostgresWebAuthService',
  'batch-import.ts':
    'web upload/job-runner pipeline with file-picker stubs replacing desktop dialogs',
  'case-metadata.ts': 'thin storage-executor adapters with web-only argument validation',
  'cases.ts': 'simple cases:list storage read adapter',
  'database.ts': 'web-only database identity/capability adapters',
  'gene-lists.ts': 'thin storage-executor adapters with web-only argument validation',
  'gene-ref.ts': 'web mode intentionally disables external reference fetches',
  'hpo.ts': 'web mode intentionally disables external reference fetches',
  'import.ts': 'web upload pipeline with file-picker stubs and shared import-logic delegation',
  'protein.ts': 'web mode intentionally disables external reference fetches',
  'region-files.ts': 'web-only server-path guards and storage-executor adapters',
  'vep.ts': 'web mode intentionally disables external reference fetches'
}

/**
 * Domains whose web overrides have not yet been collapsed onto a shared
 * session-based <domain>-logic function. MONOTONIC-DECREASE ONLY — remove
 * an entry when the domain's overrides all pass the per-key seam check.
 * do not add.
 */
const PENDING_SHARED_LOGIC_EXTRACTION = new Set<string>([])

const EXPECTED_ROUTE_OVERRIDE_MODULES = new Set([
  'analysis-groups.ts',
  'annotations.ts',
  'audit-log.ts',
  'auth.ts',
  'batch-import.ts',
  'case-metadata.ts',
  'cases.ts',
  'cohort.ts',
  'database.ts',
  'export.ts',
  'gene-lists.ts',
  'gene-ref.ts',
  'hpo.ts',
  'import.ts',
  'panels.ts',
  'protein.ts',
  'region-files.ts',
  'transcripts.ts',
  'variants.ts',
  'vep.ts'
])

// ---------------------------------------------------------------------------
// Per-override-key seam analyzer (ts-morph)
// ---------------------------------------------------------------------------

type KeyVerdict = 'passthrough' | 'shared-logic' | 'unsupported' | 'inline'

/**
 * Returns the set of function names imported from any `handlers/<x>-logic`
 * module in the given source file.
 */
function collectLogicImportNames(sf: ReturnType<Project['addSourceFileAtPath']>): Set<string> {
  const names = new Set<string>()
  for (const decl of sf.getImportDeclarations()) {
    if (!/handlers\/[A-Za-z0-9-]+-logic/.test(decl.getModuleSpecifierValue())) continue
    for (const named of decl.getNamedImports()) names.add(named.getName())
  }
  return names
}

/**
 * Returns true when the property AST subtree contains a direct call to one
 * of the supplied logic function names.
 */
function propCallsLogicFn(prop: import('ts-morph').Node, logicNames: Set<string>): boolean {
  if (logicNames.size === 0) return false
  return prop.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const expr = call.getExpression()
    return expr.getKind() === SyntaxKind.Identifier && logicNames.has(expr.getText())
  })
}

/** True when the override body calls `unsupportedWebCapability(...)` — a web-disabled method. */
function propCallsUnsupported(prop: import('ts-morph').Node): boolean {
  return prop.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const expr = call.getExpression()
    return expr.getKind() === SyntaxKind.Identifier && expr.getText() === 'unsupportedWebCapability'
  })
}

/**
 * For every override key in the named `build<X>Overrides` function of the
 * given route file, returns a verdict:
 *   'passthrough'   — exactly one executor.execute() call whose `type` matches the key
 *   'shared-logic'  — at least one call to a function imported from a *-logic module
 *   'unsupported'   — calls unsupportedWebCapability() (web-disabled method), no real work
 *   'inline'        — anything else (multi-call, type-mismatch, inline event logic, etc.)
 */
function analyzeOverrideKeys(routePath: string): Record<string, KeyVerdict> {
  const project = new Project({
    tsConfigFilePath: resolve(process.cwd(), 'tsconfig.node.json'),
    skipAddingFilesFromTsConfig: false
  })
  const sf = project.addSourceFileAtPath(resolve(process.cwd(), routePath))
  const logicNames = collectLogicImportNames(sf)
  const verdicts: Record<string, KeyVerdict> = {}

  // Find the buildXxxOverrides function
  const builder = sf
    .getFunctions()
    .find((fn) => /^build[A-Za-z]+Overrides$/.test(fn.getName() ?? ''))
  if (!builder) return verdicts

  // The first object literal expression in the function body is the returned
  // map of override handlers.
  const ret = builder.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)[0]
  if (!ret) return verdicts

  for (const prop of ret.getProperties()) {
    // The property key is either a StringLiteral (`'transcripts:list'`) or an
    // Identifier — grab it from the first child token.
    const keyNode = prop.getChildAtIndex(0)
    const key = keyNode.getText().replace(/^['"`]|['"`]$/g, '')
    const propText = prop.getText()

    // Count executor `.execute(` calls
    const execCalls = (propText.match(/get(?:Read|Write)Executor\(\)\s*\.execute\(/g) ?? []).length

    // Check that the single execute call passes `type: '<key>'`
    const callsTypeKey = propText.includes(`type: '${key}'`) || propText.includes(`type: "${key}"`)

    if (propCallsLogicFn(prop, logicNames)) {
      verdicts[key] = 'shared-logic'
    } else if (execCalls === 1 && callsTypeKey) {
      verdicts[key] = 'passthrough'
    } else if (execCalls === 0 && propCallsUnsupported(prop)) {
      // Genuinely web-disabled: 501s with no executor work. Requiring zero
      // execute() calls keeps a key that does real (multi-call) orchestration
      // from hiding behind a stray unsupportedWebCapability() call.
      verdicts[key] = 'unsupported'
    } else {
      verdicts[key] = 'inline'
    }
  }

  return verdicts
}

// ---------------------------------------------------------------------------

function listDomains(dir: string): string[] {
  const abs = resolve(process.cwd(), dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .filter((f) => statSync(resolve(abs, f)).isFile())
    .map((f) => f.replace(/\.ts$/, ''))
    .filter((domain) => !SHARED_DOMAIN_HELPERS.has(domain))
    .sort()
}

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function getRouteOverrideBuildFunction(source: string): string | undefined {
  return source.match(/export function (build[A-Za-z]+Overrides)\(/)?.[1]
}

function listRouteOverrideModules(): string[] {
  const routeDir = resolve(process.cwd(), WEB_ROUTES_DIR)
  return readdirSync(routeDir)
    .filter((name) => name.endsWith('.ts'))
    .filter((file) => {
      const routePath = `${WEB_ROUTES_DIR}/${file}`
      return getRouteOverrideBuildFunction(readRepoFile(routePath)) !== undefined
    })
    .sort()
}

describe('handler-seam gate', () => {
  test('every shared IPC domain has a preload binding and a main handler', () => {
    const shared = listDomains(SHARED_DIR)
    const preload = new Set(listDomains(PRELOAD_DIR))
    const main = new Set(listDomains(MAIN_DIR))

    expect(shared.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const domain of shared) {
      if (!preload.has(domain)) missing.push(`${PRELOAD_DIR}/${domain}.ts (missing)`)
      if (!main.has(domain)) missing.push(`${MAIN_DIR}/${domain}.ts (missing)`)
    }

    expect(missing, missing.join('\n')).toEqual([])
  })

  test('preload domain set matches shared domain set (no orphans)', () => {
    const shared = new Set(listDomains(SHARED_DIR))
    const preload = listDomains(PRELOAD_DIR)
    const orphans = preload.filter((d) => !shared.has(d))
    expect(orphans, `preload binding without shared contract: ${orphans.join(', ')}`).toEqual([])
  })

  test('main domain set matches shared domain set (no orphans)', () => {
    const shared = new Set(listDomains(SHARED_DIR))
    const main = listDomains(MAIN_DIR)
    const orphans = main.filter((d) => !shared.has(d))
    expect(orphans, `main domain without shared contract: ${orphans.join(', ')}`).toEqual([])
  })

  test('the web dispatcher and its task-type allowlist exist', () => {
    const dispatcher = resolve(process.cwd(), DISPATCHER_PATH)
    const taskTypes = resolve(process.cwd(), TASK_TYPES_PATH)
    const missing: string[] = []
    if (!existsSync(dispatcher)) missing.push(DISPATCHER_PATH)
    if (!existsSync(taskTypes)) missing.push(TASK_TYPES_PATH)
    expect(missing, missing.join('\n')).toEqual([])
  })

  test('web route override module set is explicitly audited', () => {
    const discovered = listRouteOverrideModules()
    const expected = [...EXPECTED_ROUTE_OVERRIDE_MODULES].sort()

    expect(discovered, 'new route override modules require an explicit seam review').toEqual(
      expected
    )
  })

  test('web route override modules are imported by the dispatcher', () => {
    const dispatcherSource = readRepoFile(DISPATCHER_PATH)
    const missing: string[] = []

    for (const file of listRouteOverrideModules()) {
      const routePath = `${WEB_ROUTES_DIR}/${file}`
      const source = readRepoFile(routePath)
      const buildFunction = getRouteOverrideBuildFunction(source)
      if (buildFunction === undefined) throw new Error(`${routePath} missing override builder`)

      const routeName = file.replace(/\.ts$/, '')
      if (!dispatcherSource.includes(`from './routes/${routeName}'`)) {
        missing.push(`${routePath} import`)
      }
      if (!dispatcherSource.includes(`${buildFunction}()`)) {
        missing.push(`${routePath} ${buildFunction}()`)
      }
    }

    expect(missing, missing.join('\n')).toEqual([])
  })

  test('web route override modules do not access Postgres directly', () => {
    const routeDir = resolve(process.cwd(), WEB_ROUTES_DIR)
    const offenders: string[] = []
    const forbidden = [
      /'pg'/,
      /"pg"/,
      /getPool\s*\(/,
      /pool\.query/,
      /pool\.connect/,
      /quoteIdentifier/
    ]

    for (const file of readdirSync(routeDir)
      .filter((name) => name.endsWith('.ts'))
      .sort()) {
      const routePath = `${WEB_ROUTES_DIR}/${file}`
      const source = readRepoFile(routePath)
      if (forbidden.some((pattern) => pattern.test(source))) offenders.push(routePath)
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  test('every override key of a migrated domain is pass-through or calls shared logic', () => {
    const offenders: string[] = []

    for (const file of listRouteOverrideModules()) {
      if (PENDING_SHARED_LOGIC_EXTRACTION.has(file)) continue
      if (ROUTE_OVERRIDE_LOGIC_EXCEPTIONS[file] !== undefined) continue

      const verdicts = analyzeOverrideKeys(`${WEB_ROUTES_DIR}/${file}`)
      for (const [key, verdict] of Object.entries(verdicts)) {
        if (verdict === 'inline') {
          offenders.push(`${file} → ${key} (inline orchestration; extract to <domain>-logic)`)
        }
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  test('PENDING_SHARED_LOGIC_EXTRACTION only shrinks (max 6, all known)', () => {
    const known = new Set([
      'transcripts.ts',
      'panels.ts',
      'annotations.ts',
      'variants.ts',
      'cohort.ts',
      'export.ts'
    ])
    expect(PENDING_SHARED_LOGIC_EXTRACTION.size).toBeLessThanOrEqual(6)
    for (const entry of PENDING_SHARED_LOGIC_EXTRACTION) {
      expect(known.has(entry), `unknown pending domain: ${entry}`).toBe(true)
    }
  })

  test('PENDING_SHARED_LOGIC_EXTRACTION is empty — all six domains migrated', () => {
    // Strict transport seam: every target domain (transcripts, panels,
    // annotations, variants, cohort, export) now routes its web overrides
    // through shared <domain>-logic (or an audited unsupported/pass-through
    // verdict). No domain may re-introduce inline orchestration without the
    // per-key gate above failing.
    expect([...PENDING_SHARED_LOGIC_EXTRACTION]).toEqual([])
  })
})

export { FLAT_HANDLERS }
