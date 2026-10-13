#!/usr/bin/env node
/**
 * Refreshes the bundled ClinGen CSpec snapshot (#201): which genes have a
 * released gene-specific ACMG/AMP specification from a ClinGen Variant
 * Curation Expert Panel (VCEP).
 *
 * Source: the ClinGen Criteria Specification Registry (CSpec) API. ClinGen
 * curated content is CC0 1.0 (https://clinicalgenome.org/docs/terms-of-use/);
 * ClinGen asks for attribution and the access date, both kept in the file.
 *
 *   node scripts/clingen/refresh-cspec-snapshot.mjs
 */
import { realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SOURCE_URL = 'https://cspec.genome.network/cspec/api/svis?detail=high'
const DOC_PREFIX = 'https://cspec.genome.network/'
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/renderer/src/assets/data/clingen-cspec.json'
)

/** Released specifications per gene symbol, sorted, from the CSpec API response. */
export function toSnapshot(api, retrieved) {
  if (!Array.isArray(api?.data)) throw new Error('CSpec response has no data array')
  const genes = {}
  for (const svi of api.data) {
    // Only released specs; their document link must stay on the registry (it is opened externally).
    if (svi.status !== 'Released' || typeof svi.url !== 'string') continue
    if (!svi.url.startsWith(DOC_PREFIX)) continue
    const spec = {
      id: String(svi['@id']).split('/').pop(),
      version: svi.version ?? null,
      panel: svi.affiliation?.label?.trim() ?? null,
      url: svi.url
    }
    for (const ruleSet of svi.ruleSets ?? []) {
      for (const gene of ruleSet.genes ?? []) {
        if (typeof gene.label !== 'string' || gene.label === '') continue
        const list = (genes[gene.label.trim()] ??= [])
        if (!list.some((s) => s.id === spec.id)) list.push(spec)
      }
    }
  }
  const sorted = Object.fromEntries(
    Object.keys(genes)
      .sort()
      .map((g) => [g, genes[g].sort((a, b) => a.id.localeCompare(b.id))])
  )
  return {
    source: SOURCE_URL,
    attribution: 'ClinGen Criteria Specification Registry (cspec.genome.network), CC0 1.0',
    retrieved,
    genes: sorted
  }
}

async function main() {
  const response = await fetch(SOURCE_URL, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`CSpec API answered ${response.status}`)
  const snapshot = toSnapshot(await response.json(), new Date().toISOString().slice(0, 10))
  const count = Object.keys(snapshot.genes).length
  if (count === 0) throw new Error('CSpec snapshot has no genes; refusing to overwrite')
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n')
  process.stdout.write(`Wrote ${count} genes to ${OUT}\n`)
}

const isMain = (() => {
  try {
    return (
      process.argv[1] !== undefined &&
      pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
    )
  } catch {
    return false
  }
})()
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
