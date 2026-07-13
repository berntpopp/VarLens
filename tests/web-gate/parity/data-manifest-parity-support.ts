import { expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell,
  type LaunchElectronAppResult
} from '../../e2e/helpers/electron-app'
import { startWebDriver, type WebDriver } from '../helpers/web-driver'
import { callElectronApi, unwrapIpcResultForParity } from './electron-harness'

export const SHOULD_RUN =
  process.env.VARLENS_RUN_WEB_GATE_PARITY === '1' && process.env.VARLENS_RUN_WEB_PARITY_E2E === '1'
export const HAS_PG =
  typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''
export const ELECTRON_BUILD = resolve(process.cwd(), 'out/main/index.js')
export const MANIFEST_PATH = resolve(process.cwd(), 'scripts/data-fixtures/sources.json')
const REPORT_DIR = resolve(
  process.cwd(),
  process.env.VARLENS_WEB_PARITY_REPORT_DIR ?? '.planning/artifacts/web/parity'
)
const SNAPSHOT_DIR = resolve(REPORT_DIR, 'snapshots')
export const SNAPSHOT_PATH = resolve(SNAPSHOT_DIR, 'data-manifest-parity.json')
export const REPORT_JSON_PATH = resolve(REPORT_DIR, 'latest.json')
const REPORT_MD_PATH = resolve(REPORT_DIR, 'latest.md')
export const UPDATE_FLAG = 'UPDATE_PARITY_ARTIFACTS'

interface ManifestFixture {
  id: string
  enabledByDefault?: boolean
  varlensTarget?: {
    importMode: string
    artifact?: string
    caseName?: string
    files?: Array<{
      filePath: string
      variantType: string
      caller: string | null
      annotationFormat: string | null
    }>
    options?: { selectedSample?: string; genomeBuild?: string }
  }
}

interface ImportEnvelope {
  caseId: number
  variantCount: number
}

interface NormalizedVariant {
  chr: string
  pos: number
  ref: string
  alt: string
  variant_type: string | null
  gene_symbol: string | null
  consequence: string | null
  func: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt: string | null
  gq: number | null
  dp: number | null
  ad_ref: number | null
  ad_alt: number | null
  ab: number | null
}

export interface ScenarioSnapshot {
  id: string
  importMode: string
  cases: Array<{ name: string; variantCount: number; typeCounts: Record<string, number> }>
  variants: NormalizedVariant[]
  queries: {
    all: string[]
    highImpact: string[]
    clinvarPathogenic: string[]
  }
}

export interface ParitySnapshot {
  schemaVersion: 1
  generatedFrom: string
  scenarios: ScenarioSnapshot[]
}

interface ScenarioTask {
  id: string
  importMode: string
  run: (
    call: <T>(domain: string, method: string, args: unknown[]) => Promise<T>
  ) => Promise<ScenarioSnapshot>
}

interface ScenarioSideReport {
  completed: boolean
  resultHash: string | null
  caseCount: number
  totalVariants: number
  queryCounts: {
    all: number
    highImpact: number
    clinvarPathogenic: number
  }
  typeCounts: Record<string, number>
}

interface ScenarioRunReport {
  id: string
  importMode: string | null
  status: 'passed' | 'failed'
  startedAt: string
  finishedAt: string
  durationMs: number
  hashMatch: boolean | null
  desktop: ScenarioSideReport
  web: ScenarioSideReport
  error?: string
}

export interface ParityRunReport {
  schemaVersion: 1
  status: 'passed' | 'failed'
  generatedAt: string
  finishedAt: string | null
  durationMs: number | null
  gitSha: string | null
  manifestPath: string
  snapshotPath: string
  reportPath: string
  scenarioCount: number
  scenarios: ScenarioRunReport[]
}

export function loadManifest(): ManifestFixture[] {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    fixtures: ManifestFixture[]
  }
  return manifest.fixtures.filter(
    (fixture) =>
      fixture.enabledByDefault === true &&
      fixture.varlensTarget !== undefined &&
      fixture.varlensTarget.importMode !== 'bed-filter'
  )
}

function repoPath(path: string): string {
  return resolve(process.cwd(), path)
}

async function webCall<T>(
  driver: WebDriver,
  domain: string,
  method: string,
  args: unknown[]
): Promise<T> {
  const response = await driver.api(domain, method, ...args)
  expect(response.statusCode, response.body).toBe(200)
  if (response.body.trim() === '') return undefined as T
  return unwrapIpcResultForParity<T>(response.json())
}

