/**
 * Builds one v2 hpo_similarity.db per tuned τ (#600): the stored background null is τ-specific.
 *
 *   npx jiti scripts/shortlist-sim/phenotype/build-tau-dbs.ts
 *
 * From the verified raw release files in HPO_RAW_DIR into the private cache (`hpoDbForTau`).
 */
import { buildHpoSimilarityDb } from '../../../src/main/services/phenotype/hpo-similarity-db'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertOutsideRepo, HPO_RAW_DIR, hpoDbForTau } from '../common/paths'
import { readVerifiedSources } from './bench-setup'
import { EXTERNAL_TAUS } from './tuning'

const src = readVerifiedSources()
const sha256 = Object.fromEntries(
  ['hp.json', 'phenotype.hpoa', 'genes_to_phenotype.txt'].map((f) => [
    f,
    createHash('sha256')
      .update(readFileSync(join(HPO_RAW_DIR, f)))
      .digest('hex')
  ])
)
for (const tau of EXTERNAL_TAUS) {
  const out = assertOutsideRepo(hpoDbForTau(tau))
  const t0 = performance.now()
  buildHpoSimilarityDb(
    { ontology: src.ontology, annotations: src.annotations, genes: src.genes },
    { release: src.release, sha256 },
    out,
    tau
  )
  console.log(`τ ${tau}: ${out} (${((performance.now() - t0) / 1000).toFixed(0)} s)`)
}
