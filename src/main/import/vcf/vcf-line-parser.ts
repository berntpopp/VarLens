/**
 * VCF line parser
 *
 * Parses a single VCF data line (tab-separated) into a VcfRawRecord.
 * Pure string operations — no complex parsing needed.
 */

import type { VcfRawRecord } from './types'
import {
  MAX_VCF_ALT_ALLELES,
  MAX_VCF_COMPATIBILITY_SAMPLES,
  MAX_VCF_FORMAT_CHARS,
  MAX_VCF_FORMAT_FIELDS,
  MAX_VCF_INFO_CHARS,
  MAX_VCF_INFO_FIELDS,
  MAX_VCF_SAMPLE_FIELD_CHARS,
  splitBounded
} from './vcf-resource-limits'

const QUAL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export interface VcfSelectedSampleColumn {
  name: string
  index: number
}

export function resolveVcfSelectedSampleColumn(
  sampleNames: string[],
  requestedSample?: string
): VcfSelectedSampleColumn | null {
  const name =
    requestedSample !== undefined && requestedSample !== '' ? requestedSample : sampleNames[0]
  if (name === undefined || name === '') return null
  const index = sampleNames.indexOf(name)
  if (index < 0) throw new Error(`Selected VCF sample "${name}" is not present in the header`)
  return { name, index }
}

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
  onSkip?: (reason: string) => void,
  selectedSample?: VcfSelectedSampleColumn
): VcfRawRecord | null {
  if (selectedSample === undefined && sampleNames.length > MAX_VCF_COMPATIBILITY_SAMPLES) {
    onSkip?.(
      `all-samples compatibility parsing exceeds ${MAX_VCF_COMPATIBILITY_SAMPLES} samples; select one sample`
    )
    return null
  }
  if (
    selectedSample !== undefined &&
    (!Number.isSafeInteger(selectedSample.index) ||
      selectedSample.index < 0 ||
      sampleNames[selectedSample.index] !== selectedSample.name)
  ) {
    onSkip?.(`selected VCF sample "${selectedSample.name}" is not present in the header`)
    return null
  }
  const selectedSampleIndex = selectedSample?.index ?? -1
  const {
    fixedColumns: cols,
    selectedColumn,
    remainingColumns
  } = scanVcfColumns(line, selectedSampleIndex)
  if (remainingColumns === null) {
    onSkip?.(
      `all-samples compatibility parsing exceeds ${MAX_VCF_COMPATIBILITY_SAMPLES} sample columns`
    )
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
    if (cols[8].length > MAX_VCF_FORMAT_CHARS) {
      onSkip?.(`FORMAT field exceeds ${MAX_VCF_FORMAT_CHARS} characters`)
      return null
    }
    const parsedFormat = splitBounded(cols[8], ':', MAX_VCF_FORMAT_FIELDS)
    if (parsedFormat === null) {
      onSkip?.(`too many FORMAT fields (maximum ${MAX_VCF_FORMAT_FIELDS})`)
      return null
    }
    format = parsedFormat

    const samplesToParse: Array<{ name: string; value: string | undefined }> =
      selectedSample !== undefined
        ? [{ name: selectedSample.name, value: selectedColumn }]
        : sampleNames.map((name, index) => ({ name, value: remainingColumns[index] }))

    for (const { name, value: sampleCol } of samplesToParse) {
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
        samples.set(name, values)
      } else if (selectedSample !== undefined) {
        onSkip?.(`VCF row is missing selected sample column "${selectedSample.name}"`)
        return null
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

/**
 * Read the nine fixed/FORMAT fields plus at most one selected sample column.
 * Production importers always provide a selected sample, so cohort-width does
 * not create a cohort-width array or sample map. The compatibility path that
 * omits a selected sample retains all remaining columns for small direct users.
 */
function scanVcfColumns(
  line: string,
  selectedSampleIndex: number
): {
  fixedColumns: string[]
  selectedColumn: string | undefined
  remainingColumns: string[] | null
} {
  const fixedColumns: string[] = []
  let cursor = 0

  while (fixedColumns.length < 9 && cursor <= line.length) {
    const delimiter = line.indexOf('\t', cursor)
    if (delimiter === -1) {
      fixedColumns.push(line.slice(cursor))
      cursor = line.length + 1
      break
    }
    fixedColumns.push(line.slice(cursor, delimiter))
    cursor = delimiter + 1
  }

  if (selectedSampleIndex >= 0) {
    let sampleIndex = 0
    while (cursor <= line.length) {
      const delimiter = line.indexOf('\t', cursor)
      const end = delimiter === -1 ? line.length : delimiter
      if (sampleIndex === selectedSampleIndex) {
        return {
          fixedColumns,
          selectedColumn: line.slice(cursor, end),
          remainingColumns: []
        }
      }
      if (delimiter === -1) break
      cursor = delimiter + 1
      sampleIndex += 1
    }
    return { fixedColumns, selectedColumn: undefined, remainingColumns: [] }
  }

  const remainingColumns =
    cursor <= line.length
      ? splitBounded(line.slice(cursor), '\t', MAX_VCF_COMPATIBILITY_SAMPLES)
      : []
  return {
    fixedColumns,
    selectedColumn: undefined,
    remainingColumns
  }
}
