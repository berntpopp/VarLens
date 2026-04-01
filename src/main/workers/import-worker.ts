import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { createReadStream, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import type { Readable } from 'node:stream'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import { basename } from 'node:path'

import type { WorkerMessage, MainMessage } from '../../shared/types/import-worker'
import type { DataDictionaries } from '../import/types'
import type { FormatInfo } from '../import/strategies/ImportStrategy'
import { DATABASE_CONFIG } from '../../shared/config'
import { createFieldMapper } from '../import/transforms/FieldMapper'
import { createObjectFormatMapper } from '../import/transforms/ObjectFormatMapper'
import { resolveColumnIndices } from '../import/config/fieldMapping'
import { detectFormat } from '../import/format-detection'
import { createDecompressedStream, isGzipped } from '../import/stream-utils'
import { createFTSTriggers } from '../database/schema'
import { parseVcfHeaderFromLines } from '../import/vcf/vcf-header-parser'
import { parseVcfLine } from '../import/vcf/vcf-line-parser'
import { mapVcfRecord } from '../import/vcf/VcfMapper'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../import/vcf/info-field-registry'
import type { VcfHeader } from '../import/vcf/types'
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL,
  MARK_STALE_SQL,
  CHECK_TABLE_EXISTS_SQL
} from '../../shared/sql/cohort-summary-rebuild'

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort

const DROP_FTS_TRIGGERS = `
  DROP TRIGGER IF EXISTS variants_fts_ai;
  DROP TRIGGER IF EXISTS variants_fts_ad;
  DROP TRIGGER IF EXISTS variants_fts_au;
`

const DROP_INDEXES = `
  DROP INDEX IF EXISTS idx_variants_gene;
  DROP INDEX IF EXISTS idx_variants_pos;
  DROP INDEX IF EXISTS idx_variants_filters;
  DROP INDEX IF EXISTS idx_variants_chr_pos_ref_alt;
  DROP INDEX IF EXISTS idx_vt_selected;
  DROP INDEX IF EXISTS idx_vt_transcript;
  DROP INDEX IF EXISTS idx_variants_filter_covering;
  DROP INDEX IF EXISTS idx_variants_case_coords;
  DROP INDEX IF EXISTS idx_variants_gene_notnull;
`

const RECREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
  CREATE INDEX IF NOT EXISTS idx_variants_pos ON variants(chr, pos);
  CREATE INDEX IF NOT EXISTS idx_variants_filters ON variants(gnomad_af, cadd);
  CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);
  CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
  CREATE INDEX IF NOT EXISTS idx_vt_transcript ON variant_transcripts(transcript_id);
  CREATE INDEX IF NOT EXISTS idx_variants_filter_covering ON variants(case_id, consequence, func, clinvar);
  CREATE INDEX IF NOT EXISTS idx_variants_case_coords ON variants(case_id, chr, pos, ref, alt);
  CREATE INDEX IF NOT EXISTS idx_variants_gene_notnull ON variants(gene_symbol) WHERE gene_symbol IS NOT NULL;
