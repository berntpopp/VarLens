/**
 * Offline VEP 115 + dbNSFP 5.3.1a (no network). Flags follow
 * varlens-annotation-workflows/workflow/main.nf (offline cache, --everything, dbNSFP plugin)
 * plus JSON output and MANE-first picking so one transcript per allele is flagged.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ANNOTATE_ENV_BIN,
  DBNSFP_FILE,
  GRCH38_FASTA,
  VEP,
  VEP_CACHE_DIR,
  VEP_PLUGIN_DIR
} from '../common/paths'
import type { AlleleInput } from './normalize'

export interface LocalVepRecord {
  key: string
  mostSevere: string
  impact: string
  terms: string[]
  transcript: string | null
  isMane: boolean
  gene: string | null
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

/** Parse one VEP `--json` output line into the record for its input key (VCF ID). */
export function parseVepLine(line: string): LocalVepRecord {
  const o = JSON.parse(line) as Json
  const tcs = (o.transcript_consequences as Json[] | undefined) ?? []
  const picked = tcs.find((t) => t.pick === 1) ?? tcs[0]
  const allele = (picked?.variant_allele as string | undefined) ?? null
  let freqs: Json = {}
  for (const cv of (o.colocated_variants as Json[] | undefined) ?? []) {
    const f = cv.frequencies as Record<string, Json> | undefined
    if (f && allele !== null && f[allele]) freqs = { ...freqs, ...f[allele] }
  }
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  return {
    key: String(o.id),
    mostSevere: String(o.most_severe_consequence ?? ''),
    impact: String(picked?.impact ?? ''),
    terms: (picked?.consequence_terms as string[] | undefined) ?? [],
    transcript: (picked?.transcript_id as string | undefined) ?? null,
    isMane: typeof picked?.mane_select === 'string',
    gene: (picked?.gene_symbol as string | undefined) ?? null,
    caddPhred: dbnsfpNumber(picked?.cadd_phred),
    gnomadJointAf: dbnsfpNumber(picked?.['gnomad4.1_joint_af']),
    popmaxAf: dbnsfpNumber(picked?.['gnomad4.1_joint_popmax_af']),
    gnomadExomeAf: num(freqs.gnomade),
    gnomadGenomeAf: num(freqs.gnomadg),
    exomePopmaxAf: maxPop(freqs, 'gnomade'),
    genomePopmaxAf: maxPop(freqs, 'gnomadg'),
    inGnomadCache: freqs.gnomade !== undefined || freqs.gnomadg !== undefined
  }
}

function writeVcf(alleles: AlleleInput[], path: string): void {
  const sorted = [...alleles].sort((a, b) =>
    a.chr === b.chr ? a.pos - b.pos : a.chr.localeCompare(b.chr)
  )
  const lines = sorted.map((a) =>
    [a.chr.replace(/^chr/i, ''), a.pos, a.key, a.ref, a.alt, '.', '.', '.'].join('\t')
  )
  writeFileSync(
    path,
    ['##fileformat=VCFv4.2', '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO', ...lines, ''].join(
      '\n'
    )
  )
}

export async function runLocalVep(
  alleles: AlleleInput[],
  outDir: string,
  opts: { fork?: number } = {}
): Promise<LocalVepRecord[]> {
  mkdirSync(outDir, { recursive: true })
  const inFile = join(outDir, 'vep-in.vcf')
  const outFile = join(outDir, 'vep-out.json')
  writeVcf(alleles, inFile)
  const args = [
    '--offline',
    '--cache',
    '--dir_cache',
    VEP_CACHE_DIR,
    '--cache_version',
    '115',
    '--assembly',
    'GRCh38',
    '--species',
    'homo_sapiens',
    '--fasta',
    GRCH38_FASTA,
    '--dir_plugins',
    VEP_PLUGIN_DIR,
    '--input_file',
    inFile,
    '--output_file',
    outFile,
    '--json',
    '--force_overwrite',
    '--no_stats',
    '--fork',
    String(opts.fork ?? 8),
    '--everything',
    '--flag_pick',
    '--pick_order',
    PICK_ORDER,
    '--plugin',
    `dbNSFP,${DBNSFP_FILE},${DBNSFP_FIELDS.join(',')}`
  ]
  // The env's perl must win over the system perl (vep uses `#!/usr/bin/env perl`).
  const env = { ...process.env, PATH: `${ANNOTATE_ENV_BIN}:${process.env.PATH ?? ''}` }
  const p = spawnSync(VEP, args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
  if (p.status !== 0)
    throw new Error(`vep failed (${p.status}): ${(p.stderr || String(p.error)).slice(-2000)}`)
  return readFileSync(outFile, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map(parseVepLine)
}
