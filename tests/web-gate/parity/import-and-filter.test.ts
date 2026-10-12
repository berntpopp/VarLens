import { afterAll, describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import {
  launchElectronApp,
  waitForAppShell,
  dismissDisclaimerIfPresent,
  type LaunchElectronAppResult
} from '../../e2e/helpers/electron-app'
import { startWebDriver } from '../helpers/web-driver'
import { callElectronApi } from './electron-harness'

/**
 * Phase 1 gate — Layer 3 parity scenario #1.
 *
 * The plan calls for "import a VCF, run 3 filter queries, assert identical
 * results across both backends." This file ships:
 *
 *   1. A harness smoke (cases.list on a fresh app) that pins the IPC stack.
 *   2. The full VCF-import scenario: import a small synthetic VCF and run
 *      three domain-meaningful filter queries through `window.api`. Counts
 *      are normalized and written under `.planning/artifacts/web/parity/`
 *      so the web
 *      transport can later be asserted against the same baseline.
 *
 * When the third parity scenario lands, this is the trigger to extract
 * the `BackendDriver` abstraction (see `.planning/web/completed/testing/desktop-to-web-parity.md`
 * rule of three).
 *
 * Skipped if `out/main/index.js` is missing — run `make build` first.
 */

const ELECTRON_BUILD = resolve(process.cwd(), 'out/main/index.js')
const isElectronBuilt = existsSync(ELECTRON_BUILD)
const WEB_BUILD = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

const VCF_FIXTURE = resolve(process.cwd(), 'tests/test-data/vcf/synthetic-unit-test.vcf')

const SNAPSHOT_DIR = resolve(process.cwd(), '.planning/artifacts/web/parity/snapshots')
const SNAPSHOT_PATH = resolve(SNAPSHOT_DIR, 'import-and-filter-vcf.json')

/**
 * Parity tests are **opt-in**, mirroring the `perf` project's convention.
 * Desktop-only contributors never run them by default — the gate is for
 * validating the desktop↔web migration path, not for desktop CI.
 *
 * Enable with `VARLENS_RUN_WEB_GATE_PARITY=1` (the `make web-gate-parity`
 * target sets this automatically). Without the env var the entire
 * describe block skips, even if `out/main/index.js` exists.
 */
const SHOULD_RUN_PARITY = process.env.VARLENS_RUN_WEB_GATE_PARITY === '1'

const UPDATE_FLAG = 'UPDATE_PARITY_ARTIFACTS'

interface NormalizedCases {
  count: number
  ids: string[] // case names sorted lexicographically — stable across runs
}

interface NormalizedVariantQuery {
  total: number
  // Stable identity tuples for the first N rows in the page, sorted.
  // We don't snapshot mutable fields like id / created_at / imported_at.
  rows: Array<{ chr: string; pos: number; ref: string; alt: string }>
}

interface ImportAndFilterSnapshot {
  schemaVersion: 1
  fixture: string
  variantCount: number
  filters: {
    all: NormalizedVariantQuery
    chr22: NormalizedVariantQuery
    high_impact: NormalizedVariantQuery
  }
}

async function runScenarioOnElectron(): Promise<NormalizedCases> {
  let session: LaunchElectronAppResult | undefined
  try {
    session = await launchElectronApp({ hideWindow: true })
    await waitForAppShell(session.window)
    await dismissDisclaimerIfPresent(session.window)

    // Drive through the full preload -> IPC -> main -> DB stack.
    const result = await callElectronApi<unknown>(session, 'cases', 'list')

    return normalizeCasesResult(result)
  } finally {
    await session?.cleanup()
  }
}

interface ImportAndFilterRaw {
  caseId: number
  variantCount: number
  all: unknown
  chr22: unknown
  high_impact: unknown
}

async function runImportScenarioOnElectron(vcfPath: string): Promise<ImportAndFilterRaw> {
  let session: LaunchElectronAppResult | undefined
  try {
    session = await launchElectronApp({ hideWindow: true })
    await waitForAppShell(session.window)
    await dismissDisclaimerIfPresent(session.window)

    // The preload `import.start` returns a Promise that resolves with the
    // ImportResult once the worker finishes. Progress events exist via
    // `window.api.import.onProgress` but are not required for completion.
    const importResult = await callElectronApi<{
      caseId: number
      variantCount?: number
      totalVariants?: number
    }>(session, 'import', 'start', [vcfPath, 'parity-test-case', { genomeBuild: 'GRCh38' }])
    const caseId = importResult.caseId

    const [queryAll, queryChr22, queryHighImpact] = await Promise.all([
      callElectronApi<{ rows?: unknown[]; total?: number }>(session, 'variants', 'query', [
        caseId,
        {},
        0,
        200
      ]),
      callElectronApi<{ rows?: unknown[]; total?: number }>(session, 'variants', 'query', [
        caseId,
        { chr: 'chr22' },
        0,
        200
      ]),
      callElectronApi<{ rows?: unknown[]; total?: number }>(session, 'variants', 'query', [
        caseId,
        { consequences: ['HIGH'] },
        0,
        200
      ])
    ])

    return {
      caseId,
      variantCount: importResult.variantCount ?? importResult.totalVariants ?? 0,
      all: queryAll,
      chr22: queryChr22,
      high_impact: queryHighImpact
    }
  } finally {
    await session?.cleanup()
  }
}

function normalizeCasesResult(raw: unknown): NormalizedCases {
  // The renderer returns the unwrapped array per the IpcResult contract.
  const arr = Array.isArray(raw) ? raw : []
  const names = arr
    .map((c) => (typeof c === 'object' && c !== null ? (c as { name?: string }).name : ''))
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .sort()
  return { count: arr.length, ids: names }
}

function normalizeVariantQuery(raw: unknown): NormalizedVariantQuery {
  // PaginatedResult<Variant> uses { data, total_count }. Older / web shapes
  // may use { rows, total } — accept both so the same normalizer works
  // across transports.
  const obj = (raw && typeof raw === 'object' ? raw : {}) as {
    data?: unknown[]
    total_count?: number
    rows?: unknown[]
    total?: number
  }
  const rows = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.rows) ? obj.rows : []
  // Snapshot only stable identity fields: chr/pos/ref/alt. Drop volatile
  // columns like id, created_at, imported_at, info_json (annotation order).
  const projected = rows
    .map((r) => {
      const v = r as { chr?: unknown; pos?: unknown; ref?: unknown; alt?: unknown }
      return {
        chr: typeof v.chr === 'string' ? v.chr : '',
        pos: typeof v.pos === 'number' ? v.pos : 0,
        ref: typeof v.ref === 'string' ? v.ref : '',
        alt: typeof v.alt === 'string' ? v.alt : ''
      }
    })
    .sort((a, b) => {
      if (a.chr !== b.chr) return a.chr < b.chr ? -1 : 1
      if (a.pos !== b.pos) return a.pos - b.pos
      if (a.ref !== b.ref) return a.ref < b.ref ? -1 : 1
      return a.alt < b.alt ? -1 : a.alt > b.alt ? 1 : 0
    })
  const total =
    typeof obj.total_count === 'number'
      ? obj.total_count
      : typeof obj.total === 'number'
        ? obj.total
        : projected.length
  return { total, rows: projected }
}

