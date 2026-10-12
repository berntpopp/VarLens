/**
 * One spike row (spec §4.4–4.5, Task 11): a pool variant annotated by local VEP, projected into
 * the varvis vocabulary with the empirical mapping, given a background genotype encoding, and
 * mapped by the production `ObjectFormatMapper` exactly like an imported varvis row.
 */
import {
  ObjectFormatMapper,
  type ObjectFormatVariant
} from '../../../src/main/import/transforms/ObjectFormatMapper'
import { alleleKey } from '../../../src/main/services/scoring/evidence'
import type { NormalizedAllele } from '../annotate/normalize'
import { projectToVarvis, type FuncMappingRow, type ImpactRow } from '../annotate/project-varvis'
import type { MappedVariant } from '../concordance/load-backgrounds'
import { spikeAf, type AfField } from '../concordance/metrics'
import type { SpikeAnnotation, SpikeVep } from '../annotate/spike-annotation'
import type { PoolVariant } from '../pool/select-pool'
import { alleleClassOf, type BackgroundInfo } from './background-db'

export type CaddSource = 'cadd-api' | 'local-vep' | 'imputed' | 'none'

export interface SpikeSource {
  pv: PoolVariant
  norm: NormalizedAllele
  /** Frozen annotation (local VEP 115 + dbNSFP); only sources with a VEP record are loaded. */
  ann: SpikeAnnotation & { vep: SpikeVep }
  /** CADD API PHRED for SNVs: number, null ([] response) or undefined (not fetched). */
  caddApi: number | null | undefined
}

export interface SpikeRow {
  poolKey: string
  /** bcftools-normalised key. */
  key: string
  role: 'causal' | 'decoy'
  row: MappedVariant
  caddSource: CaddSource
}

export interface SpikeOptions {
  afField: AfField
  funcMapping: FuncMappingRow[]
  impactByFunc: ImpactRow[]
  /** Impute missing spike CADD from background rows of the same func and allele class. */
  caddImpute: boolean
}

export type SpikeSkip = 'unmapped' | 'collision' | 'gene_absent'

const pick = <T>(xs: readonly T[], rnd: () => number): T => xs[Math.floor(rnd() * xs.length)]

/** Run the production mapper synchronously on one varvis-shaped object. */
export function mapVarvisObject(value: ObjectFormatVariant): MappedVariant {
  let out: (MappedVariant & { _transcripts?: unknown }) | undefined
  const mapper = new ObjectFormatMapper(undefined, (reason) => {
    throw new Error(`mapper skipped a spike: ${reason}`)
  })
  mapper.push = (chunk: unknown): boolean => {
    out = chunk as MappedVariant & { _transcripts?: unknown }
    return true
  }
  mapper._transform({ key: 0, value }, 'utf8', (error) => {
    if (error) throw error
  })
  if (out === undefined) throw new Error('mapper produced no row')
  delete out._transcripts
  return out
}

function spikeCadd(
  src: SpikeSource,
  func: string,
  bg: BackgroundInfo,
  rnd: () => number,
  impute: boolean
): { cadd: number | null; caddSource: CaddSource } {
  const cls = alleleClassOf(src.norm.ref, src.norm.alt)
  if (cls === 'snv' && typeof src.caddApi === 'number')
    return { cadd: src.caddApi, caddSource: 'cadd-api' }
  if (cls === 'snv' && src.caddApi === undefined && src.ann.vep.caddPhred !== null)
    return { cadd: src.ann.vep.caddPhred, caddSource: 'local-vep' }
  // Indels and SNVs without a precomputed score: sample a varvis value (null included) of the
  // same func and allele class, so the imputed missingness matches varvis.
  const pool = impute ? bg.caddByFuncClass.get(`${func}|${cls}`) : undefined
  if (pool === undefined || pool.length === 0) return { cadd: null, caddSource: 'none' }
  return { cadd: pick(pool, rnd), caddSource: 'imputed' }
}

/**
 * Build a spike for `bg`, or the reason it cannot be placed: unmapped `func`, collision with a
 * background allele (bcftools-normalised or production identity), or a gene absent from `bg`.
 */
export function spikeRow(
  src: SpikeSource,
  role: SpikeRow['role'],
  bg: BackgroundInfo,
  bgNormKeys: ReadonlySet<string>,
  zyg: 'het' | 'hom',
  rnd: () => number,
  opts: SpikeOptions
): SpikeRow | SpikeSkip {
  const { pv, norm } = src
  const vep = src.ann.vep
  const gene = bg.geneFields.get(pv.gene)
  if (gene === undefined) return 'gene_absent'
  if (bgNormKeys.has(norm.key) || bg.prodKeys.has(alleleKey(norm))) return 'collision'
  const proj = projectToVarvis(
    vep.mostSevere,
    vep.consequenceTerms,
    opts.funcMapping,
    opts.impactByFunc,
    norm
  )
  if (proj.func === null) return 'unmapped'
  const cls = alleleClassOf(norm.ref, norm.alt)
  const encodings = bg.encodings[`${cls}:${zyg}`] ?? bg.encodings[`snv:${zyg}`] ?? []
  const [gt, qual] =
    encodings.length > 0 ? pick(encodings, rnd) : [zyg === 'hom' ? '1/1' : '0/1', null]
  const { cadd, caddSource } = spikeCadd(src, proj.func, bg, rnd, opts.caddImpute)
  const mapped = mapVarvisObject({
    chr: norm.chr,
    pos: norm.pos,
    ref: norm.ref,
    alt: norm.alt,
    gene_symbol: pv.gene,
    omim_mim_number: gene.omim_mim_number,
    consequence: proj.consequence,
    gnomad_af: spikeAf(src.ann, opts.afField),
    cadd,
    clinvar: pv.clnsig,
    gt_num: gt,
    func: proj.func,
    qual,
    hpo_sim_score: gene.hpo_sim_score,
    transcript: vep.transcript,
    cdna: null,
    aa_change: null,
    moi: null
  } as ObjectFormatVariant)
  // Gene-level moi is copied as the stored string (the mapper's input form is an object list).
  mapped.moi = gene.moi
  return { poolKey: pv.key, key: norm.key, role, row: mapped, caddSource }
}
