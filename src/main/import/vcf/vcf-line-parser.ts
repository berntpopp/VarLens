/**
 * VCF line parser
 *
 * Parses a single VCF data line (tab-separated) into a VcfRawRecord.
 * Pure string operations — no complex parsing needed.
 */

import type { VcfRawRecord } from './types'
import { parseVcfInfo } from '../../../shared/vcf/vcf-info'

/**
 * Parse a single VCF data line into a raw record.
 *
 * @param line - Tab-separated VCF data line (non-header, non-comment)
 * @param sampleNames - Sample names from the VCF header (#CHROM line columns 10+)
 * @returns Parsed raw record
 */
export function parseVcfLine(line: string, sampleNames: string[]): VcfRawRecord | null {
  const cols = line.split('\t')

  // VCF requires at least 8 fixed columns (CHROM through INFO)
  if (cols.length < 8) {
    return null
  }

  // VCF has 8 fixed columns, optionally FORMAT + sample columns
  const chrom = cols[0]
  const pos = parseInt(cols[1], 10)
  const rawId = cols[2]
  const ref = cols[3]
  const rawAlt = cols[4]
  const rawQual = cols[5]
  const filter = cols[6]
  const rawInfo = cols[7]

  // Parse ID: "." means missing
  const id = rawId === '.' ? null : rawId

  // Parse ALT: comma-separated alleles
  const alt = rawAlt.split(',')

  // Parse QUAL: "." means missing
  const qual = rawQual === '.' || rawQual === undefined ? null : parseFloat(rawQual)

  const info = parseVcfInfo(rawInfo ?? '')

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
