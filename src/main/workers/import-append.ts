/**
 * Multi-file case: the 2nd..Nth file of a case appended by the import worker
 * (#551), not on the Electron main thread.
 *
 * One file is one IMMEDIATE transaction on the worker connection: its rows,
 * the case's variant_count, its field dictionary and the stale flag on the
 * cohort summary (the session rebuilds it at its end) commit together, and a
 * failure, a cancel or a crash leaves nothing of the file behind. FTS follows
 * the session's rule (import-worker.ts): the row triggers are down for the
 * session, which at its end indexes the rows above its watermark or rebuilds
 * the whole index (bulk session, overwrite, triggers back meanwhile). The
 * case is reported started as a replacement, so a crash gets the client's
 * recovery run (FTS, indexes) without the published case being deleted, and
 * the open-session marker makes the next app start repair it too.
 *
 * Runs inside worker threads: no MainLogger / Electron imports.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { basename } from 'node:path'

import type { FileImportRequest } from '../../shared/types/import-worker'
import { FieldProfileResolver } from '../../shared/utils/import-field-profile'
import type { ImportSummarySession } from '../database/cohort-summary-case-add'
import { detectFormat } from '../import/format-detection'
import type { FormatInfo } from '../import/types'
import { loadImportFilters, type ImportFilters } from '../import/vcf/import-filters'
import { parseVcfHeader } from '../import/vcf/vcf-header-parser'
import { streamInsertJson, streamInsertVcf, type prepareStatements } from './import-pipeline'

type ImportStatements = ReturnType<typeof prepareStatements>

export interface StreamFileArgs {
  file: FileImportRequest
  formatInfo: FormatInfo
  caseId: number
  batchSize: number
  stmts: ImportStatements
  isCancelled: () => boolean
  onProgress: (count: number) => void
  onSkip: (reason: string) => void
  vcfFilters: ImportFilters | undefined
  fields: FieldProfileResolver
  vcfSelectedSamples?: string[]
}

/** Stream one file's rows into a case; returns the rows inserted. */
export function streamFileIntoCase(a: StreamFileArgs): Promise<number> {
  if (a.formatInfo.format === 'vcf') {
    return streamInsertVcf(
      a.file.filePath,
      a.formatInfo,
      a.caseId,
      a.batchSize,
      a.stmts,
      a.isCancelled,
      a.vcfSelectedSamples ?? a.file.vcfSelectedSamples,
      a.onProgress,
      a.onSkip,
      undefined,
      a.vcfFilters,
      a.fields
    )
  }
  return streamInsertJson(
    a.file.filePath,
    a.formatInfo,
    a.caseId,
    a.batchSize,
    a.stmts,
    a.isCancelled,
    a.onProgress,
    undefined,
    a.onSkip,
    a.fields
  )
}

export type AppendArgs = Omit<StreamFileArgs, 'formatInfo' | 'vcfFilters' | 'fields'> & {
  db: DatabaseType
  summary: ImportSummarySession
}

/**
 * Append `file` to the published case `caseId`. Returns the rows added, or
 * null when cancelled (the file's rows are rolled back). Throws with the file
 * rolled back on any failure.
 */
export async function appendFileToCase(a: AppendArgs): Promise<number | null> {
  const { db, caseId } = a
  const target = db.prepare('SELECT import_status FROM cases WHERE id = ?').get(caseId) as
    { import_status: string } | undefined
  if (target?.import_status !== 'ready') throw new Error(`Case ${caseId} cannot be appended to`)

  const vcfFilters = await loadImportFilters(a.file.vcfFilters)
  const formatInfo = await detectFormat(a.file.filePath)
  // A single-sample file appended to the case is read as that sample.
  let vcfSelectedSamples = a.file.vcfSelectedSamples
  if (formatInfo.format === 'vcf') {
    const { header } = await parseVcfHeader(a.file.filePath)
    if (header.samples.length === 1) vcfSelectedSamples = [header.samples[0]]
  }
  const fields = new FieldProfileResolver(a.file.fieldProfile)
  // The keys the case's earlier files assigned keep their meaning in this one.
  const stored = db
    .prepare('SELECT field_dictionary FROM case_data_info WHERE case_id = ?')
    .get(caseId) as { field_dictionary: string | null } | undefined
  if (stored?.field_dictionary != null) fields.adopt(JSON.parse(stored.field_dictionary))

  db.exec('BEGIN IMMEDIATE')
  try {
    const added = await streamFileIntoCase({
      ...a,
      formatInfo,
      vcfFilters,
      fields,
      vcfSelectedSamples
    })
    if (a.isCancelled()) {
      db.exec('ROLLBACK')
      return null
    }
    db.prepare('UPDATE cases SET variant_count = variant_count + ? WHERE id = ?').run(added, caseId)
    const dictionary = fields.dictionary()
    if (stored === undefined) {
      // No provenance row yet: the pipeline's upsert creates it, with the keys.
      a.stmts.insertDataInfo.run(caseId, basename(a.file.filePath), formatInfo.format, dictionary)
    } else if (dictionary !== null) {
      // Patch the keys only: the row keeps the file the case was created from.
      db.prepare(
        `UPDATE case_data_info SET field_dictionary = json_patch(COALESCE(field_dictionary, '{}'), ?)
          WHERE case_id = ?`
      ).run(JSON.stringify(dictionary), caseId)
    }
    // The case's summary rows no longer match its variants.
    a.summary.invalidate()
    db.exec('COMMIT')
    return added
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK')
    throw error
  }
}
