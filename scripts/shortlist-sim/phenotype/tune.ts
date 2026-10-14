/**
 * Nested cross-validated tuning of the v2 phenotype scorer (#600):
 *
 *   npx jiti scripts/shortlist-sim/phenotype/tune.ts --run <name> [--diseases N]
 *
 * Same profiles as gene-ranking.ts. Every setting is scored through the production scorer
 * (`scoreCase` on the HPO_DB index) with `HPO_SCORING_CONFIG` fields overridden for the call; the
 * causal-gene standings of each setting are computed once over all cases and reused by every
 * fold. For each outer fold a greedy search (tuning.ts) on the other four folds picks the
 * setting, which then scores the held-out fold. Writes runs/<name>/{cases.json, tuning.json,
 * gene-ranking.md}.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPhenotypeIndex } from '../../../src/main/services/phenotype/hpo-similarity-db'
import { HPO_SCORING_CONFIG } from '../../../src/shared/config/hpo-scoring.config'
import type { PhenotypeIndex } from '../../../src/shared/phenotype/phenotype-index'
import { scoreCase } from '../../../src/shared/phenotype/phenotype-score'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import { HPO_DB } from '../common/paths'
import { rng, shuffle } from '../common/rng'
import {
  FOLDS,
  readVerifiedSources,
  runArgs,
  SEED,
  setupBench,
  standing,
  type BenchProfile
} from './bench-setup'
import { renderGeneRanking, type GeneRankCase } from './gene-ranking-report'
import { greedy, renderTuning, summarize, TUNING_STEPS, type Overrides } from './tuning'

/** The production config object, written only inside `withConfig`. */
const config = HPO_SCORING_CONFIG as unknown as Record<string, unknown>

/** Runs `fn` with config fields overridden; an unknown field throws (no silent no-op knob). */
function withConfig<T>(o: Overrides, fn: () => T): T {
  const saved: Record<string, unknown> = {}
  for (const k of Object.keys(o)) {
    if (!(k in config)) throw new Error(`HPO_SCORING_CONFIG has no field ${k}`)
    saved[k] = config[k]
  }
  Object.assign(config, o)
  try {
    return fn()
  } finally {
    Object.assign(config, saved)
  }
}

/** Gene scores in harness order; −∞ where `openHpoGeneScorer.score` would be null. */
function geneScores(
  ix: PhenotypeIndex,
  map: Int32Array,
  terms: HpoProfileTerm[],
  o: Overrides
): Float64Array {
  const r = withConfig(o, () => scoreCase(ix, terms))
  if (r === null) throw new Error('profile without a present term')
  return Float64Array.from(map, (g) => (g < 0 || r.geneBest[g] < 0 ? -Infinity : r.geneScore[g]))
}

function main(argv: string[]): void {
  const { outDir, nDiseases } = runArgs(argv)
  const src = readVerifiedSources()
  const { all, genes, foldGenes, profilesFor, rate } = setupBench(src)
  const ix = loadPhenotypeIndex(HPO_DB)
  if (ix === null) throw new Error(`${HPO_DB} needs an update`)
  const map = Int32Array.from(genes, (g) => ix.hpo.genes.get(g) ?? -1)
  const diseases = shuffle(all, rng(SEED)).slice(0, nDiseases)
  const profiles: BenchProfile[] = diseases.flatMap((d) => profilesFor(d))
  const cases = profiles.map((p) => ({ meta: p.meta, baseline: p.baseline }))

  const memo = new Map<string, Int32Array>()
  const standings = (o: Overrides): Int32Array => {
    const key = JSON.stringify(Object.entries(o).sort())
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const st = new Int32Array(2 * profiles.length)
    profiles.forEach((p, i) => {
      const s = standing(geneScores(ix, map, p.terms, o), p.causal)
      st[2 * i] = s.higher
      st[2 * i + 1] = s.equal
    })
    memo.set(key, st)
    console.log(`setting ${memo.size}: ${key}`)
    return st
  }
  const idx = profiles.map((_, i) => i)
  const search = (subset: number[]) =>
    greedy(TUNING_STEPS, (o) => summarize(cases, standings(o), subset))

  const folds = Array.from({ length: FOLDS }, (_, fold) =>
    search(idx.filter((i) => profiles[i].meta.fold !== fold))
  )
  const out: GeneRankCase[] = profiles.map((p) => {
    const t0 = performance.now()
    const v2 = geneScores(ix, map, p.terms, folds[p.meta.fold].chosen)
    const ms = performance.now() - t0
    return { ...p.meta, ms, scorers: { v2: rate(v2, p.causal), sprint3: p.baseline } }
  })
  const inSample = search(idx)
  // A knob the scorer reads only at index load would leave every point of its step identical.
  const same = (a: Int32Array, b: Int32Array): boolean => a.every((v, i) => v === b[i])
  const inert = inSample.path.filter((step) =>
    step.points.every((o) => same(standings(o), standings(step.points[0])))
  )
  const md =
    renderGeneRanking(out, {
      release: src.release,
      diseases: diseases.length,
      eligible: all.length,
      genes: genes.length,
      foldGenes,
      tuning:
        '**Nested tuning:** every v2 number is out-of-fold; each fold used the setting chosen on the\n' +
        'other four (section "Nested tuning" at the end).'
    }) +
    '\n' +
    renderTuning(folds, inSample) +
    inert
      .map((s) => `\n**Warning:** every setting of step "${s.label}" ranked identically.\n`)
      .join('')
  writeFileSync(join(outDir, 'gene-ranking.md'), md)
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(out) + '\n')
  writeFileSync(join(outDir, 'tuning.json'), JSON.stringify({ folds, inSample }) + '\n')
  console.log(`wrote ${join(outDir, 'gene-ranking.md')} (${memo.size} settings scored)`)
}

main(process.argv.slice(2))
