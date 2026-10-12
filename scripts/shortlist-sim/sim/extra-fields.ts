/**
 * Canonical `info.<KEY>` evidence fields for the "varvis full" template (#597), computed for
 * spikes AND background rows from the same LOCAL resources, so both sides are annotated alike:
 * dbNSFP 5.3.1a (REVEL, MetaRNN, BayesDel, AlphaMissense, gnomAD 4.1 joint nhomalt; SNVs only),
 * precomputed SpliceAI (SNV + indel VCFs), the gnomAD v4.1 constraint table (per gene) and the
 * local ClinVar VCF (review status). Values follow the importer's canonical form: numbers as
 * number text (max over transcripts), text lower-cased with `_` read as a space. No network.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ANNOTATE_ENV_BIN, CLINVAR_ORIGINAL } from '../common/paths'

export type ExtraFields = Record<string, string>

export interface ExtraSite {
  /** bcftools-normalised chr:pos:ref:alt (chr without prefix). */
  key: string
  gene: string | null
}

const RESOURCES = join(CLINVAR_ORIGINAL, '../..')
const DBNSFP = join(RESOURCES, 'dbnsfp/dbNSFP5.3.1a_grch38.gz')
const SPLICEAI_SNV = join(RESOURCES, 'spliceai/spliceai_scores.raw.snv.hg38.vcf.gz')
const SPLICEAI_INDEL = join(RESOURCES, 'spliceai/spliceai_scores.raw.indel.hg38.vcf.gz')
const CONSTRAINT = join(RESOURCES, 'gnomad/gnomad.v4.1.constraint_metrics.tsv')
const TABIX = join(ANNOTATE_ENV_BIN, 'tabix')

/** dbNSFP column → canonical key (spec §16 alias table). */
const DBNSFP_COLUMNS: Record<string, string> = {
  REVEL_score: 'REVEL',
  MetaRNN_rankscore: 'METARNN',
  BayesDel_noAF_rankscore: 'BAYESDEL',
  AlphaMissense_score: 'ALPHAMISSENSE',
  'gnomAD4.1_joint_nhomalt': 'GNOMAD_HOM'
}

/** Max over `;`/`&`/`,`-separated values, `.` = missing; null when none is numeric. */
export function maxNumber(text: string): number | null {
  const nums = text
    .split(/[;&,|]/)
    .filter((s) => s !== '' && s !== '.')
    .map(Number)
    .filter(Number.isFinite)
  return nums.length > 0 ? Math.max(...nums) : null
}

/** The importer's canonical text form (lower case, `_` and `&` read as space and comma). */
export const canonicalText = (text: string): string =>
  text.replace(/&/g, ',').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

const isSnv = (key: string): boolean => {
  const [, , ref, alt] = key.split(':')
  return ref.length === 1 && alt.length === 1
}

/** tabix -R over sorted regions, in chromosome-parallel chunks; returns the raw lines. */
async function tabixLines(
  file: string,
  keys: string[],
  tmp: string,
  parallel = 4
): Promise<string[]> {
  const byChr = new Map<string, Set<string>>()
  for (const k of keys) {
    const [chr, pos] = k.split(':')
    if (!byChr.has(chr)) byChr.set(chr, new Set())
    byChr.get(chr)!.add(pos)
  }
  const chrs = [...byChr.keys()]
  const out: string[] = []
  let next = 0
  const run = async (): Promise<void> => {
    while (next < chrs.length) {
      const chr = chrs[next++]
      const regions = join(tmp, `regions-${chr}.tsv`)
      const positions = [...byChr.get(chr)!].map(Number).sort((a, b) => a - b)
      writeFileSync(regions, positions.map((p) => `${chr}\t${p}\t${p}`).join('\n') + '\n')
      out.push(...(await capture(TABIX, ['-R', regions, file])))
    }
  }
  await Promise.all(Array.from({ length: parallel }, run))
  return out
}

function capture(cmd: string, args: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    let buf = ''
    let err = ''
    p.stdout.on('data', (d: Buffer) => (buf += d.toString('utf8')))
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')))
    p.on('close', (code) =>
      code === 0
        ? resolve(buf.split('\n').filter((l) => l !== ''))
        : reject(new Error(`${cmd} ${args.join(' ')}: ${err}`))
    )
  })
}

async function dbnsfpFields(keys: string[], tmp: string): Promise<Map<string, ExtraFields>> {
  const header = (await capture(TABIX, ['-H', DBNSFP]))[0].replace(/^#/, '').split('\t')
  const cols = Object.entries(DBNSFP_COLUMNS).map(([name, key]) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`dbNSFP column ${name} missing`)
    return { i, key }
  })
  const want = new Set(keys)
  const out = new Map<string, ExtraFields>()
  for (const line of await tabixLines(DBNSFP, keys, tmp)) {
    const f = line.split('\t')
    const key = `${f[0]}:${f[1]}:${f[2]}:${f[3]}`
    if (!want.has(key)) continue
    const fields: ExtraFields = {}
    for (const { i, key: k } of cols) {
      const v = maxNumber(f[i] ?? '.')
      if (v !== null) fields[k] = String(v)
    }
    out.set(key, fields)
  }
  return out
}

