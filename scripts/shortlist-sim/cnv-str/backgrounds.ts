/**
 * Background CNV sets of the CNV/STR benchmark (protocol "Backgrounds"): the DEL/DUP/CNV calls
 * of ten 1000 Genomes samples per build, 5 carrying a call ≥ 1 Mb and 5 without. Public data,
 * extracted with bcftools and cached outside the repository.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { CnvType } from '../../../src/shared/phenotype/cnv-score'
import { assertOutsideRepo, BCFTOOLS, CACHE_DIR } from '../common/paths'
import { rng, shuffle } from '../common/rng'
import { diseaseSeed } from '../phenotype/profiles'
import type { Build } from './cnv-phenopackets'

export interface BgCnv {
  chr: string
  start: number
  end: number
  type: CnvType
}

export interface Background {
  sample: string
  /** Carries a call ≥ 1 Mb (CNV-2 stratum). */
  large: boolean
  calls: BgCnv[]
}

export const MIN_CALL_BP = 1000
export const LARGE_BP = 1_000_000
const PER_STRATUM = 5
const TYPES_FILTER = 'INFO/SVTYPE=="DEL" || INFO/SVTYPE=="DUP" || INFO/SVTYPE=="CNV"'

/** Copy number of one ALT allele: `<CNk>` → k, `<DUP>` → 2, `<DEL>`/sequence (deletion) → 0. */
export function alleleCopies(alt: string): number | null {
  const cn = /^<CN(\d+)>$/.exec(alt)
  if (cn !== null) return Number(cn[1])
  if (alt === '<DUP>' || alt.startsWith('<DUP:')) return 2
  if (alt === '<DEL>' || alt.startsWith('<DEL:') || /^[ACGTN]+$/i.test(alt)) return 0
  return null
}

/**
 * The sample's call: total copies < 2 → DEL, > 2 → DUP; null for ref/missing/mixed. A `<CNV>`
 * record (GATK-SV) has no directional allele: its FORMAT `CN` decides, whatever the GT.
 */
export function sampleType(gt: string, alts: readonly string[], cn?: string): CnvType | null {
  if (alts.length === 1 && alts[0] === '<CNV>') {
    const n = Number(cn)
    return cn === undefined || cn === '' || cn === '.' || !Number.isFinite(n)
      ? null
      : n < 2
        ? 'del'
        : n > 2
          ? 'dup'
          : null
  }
  const alleles = gt.split(/[/|]/)
  if (alleles.some((a) => a === '.' || a === '')) return null
  let total = 0
  for (const a of alleles) {
    if (a === '0') {
      total += 1
      continue
    }
    const c = alleleCopies(alts[Number(a) - 1] ?? '')
    if (c === null) return null
    total += c
  }
  const ref = alleles.length === 1 ? 1 : 2
  return total < ref ? 'del' : total > ref ? 'dup' : null
}

/** Streams `bcftools query` rows: chrom, pos, end, alt, then one `GT[:CN]` per sample. */
async function query(
  vcf: string,
  hasCn: boolean,
  { expr, samples }: { expr?: string; samples?: string[] },
  row: (f: string[]) => void
): Promise<void> {
  const proc = spawn(BCFTOOLS, [
    'query',
    ...(samples === undefined ? [] : ['-s', samples.join(',')]),
    '-i',
    expr === undefined ? TYPES_FILTER : `(${TYPES_FILTER}) && ${expr}`,
    '-f',
    `%CHROM\t%POS\t%INFO/END\t%ALT[\t%GT${hasCn ? ':%CN' : ''}]\n`,
    vcf
  ])
  const done = new Promise<number>((resolve) => proc.on('close', resolve))
  for await (const line of createInterface({ input: proc.stdout })) row(line.split('\t'))
  if ((await done) !== 0) throw new Error(`bcftools query failed on ${vcf}`)
}

async function lines(args: string[]): Promise<string[]> {
  const proc = spawn(BCFTOOLS, args)
  const out: string[] = []
  for await (const line of createInterface({ input: proc.stdout })) if (line !== '') out.push(line)
  return out
}

const callOf = (field: string, alts: string[]): CnvType | null => {
  const [gt, cn] = field.split(':')
  return sampleType(gt, alts, cn)
}

const bare = (chr: string): string => chr.replace(/^chr/i, '')

/** Ten backgrounds of `vcf`, cached as JSON in CACHE_DIR/cnv-str. */
export async function loadBackgrounds(
  build: Build,
  vcf: string,
  seed: number
): Promise<Background[]> {
  const dir = assertOutsideRepo(join(CACHE_DIR, 'cnv-str'))
  const cache = join(dir, `backgrounds-${build}-${seed}.json`)
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8')) as Background[]
  const samples = await lines(['query', '-l', vcf])
  const hasCn = (await lines(['view', '-h', vcf])).some((l) => l.startsWith('##FORMAT=<ID=CN,'))
  // Pass 1: carriers of a ≥ 1 Mb call.
  const large = new Set<string>()
  await query(vcf, hasCn, { expr: `INFO/END-POS+1>=${LARGE_BP}` }, (f) => {
    const alts = f[3].split(',')
    for (let i = 4; i < f.length; i++) if (callOf(f[i], alts) !== null) large.add(samples[i - 4])
  })
  const pick = (pool: string[], salt: number): string[] =>
    shuffle(pool, rng(diseaseSeed(`${build}:${salt}`, seed))).slice(0, PER_STRATUM)
  const chosen = [
    ...pick(samples.filter((s) => large.has(s)).sort(), 1),
    ...pick(samples.filter((s) => !large.has(s)).sort(), 2)
  ]
  // Pass 2: every DEL/DUP/CNV call of the chosen samples.
  const calls = new Map<string, BgCnv[]>(chosen.map((s) => [s, []]))
  await query(vcf, hasCn, { samples: chosen }, (f) => {
    const start = Number(f[1])
    const end = Number(f[2])
    if (!(end - start + 1 >= MIN_CALL_BP)) return
    const alts = f[3].split(',')
    for (let i = 4; i < f.length; i++) {
      const type = callOf(f[i], alts)
      if (type !== null) calls.get(chosen[i - 4])!.push({ chr: bare(f[0]), start, end, type })
    }
  })
  const out = chosen.map((sample) => ({
    sample,
    large: large.has(sample),
    calls: calls.get(sample)!
  }))
  mkdirSync(dir, { recursive: true })
  writeFileSync(cache, JSON.stringify(out))
  return out
}