function loadSnapshot(): ImportAndFilterSnapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as ImportAndFilterSnapshot
}

function saveSnapshot(snap: ImportAndFilterSnapshot): void {
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n', 'utf8')
}

function buildSnapshot(raw: ImportAndFilterRaw): ImportAndFilterSnapshot {
  return {
    schemaVersion: 1,
    fixture: 'tests/test-data/vcf/synthetic-unit-test.vcf',
    variantCount: raw.variantCount,
    filters: {
      all: normalizeVariantQuery(raw.all),
      chr22: normalizeVariantQuery(raw.chr22),
      high_impact: normalizeVariantQuery(raw.high_impact)
    }
  }
}

describe.skipIf(!SHOULD_RUN_PARITY || !isElectronBuilt)('parity: cases.list on a fresh app', () => {
  // Cache the Electron-side result across both assertion blocks so we
  // don't pay the boot cost twice.
  let electronResult: NormalizedCases | undefined

  test('Electron path: cases.list returns a normalizable empty list on fresh userData', async () => {
    electronResult = await runScenarioOnElectron()
    expect(electronResult.count).toBe(0)
    expect(electronResult.ids).toEqual([])
  })

  test.skipIf(!isWebBuilt || !HAS_PG)(
    'Web path: cases.list returns identical normalized result',
    async () => {
      const driver = await startWebDriver()
      try {
        const res = await driver.api('cases', 'list')
        expect(res.statusCode).toBe(200)
        const webResult = normalizeCasesResult(res.json())
        expect(webResult).toEqual(electronResult ?? { count: 0, ids: [] })
      } finally {
        await driver.close()
      }
    }
  )

  afterAll(() => {
    // Electron sessions clean themselves up via launchElectronApp's
    // cleanup() return; nothing else to do here. This hook exists so
    // future scenarios can attach shared tear-down without restructuring.
  })
})