`

let cancelled = false

port.on('message', async (msg: MainMessage) => {
  if (msg.type === 'cancel') {
    cancelled = true
    return
  }

  if (msg.type === 'start') {
    cancelled = false
    let db: DatabaseType | null = null

    try {
      db = openDatabase(msg.dbPath, msg.encryptionKey)

      const stmts = prepareStatements(db)

      // Drop FTS triggers and non-essential indexes at start (batch optimization)
      db.exec(DROP_FTS_TRIGGERS)
      db.exec(DROP_INDEXES)

      // Mark cohort summary as stale before import
      try {
        db.exec(MARK_STALE_SQL)
      } catch {
        /* table may not exist yet */
      }

      const totalFiles = msg.files.length
      const batchSize = msg.batchSize ?? DATABASE_CONFIG.BATCH_INSERT_SIZE
      const importedInBatch = new Set<string>()
      const results: Array<{
        filePath: string
        fileName: string
        caseName: string
        status: 'success' | 'failed' | 'skipped'
        variantCount?: number
        error?: string
      }> = []
      let succeeded = 0
      let failed = 0
      let skipped = 0
      let lastProgressTime = 0

      for (let fileIndex = 0; fileIndex < totalFiles; fileIndex++) {
        if (cancelled) {
          for (let j = fileIndex; j < totalFiles; j++) {
            const f = msg.files[j]
            results.push({
              filePath: f.filePath,
              fileName: basename(f.filePath),
              caseName: f.caseName,
              status: 'skipped',
              error: 'Cancelled by user'
            })
            skipped++
          }
          break
        }

        const file = msg.files[fileIndex]
        const fileName = basename(file.filePath)

        try {
          // Handle duplicates (database + in-batch)
          const existing = stmts.getCaseByName.get(file.caseName) as { id: number } | undefined
          const isInBatchDuplicate = importedInBatch.has(file.caseName)

          if (existing || file.isDuplicate || isInBatchDuplicate) {
            if (file.duplicateStrategy === 'skip') {
              results.push({
                filePath: file.filePath,
                fileName,
                caseName: file.caseName,
                status: 'skipped',
                error: 'Duplicate case name'
              })
              skipped++
              continue
            } else if (existing) {
              stmts.deleteCase.run(existing.id)
            }
          }

          // Create case record
          const fileSize = statSync(file.filePath).size
          // Use VCF genome build override if provided, otherwise default to GRCh38
          const genomeBuild = file.vcfGenomeBuild ?? 'GRCh38'
          const caseResult = stmts.insertCase.run(
            file.caseName,
            file.filePath,
            fileSize,
            Date.now(),
            genomeBuild
          )
          const caseId = Number(caseResult.lastInsertRowid)

          const startTime = Date.now()
          let variantCount = 0
          const fileSkipped = 0

          try {
            // Emit parsing phase progress
            sendProgress(
              fileIndex,
              totalFiles,
              fileName,
              Math.round((fileIndex / totalFiles) * 100),
              'parsing',
              0,
              0
            )

            const formatInfo = await detectFormat(file.filePath)

            const onProgress = (count: number): void => {
              const now = Date.now()
              if (now - lastProgressTime >= msg.throttleMs) {
                lastProgressTime = now
                const progressMsg: WorkerMessage = {
                  type: 'progress',
                  fileIndex,
                  totalFiles,
                  fileName,
                  overallPercent: Math.round(((fileIndex + 0.5) / totalFiles) * 100),
                  phase: 'inserting',
                  variantCount: count,
                  skipped: fileSkipped
                }
                port.postMessage(progressMsg)
              }
            }

            stmts.beginBulkInsert()
            try {
              if (formatInfo.format === 'vcf') {
                variantCount = await streamInsertVcf(
                  file.filePath,
                  formatInfo,
                  caseId,
                  batchSize,
                  stmts,
                  () => cancelled,
                  file.vcfSelectedSamples,
                  onProgress
                )
              } else {
                variantCount = await streamInsertJson(
                  file.filePath,
                  formatInfo,
                  caseId,
                  batchSize,
                  stmts,
                  () => cancelled,
                  onProgress
                )
              }
            } finally {
              stmts.finishBulkInsert(caseId, variantCount)
            }

            // Insert data_info provenance
            try {
              stmts.insertDataInfo.run(caseId, fileName, formatInfo.format)
            } catch {
              // best effort
            }

            const elapsed = Date.now() - startTime

            results.push({
              filePath: file.filePath,
              fileName,
              caseName: file.caseName,
              status: 'success',
              variantCount
            })
            succeeded++
            importedInBatch.add(file.caseName)

            const fileCompleteMsg: WorkerMessage = {
              type: 'file-complete',
              fileIndex,
              result: {
                caseId,
                caseName: file.caseName,
                variantCount,
                skipped: fileSkipped,
                elapsed
              }
            }
            port.postMessage(fileCompleteMsg)
          } catch (importError) {
            stmts.deleteCase.run(caseId)
            throw importError
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          const errorStack = error instanceof Error ? error.stack : undefined

          results.push({
            filePath: file.filePath,
            fileName,
            caseName: file.caseName,
            status: 'failed',
            error: errorMsg
          })
          failed++

          const workerErrorMsg: WorkerMessage = {
            type: 'error',
            fileIndex,
            error: errorMsg,
            phase: 'import',
            stack: errorStack
          }
          port.postMessage(workerErrorMsg)
        }
      }

      // FTS rebuild + ANALYZE + optimize
      sendProgress(totalFiles, totalFiles, '', 99, 'finalizing', 0, 0)
      rebuildFts(db)
      rebuildCohortSummary(db)

      const completeMsg: WorkerMessage = {
        type: 'complete',
        results: { succeeded, failed, skipped, cancelled, details: results }
      }
      port.postMessage(completeMsg)
    } catch (fatalError) {
      // Index/trigger recreation is handled unconditionally in the finally block below

      const errorMsg: WorkerMessage = {
        type: 'error',
        fileIndex: -1,
        error: fatalError instanceof Error ? fatalError.message : String(fatalError),
        phase: 'fatal',
        stack: fatalError instanceof Error ? fatalError.stack : undefined
      }
      port.postMessage(errorMsg)
    } finally {
      if (db) {
        try {
          db.exec(RECREATE_INDEXES)
        } catch {
          // best effort — initializeSchema() recreates on next app start
        }
        try {
          db.pragma('wal_checkpoint(TRUNCATE)')
        } catch {
          // best effort
        }
        try {
          db.pragma('synchronous = NORMAL')
          db.pragma('wal_autocheckpoint = 1000')
          db.pragma('foreign_keys = ON')
        } catch {
          // best effort
        }
        try {
          db.close()
        } catch {
          // best effort
        }
      }
    }
  }
})

function sendProgress(
  fileIndex: number,
  totalFiles: number,
  fileName: string,
  overallPercent: number,
  phase: string,
  variantCount: number,
  skipped: number
): void {
  const msg: WorkerMessage = {
    type: 'progress',
    fileIndex,
    totalFiles,
    fileName,
    overallPercent,
    phase,
    variantCount,
    skipped
  }
  port.postMessage(msg)
}

function openDatabase(dbPath: string, encryptionKey?: string): DatabaseType {
  const db = new Database(dbPath)

  if (encryptionKey !== undefined && encryptionKey !== '') {
    const safeKey = encryptionKey.replace(/'/g, "''")
    db.pragma(`key='${safeKey}'`)
  }

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = OFF')
  db.pragma('synchronous = OFF')
  db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
  db.pragma(`cache_size = ${DATABASE_CONFIG.IMPORT_CACHE_SIZE_KB}`)
  db.pragma('temp_store = MEMORY')
  db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)
  db.pragma('wal_autocheckpoint = 0')

  return db
}

function prepareStatements(db: DatabaseType) {
  const insertVariantStmt = db.prepare(`
    INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number,
      consequence, gnomad_af, cadd, clinvar, gt_num, func, qual,
      hpo_sim_score, transcript, cdna, aa_change, moi,
      gq, dp, ad_ref, ad_alt, ab, filter, info_json, source_format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertTranscriptStmt = db.prepare(`
    INSERT INTO variant_transcripts (variant_id, transcript_id, gene_symbol,
      consequence, cdna, aa_change, hpo_sim_score, moi, is_selected)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertCaseStmt = db.prepare(`
    INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
    VALUES (?, ?, ?, 0, ?, ?)
  `)

  const deleteCaseStmt = db.prepare('DELETE FROM cases WHERE id = ?')
  const getCaseByNameStmt = db.prepare('SELECT id FROM cases WHERE name = ?')
  const updateVariantCountStmt = db.prepare('UPDATE cases SET variant_count = ? WHERE id = ?')

  // Data info provenance — may not exist in older schemas, so prepare lazily
  let insertDataInfoStmt: { run: (...args: unknown[]) => void } | null = null
  try {
    insertDataInfoStmt = db.prepare<unknown[]>(`
      INSERT OR REPLACE INTO case_data_info (case_id, import_file_name, import_file_type)
      VALUES (?, ?, ?)
    `)
  } catch {
    // Table may not exist in older schema versions
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
        v.source_format ?? null
      )

      const transcripts = v._transcripts as Array<Record<string, unknown>> | undefined
      if (transcripts && transcripts.length > 0) {
        const variantId = result.lastInsertRowid
        for (const t of transcripts) {
          insertTranscriptStmt.run(
            variantId,
            t.transcript_id,
            t.gene_symbol,
            t.consequence,
            t.cdna,
            t.aa_change,
            t.hpo_sim_score,
            t.moi,
            t.is_selected
          )
        }
      }
    }
  })

  /**
   * Drop FTS triggers before a bulk insert session.
   * The worker-level DROP_FTS_TRIGGERS already runs at session start,
   * but this method mirrors the VariantRepository API for per-file control.
   */
  function beginBulkInsert(): void {
    db.exec(DROP_FTS_TRIGGERS)
  }

  /**
   * Rebuild FTS, recreate triggers, and update the case variant_count
   * after all batches for one file have been inserted.
   */
  function finishBulkInsert(caseId: number, totalInserted: number): void {
    updateVariantCountStmt.run(totalInserted, caseId)

    try {
      db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
    } catch {
      // best effort
    }
    try {
      db.exec(createFTSTriggers)
    } catch {
      // best effort
    }
  }

  return {
    insertCase: insertCaseStmt,
    deleteCase: deleteCaseStmt,
    getCaseByName: getCaseByNameStmt,
    updateVariantCount: updateVariantCountStmt,
    insertDataInfo: {
      run: (caseId: number, fileName: string, format: string) => {
        if (insertDataInfoStmt) {
          insertDataInfoStmt.run(caseId, fileName, format)
        }
      }
    },
    insertBatch,
    beginBulkInsert,
    finishBulkInsert
  }
}

function rebuildFts(db: DatabaseType): void {
  try {
    db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
  } catch {
    // best effort
  }
  try {
    db.exec(createFTSTriggers)
  } catch {
    // best effort
  }
  try {
    db.exec('ANALYZE')
  } catch {
    // best effort
  }
  try {
    db.exec("INSERT INTO variants_fts(variants_fts) VALUES('optimize')")
  } catch {
    // best effort
  }
}

function rebuildCohortSummary(db: DatabaseType): void {
  try {
    const tableExists = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
    if (tableExists.c === 0) return

    db.transaction(() => {
      db.exec(REBUILD_VARIANT_SUMMARY_SQL)
      db.exec(REBUILD_GENE_BURDEN_SQL)
      db.exec(UPDATE_META_SQL)
    })()

    db.exec('ANALYZE cohort_variant_summary')
    db.exec('ANALYZE gene_burden_summary')
  } catch {
    // best effort — summary can be rebuilt on next import/app start
  }
}

/**
 * Stream a JSON/columnar/object file and insert variants in bounded batches.
 * Memory usage is proportional to batchSize, not file size.
 *
 * Returns the total number of variants inserted.
 */
async function streamInsertJson(
  filePath: string,
  formatInfo: FormatInfo,
  caseId: number,
  batchSize: number,
  stmts: ReturnType<typeof prepareStatements>,
  isCancelled: () => boolean,
  onProgress: (count: number) => void
): Promise<number> {
  const mapperStream = await createMapperPipeline(filePath, formatInfo)

  let batch: Array<Record<string, unknown>> = []
  let totalInserted = 0

  try {
    for await (const chunk of mapperStream) {
      if (isCancelled()) {
        mapperStream.destroy()
        break
      }

      if (chunk !== null) {
        batch.push(chunk as Record<string, unknown>)

        if (batch.length >= batchSize) {
          stmts.insertBatch(caseId, batch)
          totalInserted += batch.length
          batch = []
          onProgress(totalInserted)
        }
      }
    }
  } finally {
    // Flush remaining items
    if (batch.length > 0 && !isCancelled()) {
      stmts.insertBatch(caseId, batch)
      totalInserted += batch.length
      onProgress(totalInserted)
    }
  }

  return totalInserted
}

/**
 * Stream a VCF file and insert variants in bounded batches.
 * Uses readline + header parser + line parser + mapper.
 * Memory usage is proportional to batchSize, not file size.
 *
 * Returns the total number of variants inserted.
 */
async function streamInsertVcf(
  filePath: string,
  formatInfo: FormatInfo,
  caseId: number,
  batchSize: number,
  stmts: ReturnType<typeof prepareStatements>,
  isCancelled: () => boolean,
  vcfSelectedSamples: string[] | undefined,
  onProgress: (count: number) => void
): Promise<number> {
  if (vcfSelectedSamples && vcfSelectedSamples.length > 1) {
    throw new Error(
      `Worker expects at most one VCF sample per file entry but received ${vcfSelectedSamples.length}`
    )
  }

  // Suppress unused-variable warning — formatInfo kept for API consistency
  void formatInfo

  const raw = createReadStream(filePath)
  const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const headerLines: string[] = []
  let header: VcfHeader | null = null
  let activeSample = ''

  let batch: Array<Record<string, unknown>> = []
  let totalInserted = 0

  try {
    for await (const line of rl) {
      if (isCancelled()) {
        rl.close()
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
        const selectedSample = vcfSelectedSamples?.[0]
        activeSample = selectedSample ?? (header.samples.length > 0 ? header.samples[0] : '')

        if (activeSample === '') {
          break
        }
      }

      // Parse the data line
      try {
        const record = parseVcfLine(line, header.samples)
        if (record === null) continue // Skip truncated/corrupt lines
        const mapped = mapVcfRecord(record, header, activeSample, DEFAULT_INFO_FIELD_MAPPINGS)

        for (const variant of mapped) {
          batch.push(variant as unknown as Record<string, unknown>)

          if (batch.length >= batchSize) {
            stmts.insertBatch(caseId, batch)
            totalInserted += batch.length
            batch = []
            onProgress(totalInserted)
          }
        }
      } catch {
        // Skip unparseable lines — consistent with VcfStrategy behavior
      }
    }
  } finally {
    // Flush remaining items
    if (batch.length > 0 && !isCancelled()) {
      stmts.insertBatch(caseId, batch)
      totalInserted += batch.length
      onProgress(totalInserted)
    }
    // Ensure stream resources are released
    raw.destroy()
  }

  return totalInserted
}

/**
 * Create a readable stream that outputs mapped variant objects.
 * Pipes: decompress → parse → pick → streamArray → format mapper.
 *
 * Output: plain Record<string, unknown> objects (not { key, value } wrappers),
 * because the mapper transforms consume the streamArray wrapper.
 */
async function createMapperPipeline(filePath: string, formatInfo: FormatInfo): Promise<Readable> {
  switch (formatInfo.format) {
    case 'simple': {
      const stream = createDecompressedStream(filePath)
        .pipe(parser())
        .pipe(pick({ filter: 'variants' }))
        .pipe(streamArray())
        .pipe(createObjectFormatMapper())
      return stream
    }

    case 'object': {
      const samplePath = `samples.${formatInfo.caseKey}.variants`
      const stream = createDecompressedStream(filePath)
        .pipe(parser())
        .pipe(pick({ filter: samplePath }))
        .pipe(streamArray())
        .pipe(createObjectFormatMapper())
      return stream
    }

    case 'columnar': {
      const wrapped = formatInfo.wrapped !== false
      const headerPath = wrapped ? `${formatInfo.caseKey}.header` : 'header'
      const dataPath = wrapped ? `${formatInfo.caseKey}.data` : 'data'

      const { dictionaries, columnIndices } = await parseHeader(filePath, headerPath)
      const fieldMapper = createFieldMapper(dictionaries, columnIndices)

      const stream = createDecompressedStream(filePath)
        .pipe(parser())
        .pipe(pick({ filter: dataPath }))
        .pipe(streamArray())
        .pipe(fieldMapper)
      return stream
    }
  }

  throw new Error(`Unsupported format: ${String((formatInfo as FormatInfo).format)}`)
}

/**
 * Parse columnar header to extract data dictionaries and column indices.
 */
async function parseHeader(
  filePath: string,
  headerPath: string
): Promise<{
  dictionaries: DataDictionaries
  columnIndices: ReturnType<typeof resolveColumnIndices>
}> {
  return new Promise((resolve, reject) => {
    const dictionaries: DataDictionaries = {
      gene: {},
      impact: {},
      transcript: {},
      hpoSimScore: {},
      moi: {}
    }

    const headerItems: { id: string }[] = []
    const fieldsToExtract = new Set(['Gene', 'Transcript', 'HpoSimScore', 'MoI'])
    let resolved = false

    const stream = createDecompressedStream(filePath)
      .pipe(parser())
      .pipe(pick({ filter: headerPath }))
      .pipe(streamArray())

    const cleanup = (): void => {
      stream.removeAllListeners()
      stream.destroy()
    }

    stream.on('data', (data: { key: number; value: Record<string, unknown> }) => {
      if (resolved) return

      const headerItem = data.value
      const fieldId = headerItem.id as string

      headerItems[data.key] = { id: fieldId }

      const hasField: boolean = fieldsToExtract.has(fieldId)
      if (
        hasField &&
        headerItem.dataDictionary !== undefined &&
        headerItem.dataDictionary !== null
      ) {
        const rawDict = headerItem.dataDictionary as Record<string, unknown>

        switch (fieldId) {
          case 'Gene':
            dictionaries.gene = rawDict as Record<string, string>
            break
          case 'Transcript':
            dictionaries.transcript = rawDict as Record<string, string>
            break
          case 'HpoSimScore':
            dictionaries.hpoSimScore = rawDict as Record<string, number>
            break
          case 'MoI':
            for (const [key, value] of Object.entries(rawDict)) {
              const isArray: boolean = Array.isArray(value)
              if (isArray && (value as unknown[]).length > 0) {
                const abbrevs = (value as { abbreviation?: string }[])
                  .map((obj) => obj.abbreviation)
                  .filter(Boolean)
                dictionaries.moi[key] = abbrevs.join(', ')
              } else {
                dictionaries.moi[key] = ''
              }
            }
            break
        }
      }
    })

    stream.on('end', () => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve({ dictionaries, columnIndices: resolveColumnIndices(headerItems) })
    })

    stream.on('error', (err) => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(err)
    })
  })
}
