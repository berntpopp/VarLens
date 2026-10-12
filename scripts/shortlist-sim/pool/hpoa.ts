/** HPO annotation file (phenotype.hpoa) → disease id → modes of inheritance. */
import { readLines } from './clinvar-vcf'

export type Moi = 'AD' | 'AR' | 'XLD' | 'XLR'

export const MOI_TERMS: Record<string, Moi> = {
  'HP:0000006': 'AD',
  'HP:0000007': 'AR',
  'HP:0001423': 'XLD',
  'HP:0001419': 'XLR'
}

export interface Hpoa {
  release: string | null
  moiByDisease: Map<string, Set<Moi>>
}

export async function readHpoa(path: string): Promise<Hpoa> {
  const moiByDisease = new Map<string, Set<Moi>>()
  let release: string | null = null
  let cols: string[] | null = null
  for await (const line of readLines(path)) {
    if (line.startsWith('#')) {
      if (line.startsWith('#version:')) release = line.slice('#version:'.length).trim()
      continue
    }
    const f = line.split('\t')
    if (cols === null) {
      cols = f
      continue
    }
    const aspect = f[cols.indexOf('aspect')]
    const moi = MOI_TERMS[f[cols.indexOf('hpo_id')]]
    if (aspect !== 'I' || moi === undefined) continue
    const id = f[cols.indexOf('database_id')]
    // A NOT-qualified inheritance row would assert the opposite; skip it.
    if (f[cols.indexOf('qualifier')] === 'NOT') continue
    let set = moiByDisease.get(id)
    if (set === undefined) moiByDisease.set(id, (set = new Set()))
    set.add(moi)
  }
  if (cols === null) throw new Error(`No header in ${path}`)
  return { release, moiByDisease }
}