function importResultToEnvelope(raw: unknown): ImportEnvelope {
  const result = raw as { caseId: number; variantCount?: number; totalVariants?: number }
  return {
    caseId: result.caseId,
    variantCount: result.variantCount ?? result.totalVariants ?? 0
  }
}

function normalizeRows(raw: unknown): NormalizedVariant[] {
  const obj = (raw ?? {}) as { data?: unknown[]; rows?: unknown[] }
  const rows = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.rows) ? obj.rows : []
  return rows
    .map((row) => {
      const value = row as Record<string, unknown>
      return {
        chr: typeof value.chr === 'string' ? value.chr : '',
        pos: typeof value.pos === 'number' ? value.pos : 0,
        ref: typeof value.ref === 'string' ? value.ref : '',
        alt: typeof value.alt === 'string' ? value.alt : '',
        variant_type: typeof value.variant_type === 'string' ? value.variant_type : null,
        gene_symbol: typeof value.gene_symbol === 'string' ? value.gene_symbol : null,
        consequence: typeof value.consequence === 'string' ? value.consequence : null,
        func: typeof value.func === 'string' ? value.func : null,
        gnomad_af: typeof value.gnomad_af === 'number' ? value.gnomad_af : null,
        cadd: typeof value.cadd === 'number' ? value.cadd : null,
        clinvar: typeof value.clinvar === 'string' ? value.clinvar : null,
        gt: typeof value.gt === 'string' ? value.gt : null,
        gq: typeof value.gq === 'number' ? value.gq : null,
        dp: typeof value.dp === 'number' ? value.dp : null,
        ad_ref: typeof value.ad_ref === 'number' ? value.ad_ref : null,
        ad_alt: typeof value.ad_alt === 'number' ? value.ad_alt : null,
        ab: typeof value.ab === 'number' ? Number(value.ab.toFixed(6)) : null
      }
    })
    .sort((a, b) => variantIdentity(a).localeCompare(variantIdentity(b)))
}

function variantIdentity(variant: Pick<NormalizedVariant, 'chr' | 'pos' | 'ref' | 'alt'>): string {
  return `${variant.chr}:${variant.pos}:${variant.ref}:${variant.alt}`
}

async function queryScenario(
  call: <T>(domain: string, method: string, args: unknown[]) => Promise<T>,
  scenarioId: string,
  importMode: string,
  caseName: string,
  envelope: ImportEnvelope
): Promise<ScenarioSnapshot> {
  const [all, highImpact, clinvarPathogenic, typeCounts] = await Promise.all([
    call<unknown>('variants', 'query', [envelope.caseId, {}, 0, 500]),
    call<unknown>('variants', 'query', [envelope.caseId, { consequences: ['HIGH'] }, 0, 500]),
    call<unknown>('variants', 'query', [envelope.caseId, { clinvars: ['Pathogenic'] }, 0, 500]),
    call<Record<string, number>>('variants', 'typeCounts', [envelope.caseId])
  ])

  const variants = normalizeRows(all)
  return {
    id: scenarioId,
    importMode,
    cases: [{ name: caseName, variantCount: envelope.variantCount, typeCounts }],
    variants,
    queries: {
      all: variants.map(variantIdentity),
      highImpact: normalizeRows(highImpact).map(variantIdentity),
      clinvarPathogenic: normalizeRows(clinvarPathogenic).map(variantIdentity)
    }
  }
}

async function runSingleImport(
  call: <T>(domain: string, method: string, args: unknown[]) => Promise<T>,
  fixture: ManifestFixture
): Promise<ScenarioSnapshot> {
  const target = fixture.varlensTarget!
  const artifact = repoPath(target.artifact!)
  const caseName = `${fixture.id}-case`
  const raw = await call<unknown>('import', 'start', [artifact, caseName, target.options])
  return await queryScenario(
    call,
    fixture.id,
    target.importMode,
    caseName,
    importResultToEnvelope(raw)
  )
}

