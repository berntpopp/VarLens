/**
 * VCF header parser
 *
 * Parses ## meta lines and #CHROM header line from VCF files.
 * Extracts sample names, INFO/FORMAT definitions, contigs, and annotation type.
 */

import { createInterface } from 'node:readline'
import { createCappedLineStream } from '../stream-utils'
import { detectGenomeBuildFromVcfHeaders } from '../../services/GenomeBuildDetector'
import type { VcfHeader, InfoFieldDef, FormatFieldDef, ContigDef, AnnotationType } from './types'
import { VcfHeaderBudget, type VcfHeaderLimitOptions } from './vcf-header-limits'
import {
  MAX_VCF_ANNOTATION_FIELDS,
  MAX_VCF_HEADER_SAMPLES,
  MAX_VCF_STRUCTURED_HEADER_CHARS,
  MAX_VCF_STRUCTURED_HEADER_FIELDS,
  splitBounded,
  VcfResourceLimitError
} from './vcf-resource-limits'

/** Parse result includes the header and optionally the first data line */
export interface VcfHeaderParseResult {
  header: VcfHeader
  firstDataLine: string | null
}

/**
 * Scan the #CHROM row without splitting a potentially tab-dense line into an
 * unbounded temporary array. The header byte budget bounds string storage;
 * this independent token budget bounds per-sample JS allocation overhead.
 */
function parseHeaderSamples(line: string): string[] {
  const samples: string[] = []
  let columnIndex = 0
  let cursor = 0

  while (cursor <= line.length) {
    const delimiter = line.indexOf('\t', cursor)
    const end = delimiter === -1 ? line.length : delimiter
    if (columnIndex >= 9) {
      if (samples.length >= MAX_VCF_HEADER_SAMPLES) {
        throw new VcfResourceLimitError(
          `#CHROM header has more than ${MAX_VCF_HEADER_SAMPLES} samples`
        )
      }
      samples.push(line.slice(cursor, end).trim())
    }
    columnIndex += 1
    if (delimiter === -1) break
    cursor = delimiter + 1
  }

  return samples
}

/**
 * Parse a structured field definition from a VCF ## header line.
 * Handles: ##INFO=<ID=X,Number=Y,Type=Z,Description="...">
 */
