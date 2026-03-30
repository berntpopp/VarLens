/**
 * VCF preview — lightweight metadata extraction for the import dialog.
 * Reads only headers + counts data lines without full parsing.
 */

import { createReadStream, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { isGzipped } from '../stream-utils'
import { parseVcfHeaderFromLines } from './vcf-header-parser'
import { getFieldColumnMapping, DEFAULT_INFO_FIELD_MAPPINGS } from './info-field-registry'
import type { VcfPreviewResult } from './types'

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
          infoFields
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
