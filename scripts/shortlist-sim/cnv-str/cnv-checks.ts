/**
 * CNV-5 (SNV invariance on the real release) and CNV-6 (latency) of the CNV/STR protocol.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { openHpoGeneScorer } from '../../../src/main/services/phenotype/hpo-similarity-db'
import { readLocusReference } from '../../../src/main/services/phenotype/locus-reference-db'
import { loadGeneIntervals } from '../../../src/main/services/reference/gene-intervals'
import { cnvGeneSet, scoreCnv, type GeneSpanLookup } from '../../../src/shared/phenotype/cnv-score'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import type { LocusReference } from '../../../src/shared/types/locus-reference'
import { HPO_DB, HPO_DB_V6, REPO_ROOT } from '../common/paths'
import { rng, shuffle } from '../common/rng'
import { quantile } from '../stats/bootstrap'
import { diseaseSeed } from '../phenotype/profiles'
import type { BgCnv } from './backgrounds'
import type { Build } from './cnv-phenopackets'

export const GENE_REFERENCE_DB = join(REPO_ROOT, 'resources/gene_reference.db')
export const LATENCY_CNVS = 5000
export const CHECK_PROFILES = 200

/** Cold load of the locus reference and both gene-interval indexes; ms of the GRCh38 path. */
export function loadInputs(): {
  reference: LocusReference
  lookups: Record<Build, GeneSpanLookup>
  indexLoadMs: number
} {
  const t0 = performance.now()
  const reference = readLocusReference(HPO_DB_V6)
  const grch38 = loadGeneIntervals(GENE_REFERENCE_DB, 'GRCh38')
  const indexLoadMs = performance.now() - t0
  if (reference === null) throw new Error(`${HPO_DB_V6} has no locus tables`)
  return {
    reference,
    lookups: { GRCh37: loadGeneIntervals(GENE_REFERENCE_DB, 'GRCh37'), GRCh38: grch38 },
    indexLoadMs
  }
}

/** p95 ms of A3 (gene set + `scoreCnv`) over a fixed 5,000-CNV set, one warm-up profile first. */
export function latency(
  profiles: readonly HpoProfileTerm[][],
  pool: readonly BgCnv[],
  lookup: GeneSpanLookup,
  reference: LocusReference,
  seed: number
): { p95: number; median: number; n: number; cnvs: number } {
  const cnvs = shuffle(pool, rng(diseaseSeed('latency', seed))).slice(0, LATENCY_CNVS)
  const run = (terms: HpoProfileTerm[]): number => {
    const scorer = openHpoGeneScorer(terms, HPO_DB_V6)
    const ctx = { build: 'GRCh38', sex: null, reference, scorer }
    const t0 = performance.now()
    for (const c of cnvs) {
      const call = { chr: c.chr, pos: c.start, end_pos: c.end, sv_type: c.type.toUpperCase() }
      scoreCnv(call, cnvGeneSet(undefined, lookup, c.chr, c.start, c.end), ctx)
    }
    return performance.now() - t0
  }
  run(profiles[0])
  const ms = profiles.map(run).sort((a, b) => a - b)
  return { p95: quantile(ms, 0.95), median: quantile(ms, 0.5), n: ms.length, cnvs: cnvs.length }
}

/** Digest of every gene's score, best disease and percentile for one profile. */
function geneDigest(path: string, terms: HpoProfileTerm[], genes: readonly string[]): string {
  const scorer = openHpoGeneScorer(terms, path)
  const h = createHash('sha256')
  for (const g of genes) {
    const s = scorer?.score(g) ?? null
    h.update(
      `${g}\t${s}\t${scorer?.bestDisease(g)}\t${s === null ? '' : scorer?.explain(g)?.percentile}\n`
    )
  }
  return h.digest('hex')
}

/**
 * CNV-5: the builder-v5 DB of the same release (meta patched to v6 in a scratch copy, so the
 * current reader accepts it) against the v6 DB, exact per-gene digests over `profiles`.
 */
export function snvInvariance(
  profiles: readonly HpoProfileTerm[][],
  scratchDir: string
): { profiles: number; genes: number; mismatches: number } {
  const v5 = join(scratchDir, 'hpo_similarity.v5-as-v6.db')
  copyFileSync(HPO_DB, v5)
  const db = new Database(v5)
  db.prepare("UPDATE meta SET value = '6' WHERE key = 'builder_version'").run()
  const genes = (
    db.prepare('SELECT DISTINCT gene_symbol AS g FROM gene_diseases ORDER BY g').all() as Array<{
      g: string
    }>
  ).map((r) => r.g)
  db.close()
  // All v5 digests first, then v6: the index cache holds one file at a time.
  const before = profiles.map((p) => geneDigest(v5, p, genes))
  const after = profiles.map((p) => geneDigest(HPO_DB_V6, p, genes))
  return {
    profiles: profiles.length,
    genes: genes.length,
    mismatches: before.filter((d, i) => d !== after[i]).length
  }
}
