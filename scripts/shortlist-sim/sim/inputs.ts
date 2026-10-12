/**
 * Frozen simulation inputs: pool, normalisation, local VEP annotations, CADD API cache and the
 * concordance report with its §11.4 acceptance (which fixes the AF field and disabled groups).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalVepRecord } from '../annotate/local-vep'
import { normalizeAlleles, type NormalizedAllele } from '../annotate/normalize'
import { projectToVarvis } from '../annotate/project-varvis'
import {
  POOL_FILE,
  POOL_LOCAL_VEP_FILE,
  POOL_NORMALIZED_FILE,
  PRIVATE_DIR,
  REPO_ROOT
} from '../common/paths'
import type { ConcordanceCheck } from '../common/types'
import type { Background } from '../concordance/load-backgrounds'
import { TOLERANCE, type AfField, type ConcordanceReport } from '../concordance/metrics'
import type { PoolFile } from '../pool/select-pool'
import { loadCaddApiCache } from './cadd-api'
import type { SpikeOptions, SpikeSource } from './spikes'

export const CONCORDANCE_FILE = join(
  REPO_ROOT,
  '.planning/artifacts/shortlist-sim/concordance.json'
)

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
    accepted: boolean
  ): ConcordanceCheck => ({
    field,
    metric,
    value: value ?? Number.NaN,
    threshold,
    accepted
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
    ...(acc.afPass && acc.poolAfPass ? [] : ['freq', 'ad_freq']),
    ...(acc.caddPass && acc.poolCaddPass ? [] : ['cadd'])
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
  const pool = readJson<PoolFile>(POOL_FILE)
  const norm = new Map(readJson<NormalizedAllele[]>(POOL_NORMALIZED_FILE).map((n) => [n.input, n]))
  const vep = new Map(readJson<LocalVepRecord[]>(POOL_LOCAL_VEP_FILE).map((v) => [v.key, v]))
  const concordance = readJson<ConcordanceReport>(concordanceFile)
  const acceptance = acceptanceOf(concordance)
  const okNorm = [...norm.values()].filter((n) => n.status === 'ok')
  const cadd = loadCaddApiCache(okNorm.map((n) => n.key))
  const sources = new Map<string, SpikeSource>()
  let unmapped = 0
  for (const pv of pool.variants) {
    const n = norm.get(pv.key)
    const v = n?.status === 'ok' ? vep.get(n.key) : undefined
    if (n === undefined || v === undefined) continue
    sources.set(pv.key, { pv, norm: n, vep: v, caddApi: cadd.get(n.key) })
    const proj = projectToVarvis(
      v.mostSevere,
      v.terms,
      concordance.funcMapping,
      concordance.impactByFunc,
      n
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
      pool: fileHash(POOL_FILE),
      poolNormalized: fileHash(POOL_NORMALIZED_FILE),
      poolLocalVep: fileHash(POOL_LOCAL_VEP_FILE),
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

/** bcftools-normalised keys of a background (local; temporary files under PRIVATE_DIR). */
export async function backgroundNormKeys(bg: Background): Promise<Set<string>> {
  const alleles = bg.rows.map((r) => ({
    key: `${r.chr}:${r.pos}:${r.ref}:${r.alt}`,
    chr: r.chr,
    pos: r.pos,
    ref: r.ref,
    alt: r.alt
  }))
  const out = await normalizeAlleles(alleles, { tmpDir: PRIVATE_DIR })
  return new Set(out.filter((n) => n.status === 'ok').map((n) => n.key))
}
