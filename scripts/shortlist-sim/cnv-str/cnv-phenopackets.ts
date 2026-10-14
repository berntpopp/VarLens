/**
 * Real CNV cases of the CNV/STR benchmark (spec §7.1, protocol "Real cases"): phenopacket-store
 * SV interpretations whose label or id carries a chromosome, start and end.
 */
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { CnvType, GeneSpanLookup } from '../../../src/shared/phenotype/cnv-score'
import { jsonFiles } from '../phenotype/phenopackets'

export type Build = 'GRCh37' | 'GRCh38'

export interface ParsedCnv {
  chr: string
  start: number
  end: number
  type: CnvType
  /** null: no explicit build in the text (decided from the gene, else GRCh37). */
  build: Build | null
}

export interface RealCnvCase {
  id: string
  build: Build
  cnvs: Array<Omit<ParsedCnv, 'build'>>
  observed: string[]
  /** `geneContext` symbol, else `chr:band` (bootstrap cluster). */
  cluster: string
}

/** RefSeq accession version of each GRCh38 chromosome; GRCh37 is one lower for every one. */
const NC_VERSION_38: Record<string, number> = {
  '1': 11, '2': 12, '3': 12, '4': 12, '5': 10, '6': 12, '7': 14, '8': 11, '9': 12, '10': 11,
  '11': 10, '12': 12, '13': 11, '14': 9, '15': 10, '16': 10, '17': 11, '18': 10, '19': 10,
  '20': 11, '21': 9, '22': 11, X: 11, Y: 10
} // prettier-ignore

const ncChr = (n: number): string => (n === 23 ? 'X' : n === 24 ? 'Y' : String(n))

/** One SV text (label or id) → its CNV, or null when chromosome, interval or type is missing. */
export function parseCnvText(raw: string, structuralLabel = ''): ParsedCnv | null {
  const t = raw.replace(/ /g, ' ')
  if (/pter|qter/i.test(t) || /hg18|NCBI[ _]Build[ _]36|GRCh36/i.test(t)) return null
  let build: Build | null = /GRCh37|hg19/i.test(t)
    ? 'GRCh37'
    : /GRCh38|hg38/i.test(t)
      ? 'GRCh38'
      : null
  let chr: string | null = null
  const nc = /NC_0+(\d+)[._](\d+)/.exec(t)
  if (nc !== null) {
    chr = ncChr(Number(nc[1]))
    const v38 = NC_VERSION_38[chr]
    const v = Number(nc[2])
    build ??= v === v38 ? 'GRCh38' : v === v38 - 1 ? 'GRCh37' : null
  }
  chr ??= /chr(\d{1,2}|X|Y)(?![\dA-Za-z])/i.exec(t)?.[1].toUpperCase() ?? null
  chr ??= /(?:^|[\s\]}(-])(\d{1,2}|X|Y)[pq]\d/.exec(t)?.[1] ?? null
  if (chr === null) return null
  const iv = interval(t)
  if (iv === null || iv[1] <= iv[0]) return null
  const type = cnvTypeOf(t, structuralLabel)
  return type === null ? null : { chr, start: iv[0], end: iv[1], type, build }
}

function interval(t: string): [number, number] | null {
  // Uncertain breakpoints `(a_b)_(c_d)` or `(?_b)_(c_?)`: the certainly deleted inner part.
  const inner = /\((?:\?|\d+)_(\d+)\)_\((\d+)_(?:\?|\d+)\)/.exec(t)
  if (inner !== null) return [Number(inner[1]), Number(inner[2])]
  const iscn = /\(([\d ]+)[_-]([\d ]+)\)/.exec(t)
  if (iscn !== null) return [Number(iscn[1].replace(/ /g, '')), Number(iscn[2].replace(/ /g, ''))]
  const hgvs = /g[._]?(\d+)_(\d+)/.exec(t) ?? /:(\d+)-(\d+)/.exec(t)
  return hgvs === null ? null : [Number(hgvs[1]), Number(hgvs[2])]
}

function cnvTypeOf(t: string, structuralLabel: string): CnvType | null {
  const cn = /\)\s*x(\d)/.exec(t)
  if (cn !== null) return Number(cn[1]) < 2 ? 'del' : Number(cn[1]) > 2 ? 'dup' : null
  if (/dup/i.test(t)) return 'dup'
  if (/del/i.test(t)) return 'del'
  return /deletion/i.test(structuralLabel)
    ? 'del'
    : /duplication/i.test(structuralLabel)
      ? 'dup'
      : null
}

type Json = Record<string, unknown>
const obj = (x: unknown): Json => (x !== null && typeof x === 'object' ? (x as Json) : {})
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
const str = (x: unknown): string => (typeof x === 'string' ? x : '')

/**
 * The case of one phenopacket, or null without a parsable CNV, an observed term, or a decidable
 * build. `lookups` decide an implicit build: the build in which the gene overlaps the interval.
 */
export function cnvCaseOf(
  json: unknown,
  lookups: Record<Build, GeneSpanLookup>
): RealCnvCase | null {
  const pp = obj(json)
  const parsed: ParsedCnv[] = []
  let gene = ''
  let label = ''
  for (const i of arr(pp.interpretations)) {
    for (const gi of arr(obj(obj(i).diagnosis).genomicInterpretations)) {
      const vd = obj(obj(obj(gi).variantInterpretation).variationDescriptor)
      const sl = str(obj(vd.structuralType).label)
      if (sl === '') continue
      gene ||= str(obj(vd.geneContext).symbol)
      const cnv = parseCnvText(str(vd.label), sl) ?? parseCnvText(str(vd.id), sl)
      if (cnv === null) continue
      parsed.push(cnv)
      label ||= str(vd.label)
    }
  }
  const observed = [
    ...new Set(
      arr(pp.phenotypicFeatures)
        .map(obj)
        .filter((f) => f.excluded !== true)
        .map((f) => str(obj(f.type).id))
        .filter((id) => id.startsWith('HP:'))
    )
  ]
  if (parsed.length === 0 || observed.length === 0) return null
  const build =
    parsed.find((c) => c.build !== null)?.build ?? implicitBuild(parsed[0], gene, lookups)
  const band = /(?:\d{1,2}|X|Y)([pq]\d+)/.exec(label)
  return {
    id: str(pp.id),
    build,
    cnvs: parsed.map(({ build: _b, ...c }) => c),
    observed,
    cluster: gene || `${parsed[0].chr}:${band?.[1] ?? Math.floor(parsed[0].start / 1e7)}`
  }
}

function implicitBuild(c: ParsedCnv, gene: string, lookups: Record<Build, GeneSpanLookup>): Build {
  const hits = (['GRCh37', 'GRCh38'] as const).filter((b) =>
    lookups[b].overlapping(c.chr, c.start, c.end).some((s) => s.symbol === gene)
  )
  return hits.length === 1 ? hits[0] : 'GRCh37'
}

/** Every real CNV case under `dir`, with per-file drop counts. */
export function loadCnvCases(
  dir: string,
  lookups: Record<Build, GeneSpanLookup>
): { cases: RealCnvCase[]; svFiles: number } {
  const cases: RealCnvCase[] = []
  let svFiles = 0
  for (const file of jsonFiles(dir)) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('"structuralType"')) continue
    svFiles++
    const c = cnvCaseOf(JSON.parse(text), lookups)
    if (c !== null) cases.push({ ...c, id: c.id || relative(dir, file) })
  }
  return { cases: cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), svFiles }
}
