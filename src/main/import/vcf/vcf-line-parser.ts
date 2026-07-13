/**
 * VCF line parser
 *
 * Parses a single VCF data line (tab-separated) into a VcfRawRecord.
 * Pure string operations — no complex parsing needed.
 */

import type { VcfRawRecord } from './types'
import {
  MAX_VCF_ALT_ALLELES,
  MAX_VCF_COLUMNS,
  MAX_VCF_FORMAT_FIELDS,
  MAX_VCF_INFO_CHARS,
  MAX_VCF_INFO_FIELDS,
  MAX_VCF_SAMPLE_FIELD_CHARS,
  MAX_VCF_TOTAL_SAMPLE_VALUES,
  splitBounded
} from './vcf-resource-limits'

const QUAL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

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
  const cols = splitBounded(line, '\t', MAX_VCF_COLUMNS)
  if (cols === null) {
    onSkip?.(`too many VCF columns (maximum ${MAX_VCF_COLUMNS})`)
    return null
  }

  // VCF requires at least 8 fixed columns (CHROM through INFO)
  if (cols.length < 8) {
    onSkip?.(`truncated VCF row (${cols.length} columns; expected at least 8)`)
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
  const pos = Number(rawPos)
  if (!Number.isSafeInteger(pos) || pos <= 0 || !/^\d+$/.test(rawPos)) {
    onSkip?.(`invalid POS "${rawPos}" (must be a positive safe integer)`)
    return null
  }

  // Parse ID: "." means missing
  const id = rawId === '.' ? null : rawId

  // Parse ALT: comma-separated alleles
  const alt = splitBounded(rawAlt, ',', MAX_VCF_ALT_ALLELES)
  if (alt === null) {
    onSkip?.(`too many ALT alleles (maximum ${MAX_VCF_ALT_ALLELES})`)
    return null
  }

  // Parse QUAL: "." (or absent) means missing. Any other value must be a
  // complete finite number; malformed QUAL is a reasoned record skip rather
  // than being silently reinterpreted as the semantically distinct ".".
  let qual: number | null = null
  if (rawQual !== '.' && rawQual !== undefined) {
    const parsedQual = QUAL_NUMBER_PATTERN.test(rawQual) ? Number(rawQual) : Number.NaN
    if (!Number.isFinite(parsedQual)) {
      onSkip?.(`invalid QUAL "${rawQual}" (must be "." or a finite number)`)
      return null
    }
    qual = parsedQual
  }

  // Parse INFO: semicolon-separated key=value pairs
  const info = new Map<string, string>()
  if (rawInfo !== '.' && rawInfo !== undefined && rawInfo !== '') {
    if (rawInfo.length > MAX_VCF_INFO_CHARS) {
      onSkip?.(`INFO field exceeds ${MAX_VCF_INFO_CHARS} characters`)
      return null
    }
    const infoParts = splitBounded(rawInfo, ';', MAX_VCF_INFO_FIELDS)
    if (infoParts === null) {
      onSkip?.(`too many INFO fields (maximum ${MAX_VCF_INFO_FIELDS})`)
      return null
    }
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
    const parsedFormat = splitBounded(cols[8], ':', MAX_VCF_FORMAT_FIELDS)
    if (parsedFormat === null) {
      onSkip?.(`too many FORMAT fields (maximum ${MAX_VCF_FORMAT_FIELDS})`)
      return null
    }
    format = parsedFormat

    let totalSampleValues = 0
    for (let i = 0; i < sampleNames.length; i++) {
      const sampleCol = cols[9 + i]
      if (sampleCol !== undefined) {
        if (sampleCol.length > MAX_VCF_SAMPLE_FIELD_CHARS) {
          onSkip?.(`sample field exceeds ${MAX_VCF_SAMPLE_FIELD_CHARS} characters`)
          return null
        }
        const values = splitBounded(sampleCol, ':', MAX_VCF_FORMAT_FIELDS)
        if (values === null) {
          onSkip?.(`too many sample FORMAT values (maximum ${MAX_VCF_FORMAT_FIELDS})`)
          return null
        }
        totalSampleValues += values.length
        if (totalSampleValues > MAX_VCF_TOTAL_SAMPLE_VALUES) {
          onSkip?.(`too many sample FORMAT values (maximum ${MAX_VCF_TOTAL_SAMPLE_VALUES})`)
          return null
        }
        samples.set(sampleNames[i], values)
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
