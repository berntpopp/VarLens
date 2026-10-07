/**
 * Import pipeline logic extracted from import-worker.ts.
 *
 * All functions accept a DB connection and callbacks — no parentPort or
 * worker_threads imports. This module is testable in isolation.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { createInterface } from 'node:readline'

import { DATABASE_CONFIG } from '../../shared/config'
import { clinvarRankForImport, impactRank } from '../../shared/config/severity.config'
import { createBoundedBatcher, getRecordBytes } from '../import/bounded-batcher'
import type { FormatInfo } from '../import/strategies/ImportStrategy'
import { createCappedLineStream } from '../import/stream-utils'
import { parseVcfHeaderFromLines } from '../import/vcf/vcf-header-parser'
import {
  parseVcfLine,
  resolveVcfSelectedSampleColumn,
  type VcfSelectedSampleColumn
} from '../import/vcf/vcf-line-parser'
import { mapVcfRecord } from '../import/vcf/VcfMapper'
import { detectCaller } from '../import/vcf/caller-detector'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../import/vcf/info-field-registry'
import type { VcfHeader } from '../import/vcf/types'
import { VcfHeaderBudget } from '../import/vcf/vcf-header-limits'
import { VcfResourceLimitError } from '../import/vcf/vcf-resource-limits'

import { DROP_FTS_TRIGGERS } from './worker-db'
export { DROP_FTS_TRIGGERS }

export { DROP_INDEXES, RECREATE_INDEXES, keepsIndexesForSession } from './import-index-sql'

import { createMapperPipeline } from './import-mapper-pipeline'
export { createMapperPipeline, parseHeader } from './import-mapper-pipeline'

/**
 * @param inInsertTransaction runs inside every variant insert transaction,
 *   after its rows (the import session re-asserts its open marker there).
 */
