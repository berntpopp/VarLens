/**
 * Offline VEP 115 + dbNSFP 5.3.1a (no network). Flags follow
 * varlens-annotation-workflows/workflow/main.nf (offline cache, --everything) plus JSON output
 * and MANE-first picking so one transcript per allele is flagged. The dbNSFP fields the
 * workflow adds through its plugin are joined per allele from a local subset instead.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  ANNOTATE_ENV_BIN,
  DBNSFP_FILE,
  GRCH38_FASTA,
  VEP,
  VEP_CACHE_DIR,
  VEP_PLUGIN_DIR
} from '../common/paths'
import type { AlleleInput } from './normalize'
import { mostSevereOf, severityRank } from './project-varvis'

export interface LocalVepRecord {
  key: string
  mostSevere: string
  impact: string
  terms: string[]
  transcript: string | null
  isMane: boolean
  gene: string | null
  /** 'pick' = VEP flag_pick; 'gene' = restricted to the allele's gene; 'unmapped_gene' = none. */
  selection: 'pick' | 'gene' | 'unmapped_gene'
  caddPhred: number | null
  gnomadJointAf: number | null
  gnomadExomeAf: number | null
  gnomadGenomeAf: number | null
  popmaxAf: number | null
  exomePopmaxAf: number | null
  genomePopmaxAf: number | null
  /** Variant has a colocated gnomAD exome/genome entry for this allele in the VEP cache. */
  inGnomadCache: boolean
}

const DBNSFP_FIELDS = ['CADD_phred', 'gnomAD4.1_joint_AF', 'gnomAD4.1_joint_POPMAX_AF']
/** Bottlenecked/catch-all groups excluded from popmax, as gnomAD's grpmax does. */
export const POPMAX_EXCLUDED = new Set(['ami', 'asj', 'fin', 'mid', 'remaining', 'oth'])
const PICK_ORDER = 'mane_select,canonical,appris,tsl,biotype,ccds,rank,length'

/** dbNSFP values: '.' = missing; several values joined by ',' or '&' → max. */
export function dbnsfpNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const finite = v
    .split(/[,&|]/)
    .filter((s) => s !== '.' && s !== '')
    .map(Number)
    .filter(Number.isFinite)
  return finite.length > 0 ? Math.max(...finite) : null
}

type Json = Record<string, unknown>

function maxPop(freqs: Json, prefix: string): number | null {
  let max: number | null = null
  for (const [k, v] of Object.entries(freqs)) {
    if (!k.startsWith(`${prefix}_`) || typeof v !== 'number') continue
    if (POPMAX_EXCLUDED.has(k.slice(prefix.length + 1))) continue
    max = max === null ? v : Math.max(max, v)
  }
  return max
}

const RANKLESS = 999
const termsOf = (t: Json | undefined): string[] =>
  (t?.consequence_terms as string[] | undefined) ?? []

/**
 * Transcript choice. Without a gene: VEP's flag_pick transcript. With a gene (the ClinVar/varvis
 * gene of the allele): only that gene's transcripts — MANE Select, then canonical, then the most
 * severe — because VEP's pick can land on an overlapping gene. No transcript of the gene →
 * `unmapped_gene`.
 */
export function selectTranscript(
  tcs: Json[],
  gene?: string | null
): { picked: Json | undefined; selection: LocalVepRecord['selection'] } {
  if (gene === undefined || gene === null) {
    return { picked: tcs.find((t) => t.pick === 1) ?? tcs[0], selection: 'pick' }
  }
  const g = gene.toUpperCase()
  const own = tcs.filter((t) => String(t.gene_symbol ?? '').toUpperCase() === g)
  if (own.length === 0) return { picked: undefined, selection: 'unmapped_gene' }
  const rank = (t: Json): number => {
    const ms = mostSevereOf(termsOf(t))
    return ms === null ? RANKLESS : severityRank(ms)
  }
  const picked =
    own.find((t) => typeof t.mane_select === 'string') ??
    own.find((t) => t.canonical === 1) ??
    [...own].sort((a, b) => rank(a) - rank(b))[0]
  return { picked, selection: 'gene' }
}

