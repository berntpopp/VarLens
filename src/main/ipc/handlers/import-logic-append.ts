/**
 * Append an additional VCF file to an existing case.
 *
 * Unlike startImport (which creates a new case via a worker thread), this
 * variant reuses an existing caseId and streams variants into the same
 * case_id on the main thread. Used by the multi-file import session for
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
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'

import { isGzipped } from '../../import/stream-utils'
import { parseVcfHeaderFromLines } from '../../import/vcf/vcf-header-parser'
import { parseVcfLine } from '../../import/vcf/vcf-line-parser'
import { mapVcfRecord } from '../../import/vcf/VcfMapper'
import { detectCaller } from '../../import/vcf/caller-detector'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../../import/vcf/info-field-registry'
import type { VcfHeader, VcfMappedVariant } from '../../import/vcf/types'
import type { ImportFilters } from '../../import/vcf/import-filters'
import { passesPreMappingFilters, passesPostMappingFilters } from '../../import/vcf/import-filters'
import type { DatabaseService } from '../../database/DatabaseService'
import type { ImportCallbacks, ImportResult, VcfImportOptions } from './import-logic'

const APPEND_BATCH_SIZE = 5000

/**
 * Append a VCF file to an existing case by streaming it on the main thread.
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
  importFilters?: ImportFilters
): Promise<ImportResult> {
  const db = getDb()
  const startTime = Date.now()

  const raw = createReadStream(filePath)
  const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const headerLines: string[] = []
  let header: VcfHeader | null = null
  let activeSample = ''
  let callerName: string | null = null

  let batch: VcfMappedVariant[] = []
  let totalInserted = 0
  let totalSkipped = 0
  const errors: string[] = []

  try {
    for await (const line of rl) {
      // Collect header lines
      if (line.startsWith('#')) {
        headerLines.push(line)
        continue
      }

      // Parse header once, on the first data line
      if (header === null) {
        header = parseVcfHeaderFromLines(headerLines)
        const selectedSample = vcfOptions?.selectedSample
        activeSample =
          selectedSample !== undefined && selectedSample !== ''
            ? selectedSample
            : header.samples.length > 0
              ? header.samples[0]
              : ''

        if (activeSample === '') {
          errors.push(`No sample found in VCF file: ${filePath}`)
          break
        }

        const callerInfo = detectCaller(headerLines)
        callerName = callerInfo.name !== 'unknown' ? callerInfo.name : null
      }

      try {
        const record = parseVcfLine(line, header.samples)
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
          batch.push(variant)
        }

        if (batch.length >= APPEND_BATCH_SIZE) {
          db.variants.insertBatch(batch, caseId)
          totalInserted += batch.length
          batch = []

          callbacks.onProgress?.({
            phase: 'inserting',
            count: totalInserted,
            elapsed: Date.now() - startTime,
            skipped: totalSkipped
          })
        }
      } catch (lineError) {
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
      db.variants.insertBatch(batch, caseId)
      totalInserted += batch.length
    }
  } finally {
    // Ensure the file descriptor is released even on error
    raw.destroy()
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
 */
export async function detectGenomeBuildFromFile(filePath: string): Promise<string | null> {
  const raw = createReadStream(filePath)
  const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const headerLines: string[] = []
  try {
    for await (const line of rl) {
      if (line.startsWith('#')) {
        headerLines.push(line)
        continue
      }
      // First data line — header is complete, stop reading.
      break
    }
  } finally {
    raw.destroy()
  }

  if (headerLines.length === 0) return null
  const header = parseVcfHeaderFromLines(headerLines)
  return header.genomeBuild ?? null
}