function parseStructuredLine(line: string): Record<string, string> | null {
  if (line.length > MAX_VCF_STRUCTURED_HEADER_CHARS) {
    throw new VcfResourceLimitError(
      `Structured VCF header line exceeds ${MAX_VCF_STRUCTURED_HEADER_CHARS} characters`
    )
  }
  const match = line.match(/^##\w+=<(.+)>$/)
  if (!match) return null

  const result: Record<string, string> = {}
  const content = match[1]
  let i = 0
  let fieldCount = 0

  while (i < content.length) {
    // Find key
    const eqIdx = content.indexOf('=', i)
    if (eqIdx === -1) break

    const key = content.substring(i, eqIdx)
    fieldCount += 1
    if (fieldCount > MAX_VCF_STRUCTURED_HEADER_FIELDS) {
      throw new VcfResourceLimitError(
        `Structured VCF header has more than ${MAX_VCF_STRUCTURED_HEADER_FIELDS} fields`
      )
    }
    i = eqIdx + 1

    // Find value
    if (content[i] === '"') {
      // Quoted value — find closing quote (handle escaped quotes)
      i++ // skip opening quote
      let value = ''
      while (i < content.length) {
        if (content[i] === '\\' && i + 1 < content.length) {
          value += content[i + 1]
          i += 2
        } else if (content[i] === '"') {
          i++ // skip closing quote
          break
        } else {
          value += content[i]
          i++
        }
      }
      result[key] = value
      // Skip comma after value
      if (i < content.length && content[i] === ',') i++
    } else {
      // Unquoted value — find comma or end
      const commaIdx = content.indexOf(',', i)
      if (commaIdx === -1) {
        result[key] = content.substring(i)
        i = content.length
      } else {
        result[key] = content.substring(i, commaIdx)
        i = commaIdx + 1
      }
    }
  }

  return result
}

/**
 * Extract CSQ subfield names from the CSQ INFO description.
 * VEP CSQ descriptions contain "Format: Allele|Consequence|IMPACT|..."
 */
function extractCsqFields(description: string): string[] | null {
  const match = description.match(/Format:\s*(.+)/)
  if (!match) return null

  const fields = splitBounded(match[1], '|', MAX_VCF_ANNOTATION_FIELDS)
  if (fields === null) {
    throw new VcfResourceLimitError(
      `CSQ header has more than ${MAX_VCF_ANNOTATION_FIELDS} format fields`
    )
  }
  return fields.map((field) => field.trim())
}

/**
 * Parse VCF header from an array of header lines (synchronous).
 * Used by both the stream-based parser and unit tests.
 */
export function parseVcfHeaderFromLines(lines: string[]): VcfHeader {
  let fileformat = ''
  const samples: string[] = []
  const infoDefs = new Map<string, InfoFieldDef>()
  const formatDefs = new Map<string, FormatFieldDef>()
  const contigs = new Map<string, ContigDef>()
  let csqFields: string[] | null = null
  const rawHeaderLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('##')) {
      rawHeaderLines.push(line)

      // ##fileformat=VCFv4.x
      if (line.startsWith('##fileformat=')) {
        fileformat = line.substring('##fileformat='.length).trim()
        continue
      }

      // ##INFO=<ID=...,Number=...,Type=...,Description="...">
      if (line.startsWith('##INFO=')) {
        const fields = parseStructuredLine(line)
        if (fields && fields.ID) {
          const def: InfoFieldDef = {
            id: fields.ID,
            number: fields.Number || '.',
            type: (fields.Type || 'String') as InfoFieldDef['type'],
            description: fields.Description || ''
          }
          infoDefs.set(def.id, def)

          // Check for CSQ Format subfield names
          if (def.id === 'CSQ' && def.description) {
            csqFields = extractCsqFields(def.description)
          }
        }
        continue
      }

      // ##FORMAT=<ID=...,Number=...,Type=...,Description="...">
      if (line.startsWith('##FORMAT=')) {
        const fields = parseStructuredLine(line)
        if (fields && fields.ID) {
          const def: FormatFieldDef = {
            id: fields.ID,
            number: fields.Number || '.',
            type: (fields.Type || 'String') as FormatFieldDef['type'],
            description: fields.Description || ''
          }
          formatDefs.set(def.id, def)
        }
        continue
      }

      // ##contig=<ID=...,length=...>
      if (line.startsWith('##contig=')) {
        const fields = parseStructuredLine(line)
        if (fields && fields.ID) {
          const contig: ContigDef = {
            id: fields.ID,
            length: fields.length ? parseInt(fields.length, 10) : undefined
          }
          contigs.set(contig.id, contig)
        }
        continue
      }
    } else if (line.startsWith('#CHROM')) {
      // #CHROM line — extract sample names from columns 10+
      samples.push(...parseHeaderSamples(line))
    }
  }

  // Detect annotation type: CSQ takes priority over ANN
  let annotationType: AnnotationType = 'none'
  if (infoDefs.has('CSQ') && csqFields !== null) {
    annotationType = 'csq'
  } else if (infoDefs.has('ANN')) {
    annotationType = 'ann'
  }

  // Detect genome build using existing GenomeBuildDetector
  const genomeBuild = detectGenomeBuildFromVcfHeaders(rawHeaderLines)

  return {
    fileformat,
    samples,
    infoDefs,
    formatDefs,
    contigs,
    annotationType,
    csqFields,
    genomeBuild,
    rawHeaderLines
  }
}

/**
 * Parse VCF header from a file path (streaming).
 * Reads lines until the first non-# line, then returns the header
 * and the first data line (so the caller doesn't miss it).
 */
export async function parseVcfHeader(
  filePath: string,
  options: VcfHeaderLimitOptions = {}
): Promise<VcfHeaderParseResult> {
  return new Promise((resolve, reject) => {
    // Shared capped reader guards against a giant single line and a
    // decompression bomb -- see stream-utils.ts for the cap rationale.
    const { stream } = createCappedLineStream(filePath)

    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    const headerLines: string[] = []
    const headerBudget = new VcfHeaderBudget(options)
    let firstDataLine: string | null = null
    let settled = false

    const cleanup = (): void => {
      rl.close()
      stream.destroy()
    }

    const settle = (error?: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error !== undefined) {
        reject(error)
        return
      }
      try {
        resolve({ header: parseVcfHeaderFromLines(headerLines), firstDataLine })
      } catch (parseError) {
        reject(parseError)
      }
    }

    rl.on('line', (line: string) => {
      if (settled) return
      if (line.startsWith('#')) {
        try {
          headerBudget.add(line)
          headerLines.push(line)
        } catch (error) {
          settle(error)
        }
      } else {
        firstDataLine = line
        settle()
      }
    })

    rl.on('close', () => settle())
    rl.on('error', settle)
    stream.on('error', settle)
  })
}