/** Parse with the allele's gene when a gene lookup is given. */
export function parseVepFor(line: string, geneOf?: (key: string) => string | null): LocalVepRecord {
  if (geneOf === undefined) return parseVepLine(line)
  // The top-level id (VCF ID); colocated variants carry their own "id" fields.
  const id = String((JSON.parse(line) as Json).id ?? '')
  return parseVepLine(line, geneOf(id))
}

/** First finite dbNSFP value on any transcript (the plugin's values are allele-level). */
function alleleLevel(tcs: Json[], picked: Json | undefined, field: string): number | null {
  const own = dbnsfpNumber(picked?.[field])
  if (own !== null) return own
  for (const t of tcs) {
    const v = dbnsfpNumber(t[field])
    if (v !== null) return v
  }
  return null
}

/** Parse one VEP `--json` output line into the record for its input key (VCF ID). */
export function parseVepLine(line: string, gene?: string | null): LocalVepRecord {
  const o = JSON.parse(line) as Json
  const tcs = (o.transcript_consequences as Json[] | undefined) ?? []
  const { picked, selection } = selectTranscript(tcs, gene)
  const allele =
    (picked?.variant_allele as string | undefined) ??
    (tcs[0]?.variant_allele as string | undefined) ??
    null
  let freqs: Json = {}
  for (const cv of (o.colocated_variants as Json[] | undefined) ?? []) {
    const f = cv.frequencies as Record<string, Json> | undefined
    if (f && allele !== null && f[allele]) freqs = { ...freqs, ...f[allele] }
  }
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  const terms = termsOf(picked)
  return {
    key: String(o.id),
    mostSevere:
      selection === 'pick' ? String(o.most_severe_consequence ?? '') : (mostSevereOf(terms) ?? ''),
    impact: String(picked?.impact ?? ''),
    terms,
    transcript: (picked?.transcript_id as string | undefined) ?? null,
    isMane: typeof picked?.mane_select === 'string',
    gene: (picked?.gene_symbol as string | undefined) ?? null,
    selection,
    caddPhred: alleleLevel(tcs, picked, 'cadd_phred'),
    gnomadJointAf: alleleLevel(tcs, picked, 'gnomad4.1_joint_af'),
    popmaxAf: alleleLevel(tcs, picked, 'gnomad4.1_joint_popmax_af'),
    gnomadExomeAf: num(freqs.gnomade),
    gnomadGenomeAf: num(freqs.gnomadg),
    exomePopmaxAf: maxPop(freqs, 'gnomade'),
    genomePopmaxAf: maxPop(freqs, 'gnomadg'),
    inGnomadCache: freqs.gnomade !== undefined || freqs.gnomadg !== undefined
  }
}

