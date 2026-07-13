/**
 * VCF allele splitter
 *
 * Decomposes multi-allelic VCF records into biallelic records,
 * respecting VCF Number semantics for INFO and FORMAT fields.
 */

import type { VcfRawRecord, InfoFieldDef, FormatFieldDef } from './types'
import {
  MAX_VCF_ALT_ALLELES,
  splitBounded,
  splitGenotypeAlleles,
  VcfResourceLimitError
} from './vcf-resource-limits'

function splitAlleleValues(value: string): string[] {
  const parts = splitBounded(value, ',', MAX_VCF_ALT_ALLELES + 1)
  if (parts === null) {
    throw new VcfResourceLimitError(
      `Allele-valued field has more than ${MAX_VCF_ALT_ALLELES + 1} values`
    )
  }
  return parts
}

function normalizeVectorToken(value: string | undefined): string {
  return value === undefined || value === '' ? '.' : value
}

/**
 * Split a multi-allelic VcfRawRecord into one record per ALT allele.
 * Single-allelic records are also normalized so Number=A/R FORMAT vectors
 * have the same biallelic representation as split multi-allelic records.
 *
 * @param record - Raw VCF record (may have multiple ALT alleles)
 * @param infoDefs - INFO field definitions from VCF header (for Number semantics)
 * @param formatDefs - FORMAT field definitions from VCF header (for Number semantics)
 * @returns Array of biallelic records (one per ALT allele)
 */
export function splitMultiAllelic(
  record: VcfRawRecord,
  infoDefs: Map<string, InfoFieldDef>,
  formatDefs: Map<string, FormatFieldDef>
): VcfRawRecord[] {
  const results: VcfRawRecord[] = []

  for (let altIdx = 0; altIdx < record.alt.length; altIdx++) {
    const splitRecord: VcfRawRecord = {
      chrom: record.chrom,
      pos: record.pos,
      id: record.id,
      ref: record.ref,
      alt: [record.alt[altIdx]],
      qual: record.qual,
      filter: record.filter,
      info: splitInfoFields(record.info, infoDefs, altIdx),
      format: record.format,
      samples: splitSampleFields(record, formatDefs, altIdx)
    }
    results.push(splitRecord)
  }

  return results
}

/**
 * Build one biallelic view for one selected sample. Import mapping uses this
 * instead of materializing every ALT × every sample clone up front.
 */
export function splitAlleleForSample(
  record: VcfRawRecord,
  infoDefs: Map<string, InfoFieldDef>,
  formatDefs: Map<string, FormatFieldDef>,
  altIdx: number,
  sampleName: string
): VcfRawRecord {
  if (!Number.isSafeInteger(altIdx) || altIdx < 0 || altIdx >= record.alt.length) {
    throw new RangeError(`ALT index ${altIdx} is outside the VCF record`)
  }
  const sampleValues = record.samples.get(sampleName)
  const samples = new Map<string, string[]>()
  if (sampleValues !== undefined) {
    samples.set(sampleName, splitOneSampleFields(record.format, sampleValues, formatDefs, altIdx))
  }
  return {
    chrom: record.chrom,
    pos: record.pos,
    id: record.id,
    ref: record.ref,
    alt: [record.alt[altIdx]],
    qual: record.qual,
    filter: record.filter,
    info: splitInfoFields(record.info, infoDefs, altIdx),
    format: record.format,
    samples
  }
}

/**
 * Split INFO fields according to their Number attribute.
 */
function splitInfoFields(
  info: Map<string, string>,
  infoDefs: Map<string, InfoFieldDef>,
  altIdx: number
): Map<string, string> {
  const result = new Map<string, string>()

  for (const [key, value] of info) {
    const def = infoDefs.get(key)
    const number = def?.number ?? '.'

    switch (number) {
      case '0': // Flag — copy to all
      case '1': // Single value — copy to all
        result.set(key, value)
        break

      case 'A': {
        // Per-ALT allele — select value at altIdx
        const parts = splitAlleleValues(value)
        result.set(key, normalizeVectorToken(parts[altIdx]))
        break
      }

      case 'R': {
        // Per-allele (REF + ALTs) — keep REF (index 0) + current ALT
        const parts = splitAlleleValues(value)
        if (parts.length > altIdx + 1) {
          result.set(
            key,
            `${normalizeVectorToken(parts[0])},${normalizeVectorToken(parts[altIdx + 1])}`
          )
        } else {
          result.set(key, `${normalizeVectorToken(parts[0])},.`)
        }
        break
      }

      case 'G':
        // Per-genotype — complex, just copy as-is for now
        result.set(key, value)
        break

      default:
        // "." or unknown — copy as-is (CSQ/ANN handled by annotation parser)
        result.set(key, value)
        break
    }
  }

  return result
}

/**
 * Split per-sample FORMAT fields, remapping GT and splitting Number=R fields.
 */
function splitSampleFields(
  record: VcfRawRecord,
  formatDefs: Map<string, FormatFieldDef>,
  altIdx: number
): Map<string, string[]> {
  const result = new Map<string, string[]>()

  for (const [sampleName, values] of record.samples) {
    result.set(sampleName, splitOneSampleFields(record.format, values, formatDefs, altIdx))
  }

  return result
}

function splitOneSampleFields(
  format: string[],
  values: string[],
  formatDefs: Map<string, FormatFieldDef>,
  altIdx: number
): string[] {
  const newValues = [...values]
  const originalAltAllele = altIdx + 1

  for (let fIdx = 0; fIdx < format.length; fIdx++) {
    const field = format[fIdx]
    if (fIdx >= values.length) break

    if (field === 'GT') {
      newValues[fIdx] = remapGenotype(values[fIdx], originalAltAllele)
      continue
    }

    const number = formatDefs.get(field)?.number ?? (field === 'AD' ? 'R' : '.')
    if (number === 'R') {
      const parts = splitAlleleValues(values[fIdx])
      if (parts.length > altIdx + 1) {
        newValues[fIdx] =
          `${normalizeVectorToken(parts[0])},${normalizeVectorToken(parts[altIdx + 1])}`
      } else {
        newValues[fIdx] = `${normalizeVectorToken(parts[0])},.`
      }
    } else if (number === 'A') {
      const parts = splitAlleleValues(values[fIdx])
      const selected = normalizeVectorToken(parts[altIdx])
      newValues[fIdx] = field === 'AD' ? `.,${selected}` : selected
    }
  }

  return newValues
}

/**
 * Remap a GT string for a specific ALT allele.
 * - The target allele (originalAltAllele) becomes 1
 * - REF (0) stays 0
 * - All other alleles become "." (missing)
 *
 * @param gt - Original GT string (e.g. "0/2", "1/2")
 * @param originalAltAllele - 1-based allele number to keep (e.g. 2 for second ALT)
 * @returns Remapped GT string (e.g. "0/1", "1/.")
 */
function remapGenotype(gt: string, originalAltAllele: number): string {
  // Determine separator
  const separator = gt.includes('|') ? '|' : '/'
  const alleles = splitGenotypeAlleles(gt)
  if (alleles === null) throw new VcfResourceLimitError('Genotype ploidy exceeds 64 alleles')

  const remapped = alleles.map((a) => {
    if (a === '.') return '.'
    const num = parseInt(a, 10)
    if (isNaN(num)) return '.'
    if (num === 0) return '0'
    if (num === originalAltAllele) return '1'
    return '.'
  })

  return remapped.join(separator)
}
