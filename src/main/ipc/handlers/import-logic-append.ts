/**
 * Append an additional VCF file to an existing case.
 *
 * Unlike startImport (which creates a new case via a worker thread), this
 * variant reuses an existing caseId and streams variants into the same
 * case_id through an isolated SQLite connection. Parsing remains coordinated
 * by the main process, but unrelated main-connection writes cannot enter this
 * transaction. Used by the multi-file import session for
 * the 2nd..Nth files where we want a single case with per-file provenance.
 *
 * This runs on the main thread (not in a worker) because the worker
 * pipeline always creates a new case. That is slower for very large files
 * but simpler and sufficient for the initial multi-file import session.
 *
 * Contract:
 *   - The caller MUST have already called `db.variants.beginBulkInsert()`
 *     so FTS triggers are dropped for the duration of the append loop.
 *   - The caller MUST call `db.variants.finishBulkInsertNoCount()` and
 *     `db.variants.recalculateCaseVariantCount(caseId)` once all appends
 *     are complete (so FTS is rebuilt exactly once and variant_count
 *     reflects the sum across all appended files atomically).
 *   - The caller MUST ensure any genome build lock is enforced before
 *     calling this function (see checkGenomeBuildOrThrow below).
 */
import { createInterface } from 'node:readline'

import { createCappedLineStream } from '../../import/stream-utils'
import { parseVcfHeader, parseVcfHeaderFromLines } from '../../import/vcf/vcf-header-parser'
import {
  parseVcfLine,
  resolveVcfSelectedSampleColumn,
  type VcfSelectedSampleColumn
} from '../../import/vcf/vcf-line-parser'
import { mapVcfRecord } from '../../import/vcf/VcfMapper'
import { detectCaller } from '../../import/vcf/caller-detector'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../../import/vcf/info-field-registry'
import type { VcfHeader } from '../../import/vcf/types'
import type { ImportFilters } from '../../import/vcf/import-filters'
import { passesPreMappingFilters, passesPostMappingFilters } from '../../import/vcf/import-filters'
import { VcfHeaderBudget } from '../../import/vcf/vcf-header-limits'
import { VcfResourceLimitError } from '../../import/vcf/vcf-resource-limits'
import type { DatabaseService } from '../../database/DatabaseService'
import { openWorkerDatabase } from '../../workers/worker-db'
import { prepareStatements } from '../../workers/import-pipeline'
import type { ImportCallbacks, ImportResult, VcfImportOptions } from './import-logic'

const APPEND_BATCH_SIZE = 5000

/**
 * Append a VCF file to an existing case through an isolated write connection.
 *
 * Does NOT touch FTS triggers, does NOT update variant_count, and does NOT
 * rebuild the cohort summary — the caller (startMultiFileImport) manages all
 * end-of-session housekeeping across every appended file.
 *
 * Applies the same import filters (PASS-only, minQual, BED, minGq, minDp) as
 * the worker-backed single-file path (VcfStrategy).
 */
export async function importAdditionalFileToCase(
  caseId: number,
  filePath: string,
  vcfOptions: VcfImportOptions | undefined,
  getDb: () => DatabaseService,
  callbacks: ImportCallbacks,
  importFilters?: ImportFilters,
  signal?: AbortSignal
): Promise<ImportResult> {
  const db = getDb()
  const appendDb = openWorkerDatabase(db.getPath(), db.getEncryptionKey())
  const statements = prepareStatements(appendDb)
  const startTime = Date.now()

  // Shared capped reader guards against a giant single line and a
  // decompression bomb -- see stream-utils.ts for the cap rationale.
  const { stream } = createCappedLineStream(filePath)
  stream.on('error', () => undefined)
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  rl.on('error', () => undefined)

  const headerLines: string[] = []
  const headerBudget = new VcfHeaderBudget()
  let header: VcfHeader | null = null
  let activeSample = ''
  let activeSampleColumn: VcfSelectedSampleColumn | null = null
  let callerName: string | null = null

  let batch: Array<Record<string, unknown>> = []
  let totalInserted = 0
  let totalSkipped = 0
  const errors: string[] = []
  const isCancelled = (): boolean => signal?.aborted === true

  try {
    appendDb.exec('BEGIN IMMEDIATE')
    try {
      for await (const line of rl) {
        if (isCancelled()) throw new Error('Import cancelled by user')
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
            vcfOptions?.selectedSample
          )
          activeSample = activeSampleColumn?.name ?? ''

          if (activeSample === '') {
            errors.push(`No sample found in VCF file: ${filePath}`)
            break
          }

          const callerInfo = detectCaller(headerLines)
          callerName = callerInfo.name !== 'unknown' ? callerInfo.name : null
        }

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

          // Pre-mapping filter gate — shared with `VcfStrategy` via
          // `import-filters.ts` so the worker path (first file) and the
          // main-thread append path (2nd..Nth files) stay semantically
          // identical.
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

          // Post-mapping filter gate — FORMAT/GQ and FORMAT/DP.
          if (importFilters !== undefined) {
            mapped = mapped.filter((v) => passesPostMappingFilters(v, importFilters))
          }

          if (mapped.length === 0) {
            totalSkipped++
            continue
          }

          for (const variant of mapped) {
            batch.push(variant as unknown as Record<string, unknown>)
          }

          if (batch.length >= APPEND_BATCH_SIZE) {
            statements.insertBatch(caseId, batch)
            totalInserted += batch.length
            batch = []

            callbacks.onProgress?.({
              phase: 'inserting',
              count: totalInserted,
              elapsed: Date.now() - startTime,
              skipped: totalSkipped
            })
            if (isCancelled()) throw new Error('Import cancelled by user')
          }
        } catch (lineError) {
          if (isCancelled()) {
            throw Object.assign(new Error('Import cancelled by user'), { cause: lineError })
          }
          if (lineError instanceof VcfResourceLimitError) throw lineError
          totalSkipped++
          if (errors.length < 10) {
            errors.push(
              `Line parse error at ${line.substring(0, 50)}: ${
                lineError instanceof Error ? lineError.message : String(lineError)
              }`
            )
          }
        }
      }

      // Flush remaining batch
      if (batch.length > 0) {
        if (isCancelled()) throw new Error('Import cancelled by user')
        statements.insertBatch(caseId, batch)
        totalInserted += batch.length
      }
      if (isCancelled()) throw new Error('Import cancelled by user')
      appendDb.exec('COMMIT')
    } catch (error) {
      if (appendDb.inTransaction) appendDb.exec('ROLLBACK')
      throw error
    }
  } finally {
    // Ensure the file descriptor is released even on error
    stream.destroy()
    appendDb.close()
  }

  return {
    caseId,
    variantCount: totalInserted,
    skipped: totalSkipped,
    errors,
    elapsed: Date.now() - startTime
  }
}

/**
 * Parse the VCF header of an appended file and return its detected genome
 * build (or null if the header doesn't declare one).
 *
 * Used by the multi-file session to enforce a per-case genome build lock:
 * if a subsequent file declares a different build than the case was created
 * with, the session aborts before any variants are inserted.
 *
 * Delegates to the shared `parseVcfHeader`, which is already routed through
 * the capped reader (giant-line + decompression-bomb guards) -- see
 * stream-utils.ts for the cap rationale.
 */
export async function detectGenomeBuildFromFile(filePath: string): Promise<string | null> {
  const { header } = await parseVcfHeader(filePath)
  return header.genomeBuild ?? null
}
