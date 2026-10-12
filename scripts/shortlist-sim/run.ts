/**
 * Simulation runner (spec §5–6, plan Task 12 Step 5).
 *
 *   npx jiti scripts/shortlist-sim/run.ts --run <name> [--quick] [--workers N]
 *        [--cadd-impute on|off] [--scenarios primary,clinvar_visible,...] [--concordance <file>]
 *
 * Writes runs/<run>/{results.jsonl, manifest.json, protocol.lock.json, ruleset-tuned.json,
 * support.json} under _data/shortlist-sim (outside the repository). Background rows never leave
 * this process tree; outputs hold ranks, counts and public pool identifiers only.
 */
import { availableParallelism } from 'node:os'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compileRuleset } from '../../src/main/services/scoring/evidence'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../src/shared/config/evidence-rulesets/varvis-template'
import { RUNS_DIR } from './common/paths'
import { rng, shuffle } from './common/rng'
import type { CaseResult, RunManifest, ScenarioId } from './common/types'
import { backgroundFiles, loadBackgrounds } from './concordance/load-backgrounds'
import { describeBackground } from './sim/background-db'
import { buildCases, type SimCase } from './sim/cases'
import { backgroundNormKeys, fileHash, loadInputs, spikeOptions, sha256 } from './sim/inputs'
import type { Job, JobResult } from './sim/jobs'
import { runJobs } from './sim/pool'
import { canonicalJson, phenoEnrichedGenes, tuneFolds } from './sim/protocol'
import { SCENARIOS } from './sim/scenarios'
import { buildScorers, CANDIDATE_SCORER, REFERENCE_SCORER } from './sim/scorers'
import { geneFolds } from './stats/folds'

const SEEDS = {
  cases: 20261012,
  folds: 20261013,
  bootstrap: 20261014,
  scenario: 20261015,
  quick: 20261016
}
const FOLDS = 5
const CHUNK = 20

interface Args {
  run: string
  quick: boolean
  workers: number
  caddImpute: boolean
  scenarios: ScenarioId[]
  concordance?: string
}

function parseArgs(argv: string[]): Args {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const run = arg('--run')
  if (run === undefined || !/^[\w.-]+$/.test(run)) throw new Error('--run <name> is required')
  const scenarios = (arg('--scenarios')?.split(',') ?? [...SCENARIOS]) as ScenarioId[]
  for (const s of ['primary', 'clinvar_visible'] as const)
    if (!scenarios.includes(s)) throw new Error(`--scenarios must include ${s} (tuning needs it)`)
  return {
    run,
    quick: argv.includes('--quick'),
    workers: Number(arg('--workers') ?? Math.min(6, availableParallelism())),
    caddImpute: (arg('--cadd-impute') ?? 'on') !== 'off',
    scenarios,
    concordance: arg('--concordance')
  }
}

function chunks(
  bg: string,
  scenario: ScenarioId,
  cases: SimCase[]
): Array<{ bg: string; scenario: ScenarioId; cases: SimCase[] }> {
  const out = []
  for (let i = 0; i < cases.length; i += CHUNK)
    out.push({ bg, scenario, cases: cases.slice(i, i + CHUNK) })
  return out
}

const progress =
  (label: string) =>
  (done: number, total: number): void => {
    if (done === total || done % 25 === 0) console.log(`${label}: ${done}/${total} jobs`)
  }

