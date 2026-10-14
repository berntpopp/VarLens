/**
 * Simulated CNV cases of the CNV/STR benchmark (protocol "Simulation", GRCh38): ClinGen
 * dosage-sensitive regions and ClinVar P/LP copy-number variants, each with a target disease
 * whose HPOA annotations the profile is sampled from.
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import type { CnvType } from '../../../src/shared/phenotype/cnv-score'
import type { LocusReference } from '../../../src/shared/types/locus-reference'
import { rng, shuffle } from '../common/rng'
import { diseaseSeed, frequencyWeight, type Disease } from '../phenotype/profiles'

export interface SimCnvCase {
  id: string
  source: 'region' | 'clinvar'
  cnv: { chr: string; start: number; end: number; type: CnvType }
  disease: string
  cluster: string
}

export const CLINVAR_MAX = 500
const CLINVAR_SIG = new Set(['Pathogenic', 'Likely pathogenic', 'Pathogenic/Likely pathogenic'])
const CLINVAR_TYPE: Record<string, CnvType> = {
  'copy number loss': 'del',
  'copy number gain': 'dup'
}
const SALT_TARGET = 0x51a7

/** Every OMIM/ORPHA disease's positive HPOA terms (NOT and excluded-frequency rows dropped). */
export function hpoaDiseases(hpoa: string): Map<string, Disease> {
  const out = new Map<string, Disease>()
  let cols: string[] | null = null
  for (const line of hpoa.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue
    const f = line.split('\t')
    if (cols === null) {
      cols = f
      continue
    }
    const r = Object.fromEntries(cols.map((c, i) => [c, f[i] ?? '']))
    if (!/^(OMIM|ORPHA):/.test(r.database_id) || r.aspect !== 'P' || r.qualifier === 'NOT') continue
    const w = frequencyWeight(r.frequency)
    if (w <= 0) continue
    let d = out.get(r.database_id)
    if (d === undefined)
      out.set(r.database_id, (d = { id: r.database_id, terms: new Map(), genes: [] }))
    d.terms.set(r.hpo_id, Math.max(w, d.terms.get(r.hpo_id) ?? 0))
  }
  return out
}

/** A seeded pick among the ids that have HPOA terms; null if none has. */
function target(key: string, ids: readonly string[], diseases: Map<string, Disease>, seed: number) {
  const known = [...new Set(ids)].filter((id) => diseases.has(id)).sort()
  return known.length === 0
    ? null
    : known[Math.floor(rng(diseaseSeed(key, seed ^ SALT_TARGET))() * known.length)]
}

/** DEL cases for HI ≥ 2 regions (loss diseases), DUP cases for TS ≥ 2 (gain diseases). */
export function regionCases(
  ref: LocusReference,
  diseases: Map<string, Disease>,
  seed: number
): { cases: SimCnvCase[]; dropped: number } {
  const cases: SimCnvCase[] = []
  let dropped = 0
  const sensitive = (s: number | null): boolean => s !== null && s >= 2 && s <= 3
  for (const r of ref.dosageRegions) {
    if (r.build !== 'GRCh38') continue
    for (const type of ['del', 'dup'] as const) {
      if (!sensitive(type === 'del' ? r.hi : r.ts)) continue
      const id = `${r.iscaId}:${type}`
      const disease = target(id, type === 'del' ? r.lossDiseases : r.gainDiseases, diseases, seed)
      if (disease === null) {
        dropped++
        continue
      }
      const chr = r.chr.replace(/^chr/i, '')
      cases.push({
        id,
        source: 'region',
        cnv: { chr, start: r.start, end: r.end, type },
        disease,
        cluster: r.iscaId
      })
    }
  }
  return { cases: cases.sort((a, b) => (a.id < b.id ? -1 : 1)), dropped }
}

/** OMIM and Orphanet ids of a `PhenotypeIDS` cell. */
export function phenotypeIds(cell: string): string[] {
  return [...cell.matchAll(/(OMIM|Orphanet):(\d+)/g)].map((m) =>
    m[1] === 'OMIM' ? `OMIM:${m[2]}` : `ORPHA:${m[2]}`
  )
}

/** ClinVar P/LP GRCh38 copy-number loss/gain ≥ 1 kb with an annotated phenotype; ≤ CLINVAR_MAX drawn. */
export async function clinvarCases(
  path: string,
  diseases: Map<string, Disease>,
  seed: number
): Promise<{ cases: SimCnvCase[]; eligible: number }> {
  const all: SimCnvCase[] = []
  let cols: string[] | null = null
  const input = createReadStream(path).pipe(createGunzip())
  for await (const line of createInterface({ input })) {
    const f = line.split('\t')
    if (cols === null) {
      cols = f.map((c) => c.replace(/^#/, ''))
      continue
    }
    const r = (name: string): string => f[cols!.indexOf(name)] ?? ''
    const type = CLINVAR_TYPE[r('Type')]
    if (
      type === undefined ||
      r('Assembly') !== 'GRCh38' ||
      !CLINVAR_SIG.has(r('ClinicalSignificance'))
    )
      continue
    const start = Number(r('Start'))
    const end = Number(r('Stop'))
    if (!(end - start + 1 >= 1000)) continue
    const id = `clinvar:${r('VariationID')}`
    const disease = target(id, phenotypeIds(r('PhenotypeIDS')), diseases, seed)
    if (disease === null) continue
    all.push({
      id,
      source: 'clinvar',
      cnv: { chr: r('Chromosome'), start, end, type },
      disease,
      cluster: disease
    })
  }
  const unique = [...new Map(all.map((c) => [c.id, c])).values()].sort((a, b) =>
    a.id < b.id ? -1 : 1
  )
  const cases = shuffle(unique, rng(diseaseSeed('clinvar', seed))).slice(0, CLINVAR_MAX)
  return { cases, eligible: unique.length }
}
