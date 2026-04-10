/**
 * VCF preview — lightweight metadata extraction for the import dialog.
 * Reads only headers + counts data lines without full parsing.
 */

import { createReadStream, statSync, readdirSync } from 'node:fs'
import { dirname, basename, extname, resolve as pathResolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { isGzipped } from '../stream-utils'
import { parseVcfHeaderFromLines } from './vcf-header-parser'
import { getFieldColumnMapping, DEFAULT_INFO_FIELD_MAPPINGS } from './info-field-registry'
import { detectCaller } from './caller-detector'
import type { VcfPreviewResult } from './types'
import type { VcfMultiPreviewResult } from '../../../shared/types/import'

/** Maximum number of data lines to count before estimating via file size */
const MAX_COUNTED_LINES = 100_000

/**
 * Get VCF file preview for the import dialog.
 * Reads headers for metadata and counts data lines for variant estimate.
 */
export async function getVcfPreview(filePath: string): Promise<VcfPreviewResult> {
  // Check gzip before creating stream — isGzipped uses openSync which throws for missing files
  const gzipped = isGzipped(filePath)
  const fileSize = statSync(filePath).size

  return new Promise((resolve, reject) => {
    const raw = createReadStream(filePath)
    const stream = gzipped ? raw.pipe(createGunzip()) : raw

    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    const headerLines: string[] = []
    let dataLineCount = 0
    let bytesReadAtCap = 0
    let capped = false
    let resolved = false

    rl.on('line', (line: string) => {
      if (line.startsWith('#')) {
        headerLines.push(line)
      } else {
        dataLineCount++
        if (dataLineCount >= MAX_COUNTED_LINES) {
          capped = true
          bytesReadAtCap = raw.bytesRead
          rl.close()
          raw.destroy()
        }
      }
    })

    rl.on('close', () => {
      if (resolved) return
      resolved = true

      try {
        const header = parseVcfHeaderFromLines(headerLines)
        const infoFields = getFieldColumnMapping(header.infoDefs, DEFAULT_INFO_FIELD_MAPPINGS)
        const callerInfo = detectCaller(header.rawHeaderLines)

        // Extrapolate total if we hit the cap
        let estimate = dataLineCount
        if (capped && bytesReadAtCap > 0) {
          estimate = Math.round(dataLineCount * (fileSize / bytesReadAtCap))
        }

        resolve({
          fileformat: header.fileformat,
          samples: header.samples,
          variantCountEstimate: estimate,
          annotationType: header.annotationType,
          detectedGenomeBuild: header.genomeBuild,
          infoFields,
          callerName: callerInfo.name !== 'unknown' ? callerInfo.name : null,
          callerVersion: callerInfo.version,
          defaultVariantType: callerInfo.defaultVariantType,
          filePath,
          fileSize
        })
      } catch (error) {
        reject(error)
      }
    })

    rl.on('error', (error) => {
      if (!resolved) {
        resolved = true
        reject(error)
      }
    })

    stream.on('error', (error) => {
      if (!resolved) {
        resolved = true
        reject(error)
      }
    })
  })
}

/**
 * Find BED files in the same directory as the given VCF files.
 * Used by the import wizard to auto-suggest region filters.
 */
function findSiblingBedFiles(vcfPaths: string[]): string[] {
  const bedFiles = new Set<string>()
  const seenDirs = new Set<string>()

  for (const vcfPath of vcfPaths) {
    const dir = dirname(vcfPath)
    if (seenDirs.has(dir)) continue
    seenDirs.add(dir)

    try {
      for (const file of readdirSync(dir)) {
        const lower = file.toLowerCase()
        if (lower.endsWith('.bed') || lower.endsWith('.bed.gz')) {
          bedFiles.add(pathResolve(dir, file))
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return Array.from(bedFiles)
}

/**
 * Derive a suggested case name from a VCF file path.
 * Strips path, .vcf/.vcf.gz extensions, and common suffixes like .wf_sv.
 */
function deriveCaseName(filePath: string): string {
  let name = basename(filePath)
  // Strip .gz
  if (name.endsWith('.gz')) name = name.slice(0, -3)
  // Strip .vcf
  if (name.endsWith('.vcf')) name = name.slice(0, -4)
  // Strip common pipeline suffixes
  name = name.replace(
    /\.(wf_snp|wf_sv|wf_cnv|wf_str|hard-filtered|snp|sv|cnv|repeats|vep|snpeff)$/i,
    ''
  )
  // If nothing left, fall back to basename without extension
  if (name === '') name = basename(filePath, extname(filePath))
  return name
}

/**
 * Preview multiple VCF files at once for the import wizard.
 * Scans each file's header, detects caller, finds sibling BED files,
 * and suggests a case name from the first file.
 */
export async function getVcfMultiPreview(filePaths: string[]): Promise<VcfMultiPreviewResult> {
  if (filePaths.length === 0) {
    return {
      files: [],
      siblingBedFiles: [],
      suggestedCaseName: ''
    }
  }

  const files: VcfPreviewResult[] = []
  for (const filePath of filePaths) {
    try {
      const preview = await getVcfPreview(filePath)
      files.push(preview)
    } catch {
      // Skip files that fail to preview — they'll error in the UI
    }
  }

  // Derive case name from the first file's sample ID if available, else from filename
  const firstFile = files[0]
  const suggestedCaseName =
    firstFile?.samples[0] !== undefined && firstFile.samples[0] !== ''
      ? firstFile.samples[0]
      : deriveCaseName(filePaths[0])

  return {
    files,
    siblingBedFiles: findSiblingBedFiles(filePaths),
    suggestedCaseName
  }
}
