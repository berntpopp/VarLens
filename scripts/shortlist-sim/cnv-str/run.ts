/**
 * CNV/STR phenotype-score validation (spec §7, pre-registered protocol):
 *
 *   npx jiti scripts/shortlist-sim/cnv-str/run.ts --run <name>
 *
 * Per-case output goes to RUNS_DIR/<name>/ (outside the repository); the aggregate report to
 * .planning/artifacts/shortlist-sim/2026-10-14-cnv-str/report.md. Needs `npm run rebuild:node`.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertOutsideRepo, HPO_DB_V6, REPO_ROOT, RUNS_DIR } from '../common/paths'
import { loadBackgrounds } from './backgrounds'
import { BACKGROUND_VCF, runCnvBench, SEED } from './cnv-bench'
import { CHECK_PROFILES, latency, loadInputs, snvInvariance } from './cnv-checks'
import { renderReport } from './report'
import { runStrBench } from './str-bench'

const REPORT = join(REPO_ROOT, '.planning/artifacts/shortlist-sim/2026-10-14-cnv-str/report.md')

async function main(argv: string[]): Promise<void> {
  const run = argv[argv.indexOf('--run') + 1]
  if (!argv.includes('--run') || !/^[\w.-]+$/.test(run ?? ''))
    throw new Error('--run <name> is required')
  const outDir = assertOutsideRepo(join(RUNS_DIR, run))
  mkdirSync(outDir, { recursive: true })

  const inputs = loadInputs() // first: the cold index load is CNV-6
  const cnv = await runCnvBench(inputs, outDir)
  const profiles = (cnv.profiles ?? []).slice(0, CHECK_PROFILES)
  const pool = (await loadBackgrounds('GRCh38', BACKGROUND_VCF.GRCh38, SEED)).flatMap(
    (b) => b.calls
  )
  const lat = latency(profiles, pool, inputs.lookups.GRCh38, inputs.reference, SEED)
  const db = new Database(HPO_DB_V6, { readonly: true })
  const genesV6 = (
    db.prepare('SELECT COUNT(DISTINCT gene_symbol) AS n FROM gene_diseases').get() as { n: number }
  ).n
  const sources = (
    db.prepare("SELECT value FROM meta WHERE key = 'sources'").get() as { value: string }
  ).value
  db.close()
  const invariance = { ...snvInvariance(profiles, outDir), genesV6 }
  const str = runStrBench(inputs.reference)
  writeFileSync(join(outDir, 'str-run.json'), JSON.stringify(str))

  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT })
    .toString()
    .trim()
  const checks = {
    indexLoadMs: inputs.indexLoadMs,
    latency: lat,
    invariance,
    sources: `HPO DB v6 sources ${sources}`
  }
  writeFileSync(join(outDir, 'checks.json'), JSON.stringify(checks))
  writeFileSync(REPORT, renderReport({ ...cnv, profiles: undefined }, str, checks, commit))
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  )
  process.exitCode = 1
})
