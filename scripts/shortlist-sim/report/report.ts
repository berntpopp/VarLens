// Simulation report: run directory (results.jsonl + manifest.json) → report.md, SVGs, metrics.json.
// Usage: npx jiti scripts/shortlist-sim/report/report.ts --run <name|latest> [--runs-dir <dir>] [--out <dir>]
//        [--cadd-off <run>] [--notes <findings.md>]
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import type { CaseResult, RunManifest } from '../common/types'
import { analyze, type ReportData } from './analysis'
import {
  ablationSection,
  concordanceSection,
  decoySection,
  funnelSection,
  pointsSection,
  primarySection,
  provenanceSection,
  scenarioSection,
  sensitivitySection,
  strataSection,
  verdictSection
} from './markdown'
import { hitBarsSvg, rankCdfSvg } from './svg'
import { caddCheckSection } from './cadd-check'
import { caddOffSection, macroSensitivitySection } from './extra'
import { DEFAULT_REPS } from '../stats/bootstrap'

const DEFAULT_RUNS_DIR = '/home/bernt-popp/development/VarLens-wt/_data/shortlist-sim/runs'

export function readResults(file: string): CaseResult[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((line, i) => {
      const r = JSON.parse(line) as CaseResult
      if (typeof r.scorer !== 'string' || typeof r.gene !== 'string' || !Array.isArray(r.alleles)) {
        throw new Error(`${file}:${i + 1}: not a CaseResult`)
      }
      return r
    })
}

export function renderMarkdown(data: ReportData, m: RunManifest, afterVerdict = ''): string {
  const header = [
    `# Evidence shortlist simulation — ${m.run}`,
    `Created ${m.createdAt}${m.quick ? ' · **quick run (not for decisions)**' : ''}. Reference scorer \`${m.scorers.reference}\`, candidate \`${m.scorers.candidate}\`. All numbers are aggregates over simulated cases; no background row is reported.`
  ].join('\n\n')
  return (
    [
      header,
      verdictSection(data),
      ...(afterVerdict ? [afterVerdict] : []),
      primarySection(data, m.scorers.reference),
      strataSection(data),
      scenarioSection(data),
      decoySection(data, m.scorers.reference),
      sensitivitySection(data),
      pointsSection(m),
      ablationSection(data),
      funnelSection(m),
      concordanceSection(m),
      provenanceSection(m)
    ].join('\n\n') + '\n'
  )
}

export interface ReportExtras {
  /** Run directory of the CADD-imputation-off sensitivity rerun. */
  caddOffDir?: string
  /** Hand-written findings, run history and data-protection notes (markdown). */
  notesFile?: string
}

export function renderReport(
  runDir: string,
  outDir: string,
  extras: ReportExtras = {}
): ReportData {
  const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8')) as RunManifest
  const results = readResults(join(runDir, 'results.jsonl'))
  const data = analyze(results, manifest)
  mkdirSync(outDir, { recursive: true })
  const cadd = caddCheckSection(
    results,
    manifest,
    manifest.bootstrapReps || DEFAULT_REPS,
    manifest.seeds.bootstrap ?? 1
  )
  // Spec §15: the ship rule is evaluated for the fully pre-registered hand-set points too;
  // the tuned preset ships only if it passes, the hand-set one if only it passes.
  const hand = analyze(results, {
    ...manifest,
    scorers: { ...manifest.scorers, candidate: 'evidence_hand' }
  })
  const handVerdict = verdictSection(hand)
    .replace(
      '## Ship verdict',
      '## Ship verdict — hand-set points (`evidence_hand`, pre-registered)'
    )
    .replace('the tuned preset may be seeded', 'the hand-set preset may be seeded')
  const decision = data.ship.ship
    ? 'Decision: ship the tuned preset.'
    : hand.ship.ship
      ? 'Decision: the tuned preset fails and the hand-set preset passes — ship the hand-set points.'
      : 'Decision: neither preset passes — nothing is seeded.'
  const reps = manifest.bootstrapReps || DEFAULT_REPS
  const seed = manifest.seeds.bootstrap ?? 1
  const notes = extras.notesFile ? readFileSync(extras.notesFile, 'utf8').trim() : ''
  const tail = [
    macroSensitivitySection(results, reps, seed),
    ...(extras.caddOffDir
      ? [
          caddOffSection(
            readResults(join(extras.caddOffDir, 'results.jsonl')),
            basename(extras.caddOffDir),
            reps,
            seed
          )
        ]
      : []),
    cadd
  ]
  writeFileSync(
    join(outDir, 'report.md'),
    renderMarkdown(data, manifest, [handVerdict, decision, notes].filter(Boolean).join('\n\n')) +
      '\n' +
      tail.join('\n\n') +
      '\n'
  )
  writeFileSync(join(outDir, 'rank-cdf.svg'), rankCdfSvg(data.cdf))
  writeFileSync(
    join(outDir, 'hit-at-10.svg'),
    hitBarsSvg(data.scorers.map((s) => ({ label: s.label, ...s.hit10 })))
  )
  // Infinity (median rank of a mostly-missed scorer) is not JSON; keep it readable.
  writeFileSync(
    join(outDir, 'metrics.json'),
    JSON.stringify(data, (_k, v: unknown) => (v === Number.POSITIVE_INFINITY ? 'Infinity' : v), 2) +
      '\n'
  )
  return data
}

function latestRun(runsDir: string): string {
  const dirs = readdirSync(runsDir)
    .map((name) => ({ name, mtime: statSync(join(runsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (dirs.length === 0) throw new Error(`no runs in ${runsDir}`)
  return dirs[0].name
}

function main(argv: string[]): void {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const runsDir = resolve(arg('--runs-dir') ?? process.env.VARLENS_SIM_RUNS_DIR ?? DEFAULT_RUNS_DIR)
  const requested = arg('--run') ?? 'latest'
  const run = requested === 'latest' ? latestRun(runsDir) : requested
  const out = resolve(arg('--out') ?? join('.planning/artifacts/shortlist-sim', run))
  const caddOff = arg('--cadd-off')
  const data = renderReport(join(runsDir, run), out, {
    caddOffDir: caddOff ? join(runsDir, caddOff) : undefined,
    notesFile: arg('--notes')
  })
  console.log(
    `report: ${join(out, 'report.md')} — verdict ${data.ship.ship ? 'SHIP' : 'DO NOT SHIP'}`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) main(process.argv.slice(2))
