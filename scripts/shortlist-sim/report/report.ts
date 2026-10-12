// Simulation report: run directory (results.jsonl + manifest.json) → report.md, SVGs, metrics.json.
// Usage: npx jiti scripts/shortlist-sim/report/report.ts --run <name|latest> [--runs-dir <dir>] [--out <dir>]
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

export function renderMarkdown(data: ReportData, m: RunManifest): string {
  const header = [
    `# Evidence shortlist simulation — ${m.run}`,
    `Created ${m.createdAt}${m.quick ? ' · **quick run (not for decisions)**' : ''}. Reference scorer \`${m.scorers.reference}\`, candidate \`${m.scorers.candidate}\`. All numbers are aggregates over simulated cases; no background row is reported.`
  ].join('\n\n')
  return (
    [
      header,
      verdictSection(data),
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

export function renderReport(runDir: string, outDir: string): ReportData {
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
  writeFileSync(join(outDir, 'report.md'), renderMarkdown(data, manifest) + '\n' + cadd + '\n')
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
  const data = renderReport(join(runsDir, run), out)
  console.log(
    `report: ${join(out, 'report.md')} — verdict ${data.ship.ship ? 'SHIP' : 'DO NOT SHIP'}`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) main(process.argv.slice(2))
