/**
 * Annotate the frozen public pool (spec §4.4): bcftools normalisation, genefoundry vep-link +
 * gnomad-link (resumable, one cache file per variant), local VEP cross-check, and the frozen
 * committed copy. Reads only pool.json — never patient data (this module imports nothing from
 * the simulation or concordance code).
 *
 *   npx jiti scripts/shortlist-sim/annotate/fetch-annotations.ts [normalize|fetch|local-vep|freeze]...
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  CACHE_DIR,
  GENEFOUNDRY_CACHE_DIR,
  POOL_FILE,
  POOL_LOCAL_VEP_FILE,
  POOL_NORMALIZED_FILE,
  REPO_ROOT
} from '../common/paths'
import type { PoolFile } from '../pool/select-pool'
import { callTool, GenefoundryToolError, pool } from './genefoundry'
import { runLocalVep, type LocalVepRecord } from './local-vep'
import { countBy, freezeSpikes } from './freeze'
import { normalizeAlleles, type NormalizedAllele } from './normalize'
import { extractGnomad, extractVep, NOT_IN_GNOMAD, type SpikeAnnotation } from './spike-annotation'

export const SPIKES_DIR = join(REPO_ROOT, 'tests/test-data/shortlist-sim/spikes')
const VEP_BATCH = 50
const MIN_VEP_BATCH = 12
/** `--skip-vep`: fetch gnomAD only (e.g. while Ensembl GRCh38 REST is degraded). */
const SKIP_VEP = process.argv.includes('--skip-vep')
const VEP_CONCURRENCY = 2
// Per batch; with VEP_CONCURRENCY = 2 batches at most 6 gnomAD requests are in flight.
const GNOMAD_CONCURRENCY = 3

const cachePath = (key: string): string =>
  join(GENEFOUNDRY_CACHE_DIR, `${createHash('sha1').update(key).digest('hex')}.json`)
const dashed = (key: string): string => key.replace(/:/g, '-')
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T

async function normalizePool(): Promise<NormalizedAllele[]> {
  const poolFile = readJson<PoolFile>(POOL_FILE)
  const norm = await normalizeAlleles(poolFile.variants, { tmpDir: CACHE_DIR })
  const counts: Record<string, number> = {}
  for (const n of norm) counts[n.status] = (counts[n.status] ?? 0) + 1
  const changed = norm.filter((n) => n.status === 'ok' && n.key !== n.input).length
  console.log('normalisation', counts, `re-positioned ${changed}`)
  writeFileSync(POOL_NORMALIZED_FILE, JSON.stringify(norm))
  return norm
}

function loadNormalized(): NormalizedAllele[] {
  return readJson<NormalizedAllele[]>(POOL_NORMALIZED_FILE).filter((n) => n.status === 'ok')
}

type VepResult = { vep: Map<string, SpikeAnnotation['vep']>; errors: Map<string, string> }

/** One vep-link batch; on a batch-level failure split in halves (Ensembl REST times out on big batches). */
async function fetchVep(keys: string[]): Promise<VepResult> {
  const out: VepResult = { vep: new Map(), errors: new Map() }
  try {
    const res = await callTool<{ results: Array<Record<string, unknown>>; errors?: unknown[] }>(
      'vep-link',
      'annotate_variants_batch',
      { variants: keys.map(dashed), response_mode: 'full' },
      { timeoutMs: 180_000, retries: 1 }
    )
    for (const r of res.results) out.vep.set(String(r.input).replace(/-/g, ':'), extractVep(r))
    for (const e of res.errors ?? []) {
      const input = String((e as { input?: string }).input ?? '').replace(/-/g, ':')
      out.errors.set(input, `vep: ${JSON.stringify(e).slice(0, 300)}`)
    }
  } catch (e) {
    console.log(`vep batch of ${keys.length} failed: ${String(e).slice(0, 200)}`)
    // An open circuit fails fast for every request; splitting would only add waiting.
    if (keys.length <= MIN_VEP_BATCH || String(e).includes('circuit open')) {
      for (const k of keys) out.errors.set(k, `vep: ${String(e)}`)
      return out
    }
    await new Promise((r) => setTimeout(r, 10_000))
    const half = Math.ceil(keys.length / 2)
    for (const part of [keys.slice(0, half), keys.slice(half)]) {
      const sub = await fetchVep(part)
      sub.vep.forEach((v, k) => out.vep.set(k, v))
      sub.errors.forEach((v, k) => out.errors.set(k, v))
    }
  }
  return out
}

