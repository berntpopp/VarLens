/**
 * Frozen simulation inputs: the committed pool and spike annotations
 * (tests/test-data/shortlist-sim/spikes, local VEP 115 + dbNSFP), the CADD API cache and the
 * concordance report with its §11.4 acceptance (which fixes the AF field and disabled groups).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FrozenSpike } from '../annotate/freeze'
import { normalizeAlleles } from '../annotate/normalize'
import { projectToVarvis } from '../annotate/project-varvis'
import { PRIVATE_DIR, REPO_ROOT } from '../common/paths'
import type { ConcordanceCheck } from '../common/types'
import type { Background } from '../concordance/load-backgrounds'
import { TOLERANCE, type AfField, type ConcordanceReport } from '../concordance/metrics'
import type { PoolFile, PoolVariant } from '../pool/select-pool'
import { gunzipSync } from 'node:zlib'
import { loadCaddApiCache } from './cadd-api'
import type { SpikeOptions, SpikeSource } from './spikes'

export const CONCORDANCE_FILE = join(
  REPO_ROOT,
  '.planning/artifacts/shortlist-sim/concordance.json'
)

export const SPIKES_DIR = join(REPO_ROOT, 'tests/test-data/shortlist-sim/spikes')
const POOL_JSONL = join(SPIKES_DIR, 'pool.jsonl.gz')
const ANNOTATIONS_JSONL = join(SPIKES_DIR, 'annotations.jsonl.gz')

const readJsonl = <T>(path: string): T[] =>
  gunzipSync(readFileSync(path))
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T)

/** pool.jsonl.gz: line 1 = release, seed and funnel; then one PoolVariant per line. */
function readPool(): PoolFile {
  const [head, ...variants] = readJsonl<Record<string, unknown>>(POOL_JSONL)
  return { ...(head as Omit<PoolFile, 'variants'>), variants: variants as unknown as PoolVariant[] }
}

export const sha256 = (text: string | Buffer): string =>
  createHash('sha256').update(text).digest('hex')
export const fileHash = (path: string): string => sha256(readFileSync(path))

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

export interface Acceptance {
  afField: AfField
  disabledGroups: string[]
  checks: ConcordanceCheck[]
}

/** §11.4: a failing AF or CADD check disables its rule groups everywhere. */
export function acceptanceOf(report: ConcordanceReport): Acceptance {
  const acc = report.acceptance
  if (acc.afField === null) throw new Error('concordance chose no AF field')
  const bgAf = report.afField.find((s) => s.field === acc.afField)
  const poolAf = report.pool?.afField.find((s) => s.field === acc.afField)
  const check = (
    field: string,
    metric: string,
    value: number | null | undefined,
    threshold: string,
    pass: boolean | null
  ): ConcordanceCheck => ({
    field,
    metric,
    value: value ?? Number.NaN,
    threshold: pass === null ? `${threshold} (not evaluable: too few sites)` : threshold,
    accepted: pass !== false
  })
  const checks = [
    check(
      `gnomad_af (${acc.afField}), backgrounds`,
      'median |Δlog10|',
      bgAf?.medianAbsLog10Err,
      `≤ ${TOLERANCE.afMedianLog10}`,
      acc.afPass
    ),
    check(
      `gnomad_af (${acc.afField}), pool`,
      'median |Δlog10|',
      poolAf?.medianAbsLog10Err,
      `≤ ${TOLERANCE.afMedianLog10}`,
      acc.poolAfPass
    ),
    check(
      'cadd, backgrounds',
      'median |Δ|',
      report.cadd.medianAbsErr,
      `≤ ${TOLERANCE.caddMedianAbs}`,
      acc.caddPass
    ),
    check(
      'cadd, backgrounds',
      'Pearson',
      report.cadd.pearson,
      `≥ ${TOLERANCE.caddPearson}`,
      acc.caddPass
    ),
    check(
      'cadd, pool',
      'median |Δ|',
      report.pool?.cadd.medianAbsErr,
      `≤ ${TOLERANCE.caddMedianAbs}`,
      acc.poolCaddPass
    ),
    check(
      'cadd, pool',
      'Pearson',
      report.pool?.cadd.pearson,
      `≥ ${TOLERANCE.caddPearson}`,
      acc.poolCaddPass
    )
  ]
  const disabledGroups = [
    // null = not evaluable (too few compared sites), which the concordance defines as no fail.
    ...(acc.afPass !== false && acc.poolAfPass !== false ? [] : ['freq', 'ad_freq']),
    ...(acc.caddPass !== false && acc.poolCaddPass !== false ? [] : ['cadd'])
  ]
  return { afField: acc.afField, disabledGroups, checks }
}

