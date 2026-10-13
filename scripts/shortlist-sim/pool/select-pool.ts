/**
 * Patient-independent public candidate pool (spec §4.2): ClinVar P/LP + benign decoys with
 * variant-level MOI from phenotype.hpoa. Reads only public files.
 *
 *   npx jiti scripts/shortlist-sim/pool/select-pool.ts [--seed 20261012]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { rng, shuffle } from '../common/rng'
import { CLINVAR_2024_VCF, CLINVAR_VCF, HPOA_FILE, POOL_FILE } from '../common/paths'
import { readClinvar, type ClinvarHeader, type ClinvarRecord } from './clinvar-vcf'
import { readHpoa, type Hpoa, type Moi } from './hpoa'

export interface PoolVariant {
  key: string // chr:pos:ref:alt as in ClinVar (pre-normalisation)
  chr: string
  pos: number
  ref: string
  alt: string
  gene: string
  clinvarId: string
  clnsig: string
  revstat: string
  label: 'plp' | 'benign'
  moi: Moi | null // null only for benign
  diseaseIds: string[]
  newSince2024: boolean
}

export interface PoolFile {
  clinvarRelease: string
  hpoaRelease: string
  seed: number
  funnel: Record<string, number>
  variants: PoolVariant[]
}

export const PLP = new Set(['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic'])
const BENIGN = new Set(['Benign', 'Likely_benign', 'Benign/Likely_benign'])
const TWO_STAR = new Set([
  'criteria_provided,_multiple_submitters,_no_conflicts',
  'reviewed_by_expert_panel',
  'practice_guideline'
])
/** ORIGIN labels (as named in the VCF header) that count as germline evidence. */
const GERMLINE_LABELS = new Set([
  'germline',
  'inherited',
  'paternal',
  'maternal',
  'de-novo',
  'biparental',
  'uniparental'
])
const SMALL_CLASSES = new Set([
  'single_nucleotide_variant',
  'Deletion',
  'Insertion',
  'Duplication',
  'Indel'
])
const CHROMS = new Set([...Array.from({ length: 22 }, (_, i) => String(i + 1)), 'X', 'Y'])
const UNNAMED = new Set(['not_provided', 'not_specified', ''])

export const MOI_TARGETS: Record<Moi, number> = { AD: 1300, AR: 1800, XLD: 300, XLR: 300 }
export const PLP_PER_GENE = 3
export const DECOYS_PER_GENE = 2
export const DECOY_TARGET = 2000

type Classified = { variant: Omit<PoolVariant, 'newSince2024'> } | { drop: string; label?: string }

export function originMasks(header: ClinvarHeader): { germline: number; somatic: number } {
  let germline = 0
  let somatic = 0
  for (const [bit, label] of header.originBits) {
    if (GERMLINE_LABELS.has(label)) germline |= bit
    if (label === 'somatic') somatic |= bit
  }
  if (germline === 0 || somatic === 0)
    throw new Error('ClinVar header lacks ORIGIN bit definitions')
  return { germline, somatic }
}

export function diseaseIdsOf(clndisdb: string | undefined): string[] {
  const ids = new Set<string>()
  for (const part of (clndisdb ?? '').split(/[|,]/)) {
    const omim = /^OMIM:(\d+)$/.exec(part)
    if (omim) ids.add(`OMIM:${omim[1]}`)
    const orpha = /^Orphanet:(?:ORPHA)?(\d+)$/.exec(part)
    if (orpha) ids.add(`ORPHA:${orpha[1]}`)
  }
  return [...ids].sort()
}

function isSmall(r: ClinvarRecord): boolean {
  if (!SMALL_CLASSES.has(r.info.get('CLNVC') ?? '')) return false
  if (!/^[ACGT]+$/.test(r.ref) || !/^[ACGT]+$/.test(r.alt)) return false
  return Math.max(r.ref.length, r.alt.length) <= 51
}

export function classify(
  r: ClinvarRecord,
  masks: { germline: number; somatic: number },
  hpoa: Hpoa
): Classified {
  const clnsig = r.info.get('CLNSIG') ?? ''
  const label = PLP.has(clnsig) ? 'plp' : BENIGN.has(clnsig) ? 'benign' : null
  if (label === null) return { drop: 'clnsig' }
  const revstat = r.info.get('CLNREVSTAT') ?? ''
  if (!TWO_STAR.has(revstat)) return { drop: 'review', label }
  const originRaw = r.info.get('ORIGIN')
  if (originRaw === undefined) return { drop: 'origin', label }
  const origin = originRaw.split(/[|,]/).reduce((acc, v) => acc | Number(v), 0)
  if ((origin & masks.germline) === 0 || (origin & masks.somatic) !== 0)
    return { drop: 'origin', label }
  const genes = (r.info.get('GENEINFO') ?? '').split('|').filter((g) => g !== '')
  if (genes.length !== 1) return { drop: 'gene', label }
  if (!CHROMS.has(r.chr) || !isSmall(r)) return { drop: 'size', label }
  const diseaseIds = diseaseIdsOf(r.info.get('CLNDISDB'))
  let moi: Moi | null = null
  if (label === 'plp') {
    const named = (r.info.get('CLNDN') ?? '').split('|').some((d) => !UNNAMED.has(d))
    if (!named) return { drop: 'disease', label }
    const mois = new Set<Moi>()
    for (const id of diseaseIds) for (const m of hpoa.moiByDisease.get(id) ?? []) mois.add(m)
    if (mois.size === 0) return { drop: 'moi_none', label }
    if (mois.size > 1) return { drop: 'moi_ambiguous', label }
    moi = [...mois][0]
  }
  const variant = {
    key: `${r.chr}:${r.pos}:${r.ref}:${r.alt}`,
    chr: r.chr,
    pos: r.pos,
    ref: r.ref,
    alt: r.alt,
    gene: genes[0].split(':')[0],
    clinvarId: r.id,
    clnsig,
    revstat,
    label,
    moi,
    diseaseIds
  } as const
  return { variant }
}