/** Max SpliceAI delta score per allele (the site gene's entry when present, else any gene). */
async function spliceAiMax(sites: ExtraSite[], tmp: string): Promise<Map<string, number>> {
  const gene = new Map(sites.map((s) => [s.key, s.gene]))
  const out = new Map<string, number>()
  for (const [file, keys] of [
    [SPLICEAI_SNV, sites.filter((s) => isSnv(s.key)).map((s) => s.key)],
    [SPLICEAI_INDEL, sites.filter((s) => !isSnv(s.key)).map((s) => s.key)]
  ] as const) {
    if (keys.length === 0) continue
    for (const line of await tabixLines(file, keys, tmp)) {
      const f = line.split('\t')
      const key = `${f[0]}:${f[1]}:${f[3]}:${f[4]}`
      if (!gene.has(key)) continue
      const info = /SpliceAI=([^;\t]+)/.exec(f[7] ?? '')?.[1] ?? ''
      const entries = info.split(',').map((e) => e.split('|'))
      const own = entries.filter((e) => e[1] === gene.get(key))
      const ds = (own.length > 0 ? own : entries).flatMap((e) => e.slice(2, 6).map(Number))
      const max = Math.max(...ds.filter(Number.isFinite))
      if (Number.isFinite(max)) out.set(key, Math.max(out.get(key) ?? 0, max))
    }
  }
  return out
}

/** Per gene (MANE Select row, else canonical): LOEUF, LoF o/e, missense Z. */
export function constraintByGene(tsv = readFileSync(CONSTRAINT, 'utf8')): Map<string, ExtraFields> {
  const [head, ...lines] = tsv.split('\n').filter((l) => l !== '')
  const h = head.split('\t')
  const col = (n: string): number => h.indexOf(n)
  const [gi, mane, canon, loeuf, oe, misz] = [
    'gene',
    'mane_select',
    'canonical',
    'lof.oe_ci.upper',
    'lof.oe',
    'mis.z_score'
  ].map(col)
  const rank = (f: string[]): number => (f[mane] === 'true' ? 2 : f[canon] === 'true' ? 1 : 0)
  const best = new Map<string, string[]>()
  for (const line of lines) {
    const f = line.split('\t')
    const prev = best.get(f[gi])
    if (prev === undefined || rank(f) > rank(prev)) best.set(f[gi], f)
  }
  const out = new Map<string, ExtraFields>()
  for (const [gene, f] of best) {
    const fields: ExtraFields = {}
    for (const [key, i] of [
      ['LOEUF', loeuf],
      ['LOF_OE', oe],
      ['MISSENSE_Z', misz]
    ] as const) {
      const v = Number(f[i])
      if (f[i] !== 'NA' && f[i] !== '' && Number.isFinite(v)) fields[key] = String(v)
    }
    out.set(gene, fields)
  }
  return out
}

/** ClinVar CLNREVSTAT per allele from the local ClinVar VCF (canonical text). */
async function clinvarRevstat(keys: string[], tmp: string): Promise<Map<string, string>> {
  const want = new Set(keys)
  const out = new Map<string, string>()
  for (const line of await tabixLines(CLINVAR_ORIGINAL, keys, tmp)) {
    const f = line.split('\t')
    const key = `${f[0]}:${f[1]}:${f[3]}:${f[4]}`
    const rev = /CLNREVSTAT=([^;]+)/.exec(f[7] ?? '')?.[1]
    if (want.has(key) && rev !== undefined) out.set(key, canonicalText(rev))
  }
  return out
}

/**
 * Extra fields per site key, cached as JSON in `cacheDir` (the private directory for
 * background sites). `withRevstat`: add CLINVAR_REVSTAT from the local ClinVar VCF.
 */
export async function extraFields(
  sites: ExtraSite[],
  cacheDir: string,
  label: string,
  withRevstat: boolean
): Promise<Map<string, ExtraFields>> {
  mkdirSync(cacheDir, { recursive: true })
  const hash = createHash('sha256')
    .update(sites.map((s) => `${s.key}|${s.gene}`).join('\n') + String(withRevstat))
    .digest('hex')
    .slice(0, 16)
  const cache = join(cacheDir, `extra-fields-${label}-${hash}.json`)
  if (existsSync(cache))
    return new Map(
      Object.entries(JSON.parse(readFileSync(cache, 'utf8')) as Record<string, ExtraFields>)
    )
  const tmp = join(cacheDir, `extra-tmp-${hash}`)
  mkdirSync(tmp, { recursive: true })
  try {
    const keys = sites.map((s) => s.key)
    const db = await dbnsfpFields(keys.filter(isSnv), tmp)
    const sai = await spliceAiMax(sites, tmp)
    const constraint = constraintByGene()
    const rev = withRevstat ? await clinvarRevstat(keys, tmp) : new Map<string, string>()
    const out = new Map<string, ExtraFields>()
    for (const s of sites) {
      const fields: ExtraFields = {
        ...(db.get(s.key) ?? {}),
        ...(s.gene !== null ? (constraint.get(s.gene) ?? {}) : {})
      }
      const ds = sai.get(s.key)
      if (ds !== undefined) fields.SPLICEAI_MAX = String(ds)
      const r = rev.get(s.key)
      if (r !== undefined) fields.CLINVAR_REVSTAT = r
      out.set(s.key, fields)
    }
    writeFileSync(cache, JSON.stringify(Object.fromEntries(out)))
    return out
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