export interface SimInputs {
  pool: PoolFile
  sources: Map<string, SpikeSource>
  concordance: ConcordanceReport
  acceptance: Acceptance
  /** Pool variants with a local annotation whose `func` has no empirical mapping. */
  funcUnmapped: { n: number; of: number }
  hashes: Record<string, string>
}

export function loadInputs(concordanceFile = CONCORDANCE_FILE): SimInputs {
  const pool = readPool()
  const anns = new Map(readJsonl<FrozenSpike>(ANNOTATIONS_JSONL).map((a) => [a.poolKey, a]))
  const concordance = readJson<ConcordanceReport>(concordanceFile)
  const acceptance = acceptanceOf(concordance)
  const cadd = loadCaddApiCache([...anns.values()].map((a) => a.key))
  const sources = new Map<string, SpikeSource>()
  let unmapped = 0
  for (const pv of pool.variants) {
    const ann = anns.get(pv.key)
    if (ann === undefined || ann.vep === null) continue
    const [chr, pos, ref, alt] = ann.key.split(':')
    const norm = {
      input: pv.key,
      chr,
      pos: Number(pos),
      ref,
      alt,
      key: ann.key,
      status: 'ok' as const
    }
    sources.set(pv.key, { pv, norm, ann: { ...ann, vep: ann.vep }, caddApi: cadd.get(ann.key) })
    const { mostSevere, consequenceTerms } = ann.vep
    const proj = projectToVarvis(
      mostSevere,
      consequenceTerms,
      concordance.funcMapping,
      concordance.impactByFunc,
      norm
    )
    if (proj.func === null) unmapped++
  }
  return {
    pool,
    sources,
    concordance,
    acceptance,
    funcUnmapped: { n: unmapped, of: sources.size },
    hashes: {
      pool: fileHash(POOL_JSONL),
      annotations: fileHash(ANNOTATIONS_JSONL),
      concordance: fileHash(concordanceFile),
      caddApiValues: sha256(JSON.stringify([...cadd.entries()].sort()))
    }
  }
}

export function spikeOptions(inputs: SimInputs, caddImpute: boolean): SpikeOptions {
  return {
    afField: inputs.acceptance.afField,
    funcMapping: inputs.concordance.funcMapping,
    impactByFunc: inputs.concordance.impactByFunc,
    caddImpute
  }
}

export const rowKey = (r: { chr: string; pos: number; ref: string; alt: string }): string =>
  `${r.chr}:${r.pos}:${r.ref}:${r.alt}`

/**
 * bcftools-normalised key per background row key (local; temporary files under PRIVATE_DIR).
 * Cached in PRIVATE_DIR (outside the repository) by a hash of the rows, since normalisation is
 * slow. Rows that fail normalisation (REF mismatch) are absent.
 */
export async function backgroundNormMap(bg: Background): Promise<Map<string, string>> {
  const alleles = bg.rows.map((r) => ({
    key: rowKey(r),
    chr: r.chr,
    pos: r.pos,
    ref: r.ref,
    alt: r.alt
  }))
  const cache = join(
    PRIVATE_DIR,
    `norm-map-${sha256(alleles.map((a) => a.key).join('\n')).slice(0, 16)}.json`
  )
  if (existsSync(cache)) return new Map(Object.entries(readJson<Record<string, string>>(cache)))
  const out = await normalizeAlleles(alleles, { tmpDir: PRIVATE_DIR })
  const map = new Map(out.filter((n) => n.status === 'ok').map((n) => [n.input, n.key]))
  writeFileSync(cache, JSON.stringify(Object.fromEntries(map)))
  return map
}

/** bcftools-normalised keys of a background (collision check). */
export async function backgroundNormKeys(bg: Background): Promise<Set<string>> {
  return new Set((await backgroundNormMap(bg)).values())
}