async function main(argv: string[]): Promise<void> {
  console.info = () => {} // rankCase logs one line per call
  const args = parseArgs(argv)
  const t0 = Date.now()
  const timing: Record<string, number> = {}
  const lap = (k: string, since: number): number => (
    (timing[k] = (Date.now() - since) / 1000),
    Date.now()
  )
  const outDir = join(RUNS_DIR, args.run)
  mkdirSync(outDir, { recursive: true })

  const inputs = loadInputs(args.concordance)
  let backgrounds = await loadBackgrounds()
  if (args.quick) backgrounds = backgrounds.slice(0, 1)
  const caseBgs = await Promise.all(
    backgrounds.map(async (bg) => ({
      info: describeBackground(bg.caseLabel, bg.rows),
      normKeys: await backgroundNormKeys(bg)
    }))
  )
  const opts = spikeOptions(inputs, args.caddImpute)
  const build = buildCases(inputs.pool.variants, inputs.sources, caseBgs, SEEDS.cases, opts)
  let cases = build.cases
  if (args.quick) cases = shuffle(cases, rng(SEEDS.quick)).slice(0, 50)
  let t = lap('inputs_and_cases', t0)
  console.log(`cases: ${cases.length} (${JSON.stringify(build.funnel)})`)

  const genes = new Set<string>([''])
  for (const b of caseBgs) for (const g of b.info.genes) genes.add(g)
  for (const c of cases) genes.add(c.gene)
  const folds = geneFolds(genes, FOLDS, SEEDS.folds)
  const init = {
    backgrounds,
    seed: SEEDS.scenario,
    disabledGroups: inputs.acceptance.disabledGroups
  }
  const byBg = (label: string): SimCase[] => cases.filter((c) => c.bg === label)

  // Phase A: first-match assignments of training material (template rules; points irrelevant).
  const assignJobs: Job[] = backgrounds.flatMap((bg) =>
    (['primary', 'clinvar_visible'] as const).flatMap((scenario) => {
      const parts = chunks(bg.caseLabel, scenario, byBg(bg.caseLabel))
      if (parts.length === 0) parts.push({ bg: bg.caseLabel, scenario, cases: [] })
      return parts.map((p, i) => ({ kind: 'assign' as const, ...p, withBackground: i === 0 }))
    })
  )
  const assigned = (await runJobs(assignJobs, init, args.workers, progress('assign'))) as Array<
    Extract<JobResult, { kind: 'assign' }>
  >
  const tuneInput = {
    positives: assigned.flatMap((r) => r.positives),
    background: assigned.flatMap((r) => r.background)
  }
  const overlaps: Record<string, number> = {}
  for (const r of assigned)
    for (const [g, n] of Object.entries(r.overlaps)) overlaps[g] = (overlaps[g] ?? 0) + n
  t = lap('assign', t)

  const reps = args.quick ? 200 : 2000
  const tuned = tuneFolds(tuneInput, folds, FOLDS, inputs.acceptance.disabledGroups, {
    reps,
    seed: SEEDS.bootstrap,
    run: args.run
  })
  t = lap('tune', t)

  // Phase B: every scorer on every case and scenario; fold-specific tuned points.
  const enriched = new Map(caseBgs.map((b) => [b.info.label, phenoEnrichedGenes(b.info)]))
  const evalJobs: Job[] = backgrounds.flatMap((bg) =>
    args.scenarios.flatMap((scenario) => {
      const pool = byBg(bg.caseLabel).filter(
        (c) => scenario !== 'pheno_enriched' || enriched.get(bg.caseLabel)!.has(c.gene)
      )
      return chunks(bg.caseLabel, scenario, pool).map((p) => ({
        kind: 'eval' as const,
        ...p,
        folds: p.cases.map((c) => folds.get(c.gene)!),
        tuned: tuned.perFold
      }))
    })
  )
  const out = createWriteStream(join(outDir, 'results.jsonl'))
  let n = 0
  for (const r of (await runJobs(evalJobs, init, args.workers, progress('eval'))) as Array<
    Extract<JobResult, { kind: 'eval' }>
  >) {
    for (const res of r.results as CaseResult[]) {
      out.write(JSON.stringify(res) + '\n')
      n++
    }
  }
  await new Promise<void>((res) => out.end(res))
  lap('evaluate', t)
  timing.total = (Date.now() - t0) / 1000

  const refit = { ...tuned.refit.ruleset }
  const shipped = { ...refit, sha256: sha256(canonicalJson(refit)) }
  compileRuleset(shipped) // the artefact must load in the app; throws otherwise
  writeFileSync(join(outDir, 'ruleset-tuned.json'), JSON.stringify(shipped, null, 2) + '\n')
  writeFileSync(join(outDir, 'support.json'), JSON.stringify(tuned.refit.support, null, 2) + '\n')

  const scorers = buildScorers(tuned.perFold, inputs.acceptance.disabledGroups)
  const manifest: RunManifest & Record<string, unknown> = {
    run: args.run,
    createdAt: new Date().toISOString(),
    quick: args.quick,
    seeds: SEEDS,
    bootstrapReps: reps,
    inputHashes: {
      ...inputs.hashes,
      template: sha256(canonicalJson(VARVIS_EVIDENCE_TEMPLATE)),
      ...Object.fromEntries(
        backgroundFiles()
          .slice(0, backgrounds.length)
          .map((f, i) => [`background:bg${i + 1}`, fileHash(f)])
      )
    },
    poolFunnel: [
      ...Object.entries(inputs.pool.funnel).map(([step, count]) => ({
        step: `pool: ${step}`,
        count
      })),
      ...Object.entries(build.funnel).map(([step, count]) => ({ step: `cases: ${step}`, count }))
    ],
    concordance: {
      checks: inputs.acceptance.checks,
      funcUnmappedShare:
        inputs.funcUnmapped.of > 0 ? inputs.funcUnmapped.n / inputs.funcUnmapped.of : 0,
      disabledGroups: inputs.acceptance.disabledGroups
    },
    tuned: { A: tuned.refit.A, B: tuned.refit.B, bins: tuned.refit.support },
    scorers: {
      reference: REFERENCE_SCORER,
      candidate: CANDIDATE_SCORER,
      ablations: scorers.filter((s) => s.id.startsWith('abl_')).map((s) => s.id),
      all: scorers.map((s) => ({ id: s.id, label: s.label }))
    },
    afField: inputs.acceptance.afField,
    caddImpute: args.caddImpute,
    caddSources: build.caddSources,
    binOverlaps: overlaps,
    foldPoints: tuned.perFold.map((rs) => ({ sha256: sha256(canonicalJson(rs)) })),
    scenarios: args.scenarios,
    resultsLines: n,
    cases: cases.length,
    workers: args.workers,
    timingSeconds: timing,
    rulesetSha256: shipped.sha256
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const lock = {
    run: args.run,
    seeds: SEEDS,
    inputHashes: manifest.inputHashes,
    scenarios: args.scenarios,
    caddImpute: args.caddImpute,
    acceptance: inputs.acceptance,
    folds: FOLDS,
    scorers: manifest.scorers,
    rulesetSha256: shipped.sha256
  }
  writeFileSync(join(outDir, 'protocol.lock.json'), JSON.stringify(lock, null, 2) + '\n')
  console.log(
    `run ${args.run}: ${n} results, ${cases.length} cases, ${timing.total.toFixed(0)} s → ${outDir}`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