function capPerGene<T extends { gene: string; key: string }>(
  items: T[],
  cap: number,
  rnd: () => number
): T[] {
  const byGene = new Map<string, T[]>()
  for (const it of [...items].sort((a, b) => a.key.localeCompare(b.key))) {
    const list = byGene.get(it.gene) ?? []
    list.push(it)
    byGene.set(it.gene, list)
  }
  const out: T[] = []
  for (const gene of [...byGene.keys()].sort())
    out.push(...shuffle(byGene.get(gene)!, rnd).slice(0, cap))
  return out
}

/** Per-gene cap, then MOI stratification (P/LP) or a decoy target, all with one seeded stream. */
export function samplePool(
  plp: PoolVariant[],
  benign: PoolVariant[],
  seed: number,
  funnel: Record<string, number>
): PoolVariant[] {
  const rnd = rng(seed)
  const capped = capPerGene(plp, PLP_PER_GENE, rnd)
  funnel.plp_after_gene_cap = capped.length
  const out: PoolVariant[] = []
  for (const moi of Object.keys(MOI_TARGETS) as Moi[]) {
    const take = shuffle(
      capped.filter((v) => v.moi === moi),
      rnd
    ).slice(0, MOI_TARGETS[moi])
    funnel[`plp_sampled_${moi}`] = take.length
    out.push(...take)
  }
  const cappedBenign = capPerGene(benign, DECOYS_PER_GENE, rnd)
  funnel.benign_after_gene_cap = cappedBenign.length
  const decoys = shuffle(cappedBenign, rnd).slice(0, DECOY_TARGET)
  funnel.benign_sampled = decoys.length
  out.push(...decoys)
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

const bump = (f: Record<string, number>, k: string): void => {
  f[k] = (f[k] ?? 0) + 1
}

/** P/LP keys of an archived release (any review status), for the temporal stratum. */
export async function plpKeys(path: string): Promise<Set<string>> {
  const keys = new Set<string>()
  const header: ClinvarHeader = { fileDate: null, originBits: new Map() }
  for await (const r of readClinvar(path, header)) {
    if (PLP.has(r.info.get('CLNSIG') ?? '')) keys.add(`${r.chr}:${r.pos}:${r.ref}:${r.alt}`)
  }
  return keys
}

export async function buildPool(opts: {
  clinvar: string
  clinvar2024: string
  hpoa: string
  seed: number
}): Promise<PoolFile> {
  const hpoa = await readHpoa(opts.hpoa)
  const header: ClinvarHeader = { fileDate: null, originBits: new Map() }
  const funnel: Record<string, number> = { records: 0 }
  const kept: { plp: PoolVariant[]; benign: PoolVariant[] } = { plp: [], benign: [] }
  let masks: ReturnType<typeof originMasks> | null = null
  for await (const r of readClinvar(opts.clinvar, header)) {
    masks ??= originMasks(header)
    funnel.records++
    const c = classify(r, masks, hpoa)
    if ('drop' in c) {
      if (c.label !== undefined) {
        bump(funnel, `${c.label}_clnsig`)
        bump(funnel, `${c.label}_drop_${c.drop}`)
      }
      continue
    }
    bump(funnel, `${c.variant.label}_clnsig`)
    bump(funnel, `${c.variant.label}_eligible`)
    kept[c.variant.label].push({ ...c.variant, newSince2024: false })
  }
  const old = await plpKeys(opts.clinvar2024)
  for (const v of kept.plp) v.newSince2024 = !old.has(v.key)
  funnel.plp_eligible_genes = new Set(kept.plp.map((v) => v.gene)).size
  funnel.benign_eligible_genes = new Set(kept.benign.map((v) => v.gene)).size
  const variants = samplePool(kept.plp, kept.benign, opts.seed, funnel)
  funnel.plp_sampled_new_since_2024 = variants.filter(
    (v) => v.label === 'plp' && v.newSince2024
  ).length
  return {
    clinvarRelease: header.fileDate ?? 'unknown',
    hpoaRelease: hpoa.release ?? 'unknown',
    seed: opts.seed,
    funnel,
    variants
  }
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--seed')
  const seed = i > -1 ? Number(process.argv[i + 1]) : 20261012
  const pool = await buildPool({
    clinvar: CLINVAR_VCF,
    clinvar2024: CLINVAR_2024_VCF,
    hpoa: HPOA_FILE,
    seed
  })
  mkdirSync(dirname(POOL_FILE), { recursive: true })
  writeFileSync(POOL_FILE, JSON.stringify(pool))
  console.log(`ClinVar ${pool.clinvarRelease}, hpoa ${pool.hpoaRelease}, seed ${seed}`)
  console.table(pool.funnel)
  console.log(`wrote ${pool.variants.length} variants to ${POOL_FILE}`)
}

if (process.argv[1]?.endsWith('select-pool.ts')) {
  main().catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
}
