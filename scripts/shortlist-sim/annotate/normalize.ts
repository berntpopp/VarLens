/**
 * Allele normalisation with `bcftools norm` against the pinned GRCh38 FASTA (spec §4.3).
 * Used for the spike ↔ background collision check only; production gene-hit identity is the
 * engine's minimal-trim key and is deliberately not reimplemented here.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BCFTOOLS, GRCH38_FASTA } from '../common/paths'

export { GRCH38_FASTA }

export interface AlleleInput {
  key: string
  chr: string
  pos: number
  ref: string
  alt: string
}

export interface NormalizedAllele {
  input: string
  chr: string
  pos: number
  ref: string
  alt: string
  key: string
  status: 'ok' | 'ref_mismatch' | 'multiallelic' | 'error'
}

const stripChr = (chr: string): string => chr.replace(/^chr/i, '')
const alleleKey = (chr: string, pos: number, ref: string, alt: string): string =>
  `${chr}:${pos}:${ref}:${alt}`

function toVcf(alleles: AlleleInput[]): string {
  const sorted = [...alleles].sort((a, b) =>
    a.chr === b.chr ? a.pos - b.pos : a.chr.localeCompare(b.chr)
  )
  const contigs = [...new Set(sorted.map((a) => a.chr))].map((c) => `##contig=<ID=${c}>`)
  const lines = sorted.map((a) => [a.chr, a.pos, a.key, a.ref, a.alt, '.', '.', '.'].join('\t'))
  return [
    '##fileformat=VCFv4.2',
    ...contigs,
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
    ...lines,
    ''
  ].join('\n')
}

export async function normalizeAlleles(
  alleles: AlleleInput[],
  opts: { fasta?: string; tmpDir?: string; bcftools?: string } = {}
): Promise<NormalizedAllele[]> {
  const results = new Map<string, NormalizedAllele>()
  const valid: AlleleInput[] = []
  const seen = new Set<string>()
  for (const a of alleles) {
    if (seen.has(a.key)) continue
    seen.add(a.key)
    const chr = stripChr(a.chr)
    const base = { input: a.key, chr, pos: a.pos, ref: a.ref, alt: a.alt }
    const key = alleleKey(chr, a.pos, a.ref, a.alt)
    if (a.alt.includes(',')) results.set(a.key, { ...base, key, status: 'multiallelic' })
    else if (!/^[ACGTN]+$/i.test(a.ref) || !/^[ACGTN]+$/i.test(a.alt) || a.key.includes('\t'))
      results.set(a.key, { ...base, key, status: 'error' })
    else valid.push({ ...a, chr, ref: a.ref.toUpperCase(), alt: a.alt.toUpperCase() })
  }
  if (valid.length > 0) runNorm(valid, opts, results)
  return alleles.map((a) => results.get(a.key)!)
}

function runNorm(
  valid: AlleleInput[],
  opts: { fasta?: string; tmpDir?: string; bcftools?: string },
  results: Map<string, NormalizedAllele>
): void {
  if (opts.tmpDir !== undefined) mkdirSync(opts.tmpDir, { recursive: true })
  const dir = mkdtempSync(join(opts.tmpDir ?? tmpdir(), 'norm-'))
  try {
    const inFile = join(dir, 'in.vcf')
    const outFile = join(dir, 'out.vcf')
    writeFileSync(inFile, toVcf(valid))
    const args = ['norm', '-f', opts.fasta ?? GRCH38_FASTA, '-c', 'x', '-m', '-any']
    const p = spawnSync(opts.bcftools ?? BCFTOOLS, [...args, '-Ov', '-o', outFile, inFile], {
      encoding: 'utf8'
    })
    if (p.status !== 0) throw new Error(`bcftools norm failed: ${p.stderr || String(p.error)}`)
    for (const line of readFileSync(outFile, 'utf8').split('\n')) {
      if (line === '' || line.startsWith('#')) continue
      const [chr, pos, id, ref, alt] = line.split('\t')
      if (results.has(id)) throw new Error(`bcftools norm split ${id} into several records`)
      const p0 = Number(pos)
      results.set(id, {
        input: id,
        chr,
        pos: p0,
        ref,
        alt,
        key: alleleKey(chr, p0, ref, alt),
        status: 'ok'
      })
    }
    // `-c x` drops records whose REF does not match the reference.
    for (const a of valid) {
      if (!results.has(a.key))
        results.set(a.key, {
          input: a.key,
          chr: a.chr,
          pos: a.pos,
          ref: a.ref,
          alt: a.alt,
          key: alleleKey(a.chr, a.pos, a.ref, a.alt),
          status: 'ref_mismatch'
        })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
