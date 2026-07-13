import type { PoolClient } from 'pg'

import { UniqueConstraintError } from '../../database/errors'
import { quoteIdentifier } from './identifiers'
import { runBulkCopy } from './postgres-bulk-write'
import {
  VARIANT_CNV_COPY_COLUMNS,
  VARIANT_COLUMN_ENCODERS,
  VARIANT_COPY_COLUMNS,
  VARIANT_STR_COPY_COLUMNS,
  VARIANT_SV_COPY_COLUMNS,
  VARIANT_TRANSCRIPT_COPY_COLUMNS,
  toNumericId
} from './postgres-import-columns'
import { profilePhase, profileCount } from './postgres-import-profile'

// ---------------------------------------------------------------------------
// Request / result types
// ---------------------------------------------------------------------------

/** Variant row as produced by the VCF mapper — same column names as the DB. */
export type VcfVariantRow = Record<string, unknown>

/** Extension rows carry an `ordinal` (0-based index into the variants array). */
export type VcfTranscriptRow = Record<string, unknown> & { ordinal: number }
export type VcfSvRow = Record<string, unknown> & { ordinal: number }
export type VcfCnvRow = Record<string, unknown> & { ordinal: number }
export type VcfStrRow = Record<string, unknown> & { ordinal: number }

interface PostgresVcfImportRequestBase {
  caseName: string
  fileName: string
  filePath: string
  fileSize: number
  genomeBuild: string
  caller: string | null
  annotationFormat: string | null
  variantType: string
  variants: VcfVariantRow[]
  transcripts: VcfTranscriptRow[]
  sv: VcfSvRow[]
  cnv: VcfCnvRow[]
  str: VcfStrRow[]
}

export interface PostgresVcfImportSingleFileRequest extends PostgresVcfImportRequestBase {
  mode: 'single-file'
}

export interface PostgresVcfImportMultiFileRequest extends PostgresVcfImportRequestBase {
  mode: 'multi-file'
  /** 0 = first file (creates the case), >= 1 = subsequent files (looks up the case). */
  fileIndex: number
}

/**
 * Append-mode request for subsequent batches of the same file. The caller
 * already holds the resolved `caseId` (from the first batch's
 * PostgresVcfImportFileResult), so writeVcfFile skips both the case-name
 * lookup and the per-batch case_data_info upsert. Saves O(N) redundant
 * `SELECT id FROM cases` queries and `case_data_info` writes per file.
 */
export interface PostgresVcfImportAppendRequest extends PostgresVcfImportRequestBase {
  mode: 'append'
  caseId: number
}

export type PostgresVcfImportRequest =
  | PostgresVcfImportSingleFileRequest
  | PostgresVcfImportMultiFileRequest
  | PostgresVcfImportAppendRequest

export interface PostgresVcfImportFileResult {
  caseId: number
  variantCount: number
}

export interface PostgresProvisionalImport {
  caseId: number
  watermark: number
  isNew: boolean
}