async function runImportScenarioOnWeb(vcfPath: string): Promise<ImportAndFilterRaw> {
  const driver = await startWebDriver()
  try {
    const importRes = await driver.api('import', 'start', vcfPath, 'parity-test-case', {
      genomeBuild: 'GRCh38'
    })
    expect(importRes.statusCode).toBe(200)
    const importResult = importRes.json() as { caseId: number; variantCount: number }
    const caseId = importResult.caseId

    const queryAll = await driver.api('variants', 'query', caseId, {}, 0, 200)
    expect(queryAll.statusCode).toBe(200)

    const queryChr22 = await driver.api('variants', 'query', caseId, { chr: 'chr22' }, 0, 200)
    expect(queryChr22.statusCode).toBe(200)

    const queryHighImpact = await driver.api(
      'variants',
      'query',
      caseId,
      { consequences: ['HIGH'] },
      0,
      200
    )
    expect(queryHighImpact.statusCode).toBe(200)

    return {
      caseId,
      variantCount: importResult.variantCount,
      all: queryAll.json(),
      chr22: queryChr22.json(),
      high_impact: queryHighImpact.json()
    }
  } finally {
    await driver.close()
  }
}

describe.skipIf(!SHOULD_RUN_PARITY || !isElectronBuilt)(
  'parity: VCF import + 3 filter queries',
  () => {
    let electronSnapshot: ImportAndFilterSnapshot | undefined

    test('fixture exists', () => {
      expect(existsSync(VCF_FIXTURE)).toBe(true)
    })

    test('Electron path: imports VCF, runs 3 filter queries, matches snapshot', async () => {
      const raw = await runImportScenarioOnElectron(VCF_FIXTURE)
      electronSnapshot = buildSnapshot(raw)

      // Sanity: the fixture is non-empty and the unfiltered query returned
      // something. We don't pin an exact count here — that's the snapshot's
      // job — but a count of zero would mean import silently failed and
      // the snapshot would still pass on regenerate. Guard against that.
      expect(electronSnapshot.variantCount).toBeGreaterThan(0)
      expect(electronSnapshot.filters.all.total).toBeGreaterThan(0)

      const update = process.env[UPDATE_FLAG] === '1'
      const existing = loadSnapshot()
      if (update || existing === null) {
        saveSnapshot(electronSnapshot)
        return
      }

      expect(electronSnapshot, driftMessage()).toEqual(existing)
    })

    test.skipIf(!isWebBuilt || !HAS_PG)(
      'Web path: VCF import + filters match Electron snapshot',
      async () => {
        const existing = loadSnapshot()
        const baseline = electronSnapshot ?? existing
        expect(baseline, 'Run the Electron half first to seed the snapshot.').not.toBeNull()
        const raw = await runImportScenarioOnWeb(VCF_FIXTURE)
        const webSnapshot = buildSnapshot(raw)
        expect(webSnapshot).toEqual(baseline)
      }
    )
  }
)

function driftMessage(): string {
  return (
    `Parity snapshot drift at ${SNAPSHOT_PATH}.\n` +
    `If the change is intentional: review the diff carefully, then run\n` +
    `  ${UPDATE_FLAG}=1 VARLENS_RUN_WEB_GATE_PARITY=1 npx vitest run --project web-gate-parity tests/web-gate/parity/import-and-filter.test.ts\n` +
    `and review the regenerated artifact under .planning/artifacts/web/parity/.\n` +
    `If unintended: investigate before updating.`
  )
}

describe.skipIf(SHOULD_RUN_PARITY && isElectronBuilt)('parity skipped notice', () => {
  test('parity is opt-in (set VARLENS_RUN_WEB_GATE_PARITY=1) and requires a build', () => {
    // Sentinel — succeeds whenever parity didn't run, so `make web-gate-
    // parity` produces a clear pass even on platforms without an Electron
    // build. The "real" parity assertion lives in the gated describe above.
    expect(SHOULD_RUN_PARITY ? isElectronBuilt : true).toBe(true)
  })
})
