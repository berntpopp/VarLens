/**
 * Streaming, header-aware ClinVar VCF reader. Plain `.vcf` or gzip/bgzip `.vcf.gz`.
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'

export interface ClinvarRecord {
  chr: string
  pos: number
  id: string
  ref: string
  alt: string
  info: Map<string, string>
}

export interface ClinvarHeader {
  fileDate: string | null
  /** ORIGIN bit value → lower-case label, parsed from the ##INFO=<ID=ORIGIN> description. */
  originBits: Map<number, string>
}

export async function* readLines(path: string): AsyncGenerator<string> {
  const raw = createReadStream(path)
  const input = path.endsWith('.gz') ? raw.pipe(createGunzip()) : raw
  yield* createInterface({ input, crlfDelay: Infinity })
}

/** "0 - unknown; 1 - germline; 2 - somatic; …" → Map(bit → label). */
export function parseOriginBits(headerLine: string): Map<number, string> {
  const desc = /Description="([^"]*)"/.exec(headerLine)?.[1] ?? ''
  const bits = new Map<number, string>()
  for (const m of desc.matchAll(/(\d+)\s*-\s*([A-Za-z-]+(?: [A-Za-z-]+)*)/g)) {
    bits.set(Number(m[1]), m[2].trim().toLowerCase())
  }
  return bits
}

function parseInfo(field: string): Map<string, string> {
  const info = new Map<string, string>()
  if (field === '.') return info
  for (const part of field.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) info.set(part, '')
    else info.set(part.slice(0, eq), part.slice(eq + 1))
  }
  return info
}

/** Reads the header, then yields records. `header` is filled before the first record. */
export async function* readClinvar(
  path: string,
  header: ClinvarHeader
): AsyncGenerator<ClinvarRecord> {
  for await (const line of readLines(path)) {
    if (line.startsWith('##')) {
      if (line.startsWith('##fileDate=')) header.fileDate = line.slice('##fileDate='.length)
      if (line.startsWith('##INFO=<ID=ORIGIN,')) header.originBits = parseOriginBits(line)
      continue
    }
    if (line.startsWith('#') || line === '') continue
    const f = line.split('\t')
    if (f.length < 8) throw new Error(`Malformed ClinVar line: ${line.slice(0, 80)}`)
    yield { chr: f[0], pos: Number(f[1]), id: f[2], ref: f[3], alt: f[4], info: parseInfo(f[7]) }
  }
}
