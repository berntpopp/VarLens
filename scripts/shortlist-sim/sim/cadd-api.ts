/**
 * Real CADD v1.7 PHRED for pool SNVs from the public CADD API (every possible SNV is
 * precomputed). Only pool variants (public, patient-independent) are ever sent; one cache
 * file per variant under _data/shortlist-sim/cache/cadd-api/, so reruns resume.
 *
 *   npx jiti scripts/shortlist-sim/sim/cadd-api.ts [--concurrency 4]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CACHE_DIR, POOL_NORMALIZED_FILE } from '../common/paths'

export const CADD_API_DIR = join(CACHE_DIR, 'cadd-api')
const API = 'https://cadd.gs.washington.edu/api/v1.0/GRCh38-v1.7'

export interface CaddApiEntry {
  key: string
  /** null when the API has no precomputed score ([] response). */
  phred: number | null
  fetchedAt: string
}

const isSnv = (ref: string, alt: string): boolean => ref.length === 1 && alt.length === 1
const cacheFile = (key: string): string => join(CADD_API_DIR, `${key.replace(/:/g, '_')}.json`)

/** Parse the API body: `[{"PHRED":"25.0",...}]` → 25, `[]` → null. */
export function parseCaddBody(body: unknown): number | null {
  if (!Array.isArray(body) || body.length === 0) return null
  const phred = Number((body[0] as { PHRED?: unknown }).PHRED)
  return Number.isFinite(phred) ? phred : null
}

/** Cached CADD API values by normalised key (only keys that were fetched). */
export function loadCaddApiCache(keys: Iterable<string>): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const key of keys) {
    const f = cacheFile(key)
    if (existsSync(f)) out.set(key, (JSON.parse(readFileSync(f, 'utf8')) as CaddApiEntry).phred)
  }
  return out
}

async function fetchOne(key: string): Promise<void> {
  const [chr, pos, ref, alt] = key.split(':')
  const url = `${API}/${chr}:${pos}_${ref}_${alt}`
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const entry: CaddApiEntry = {
        key,
        phred: parseCaddBody(await res.json()),
        fetchedAt: new Date().toISOString()
      }
      writeFileSync(cacheFile(key), JSON.stringify(entry))
      return
    } catch (error) {
      if (attempt >= 5) throw new Error(`${key}: ${String(error)}`, { cause: error })
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
}

async function main(argv: string[]): Promise<void> {
  const i = argv.indexOf('--concurrency')
  const concurrency = Math.min(4, i >= 0 ? Number(argv[i + 1]) : 4)
  mkdirSync(CADD_API_DIR, { recursive: true })
  const pool = JSON.parse(readFileSync(POOL_NORMALIZED_FILE, 'utf8')) as Array<{
    key: string
    ref: string
    alt: string
    status: string
  }>
  const todo = pool
    .filter((a) => a.status === 'ok' && isSnv(a.ref, a.alt) && !existsSync(cacheFile(a.key)))
    .map((a) => a.key)
  console.log(`cadd-api: ${todo.length} SNVs to fetch`)
  let next = 0
  let failed = 0
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const key = todo[next++]
      try {
        await fetchOne(key)
      } catch (error) {
        failed++
        console.error(String(error))
      }
      if (next % 250 === 0) console.log(`cadd-api: ${next}/${todo.length}`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  console.log(`cadd-api: done, ${failed} failed`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename))
  void main(process.argv.slice(2))