async function runMultiFileImport(
  call: <T>(domain: string, method: string, args: unknown[]) => Promise<T>,
  fixture: ManifestFixture,
  bedFile?: string
): Promise<ScenarioSnapshot> {
  const target = fixture.varlensTarget!
  const caseName = bedFile === undefined ? `${fixture.id}-case` : `${fixture.id}-bed-case`
  const files = (target.files ?? []).map((file) => ({
    ...file,
    filePath: repoPath(file.filePath)
  }))
  const filters = bedFile === undefined ? undefined : { bedFile: repoPath(bedFile) }
  const raw = await call<unknown>('import', 'startMultiFile', [
    caseName,
    files,
    target.options,
    filters
  ])
  return await queryScenario(
    call,
    bedFile === undefined ? fixture.id : `${fixture.id}-bed-filter`,
    bedFile === undefined ? target.importMode : 'bed-filtered-multi-file',
    caseName,
    importResultToEnvelope(raw)
  )
}

async function runZipImport(
  call: <T>(domain: string, method: string, args: unknown[]) => Promise<T>,
  fixture: ManifestFixture
): Promise<ScenarioSnapshot> {
  const target = fixture.varlensTarget!
  const extracted = await call<{ files: string[]; errors: string[]; extractionId: string }>(
    'batch-import',
    'extractZip',
    [repoPath(target.artifact!)]
  )
  expect(extracted.errors).toEqual([])
  const cases: ScenarioSnapshot['cases'] = []
  const variants: NormalizedVariant[] = []

  try {
    for (const file of extracted.files.sort()) {
      const caseName = `${fixture.id}-${basename(file).replace(/[^a-zA-Z0-9]+/gu, '-')}`
      const raw = await call<unknown>('import', 'start', [file, caseName, undefined])
      const envelope = importResultToEnvelope(raw)
      const typeCounts = await call<Record<string, number>>('variants', 'typeCounts', [
        envelope.caseId
      ])
      const queryAll = await call<unknown>('variants', 'query', [envelope.caseId, {}, 0, 500])
      cases.push({ name: caseName, variantCount: envelope.variantCount, typeCounts })
      variants.push(...normalizeRows(queryAll))
    }
  } finally {
    await call<void>('batch-import', 'cleanupZipTemp', [extracted.extractionId])
  }

  variants.sort((a, b) => variantIdentity(a).localeCompare(variantIdentity(b)))
  return {
    id: fixture.id,
    importMode: 'zip',
    cases: cases.sort((a, b) => a.name.localeCompare(b.name)),
    variants,
    queries: {
      all: variants.map(variantIdentity),
      highImpact: variants.filter((variant) => variant.consequence === 'HIGH').map(variantIdentity),
      clinvarPathogenic: variants
        .filter((variant) => variant.clinvar === 'Pathogenic')
        .map(variantIdentity)
    }
  }
}

export function buildScenarioTasks(fixtures: ManifestFixture[]): ScenarioTask[] {
  const tasks: ScenarioTask[] = []

  for (const fixture of fixtures) {
    const mode = fixture.varlensTarget?.importMode
    if (mode === 'single-vcf' || mode === 'single-json') {
      tasks.push({
        id: fixture.id,
        importMode: mode,
        run: async (call) => await runSingleImport(call, fixture)
      })
      continue
    }
    if (mode === 'multi-file') {
      tasks.push({
        id: fixture.id,
        importMode: 'multi-file',
        run: async (call) => await runMultiFileImport(call, fixture)
      })
      tasks.push({
        id: `${fixture.id}-bed-filter`,
        importMode: 'bed-filtered-multi-file',
        run: async (call) =>
          await runMultiFileImport(
            call,
            fixture,
            'tests/.cache/public-data/generated/bed/test-regions.bed'
          )
      })
      continue
    }
    if (mode === 'zip') {
      tasks.push({
        id: fixture.id,
        importMode: 'zip',
        run: async (call) => await runZipImport(call, fixture)
      })
    }
  }

  return tasks
}

export function loadSnapshot(): ParitySnapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as ParitySnapshot
}

export function saveSnapshot(snapshot: ParitySnapshot): void {
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
}

