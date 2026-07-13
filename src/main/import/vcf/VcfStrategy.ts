/**
 * VCF import strategy
 *
 * Implements ImportStrategy for VCF (.vcf, .vcf.gz) files.
 * Streams line-by-line, parses headers once, splits alleles, extracts
 * annotations and genotypes, then inserts via the existing bulk insert pipeline.
 */

import { createInterface } from 'node:readline'
import { createCappedLineStream } from '../stream-utils'
import type { ImportOptions, ImportResult } from '../types'
import type { ImportStrategy, FormatInfo, StrategyContext } from '../strategies/ImportStrategy'
import type { VcfImportOptions, VcfMappedVariant, VcfHeader } from './types'
import { parseVcfHeaderFromLines } from './vcf-header-parser'
import {
  parseVcfLine,
  resolveVcfSelectedSampleColumn,
  type VcfSelectedSampleColumn
} from './vcf-line-parser'
import { mapVcfRecord } from './VcfMapper'
import { DEFAULT_INFO_FIELD_MAPPINGS } from './info-field-registry'
import { detectCaller } from './caller-detector'
import type { ImportFilters } from './import-filters'
import { passesPreMappingFilters, passesPostMappingFilters } from './import-filters'
import { VcfHeaderBudget } from './vcf-header-limits'
import { VcfResourceLimitError } from './vcf-resource-limits'
export class VcfStrategy implements ImportStrategy {
  readonly formatId = 'vcf' as const

  canHandle(formatInfo: FormatInfo): boolean {
    return formatInfo.format === 'vcf'
  }

  async import(
    filePath: string,
    options: ImportOptions,
    context: StrategyContext,
    vcfOptions?: VcfImportOptions,
    importFilters?: ImportFilters
  ): Promise<ImportResult> {
    const { db, caseId, startTime } = context
    const batchSize = options.batchSize ?? 5000

    // Read file line by line. Shared capped reader guards against a giant
    // single line and a decompression bomb -- see stream-utils.ts for the
    // cap rationale.
    const { stream } = createCappedLineStream(filePath)
    stream.on('error', () => undefined)
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('error', () => undefined)

    const headerLines: string[] = []
    const headerBudget = new VcfHeaderBudget()
    let header: VcfHeader | null = null
    let activeSample = ''
    let activeSampleColumn: VcfSelectedSampleColumn | null = null
    let totalInserted = 0
    let totalSkipped = 0
    const errors: string[] = []
    let callerName: string | null = null
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
          headerBudget.add(line)
          headerLines.push(line)
          continue
        }

        // Parse header once, on the first data line
        if (header === null) {
          header = parseVcfHeaderFromLines(headerLines)
          activeSampleColumn = resolveVcfSelectedSampleColumn(
            header.samples,
            vcfOptions?.selectedSamples?.[0]
          )
          activeSample = activeSampleColumn?.name ?? ''

          if (activeSample === '') {
            errors.push('No sample found in VCF file')
            break
          }

          const callerInfo = detectCaller(header.rawHeaderLines)
          callerName = callerInfo.name !== 'unknown' ? callerInfo.name : null
        }

        // Parse the data line
        try {
          const record = parseVcfLine(
            line,
            header.samples,
            (reason) => {
              if (errors.length < 10) {
                errors.push(`Line skipped at ${line.substring(0, 50)}: ${reason}`)
              }
            },
            activeSampleColumn ?? undefined
          )
          if (record === null) {
            totalSkipped++
            continue
          }

          // Pre-mapping filter gate — PASS-only, min QUAL, BED region.
          // Shared with the main-thread append path via `import-filters.ts`
          // so the two paths can't drift apart semantically.
          if (!passesPreMappingFilters(record, importFilters)) {
            totalSkipped++
            continue
          }

          let mapped = mapVcfRecord(
            record,
            header,
            activeSample,
            DEFAULT_INFO_FIELD_MAPPINGS,
            callerName
          )

          // Post-mapping filter gate — FORMAT/GQ and FORMAT/DP thresholds.
          // No-op on SV/CNV/STR records which typically lack these fields.
          if (importFilters !== undefined) {
            mapped = mapped.filter((v) => passesPostMappingFilters(v, importFilters))
          }

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
          if (lineError instanceof VcfResourceLimitError) throw lineError
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
      stream.destroy()
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