/** The env's perl/htslib must win over the system ones (vep uses `#!/usr/bin/env perl`). */
export const toolEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${ANNOTATE_ENV_BIN}:${process.env.PATH ?? ''}`
})

function vcfText(alleles: AlleleInput[]): string {
  const lines = alleles.map((a) =>
    [a.chr.replace(/^chr/i, ''), a.pos, a.key, a.ref, a.alt, '.', '.', '.'].join('\t')
  )
  return [
    '##fileformat=VCFv4.2',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
    ...lines,
    ''
  ].join('\n')
}

function vepArgs(inFile: string, outFile: string, fork: number): string[] {
  return [
    ...['--offline', '--cache', '--dir_cache', VEP_CACHE_DIR, '--cache_version', '115'],
    ...['--assembly', 'GRCh38', '--species', 'homo_sapiens', '--fasta', GRCH38_FASTA],
    ...['--dir_plugins', VEP_PLUGIN_DIR, '--input_file', inFile, '--output_file', outFile],
    ...['--json', '--force_overwrite', '--no_stats', '--fork', String(fork)],
    ...['--everything', '--flag_pick', '--pick_order', PICK_ORDER]
  ]
}

/** Run VEP on one chunk; stderr goes to a file so an orphaned fork cannot hold a pipe open. */
function runChunk(text: string, outDir: string, fork: number): string {
  const id = createHash('sha1').update('vep').update(text).digest('hex').slice(0, 12)
  const inFile = join(outDir, `chunk-${id}.vcf`)
  const outFile = join(outDir, `chunk-${id}.json`)
  const done = join(outDir, `chunk-${id}.done`)
  if (existsSync(done)) return outFile
  writeFileSync(inFile, text)
  let last = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    const errFile = join(outDir, `chunk-${id}.stderr`)
    const fd = openSync(errFile, 'w')
    const p = spawnSync(VEP, vepArgs(inFile, outFile, fork), {
      env: toolEnv(),
      stdio: ['ignore', 'ignore', fd]
    })
    closeSync(fd)
    const warnings = `${outFile}_warnings.txt`
    if (
      existsSync(warnings) &&
      readFileSync(warnings, 'utf8').includes('Failed to instantiate plugin')
    )
      throw new Error(`VEP plugin failed: ${readFileSync(warnings, 'utf8').slice(0, 500)}`)
    if (p.status === 0) {
      writeFileSync(done, '')
      return outFile
    }
    last = `vep failed (${p.status}): ${readFileSync(errFile, 'utf8').slice(-1500)}`
    console.error(`${last}\nretrying chunk ${id} (${attempt}/3)`)
  }
  throw new Error(last)
}

/** Merged 1-based regions covering every allele's REF span. */
export function mergedRegions(alleles: AlleleInput[]): string[] {
  const spans = alleles
    .map((a) => ({
      chr: a.chr.replace(/^chr/i, ''),
      beg: a.pos,
      end: a.pos + Math.max(a.ref.length, 1)
    }))
    .sort((x, y) => (x.chr === y.chr ? x.beg - y.beg : x.chr.localeCompare(y.chr)))
  const out: Array<{ chr: string; beg: number; end: number }> = []
  for (const s of spans) {
    const last = out[out.length - 1]
    if (last && last.chr === s.chr && s.beg <= last.end + 1) last.end = Math.max(last.end, s.end)
    else out.push({ ...s })
  }
  return out.map((r) => `${r.chr}\t${r.beg}\t${r.end}`)
}

/** Runs a fixed bash script; paths come in as "$1", "$2", … so none is parsed as shell code. */
function runBash(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn('bash', ['-c', script, 'bash', ...args], {
      env,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    p.on('close', (status) => resolve({ status, stderr }))
  })
}

/** Regions grouped into `n` parts at chromosome boundaries (each chromosome stays contiguous). */
export function splitByChromosome(regions: string[], n: number): string[][] {
  const byChr = new Map<string, string[]>()
  for (const r of regions) {
    const chr = r.split('\t')[0]
    byChr.set(chr, [...(byChr.get(chr) ?? []), r])
  }
  const parts: string[][] = Array.from({ length: n }, () => [])
  for (const rows of [...byChr.values()].sort((x, y) => y.length - x.length)) {
    parts.sort((x, y) => x.length - y.length)[0].push(...rows)
  }
  return parts.filter((p) => p.length > 0)
}

/**
 * Local dbNSFP subset for the alleles, extracted with parallel tabix queries: the full file sits
 * on a soft-mounted CIFS share where concurrent VEP forks intermittently fail to open it.
 */
export async function dbnsfpSubset(
  alleles: AlleleInput[],
  outDir: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const regions = mergedRegions(alleles)
  const id = createHash('sha1').update(regions.join('\n')).digest('hex').slice(0, 12)
  // The plugin reads the dbNSFP version from the file name.
  const subset = join(outDir, `dbNSFP5.3.1a_grch38.subset-${id}.gz`)
  if (existsSync(`${subset}.tbi`)) return subset
  const parts = splitByChromosome(regions, 8)
  const partFiles = await Promise.all(
    parts.map(async (rows, i) => {
      const regionFile = join(outDir, `dbnsfp-${id}.part${i}.regions`)
      const out = join(outDir, `dbnsfp-${id}.part${i}.gz`)
      if (existsSync(out)) return out // finished by an earlier run
      writeFileSync(regionFile, rows.join('\n') + '\n')
      const script = `set -o pipefail; tabix ${i === 0 ? '-h ' : ''}"$1" -R "$2" | bgzip -c > "$3.tmp" && mv "$3.tmp" "$3"`
      for (let attempt = 1; attempt <= 3; attempt++) {
        const p = await runBash(script, [DBNSFP_FILE, regionFile, out], env)
        if (p.status === 0) return out
        console.error(`dbNSFP part ${i} failed (${attempt}/3): ${p.stderr.slice(-300)}`)
      }
      throw new Error(`could not extract dbNSFP part ${i}`)
    })
  )
  const p = await runBash(
    'out="$1"; shift; cat "$@" > "$out" && tabix -f -s 1 -b 2 -e 2 "$out" && rm "$@"',
    [subset, ...partFiles],
    env
  )
  if (p.status !== 0) throw new Error(`dbNSFP subset index failed: ${p.stderr.slice(-300)}`)
  return subset
}

export interface DbnsfpValues {
  caddPhred: number | null
  jointAf: number | null
  popmaxAf: number | null
}

/** Allele-level dbNSFP values (SNVs only) keyed chr:pos:ref:alt, read from the local subset. */
export async function dbnsfpLookup(
  alleles: AlleleInput[],
  outDir: string
): Promise<Map<string, DbnsfpValues>> {
  const subset = await dbnsfpSubset(alleles, outDir, toolEnv())
  const lines = gunzipSync(readFileSync(subset)).toString('utf8').split('\n')
  const cols = lines[0].replace(/^#/, '').split('\t')
  const at = (name: string): number => {
    const i = cols.indexOf(name)
    if (i < 0) throw new Error(`dbNSFP column ${name} missing`)
    return i
  }
  const [chr, pos, ref, alt] = ['chr', 'pos(1-based)', 'ref', 'alt'].map(at)
  const [cadd, joint, popmax] = DBNSFP_FIELDS.map(at)
  const out = new Map<string, DbnsfpValues>()
  for (const line of lines.slice(1)) {
    if (line === '') continue
    const f = line.split('\t')
    out.set(`${f[chr]}:${f[pos]}:${f[ref]}:${f[alt]}`, {
      caddPhred: dbnsfpNumber(f[cadd]),
      jointAf: dbnsfpNumber(f[joint]),
      popmaxAf: dbnsfpNumber(f[popmax])
    })
  }
  return out
}

/**
 * Offline VEP in resumable chunks (finished chunks are reused by content hash), then dbNSFP
 * values joined per allele — equivalent to the dbNSFP plugin's allele match, without having
 * every VEP fork open the 50 GB file on the CIFS share.
 */
export async function runLocalVep(
  alleles: AlleleInput[],
  outDir: string,
  opts: {
    fork?: number
    chunkSize?: number
    dbnsfp?: boolean
    /** Restrict the transcript choice to this gene per allele key (see selectTranscript). */
    geneOf?: (key: string) => string | null
  } = {}
): Promise<LocalVepRecord[]> {
  mkdirSync(outDir, { recursive: true })
  const sorted = [...alleles].sort((a, b) =>
    a.chr === b.chr ? a.pos - b.pos : a.chr.localeCompare(b.chr)
  )
  const size = opts.chunkSize ?? 2500
  const records: LocalVepRecord[] = []
  for (let i = 0; i < sorted.length; i += size) {
    const outFile = runChunk(vcfText(sorted.slice(i, i + size)), outDir, opts.fork ?? 8)
    for (const line of readFileSync(outFile, 'utf8').split('\n'))
      if (line.trim() !== '') records.push(parseVepFor(line, opts.geneOf))
  }
  if (opts.dbnsfp === false) return records
  const values = await dbnsfpLookup(sorted, outDir)
  return records.map((r) => {
    const v = values.get(r.key.replace(/^chr/i, ''))
    return v ? { ...r, caddPhred: v.caddPhred, gnomadJointAf: v.jointAf, popmaxAf: v.popmaxAf } : r
  })
}