export function getGitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    }).trim()
  } catch {
    return null
  }
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`
}

function resultHash(snapshot: ScenarioSnapshot | undefined): string | null {
  if (snapshot === undefined) return null
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex')
}

function summarizeScenarioSide(snapshot: ScenarioSnapshot | undefined): ScenarioSideReport {
  if (snapshot === undefined) {
    return {
      completed: false,
      resultHash: null,
      caseCount: 0,
      totalVariants: 0,
      queryCounts: { all: 0, highImpact: 0, clinvarPathogenic: 0 },
      typeCounts: {}
    }
  }

  const typeCounts: Record<string, number> = {}
  for (const entry of snapshot.cases) {
    for (const [type, count] of Object.entries(entry.typeCounts)) {
      typeCounts[type] = (typeCounts[type] ?? 0) + count
    }
  }

  return {
    completed: true,
    resultHash: resultHash(snapshot),
    caseCount: snapshot.cases.length,
    totalVariants: snapshot.cases.reduce((sum, entry) => sum + entry.variantCount, 0),
    queryCounts: {
      all: snapshot.queries.all.length,
      highImpact: snapshot.queries.highImpact.length,
      clinvarPathogenic: snapshot.queries.clinvarPathogenic.length
    },
    typeCounts
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function buildScenarioReport(
  task: ScenarioTask,
  status: 'passed' | 'failed',
  startedAt: Date,
  finishedAt: Date,
  desktop: ScenarioSnapshot | undefined,
  web: ScenarioSnapshot | undefined,
  error?: unknown
): ScenarioRunReport {
  const desktopReport = summarizeScenarioSide(desktop)
  const webReport = summarizeScenarioSide(web)
  return {
    id: task.id,
    importMode: desktop?.importMode ?? web?.importMode ?? task.importMode,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    hashMatch:
      desktopReport.resultHash === null || webReport.resultHash === null
        ? null
        : desktopReport.resultHash === webReport.resultHash,
    desktop: desktopReport,
    web: webReport,
    ...(error === undefined ? {} : { error: errorMessage(error) })
  }
}

export function writeReport(report: ParityRunReport): void {
  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8')
  writeFileSync(REPORT_MD_PATH, renderReportMarkdown(report), 'utf8')
}

function renderReportMarkdown(report: ParityRunReport): string {
  const shortHash = (hash: string | null): string => (hash === null ? 'n/a' : hash.slice(0, 12))
  const lines = [
    '# Web Parity E2E Report',
    '',
    `Status: ${report.status}`,
    `Generated: ${report.generatedAt}`,
    `Finished: ${report.finishedAt ?? 'not finished'}`,
    `Duration: ${report.durationMs ?? 0} ms`,
    `Git SHA: ${report.gitSha ?? 'unknown'}`,
    `Manifest: ${report.manifestPath}`,
    `Snapshot: ${report.snapshotPath}`,
    '',
    '| Scenario | Mode | Status | Desktop variants | Web variants | Result hash | Hash match | Queries | Duration ms |',
    '| --- | --- | --- | ---: | ---: | --- | --- | --- | ---: |'
  ]

  for (const scenario of report.scenarios) {
    lines.push(
      `| ${[
        scenario.id,
        scenario.importMode ?? '',
        scenario.status,
        String(scenario.desktop.totalVariants),
        String(scenario.web.totalVariants),
        shortHash(scenario.desktop.resultHash),
        scenario.hashMatch === null ? 'n/a' : scenario.hashMatch ? 'yes' : 'no',
        `all ${scenario.desktop.queryCounts.all}/${scenario.web.queryCounts.all}, high ${scenario.desktop.queryCounts.highImpact}/${scenario.web.queryCounts.highImpact}, clinvar ${scenario.desktop.queryCounts.clinvarPathogenic}/${scenario.web.queryCounts.clinvarPathogenic}`,
        String(scenario.durationMs)
      ].join(' | ')} |`
    )
  }

  const failures = report.scenarios.filter((scenario) => scenario.status === 'failed')
  if (failures.length > 0) {
    lines.push('', '## Failures', '')
    for (const failure of failures) {
      lines.push(`- ${failure.id}: ${failure.error ?? 'unknown error'}`)
    }
  }

  return `${lines.join('\n')}\n`
}

export async function runTaskOnElectron(task: ScenarioTask): Promise<ScenarioSnapshot> {
  let session: LaunchElectronAppResult | undefined
  try {
    session = await launchElectronApp({ hideWindow: true })
    await waitForAppShell(session.window)
    await dismissDisclaimerIfPresent(session.window)
    return await task.run((domain, method, args) => callElectronApi(session!, domain, method, args))
  } finally {
    await session?.cleanup()
  }
}

export async function runTaskOnWeb(task: ScenarioTask): Promise<ScenarioSnapshot> {
  let driver: WebDriver | undefined
  try {
    driver = await startWebDriver()
    return await task.run((domain, method, args) => webCall(driver!, domain, method, args))
  } finally {
    await driver?.close()
  }
}
