/**
 * Import pipeline logic extracted from import-worker.ts.
 *
 * All functions accept a DB connection and callbacks — no parentPort or
 * worker_threads imports. This module is testable in isolation.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import type { Readable } from 'node:stream'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'

import type { DataDictionaries } from '../import/types'
import type { FormatInfo } from '../import/strategies/ImportStrategy'
import { createFieldMapper } from '../import/transforms/FieldMapper'
import { createObjectFormatMapper } from '../import/transforms/ObjectFormatMapper'
import { resolveColumnIndices } from '../import/config/fieldMapping'
import { createDecompressedStream, isGzipped } from '../import/stream-utils'
import { createFTSTriggers } from '../database/schema'
import { parseVcfHeaderFromLines } from '../import/vcf/vcf-header-parser'
import { parseVcfLine } from '../import/vcf/vcf-line-parser'
import { mapVcfRecord } from '../import/vcf/VcfMapper'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../import/vcf/info-field-registry'
import type { VcfHeader } from '../import/vcf/types'

import { DROP_FTS_TRIGGERS } from './worker-db'
export { DROP_FTS_TRIGGERS }

export const DROP_INDEXES = `
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

export const RECREATE_INDEXES = `
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

export function prepareStatements(db: DatabaseType) {
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
    } catch (e) {
      console.warn(
        '[import-pipeline] Failed to rebuild FTS index during finishBulkInsert:',
        e instanceof Error ? e.message : String(e)
      )
    }
    try {
      db.exec(createFTSTriggers)
    } catch (e) {
      console.warn(
        '[import-pipeline] Failed to recreate FTS triggers during finishBulkInsert:',
        e instanceof Error ? e.message : String(e)
      )
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

/**
 * Stream a JSON/columnar/object file and insert variants in bounded batches.
 * Memory usage is proportional to batchSize, not file size.
 *
 * Returns the total number of variants inserted.
 */
export async function streamInsertJson(
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
export async function streamInsertVcf(
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
      } catch (e) {
        console.warn(
          '[import-pipeline] Skipping unparseable VCF line:',
          e instanceof Error ? e.message : String(e)
        )
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
export async function createMapperPipeline(
  filePath: string,
  formatInfo: FormatInfo
): Promise<Readable> {
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
export async function parseHeader(
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
