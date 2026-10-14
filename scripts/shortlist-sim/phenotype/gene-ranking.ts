/**
 * Public-data gene-ranking benchmark for HPO phenotype scoring v2 (#600, spec §5):
 *
 *   npx jiti scripts/shortlist-sim/phenotype/gene-ranking.ts --run <name> [--diseases N] [--options <json>]
 *
 * One simulated profile per sampled HPO disease, noise level and arm (E0/E1/E2, arms.ts); every
 * gene in genes_to_phenotype.txt (positive annotations) is scored by the candidate production
 * scorer (`openHpoGeneScorer` on the τ-matched DB, `hpoDbForTau`) and the frozen sprint-3 baseline (sprint3-baseline.ts on
 * HPO_DB_SPRINT3), on identical profiles. Same seed and diseases as the sprint-3 run.
 * Writes runs/<name>/{cases.json, gene-ranking.md}. Needs `npm run rebuild:node`.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openHpoGeneScorer } from '../../../src/main/services/phenotype/hpo-similarity-db'
import {
  HPO_SCORING_CONFIG,
  type HpoScoringOptions
} from '../../../src/shared/config/hpo-scoring.config'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import { hpoDbForTau } from '../common/paths'
import { rng, shuffle } from '../common/rng'
import { readVerifiedSources, runArgs, SEED, setupBench } from './bench-setup'
import { renderGeneRanking, type GeneRankCase } from './gene-ranking-report'

/** The scorer under test (v2, production), given the full profile incl. excluded and key terms. */
function openCandidate(
  terms: HpoProfileTerm[],
  options: Partial<HpoScoringOptions>
): ((gene: string) => number | null) | null {
  const scorer = openHpoGeneScorer(
    terms,
    hpoDbForTau(options.tau ?? HPO_SCORING_CONFIG.tau),
    options
  )
  return scorer === null ? null : (gene) => scorer.score(gene)
}

function main(argv: string[]): void {
  const { outDir, nDiseases } = runArgs(argv)
  // `--options <json>`: scorer overrides, e.g. the frozen setting of tune-external.ts.
  const options = JSON.parse(
    argv.includes('--options') ? argv[argv.indexOf('--options') + 1] : '{}'
  ) as Partial<HpoScoringOptions>
  const src = readVerifiedSources()
  const { all, genes, foldGenes, profilesFor, rate } = setupBench(src)
  const diseases = shuffle(all, rng(SEED)).slice(0, nDiseases)
  console.log(`${all.length} diseases, ${genes.length} genes; sampling ${diseases.length}`)
  const cases: GeneRankCase[] = []
  for (const [di, disease] of diseases.entries()) {
    for (const p of profilesFor(disease)) {
      const t0 = performance.now()
      const score = openCandidate(p.terms, options)
      if (score === null) throw new Error(`no scorer for ${p.meta.disease}`)
      const v2 = Float64Array.from(genes, (g) => score(g) ?? -Infinity)
      const ms = performance.now() - t0
      cases.push({ ...p.meta, ms, scorers: { v2: rate(v2, p.causal), sprint3: p.baseline } })
    }
    if ((di + 1) % 100 === 0) console.log(`${di + 1}/${diseases.length} diseases`)
  }
  const md = renderGeneRanking(cases, {
    release: src.release,
    diseases: diseases.length,
    eligible: all.length,
    genes: genes.length,
    foldGenes
  })
  writeFileSync(join(outDir, 'gene-ranking.md'), md)
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases) + '\n')
  console.log(`wrote ${join(outDir, 'gene-ranking.md')}`)
}

main(process.argv.slice(2))
