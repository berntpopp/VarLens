/**
 * VCF line parser
 *
 * Parses a single VCF data line (tab-separated) into a VcfRawRecord.
 * Pure string operations — no complex parsing needed.
 */

import type { VcfRawRecord } from './types'

/**
 * Parse a single VCF data line into a raw record.
 *
 * @param line - Tab-separated VCF data line (non-header, non-comment)
 * @param sampleNames - Sample names from the VCF header (#CHROM line columns 10+)
 * @param onSkip - Optional callback invoked with a human-readable reason when
 *   the line is rejected. Callers with a diagnostics/errors channel should
 *   wire this through so a malformed line is a *counted, reasoned* skip
 *   rather than a silent one.
 * @returns Parsed raw record, or `null` if the line is rejected
 */
export function parseVcfLine(
  line: string,
  sampleNames: string[],
  onSkip?: (reason: string) => void
): VcfRawRecord | null {
  const cols = line.split('\t')

  // VCF requires at least 8 fixed columns (CHROM through INFO)
  if (cols.length < 8) {
    return null
  }

  // VCF has 8 fixed columns, optionally FORMAT + sample columns
  const chrom = cols[0]
  const rawPos = cols[1]
  const rawId = cols[2]
  const ref = cols[3]
  const rawAlt = cols[4]
  const rawQual = cols[5]
  const filter = cols[6]
  const rawInfo = cols[7]

  // Parse POS: must be a positive integer per the VCF spec. A malformed POS
  // (non-numeric, zero, negative, or fractional) is rejected outright rather
  // than allowed to flow forward as `NaN` — a NaN row would otherwise pass
  // silently through downstream mapping/insert paths.
  const pos = Number.parseInt(rawPos, 10)
  if (!Number.isInteger(pos) || pos <= 0 || !/^\d+$/.test(rawPos)) {
    onSkip?.(`invalid POS "${rawPos}" (must be a positive integer)`)
    return null
  }

  // Parse ID: "." means missing
  const id = rawId === '.' ? null : rawId

  // Parse ALT: comma-separated alleles
  const alt = rawAlt.split(',')

  // Parse QUAL: "." (or absent) means missing; a malformed (non-numeric)
  // QUAL becomes `null` rather than `NaN` — QUAL is optional per the VCF
  // spec, so a bad value doesn't invalidate the record.
  let qual: number | null = null
  if (rawQual !== '.' && rawQual !== undefined) {
    const parsedQual = Number.parseFloat(rawQual)
    qual = Number.isNaN(parsedQual) ? null : parsedQual
  }

  // Parse INFO: semicolon-separated key=value pairs
  const info = new Map<string, string>()
  if (rawInfo !== '.' && rawInfo !== undefined && rawInfo !== '') {
    const infoParts = rawInfo.split(';')
    for (const part of infoParts) {
      const eqIdx = part.indexOf('=')
      if (eqIdx === -1) {
        // FLAG field (no value)
        info.set(part, '')
      } else {
        info.set(part.substring(0, eqIdx), part.substring(eqIdx + 1))
      }
    }
  }

  // Parse FORMAT and sample columns
  let format: string[] = []
  const samples = new Map<string, string[]>()

  if (cols.length > 8 && cols[8] !== undefined && cols[8] !== '') {
    format = cols[8].split(':')

    for (let i = 0; i < sampleNames.length; i++) {
      const sampleCol = cols[9 + i]
      if (sampleCol !== undefined) {
        samples.set(sampleNames[i], sampleCol.split(':'))
      }
    }
  }

  return {
    chrom,
    pos,
    id,
    ref,
    alt,
    qual,
    filter,
    info,
    format,
    samples
  }
}