interface ProvisionalCleanupOptions {
  restoreReady?: boolean
  preserveNewCase?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickColumns<T extends string>(
  row: Record<string, unknown>,
  columns: readonly T[]
): Record<T, unknown> {
  const out = {} as Record<T, unknown>
  for (const col of columns) {
    out[col] = row[col] ?? null
  }
  return out
}

async function inTransaction<T>(
  client: Pick<PoolClient, 'query'>,
  operation: () => Promise<T>
): Promise<T> {
  await client.query('BEGIN')
  try {
    const result = await operation()
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Preserve the operation/commit failure. Closing the import connection
      // releases its advisory lease; the next owner resumes idempotently.
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresVcfImportRepository {
  private readonly schemaName: string

  constructor(schema: string) {
    this.schemaName = quoteIdentifier(schema)
  }

  async beginProvisionalImport(
    client: Pick<PoolClient, 'query'>,
    request: Pick<
      PostgresVcfImportRequestBase,
      'caseName' | 'filePath' | 'fileSize' | 'genomeBuild'
    >,
    existingCaseId?: number
  ): Promise<PostgresProvisionalImport> {
    if (existingCaseId === undefined) {
      await this.assertCaseNameAvailable(client, request.caseName)
      const result = await client.query(
        `INSERT INTO ${this.schemaName}."cases_all"
         (name, file_path, file_size, variant_count, created_at, genome_build,
          import_status, import_variant_watermark, import_is_new)
         VALUES ($1, $2, $3, 0, $4, $5, 'importing', 0, TRUE)
         RETURNING id`,
        [request.caseName, request.filePath, request.fileSize, Date.now(), request.genomeBuild]
      )
      return {
        caseId: toNumericId((result.rows[0] as { id: unknown } | undefined)?.id),
        watermark: 0,
        isNew: true
      }
    }

    const watermarkResult = await client.query(
      `SELECT COALESCE(MAX(id), 0)::bigint AS watermark
       FROM ${this.schemaName}."variants_all" WHERE case_id = $1`,
      [existingCaseId]
    )
    const watermark = toNumericId(
      (watermarkResult.rows[0] as { watermark: unknown } | undefined)?.watermark ?? 0
    )
    await client.query(
      `UPDATE ${this.schemaName}."cases_all"
       SET import_status = 'importing', import_variant_watermark = $2, import_is_new = FALSE
       WHERE id = $1`,
      [existingCaseId, watermark]
    )
    return { caseId: existingCaseId, watermark, isNew: false }
  }

  async captureVariantWatermark(
    client: Pick<PoolClient, 'query'>,
    caseId: number
  ): Promise<number> {
    const result = await client.query(
      `SELECT COALESCE(MAX(id), 0)::bigint AS watermark
       FROM ${this.schemaName}."variants_all" WHERE case_id = $1`,
      [caseId]
    )
    return toNumericId((result.rows[0] as { watermark?: unknown } | undefined)?.watermark ?? 0)
  }

  async finishProvisionalImport(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    fileName: string,
    importFileType: string
  ): Promise<void> {
    const now = Date.now()
    await client.query(
      `INSERT INTO ${this.schemaName}."case_data_info"
         (case_id, import_file_name, import_file_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (case_id) DO UPDATE SET import_file_name = EXCLUDED.import_file_name,
         import_file_type = EXCLUDED.import_file_type, updated_at = EXCLUDED.updated_at`,
      [caseId, fileName, importFileType, now]
    )
    await client.query(
      `UPDATE ${this.schemaName}."cases_all" SET import_status = 'ready',
       import_variant_watermark = 0, import_is_new = FALSE
       WHERE id = $1 AND import_status = 'importing'`,
      [caseId]
    )
  }

  async cleanupProvisionalImport(
    client: Pick<PoolClient, 'query'>,
    provisional: PostgresProvisionalImport,
    options: ProvisionalCleanupOptions = {}
  ): Promise<void> {
    while (true) {
      const deleted = await inTransaction(client, () =>
        client.query(
          `WITH doomed AS (
             SELECT id FROM ${this.schemaName}."variants_all"
             WHERE case_id = $1 AND id > $2 ORDER BY id LIMIT 10000
           ) DELETE FROM ${this.schemaName}."variants_all" v USING doomed d
             WHERE v.id = d.id RETURNING v.id`,
          [provisional.caseId, provisional.watermark]
        )
      )
      if (deleted.rows.length === 0) break
    }
    await inTransaction(client, async () => {
      if (provisional.isNew && options.preserveNewCase !== true) {
        await client.query({
          text: `DELETE FROM ${this.schemaName}."cases_all" WHERE id = $1`,
          values: [provisional.caseId]
        })
      } else if (options.restoreReady !== false) {
        await client.query(
          `UPDATE ${this.schemaName}."cases_all" SET import_status = 'ready',
           import_variant_watermark = 0, import_is_new = FALSE WHERE id = $1`,
          [provisional.caseId]
        )
      }
    })
  }

  async recoverInterruptedImports(client: Pick<PoolClient, 'query'>): Promise<void> {
    const result = await client.query(
      `SELECT id, import_variant_watermark, import_is_new
       FROM ${this.schemaName}."cases_all"
       WHERE import_status = 'importing' ORDER BY id`
    )
    for (const row of result.rows as Array<Record<string, unknown>>) {
      const caseId = toNumericId(row.id)
      await this.cleanupProvisionalImport(client, {
        caseId,
        watermark: toNumericId(row.import_variant_watermark),
        isNew: row.import_is_new === true
      })
    }
  }

  async assertCaseNameAvailable(
    client: Pick<PoolClient, 'query'>,
    caseName: string
  ): Promise<void> {
    const duplicate = await client.query(
      `SELECT id FROM ${this.schemaName}."cases_all" WHERE name = $1`,
      [caseName]
    )
    if ((duplicate.rows as unknown[]).length > 0) {
      throw new UniqueConstraintError('case', caseName)
    }
  }

  /**
   * Write one batch worth of VCF variants into the database.
   *
   * The caller MUST own the transaction (BEGIN/COMMIT/ROLLBACK). This method
   * issues NO transaction-lifecycle SQL. variant_frequency is also NOT updated
   * here — the worker handles that after all writeVcfFile calls complete.
   *
   * Per-mode semantics:
   *  - mode: 'single-file'             — duplicate check + case insert + provenance
   *  - mode: 'multi-file', index: 0    — duplicate check + case insert + provenance
   *  - mode: 'multi-file', index: N    — look up existing case by name + provenance
   *  - mode: 'append', caseId          — variants only; no case lookup, no provenance
   *
   * The 'append' shape is the WGS-friendly path: subsequent batches of the
   * same file pass the resolved caseId from the first batch's result and
   * skip the per-batch `SELECT id FROM cases` + `case_data_info` upsert.
   */
  async writeVcfFile(
    client: Pick<PoolClient, 'query'>,
    request: PostgresVcfImportRequest
  ): Promise<PostgresVcfImportFileResult> {
    let caseId: number
    let writeProvenance = true

    if (request.mode === 'append') {
      caseId = request.caseId
      writeProvenance = false
    } else if (
      request.mode === 'single-file' ||
      (request.mode === 'multi-file' && request.fileIndex === 0)
    ) {
      // Check for pre-existing case and create if absent.
      const dupResult = await client.query(
        `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
        [request.caseName]
      )
      if ((dupResult.rows as unknown[]).length > 0) {
        throw new UniqueConstraintError('case', request.caseName)
      }

      const createdAt = Date.now()
      const caseInsert = await client.query(
        `INSERT INTO ${this.schemaName}."cases"
         (name, file_path, file_size, variant_count, created_at, genome_build)
         VALUES ($1, $2, $3, 0, $4, $5)
         RETURNING id`,
        [request.caseName, request.filePath, request.fileSize, createdAt, request.genomeBuild]
      )
      caseId = toNumericId((caseInsert.rows[0] as { id: unknown } | undefined)?.id)
    } else {
      // Subsequent file in a multi-file import: look up by name.
      const lookupResult = await client.query(
        `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
        [request.caseName]
      )
      if ((lookupResult.rows as unknown[]).length === 0) {
        throw new Error(
          `case '${request.caseName}' not found — subsequent file must reference an existing case`
        )
      }
      caseId = toNumericId((lookupResult.rows[0] as { id: unknown }).id)
    }

    // Insert variants and their extension rows.
    const variantCount = await this.insertVariants(client, caseId, request)

    // Write per-file provenance — only on the first batch of a file.
    // Subsequent batches (`mode: 'append'`) skip this; the row is already
    // there with the correct file_name + file_type.
    if (writeProvenance) {
      const createdAt = Date.now()
      await client.query(
        `INSERT INTO ${this.schemaName}."case_data_info"
           (case_id, import_file_name, import_file_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (case_id) DO UPDATE SET
           import_file_name = EXCLUDED.import_file_name,
           import_file_type = EXCLUDED.import_file_type,
           updated_at = EXCLUDED.updated_at`,
        [caseId, request.fileName, 'vcf', createdAt]
      )
    }

    return { caseId, variantCount }
  }

  // ---------------------------------------------------------------------------
  // Private — variant insertion
  // ---------------------------------------------------------------------------

  private async insertVariants(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    request: PostgresVcfImportRequest
  ): Promise<number> {
    const { variants, transcripts, sv, cnv, str } = request
    const N = variants.length
    if (N === 0) return 0

    // Pre-reserve N IDs with an explicit ordinal column. The ORDER BY g.ord
    // guarantees the returned rows are aligned with the variants array index,
    // which is what the extension-row ordinal lookup later depends on.
    //
    // pg_get_serial_sequence takes a regclass-style relation name. The text
    // is parsed by the SQL identifier rules, so quoted identifiers ("My
    // Schema"."variants") are accepted — `this.schemaName` is already
    // quoted via `quoteIdentifier`, so we just append the (always-safe,
    // always-lowercase) "variants" table name. This survives schemas that
    // need quoting (hyphens, mixed case, reserved words, etc.).
    const variantsRelation = `${this.schemaName}."variants_all"`
    const idResult = await profilePhase('reserve-ids', () =>
      client.query(
        `SELECT g.ord                                              AS ordinal,
                nextval(pg_get_serial_sequence($1, 'id'))::bigint  AS id
         FROM   generate_series(0, $2 - 1) AS g(ord)
         ORDER BY g.ord`,
        [variantsRelation, N]
      )
    )
    const idRows = idResult.rows as Array<{ ordinal: unknown; id: unknown }>
    const variantIds: bigint[] = idRows.map((r) => BigInt(r.id as string | number | bigint))
    profileCount('rows-variants', N)

    // Build the per-row payload aligned by ordinal with the variants array.
    // pickColumns projects to exactly the COPY column list and sets nulls for
    // missing keys; we then add the pre-reserved id and the resolved case_id.
    const variantsRowsWithIds = variants.map((row, i) => {
      const picked = pickColumns(row, VARIANT_COPY_COLUMNS as readonly string[])
      if (picked.variant_type === null) picked.variant_type = 'snv'
      picked.id = variantIds[i]
      picked.case_id = caseId
      return picked as Record<string, unknown>
    })

    // COPY base variants. VARIANT_COPY_COLUMNS prepends `id` and excludes
    // both `coord_hash` (generated) and `search_document` (also a STORED
    // generated column since Phase 16.1; Postgres rejects writes to it).
    await profilePhase('copy-variants', () =>
      runBulkCopy({
        client,
        sql:
          `COPY ${this.schemaName}."variants_all" ` +
          `(${(VARIANT_COPY_COLUMNS as readonly string[])
            .map((c) => quoteIdentifier(c))
            .join(', ')}) ` +
          `FROM STDIN`,
        columns: (VARIANT_COPY_COLUMNS as readonly string[]).map((name) => ({
          name,
          encoder: VARIANT_COLUMN_ENCODERS[name]
        })),
        rows: variantsRowsWithIds
      })
    )

    // COPY extension tables sequentially. Each helper resolves
    // ordinal → variant_id at iterate time and skips out-of-range ordinals.
    //
    // search_document is populated inline by STORED generated columns on the
    // variants/variant_sv/variant_str tables (see migration 16-phase16-...);
    // there is no per-batch bulk UPDATE and no trigger to defer.
    await this.copyExtensions(client, variantIds, transcripts, sv, cnv, str)

    return variantIds.length
  }

  private async copyExtensions(
    client: Pick<PoolClient, 'query'>,
    variantIds: bigint[],
    transcripts: VcfTranscriptRow[],
    svRows: VcfSvRow[],
    cnvRows: VcfCnvRow[],
    strRows: VcfStrRow[]
  ): Promise<void> {
    const helper = async (
      table: string,
      columns: readonly string[],
      rows: ReadonlyArray<Record<string, unknown> & { ordinal: number }>
    ): Promise<void> => {
      if (rows.length === 0) return

      // Resolve ordinal → variant_id; drop rows whose ordinal is out of bounds
      // (negative ordinals would silently index from the end in JS arrays).
      const resolved: Array<Record<string, unknown>> = []
      for (const row of rows) {
        if (row.ordinal < 0 || row.ordinal >= variantIds.length) continue
        const picked = pickColumns(row, columns)
        picked.variant_id = variantIds[row.ordinal]
        resolved.push(picked as Record<string, unknown>)
      }
      if (resolved.length === 0) return

      const sql =
        `COPY ${this.schemaName}.${quoteIdentifier(table)} ` +
        `(${columns.map((c) => quoteIdentifier(c)).join(', ')}) FROM STDIN`

      await profilePhase(`copy-${table}`, () =>
        runBulkCopy({
          client,
          sql,
          columns: columns.map((name) => ({ name, encoder: VARIANT_COLUMN_ENCODERS[name] })),
          rows: resolved
        })
      )
      profileCount(`rows-${table}`, resolved.length)
    }

    await helper(
      'variant_transcripts',
      VARIANT_TRANSCRIPT_COPY_COLUMNS as unknown as readonly string[],
      transcripts
    )
    await helper('variant_sv', VARIANT_SV_COPY_COLUMNS as unknown as readonly string[], svRows)
    await helper('variant_cnv', VARIANT_CNV_COPY_COLUMNS as unknown as readonly string[], cnvRows)
    await helper('variant_str', VARIANT_STR_COPY_COLUMNS as unknown as readonly string[], strRows)
  }
}
