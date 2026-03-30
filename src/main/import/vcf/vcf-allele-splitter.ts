/**
 * VCF allele splitter
 *
 * Decomposes multi-allelic VCF records into biallelic records,
 * respecting VCF Number semantics for INFO and FORMAT fields.
 */

import type { VcfRawRecord, InfoFieldDef, FormatFieldDef } from './types'

/**
 * Split a multi-allelic VcfRawRecord into one record per ALT allele.
 * Single-allelic records pass through unchanged (returned as a one-element array).
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
  // Single-allelic: pass through
  if (record.alt.length <= 1) {
    return [record]
  }

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
        const parts = value.split(',')
        if (altIdx < parts.length) {
          result.set(key, parts[altIdx])
        } else {
          result.set(key, value)
        }
        break
      }

      case 'R': {
        // Per-allele (REF + ALTs) — keep REF (index 0) + current ALT
        const parts = value.split(',')
        if (parts.length > altIdx + 1) {
          result.set(key, `${parts[0]},${parts[altIdx + 1]}`)
        } else {
          result.set(key, value)
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
  const originalAltAllele = altIdx + 1 // 1-based allele number in GT

  for (const [sampleName, values] of record.samples) {
    const newValues = [...values]

    for (let fIdx = 0; fIdx < record.format.length; fIdx++) {
      const field = record.format[fIdx]
      if (fIdx >= values.length) break

      if (field === 'GT') {
        newValues[fIdx] = remapGenotype(values[fIdx], originalAltAllele)
        continue
      }

      const def = formatDefs.get(field)
      const number = def?.number ?? '.'

      if (number === 'R') {
        // Per-allele (REF + ALTs) — keep REF + current ALT
        const parts = values[fIdx].split(',')
        if (parts.length > altIdx + 1) {
          newValues[fIdx] = `${parts[0]},${parts[altIdx + 1]}`
        }
      } else if (number === 'A') {
        // Per-ALT — select value at altIdx
        const parts = values[fIdx].split(',')
        if (altIdx < parts.length) {
          newValues[fIdx] = parts[altIdx]
        }
      }
      // Number=1, 0, ., G: keep as-is
    }

    result.set(sampleName, newValues)
  }

  return result
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
  const alleles = gt.split(/[/|]/)

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
