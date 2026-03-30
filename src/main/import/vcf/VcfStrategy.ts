/**
 * VCF import strategy
 *
 * Implements ImportStrategy for VCF (.vcf, .vcf.gz) files.
 * Streams line-by-line, parses headers once, splits alleles, extracts
 * annotations and genotypes, then inserts via the existing bulk insert pipeline.
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { isGzipped } from '../stream-utils'
import type { ImportOptions, ImportResult } from '../types'
import type { ImportStrategy, FormatInfo, StrategyContext } from '../strategies/ImportStrategy'
import type { VcfImportOptions, VcfMappedVariant, VcfHeader } from './types'
import { parseVcfHeaderFromLines } from './vcf-header-parser'
import { parseVcfLine } from './vcf-line-parser'
import { mapVcfRecord } from './VcfMapper'
import { DEFAULT_INFO_FIELD_MAPPINGS } from './info-field-registry'
export class VcfStrategy implements ImportStrategy {
  readonly formatId = 'vcf' as const

  canHandle(formatInfo: FormatInfo): boolean {
    return formatInfo.format === 'vcf'
  }

  async import(
    filePath: string,
    options: ImportOptions,
    context: StrategyContext,
    vcfOptions?: VcfImportOptions
  ): Promise<ImportResult> {
    const { db, caseId, startTime } = context
    const batchSize = options.batchSize ?? 5000

    // Read file line by line
    const raw = createReadStream(filePath)
    const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    const headerLines: string[] = []
    let header: VcfHeader | null = null
    let activeSample = ''
    let totalInserted = 0
    let totalSkipped = 0
    const errors: string[] = []
    let batch: VcfMappedVariant[] = []

    // Drop FTS triggers for bulk insert performance
    db.variants.beginBulkInsert()

    try {
      for await (const line of rl) {
        // Check cancellation
        if (options.signal?.aborted === true) {
          errors.push('Import cancelled by user')
          break
        }

        // Collect header lines
        if (line.startsWith('#')) {
          headerLines.push(line)
          continue
        }

        // Parse header once, on the first data line
        if (header === null) {
          header = parseVcfHeaderFromLines(headerLines)
          const selectedSample = vcfOptions?.selectedSamples?.[0]
          activeSample = selectedSample ?? (header.samples.length > 0 ? header.samples[0] : '')

          if (activeSample === '') {
            errors.push('No sample found in VCF file')
            break
          }
        }

        // Parse the data line
        try {
          const record = parseVcfLine(line, header.samples)
          if (record === null) {
            totalSkipped++
            continue
          }
          const mapped = mapVcfRecord(record, header, activeSample, DEFAULT_INFO_FIELD_MAPPINGS)

          if (mapped.length === 0) {
            totalSkipped++
          } else {
            for (const variant of mapped) {
              batch.push(variant)
            }
          }

          // Flush batch when full
          if (batch.length >= batchSize) {
            db.variants.insertBatch(batch, caseId)
            totalInserted += batch.length
            batch = []

            if (options.onProgress) {
              options.onProgress({
                phase: 'inserting',
                count: totalInserted,
                elapsed: Date.now() - startTime,
                skipped: totalSkipped
              })
            }
          }
        } catch (lineError) {
          totalSkipped++
          if (errors.length < 10) {
            errors.push(
              `Line parse error at pos ${line.substring(0, 50)}: ${lineError instanceof Error ? lineError.message : String(lineError)}`
            )
          }
        }
      }

      // Flush remaining batch
      if (batch.length > 0) {
        db.variants.insertBatch(batch, caseId)
        totalInserted += batch.length
      }
    } finally {
      // Always restore FTS triggers and update case
      db.variants.finishBulkInsert(caseId, totalInserted)
    }

    const elapsed = Date.now() - startTime

    return {
      caseId,
      variantCount: totalInserted,
      skipped: totalSkipped,
      errors,
      elapsed
    }
  }
}
