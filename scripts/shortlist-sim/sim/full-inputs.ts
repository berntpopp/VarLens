/**
 * Inputs of the "varvis full" benchmark (#597): canonical info fields for spikes and background
 * rows from the same local resources (see extra-fields.ts). Background values are cached in
 * the private directory only; the returned coverage is aggregate.
 */
import { CACHE_DIR, PRIVATE_DIR } from '../common/paths'
import type { Background } from '../concordance/load-backgrounds'
import { canonicalText, extraFields, type ExtraFields } from './extra-fields'
import { backgroundNormMap, rowKey, type SimInputs } from './inputs'

/** Share of rows carrying each canonical key, per side (aggregate). */
export type ExtraCoverage = Record<'spikes' | 'background', Record<string, number>>

function mergeInfo(infoJson: string | null, extra: ExtraFields): string | null {
  const merged = {
    ...(infoJson ? (JSON.parse(infoJson) as Record<string, unknown>) : {}),
    ...extra
  }
  return Object.keys(merged).length > 0 ? JSON.stringify(merged) : null
}

function coverage(all: ExtraFields[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const f of all) for (const k of Object.keys(f)) counts[k] = (counts[k] ?? 0) + 1
  return Object.fromEntries(
    Object.entries(counts).map(([k, n]) => [
      k,
      Math.round((n / Math.max(all.length, 1)) * 1000) / 1000
    ])
  )
}

/**
 * Sets `extra` on every spike source (with the pool's ClinVar review status) and merges the
 * fields into each background row's `info_json` (in place).
 */
export async function addExtraFields(
  inputs: SimInputs,
  backgrounds: Background[]
): Promise<ExtraCoverage> {
  const sources = [...inputs.sources.values()]
  const pool = await extraFields(
    sources.map((s) => ({ key: s.norm.key, gene: s.pv.gene })),
    CACHE_DIR,
    'pool',
    false
  )
  const spikeFields: ExtraFields[] = []
  for (const s of sources) {
    s.extra = { ...(pool.get(s.norm.key) ?? {}), CLINVAR_REVSTAT: canonicalText(s.pv.revstat) }
    spikeFields.push(s.extra)
  }
  const bgFields: ExtraFields[] = []
  for (const bg of backgrounds) {
    const norm = await backgroundNormMap(bg)
    const sites = bg.rows.flatMap((r) => {
      const key = norm.get(rowKey(r))
      return key === undefined ? [] : [{ key, gene: r.gene_symbol }]
    })
    const fields = await extraFields(sites, PRIVATE_DIR, bg.caseLabel, true)
    for (const r of bg.rows) {
      const key = norm.get(rowKey(r))
      const extra = key === undefined ? {} : (fields.get(key) ?? {})
      r.info_json = mergeInfo(r.info_json, extra)
      bgFields.push(extra)
    }
  }
  return { spikes: coverage(spikeFields), background: coverage(bgFields) }
}