async function fetchGnomad(
  key: string
): Promise<{ gnomad: SpikeAnnotation['gnomad']; error?: string }> {
  try {
    const payload = await callTool<Record<string, unknown>>(
      'gnomad-link',
      'get_variant_frequencies',
      {
        variant_id: dashed(key),
        exclude_zero_populations: false
      }
    )
    return { gnomad: extractGnomad(payload) }
  } catch (e) {
    if (e instanceof GenefoundryToolError && e.code === 'not_found')
      return { gnomad: NOT_IN_GNOMAD }
    return { gnomad: null, error: `gnomad: ${String(e)}` }
  }
}

/** Fetch what is missing for a batch; parts that already succeeded in the cache are kept. */
async function fetchBatch(batch: NormalizedAllele[]): Promise<void> {
  const previous = new Map<string, SpikeAnnotation>()
  for (const a of batch)
    if (existsSync(cachePath(a.key)))
      previous.set(a.key, readJson<SpikeAnnotation>(cachePath(a.key)))
  const vepOk = (k: string): boolean => previous.get(k)?.vep != null
  const gnomadOk = (k: string): boolean => previous.get(k)?.gnomad != null
  const vepKeys = SKIP_VEP ? [] : batch.map((a) => a.key).filter((k) => !vepOk(k))
  const vep = vepKeys.length > 0 ? await fetchVep(vepKeys) : { vep: new Map(), errors: new Map() }
  await pool(batch, GNOMAD_CONCURRENCY, async (a) => {
    const errors: string[] = []
    const g = gnomadOk(a.key) ? { gnomad: previous.get(a.key)!.gnomad } : await fetchGnomad(a.key)
    if (g.error !== undefined) errors.push(g.error)
    const v = vepOk(a.key) ? previous.get(a.key)!.vep : (vep.vep.get(a.key) ?? null)
    if (v === null)
      errors.push(vep.errors.get(a.key) ?? (SKIP_VEP ? 'vep: skipped' : 'vep: no result'))
    const ann: SpikeAnnotation = {
      key: a.key,
      poolKey: a.input,
      vep: v,
      gnomad: g.gnomad,
      fetchedAt: new Date().toISOString(),
      errors
    }
    writeFileSync(cachePath(a.key), JSON.stringify(ann))
  })
}

/** Abort with a message when Ensembl GRCh38 stays down (polls for up to 30 min). */
async function waitForUpstream(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const health = await callTool<{ upstream?: { GRCh38?: { accepting?: boolean } } }>(
      'vep-link',
      'check_upstream_health',
      {}
    )
    if (health.upstream?.GRCh38?.accepting !== false) return
    console.log(`vep-link GRCh38 upstream is down; retrying in 60 s (${i + 1}/30)`)
    await new Promise((r) => setTimeout(r, 60_000))
  }
  throw new Error('vep-link GRCh38 upstream down for 30 min; aborting')
}

async function fetchAll(): Promise<void> {
  mkdirSync(GENEFOUNDRY_CACHE_DIR, { recursive: true })
  if (!SKIP_VEP) await waitForUpstream()
  const pending = loadNormalized().filter((a) => {
    const p = cachePath(a.key)
    return !existsSync(p) || readJson<SpikeAnnotation>(p).errors.length > 0
  })
  const batches: NormalizedAllele[][] = []
  for (let i = 0; i < pending.length; i += VEP_BATCH) batches.push(pending.slice(i, i + VEP_BATCH))
  console.log(`fetching ${pending.length} variants in ${batches.length} batches`)
  let done = 0
  await pool(batches, VEP_CONCURRENCY, async (b) => {
    const t = Date.now()
    await fetchBatch(b)
    console.log(
      `batch ${++done}/${batches.length} (${b.length}) ${((Date.now() - t) / 1000).toFixed(0)} s`
    )
  })
}

