import * as fs from 'node:fs'
import type { ReferenceWindowLookup } from '../../../shared/utils/trim-alleles'

export interface FaiEntry {
  name: string
  length: number
  offset: number
  lineBases: number
  lineWidth: number
}

export type ContigReferenceLookup = (chr: string) => ReferenceWindowLookup | null

/**
 * Synchronous indexed FASTA reader backed by a `.fai` sidecar index (#587).
 *
 * Supports random-access 1-based inclusive window queries across wrapped FASTA
 * lines and resolves both `chr`-prefixed and bare contig names (`chr1` <-> `1`).
 */
export class FastaIndexedReader {
  private fd: number | null
  private readonly entries = new Map<string, FaiEntry>()

  constructor(fastaPath: string, faiPath: string = `${fastaPath}.fai`) {
    const faiContent = fs.readFileSync(faiPath, 'utf8')
    this.parseFai(faiContent)
    this.fd = fs.openSync(fastaPath, 'r')
  }

  private parseFai(content: string): void {
    const lines = content.split(/\r?\n/)
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (line === '') continue
      const cols = line.split('\t')
      if (cols.length < 5) continue

      const name = cols[0].trim()
      const length = Number.parseInt(cols[1], 10)
      const offset = Number.parseInt(cols[2], 10)
      const lineBases = Number.parseInt(cols[3], 10)
      const lineWidth = Number.parseInt(cols[4], 10)

      if (
        name === '' ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(lineBases) ||
        lineBases <= 0 ||
        !Number.isSafeInteger(lineWidth) ||
        lineWidth < lineBases
      ) {
        continue
      }

      const entry: FaiEntry = { name, length, offset, lineBases, lineWidth }
      const upper = name.toUpperCase()
      const bare = upper.startsWith('CHR') ? upper.slice(3) : upper
      const prefixed = `CHR${bare}`

      if (!this.entries.has(name)) this.entries.set(name, entry)
      if (!this.entries.has(upper)) this.entries.set(upper, entry)
      if (!this.entries.has(bare)) this.entries.set(bare, entry)
      if (!this.entries.has(prefixed)) this.entries.set(prefixed, entry)
    }
  }

  private resolveEntry(chr: string): FaiEntry | undefined {
    return this.entries.get(chr) ?? this.entries.get(chr.trim().toUpperCase())
  }

  /**
   * Fetch a 1-based inclusive sequence window `[start1Based, end1BasedInclusive]`
   * as upper-case ASCII bases, or `null` when out of bounds or contig unknown.
   */
  fetch(chr: string, start1Based: number, end1BasedInclusive: number): string | null {
    if (this.fd === null) return null
    if (!Number.isSafeInteger(start1Based) || !Number.isSafeInteger(end1BasedInclusive)) {
      return null
    }
    const entry = this.resolveEntry(chr)
    if (entry === undefined) return null
    if (start1Based < 1 || end1BasedInclusive < start1Based || end1BasedInclusive > entry.length) {
      return null
    }

    const start0 = start1Based - 1
    const end0 = end1BasedInclusive - 1
    const byteStart =
      entry.offset +
      Math.floor(start0 / entry.lineBases) * entry.lineWidth +
      (start0 % entry.lineBases)
    const byteEndInclusive =
      entry.offset + Math.floor(end0 / entry.lineBases) * entry.lineWidth + (end0 % entry.lineBases)
    const byteLen = byteEndInclusive - byteStart + 1

    const buf = Buffer.allocUnsafe(byteLen)
    const bytesRead = fs.readSync(this.fd, buf, 0, byteLen, byteStart)
    if (bytesRead < byteLen) return null

    const seq = buf
      .toString('ascii', 0, bytesRead)
      .replace(/[\r\n]/g, '')
      .toUpperCase()
    const expectedBases = end1BasedInclusive - start1Based + 1
    return seq.length === expectedBases ? seq : null
  }

  /**
   * Return a `ReferenceWindowLookup` bound to `chr`, or `null` if `chr` is not in the index.
   */
  windowForContig(chr: string): ReferenceWindowLookup | null {
    if (this.fd === null || this.resolveEntry(chr) === undefined) return null
    return (start1Based: number, end1BasedInclusive: number): string | null =>
      this.fetch(chr, start1Based, end1BasedInclusive)
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd)
      this.fd = null
    }
  }
}

/**
 * Open an indexed reference FASTA reader when `fastaPath` or `VARLENS_REFERENCE_FASTA`
 * points to an existing `.fa`/`.fasta` with a sidecar `.fai` index; otherwise `null`.
 */
export function openConfiguredFastaReader(fastaPath?: string | null): FastaIndexedReader | null {
  const target = (fastaPath ?? process.env.VARLENS_REFERENCE_FASTA ?? '').trim()
  if (target === '') return null
  const faiPath = `${target}.fai`
  if (!fs.existsSync(target) || !fs.existsSync(faiPath)) return null
  return new FastaIndexedReader(target, faiPath)
}
