/**
 * VCF genotype parser
 *
 * Extracts per-sample GT/GQ/DP/AD fields from VCF FORMAT+sample columns.
 * Pure functions with no side effects.
 */

import type { GenotypeData } from './types'

/**
 * Parse genotype data from sample values using FORMAT field order.
 *
 * @param sampleValues - Colon-split values for one sample (e.g. ["0/1", "99", "45", "22,23"])
 * @param formatFields - FORMAT field order (e.g. ["GT", "GQ", "DP", "AD"])
 * @param altAlleleIndex - 1-based index of ALT allele for multi-allelic AD extraction (default 1)
 * @returns Parsed genotype data
 */
export function parseGenotype(
  sampleValues: string[],
  formatFields: string[],
  altAlleleIndex: number = 1
): GenotypeData {
  // Build index map for FORMAT fields
  const fieldIndex = new Map<string, number>()
  for (let i = 0; i < formatFields.length; i++) {
    fieldIndex.set(formatFields[i], i)
  }

  // Extract GT
  const gtIdx = fieldIndex.get('GT')
  const gt = gtIdx !== undefined && gtIdx < sampleValues.length ? sampleValues[gtIdx] : '.'

  // Extract GQ
  const gqIdx = fieldIndex.get('GQ')
  const gq = parseIntField(gqIdx, sampleValues)

  // Extract DP
  const dpIdx = fieldIndex.get('DP')
  const dp = parseIntField(dpIdx, sampleValues)

  // Extract AD (comma-separated: ref,alt1[,alt2,...])
  const adIdx = fieldIndex.get('AD')
  let adRef: number | null = null
  let adAlt: number | null = null

  if (adIdx !== undefined && adIdx < sampleValues.length) {
    const adStr = sampleValues[adIdx]
    if (adStr !== '.' && adStr !== '') {
      const adParts = adStr.split(',')
      if (adParts.length >= 2) {
        const refVal = parseInt(adParts[0], 10)
        const altVal = parseInt(adParts[altAlleleIndex] || adParts[1], 10)
        adRef = isNaN(refVal) ? null : refVal
        adAlt = isNaN(altVal) ? null : altVal
      }
    }
  }

  // Compute allele balance
  let ab: number | null = null
  if (adRef !== null && adAlt !== null) {
    const total = adRef + adAlt
    if (total > 0) {
      ab = adAlt / total
    }
  }

  return { gt, gq, dp, adRef, adAlt, ab }
}

/**
 * Parse an integer field from sample values.
 * Returns null for missing values (".") or invalid numbers.
 */
function parseIntField(fieldIdx: number | undefined, sampleValues: string[]): number | null {
  if (fieldIdx === undefined || fieldIdx >= sampleValues.length) return null
  const val = sampleValues[fieldIdx]
  if (val === '.' || val === '') return null
  const parsed = parseInt(val, 10)
  return isNaN(parsed) ? null : parsed
}