export function prepareStatements(db: DatabaseType, inInsertTransaction?: () => void) {
  const insertVariantStmt = db.prepare(`
    INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number,
      consequence, gnomad_af, cadd, clinvar, gt_num, func, qual,
      hpo_sim_score, transcript, cdna, aa_change, moi,
      gq, dp, ad_ref, ad_alt, ab, filter, info_json, source_format,
      variant_type, end_pos, sv_type, sv_length, caller, impact_rank, clinvar_rank)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertSvStmt = db.prepare(`
    INSERT INTO variant_sv (variant_id, sv_is_precise, cipos_left, cipos_right,
      ciend_left, ciend_right, support, coverage, strand, stdev_len, stdev_pos,
      vaf, dr, dv, pe_support, sr_support, event_id, mate_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertCnvStmt = db.prepare(
    'INSERT INTO variant_cnv (variant_id, copy_number, copy_number_quality, homozygosity_ref, homozygosity_alt, sm, bin_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )

  const insertStrStmt = db.prepare(`
    INSERT INTO variant_str (variant_id, repeat_id, variant_catalog_id, repeat_unit, display_repeat_unit,
      ref_copies, alt_copies, repeat_length, str_status, normal_max, pathologic_min, disease, inheritance_mode,
      source_display, rank_score, locus_coverage, support_type, confidence_interval)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertTranscriptStmt = db.prepare(
    'INSERT INTO variant_transcripts (variant_id, transcript_id, gene_symbol, consequence, func, cdna, aa_change, hpo_sim_score, moi, is_selected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )

  const insertCaseStmt = db.prepare(
    "INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build, import_status) VALUES (?, ?, ?, 0, ?, ?, 'provisional')"
  )

  // Child deletion statements for atomic case cleanup when foreign_keys = OFF (F01)
  const deleteChildSqls = [
    'DELETE FROM variant_transcripts WHERE variant_id IN (SELECT id FROM variants WHERE case_id = ?)',
    'DELETE FROM variant_sv WHERE variant_id IN (SELECT id FROM variants WHERE case_id = ?)',
    'DELETE FROM variant_cnv WHERE variant_id IN (SELECT id FROM variants WHERE case_id = ?)',
    'DELETE FROM variant_str WHERE variant_id IN (SELECT id FROM variants WHERE case_id = ?)',
    'DELETE FROM case_variant_annotations WHERE case_id = ?',
    'DELETE FROM case_data_info WHERE case_id = ?',
    'DELETE FROM variants WHERE case_id = ?',
    'DELETE FROM cases WHERE id = ?'
  ]
  const deleteCaseStmts = deleteChildSqls.flatMap((sql) => {
    try {
      return [db.prepare(sql)]
    } catch {
      return []
    }
  })

  const runDeleteCase = (caseId: number) => {
    let lastResult = { changes: 0, lastInsertRowid: 0 }
    for (const stmt of deleteCaseStmts) {
      lastResult = stmt.run(caseId) as { changes: number; lastInsertRowid: number }
    }
    return lastResult
  }
  const deleteCase = Object.assign(runDeleteCase, { run: runDeleteCase })

  const getCaseByNameStmt = db.prepare('SELECT id FROM cases WHERE name = ?')
  const updateVariantCountStmt = db.prepare('UPDATE cases SET variant_count = ? WHERE id = ?')

  // Data info provenance — may not exist in older schemas, so prepare lazily
  let insertDataInfoStmt: { run: (...args: unknown[]) => void } | null = null
  try {
    insertDataInfoStmt = db.prepare<unknown[]>(`
      INSERT INTO case_data_info
        (case_id, import_file_name, import_file_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        import_file_name = excluded.import_file_name,
        import_file_type = excluded.import_file_type,
        updated_at = excluded.updated_at
    `)
  } catch (e) {
    console.warn(
      '[import-pipeline] Failed to prepare case_data_info statement (table may not exist in older schema):',
      e instanceof Error ? e.message : String(e)
    )
  }

  const insertBatch = db.transaction((caseId: number, variants: Array<Record<string, unknown>>) => {
    for (const v of variants) {
      const result = insertVariantStmt.run(
        caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.gene_symbol ?? null,
        v.omim_mim_number ?? null,
        v.consequence ?? null,
        v.gnomad_af ?? null,
        v.cadd ?? null,
        v.clinvar ?? null,
        v.gt_num ?? null,
        v.func ?? null,
        v.qual ?? null,
        v.hpo_sim_score ?? null,
        v.transcript ?? null,
        v.cdna ?? null,
        v.aa_change ?? null,
        v.moi ?? null,
        v.gq ?? null,
        v.dp ?? null,
        v.ad_ref ?? null,
        v.ad_alt ?? null,
        v.ab ?? null,
        v.filter ?? null,
        v.info_json ?? null,
        v.source_format ?? null,
        v.variant_type ?? 'snv',
        v.end_pos ?? null,
        v.sv_type ?? null,
        v.sv_length ?? null,
        v.caller ?? null,
        // Stored severity ranks of the impact and ClinVar strings (#469).
        impactRank(typeof v.consequence === 'string' ? v.consequence : null),
        clinvarRankForImport(typeof v.clinvar === 'string' ? v.clinvar : null)
      )

      const variantId = result.lastInsertRowid

      const transcripts = v._transcripts as Array<Record<string, unknown>> | undefined
      if (transcripts && transcripts.length > 0) {
        for (const t of transcripts) {
          insertTranscriptStmt.run(
            variantId,
            t.transcript_id,
            t.gene_symbol,
            t.consequence,
            t.func,
            t.cdna,
            t.aa_change,
            t.hpo_sim_score,
            t.moi,
            t.is_selected === true || t.is_selected === 1 ? 1 : 0
          )
        }
      }

      // Insert extension table row if present
      if (v._sv !== undefined) {
        const s = v._sv as Record<string, unknown>
        insertSvStmt.run(
          variantId,
          s.sv_is_precise,
          s.cipos_left,
          s.cipos_right,
          s.ciend_left,
          s.ciend_right,
          s.support,
          s.coverage,
          s.strand,
          s.stdev_len,
          s.stdev_pos,
          s.vaf,
          s.dr,
          s.dv,
          s.pe_support,
          s.sr_support,
          s.event_id,
          s.mate_id
        )
      } else if (v._cnv !== undefined) {
        const c = v._cnv as Record<string, unknown>
        insertCnvStmt.run(
          variantId,
          c.copy_number,
          c.copy_number_quality,
          c.homozygosity_ref,
          c.homozygosity_alt,
          c.sm,
          c.bin_count
        )
      } else if (v._str !== undefined) {
        const t = v._str as Record<string, unknown>
        insertStrStmt.run(
          variantId,
          t.repeat_id,
          t.variant_catalog_id,
          t.repeat_unit,
          t.display_repeat_unit,
          t.ref_copies,
          t.alt_copies,
          t.repeat_length,
          t.str_status,
          t.normal_max,
          t.pathologic_min,
          t.disease,
          t.inheritance_mode,
          t.source_display,
          t.rank_score,
          t.locus_coverage,
          t.support_type,
          t.confidence_interval
        )
      }
    }
    inInsertTransaction?.()
  })

  /**
   * Drop FTS triggers before a bulk insert session.
   * The worker-level DROP_FTS_TRIGGERS already runs at session start,
   * but this method mirrors the VariantRepository API for per-file control.
   */
  function beginBulkInsert(): void {
    db.exec(DROP_FTS_TRIGGERS)
  }

  function finishBulkInsert(caseId: number, totalInserted: number): void {
    // QW-11: Per-file FTS rebuild + trigger recreate removed (audit Perf-01 #8).
    // Session-end rebuildFts(db) in import-worker.ts handles the single FTS
    // rebuild for the whole import session.
    updateVariantCountStmt.run(totalInserted, caseId)
  }

  return {
    insertCase: insertCaseStmt,
    deleteCase,
    getCaseByName: getCaseByNameStmt,
    updateVariantCount: updateVariantCountStmt,
    insertDataInfo: {
      run: (caseId: number, fileName: string, format: string) => {
        if (insertDataInfoStmt) {
          const now = Date.now()
          insertDataInfoStmt.run(caseId, fileName, format, now, now)
        }
      }
    },
    insertBatch,
    beginBulkInsert,
    finishBulkInsert
  }
}

type ImportStatements = ReturnType<typeof prepareStatements>
type MappedRow = Record<string, unknown>

/** Overrides for the batch limits; production callers leave it unset. */
export interface ImportBatchLimits {
  maxBatchBytes?: number
}

/**
 * The SQLite import batch: flushed at `batchSize` rows or at
 * BATCH_INSERT_MAX_BYTES of source data, whichever comes first.
 */
function createInsertBatcher(
  stmts: ImportStatements,
  caseId: number,
  batchSize: number,
  onProgress: (count: number) => void,
  limits: ImportBatchLimits = {}
) {
  let inserted = 0
  const batcher = createBoundedBatcher<MappedRow, void>({
    maxRows: batchSize,
    maxBytes: limits.maxBatchBytes ?? DATABASE_CONFIG.BATCH_INSERT_MAX_BYTES,
    flush: (rows) => {
      stmts.insertBatch(caseId, rows)
      inserted += rows.length
      onProgress(inserted)
    }
  })
  return { add: batcher.add, flush: batcher.flush, inserted: () => inserted }
}

/**
 * Stream a JSON/columnar/object file and insert variants in bounded batches.
 * Memory usage is proportional to the batch limits, not file size.
 *
 * Returns the total number of variants inserted.
 */
export async function streamInsertJson(
  filePath: string,
  formatInfo: FormatInfo,
  caseId: number,
  batchSize: number,
  stmts: ImportStatements,
  isCancelled: () => boolean,
  onProgress: (count: number) => void,
  limits?: ImportBatchLimits
): Promise<number> {
  const mapperStream = await createMapperPipeline(filePath, formatInfo)
  const batch = createInsertBatcher(stmts, caseId, batchSize, onProgress, limits)

  try {
    for await (const chunk of mapperStream) {
      if (isCancelled()) {
        mapperStream.destroy()
        break
      }

      if (chunk !== null && batch.add(chunk as MappedRow, getRecordBytes(chunk as object))) {
        batch.flush()
      }
    }
  } finally {
    // Flush remaining items
    if (!isCancelled()) batch.flush()
  }

  return batch.inserted()
}

/**
 * Stream a VCF file and insert variants in bounded batches.
 * Uses readline + header parser + line parser + mapper.
 * Memory usage is proportional to the batch limits, not file size.
 *
 * Returns the total number of variants inserted.
 */
export async function streamInsertVcf(
  filePath: string,
  formatInfo: FormatInfo,
  caseId: number,
  batchSize: number,
  stmts: ImportStatements,
  isCancelled: () => boolean,
  vcfSelectedSamples: string[] | undefined,
  onProgress: (count: number) => void,
  onSkip?: (reason: string) => void,
  limits?: ImportBatchLimits
): Promise<number> {
  if (vcfSelectedSamples && vcfSelectedSamples.length > 1) {
    throw new Error(
      `Worker expects at most one VCF sample per file entry but received ${vcfSelectedSamples.length}`
    )
  }

  // Suppress unused-variable warning — formatInfo kept for API consistency
  void formatInfo

  // Shared capped reader guards against a giant single line and a
  // decompression bomb -- see stream-utils.ts for the cap rationale.
  const { stream } = createCappedLineStream(filePath)
  // Keep error ownership through destroy(); compose emits ABORT_ERR when a
  // header-budget failure settles before the file naturally ends.
  stream.on('error', () => undefined)
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  rl.on('error', () => undefined)

  const headerLines: string[] = []
  const headerBudget = new VcfHeaderBudget()
  let header: VcfHeader | null = null
  let activeSample = ''
  let activeSampleColumn: VcfSelectedSampleColumn | null = null
  let callerName: string | null = null
  const batch = createInsertBatcher(stmts, caseId, batchSize, onProgress, limits)

  try {
    for await (const line of rl) {
      if (isCancelled()) {
        rl.close()
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
        activeSampleColumn = resolveVcfSelectedSampleColumn(header.samples, vcfSelectedSamples?.[0])
        activeSample = activeSampleColumn?.name ?? ''

        if (activeSample === '') {
          break
        }

        // Detect caller from header lines for variant type routing
        const callerInfo = detectCaller(headerLines)
        callerName = callerInfo.name !== 'unknown' ? callerInfo.name : null
      }

      // Parse the data line. `full` is acted on after the try: a failed
      // insert must fail the import, not be logged as an unparseable line.
      let full = false
      try {
        const record = parseVcfLine(line, header.samples, onSkip, activeSampleColumn ?? undefined)
        if (record === null) continue // Skip truncated/corrupt lines
        const mapped = mapVcfRecord(
          record,
          header,
          activeSample,
          DEFAULT_INFO_FIELD_MAPPINGS,
          callerName
        )

        // Every variant split from one line is charged the whole line: each
        // may retain that line's INFO payload.
        for (const variant of mapped) {
          full = batch.add(variant as unknown as MappedRow, line.length) || full
        }
      } catch (e) {
        if (e instanceof VcfResourceLimitError) throw e
        console.warn(
          '[import-pipeline] Skipping unparseable VCF line:',
          e instanceof Error ? e.message : String(e)
        )
      }
      if (full) batch.flush()
    }
  } finally {
    // Flush remaining items
    if (!isCancelled()) batch.flush()
    // Ensure stream resources are released
    stream.destroy()
  }

  return batch.inserted()
}