async function localVep(): Promise<void> {
  const alleles = loadNormalized()
  const records = await runLocalVep(alleles, join(CACHE_DIR, 'pool-vep'))
  writeFileSync(POOL_LOCAL_VEP_FILE, JSON.stringify(records))
  console.log(`local VEP: ${records.length}/${alleles.length} records → ${POOL_LOCAL_VEP_FILE}`)
}

function freeze(): void {
  const alleles = readJson<NormalizedAllele[]>(POOL_NORMALIZED_FILE)
  const cache = new Map<string, SpikeAnnotation>()
  for (const a of alleles)
    if (existsSync(cachePath(a.key))) cache.set(a.key, readJson<SpikeAnnotation>(cachePath(a.key)))
  const local = new Map(readJson<LocalVepRecord[]>(POOL_LOCAL_VEP_FILE).map((r) => [r.key, r]))
  const anns = freezeSpikes(alleles, cache, local)
  const poolFile = readJson<PoolFile>(POOL_FILE)
  mkdirSync(SPIKES_DIR, { recursive: true })
  const jsonl = anns.map((a) => JSON.stringify(a)).join('\n') + '\n'
  writeFileSync(join(SPIKES_DIR, 'annotations.jsonl.gz'), gzipSync(jsonl, { level: 9 }))
  const fetched = anns
    .filter((a) => a.fetchedAt !== '')
    .map((a) => a.fetchedAt)
    .sort()
  const manifest = {
    clinvarRelease: poolFile.clinvarRelease,
    hpoaRelease: poolFile.hpoaRelease,
    seed: poolFile.seed,
    poolVariants: poolFile.variants.length,
    normalization: countBy(alleles, (a) => a.status),
    annotated: anns.length,
    withErrors: anns.filter((a) => a.errors.length > 0).length,
    provenance: {
      vep: countBy(anns, (a) => a.vepSource),
      gnomad: countBy(anns, (a) => a.gnomadSource)
    },
    vepMane: anns.filter((a) => a.vep?.isMane === true).length,
    gnomadFound: anns.filter((a) => a.gnomad?.found === true).length,
    gnomadAbsent: anns.filter((a) => a.gnomad?.found === false).length,
    sources: {
      genefoundry: {
        vep: 'https://vep-link.genefoundry.org/mcp annotate_variants_batch (response_mode=full; MANE Select > canonical; CADD from position_scores)',
        gnomad:
          'https://gnomad-link.genefoundry.org/mcp get_variant_frequencies (gnomad_r4 v4.1.1, exclude_zero_populations=false; popmax excludes ami/asj/fin/mid/remaining)'
      },
      'local-vep':
        'VEP 115.2 offline cache + dbNSFP 5.3.1a (CADD_phred, gnomAD4.1_joint_AF, gnomAD4.1_joint_POPMAX_AF); pick order mane_select,canonical,…; dbNSFP covers missense/splice SNVs only, so CADD and joint AF are null for indels and other SNVs there'
    },
    fetchedFrom: fetched[0] ?? null,
    fetchedTo: fetched[fetched.length - 1] ?? null,
    sha256: createHash('sha256').update(jsonl).digest('hex')
  }
  writeFileSync(join(SPIKES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log('frozen', manifest)
}

async function main(): Promise<void> {
  const steps = process.argv.slice(2)
  const all = steps.length === 0
  mkdirSync(dirname(POOL_NORMALIZED_FILE), { recursive: true })
  if (all || steps.includes('normalize')) await normalizePool()
  if (all || steps.includes('fetch')) await fetchAll()
  if (all || steps.includes('local-vep')) await localVep()
  if (all || steps.includes('freeze')) freeze()
}

if (process.argv[1]?.endsWith('fetch-annotations.ts')) {
  main().catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
}
