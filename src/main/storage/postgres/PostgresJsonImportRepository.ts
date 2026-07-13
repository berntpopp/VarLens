import type { Pool, PoolClient } from 'pg'

import { UniqueConstraintError } from '../../database/errors'
import { quoteIdentifier } from './identifiers'
import {
  VARIANT_BASE_COLUMNS,
  VARIANT_CNV_COLUMNS,
  VARIANT_STR_COLUMNS,
  VARIANT_SV_COLUMNS,
  VARIANT_TRANSCRIPT_COLUMNS,
  toNumericId
} from './postgres-import-columns'

// ---------------------------------------------------------------------------
// Recordset type maps (Phase 16: relocated from postgres-import-columns.ts).
//
// The JSON import path still uses `jsonb_to_recordset` for variant + extension
// inserts. Phase 16 only swapped the VCF path to COPY FROM STDIN, so these
// type maps remain co-located with their sole consumer here.
// ---------------------------------------------------------------------------

const VARIANT_BATCH_RECORDSET_TYPES: Record<string, string> = {
  chr: 'text',
  pos: 'bigint',
  ref: 'text',
  alt: 'text',
  gene_symbol: 'text',
  omim_mim_number: 'text',
  consequence: 'text',
  gnomad_af: 'double precision',
  cadd: 'double precision',
  clinvar: 'text',
  gt_num: 'text',
  func: 'text',
  qual: 'double precision',
  hpo_sim_score: 'double precision',
  transcript: 'text',
  cdna: 'text',
  aa_change: 'text',
  moi: 'text',
  gq: 'double precision',
  dp: 'bigint',
  ad_ref: 'bigint',
  ad_alt: 'bigint',
  ab: 'double precision',
  filter: 'text',
  info_json: 'text',
  source_format: 'text',
  variant_type: 'text',
  end_pos: 'bigint',
  sv_type: 'text',
  sv_length: 'bigint',
  caller: 'text'
}

const TRANSCRIPT_RECORDSET_TYPES: Record<string, string> = {
  variant_id: 'bigint',
  transcript_id: 'text',
  gene_symbol: 'text',
  consequence: 'text',
  func: 'text',
  cdna: 'text',
  aa_change: 'text',
  hpo_sim_score: 'double precision',
  moi: 'text',
  is_selected: 'integer',
  is_mane_select: 'integer',
  is_canonical: 'integer'
}

const SV_RECORDSET_TYPES: Record<string, string> = {
  variant_id: 'bigint',
  sv_is_precise: 'integer',
  cipos_left: 'bigint',
  cipos_right: 'bigint',
  ciend_left: 'bigint',
  ciend_right: 'bigint',
  support: 'bigint',
  coverage: 'text',
  strand: 'text',
  stdev_len: 'double precision',
  stdev_pos: 'double precision',
  vaf: 'double precision',
  dr: 'bigint',
  dv: 'bigint',
  pe_support: 'bigint',
  sr_support: 'bigint',
  event_id: 'text',
  mate_id: 'text'
}

const CNV_RECORDSET_TYPES: Record<string, string> = {
  variant_id: 'bigint',
  copy_number: 'bigint',
  copy_number_quality: 'bigint',
  homozygosity_ref: 'double precision',
  homozygosity_alt: 'double precision',
  sm: 'double precision',
  bin_count: 'bigint'
}

const STR_RECORDSET_TYPES: Record<string, string> = {
  variant_id: 'bigint',
  repeat_id: 'text',
  variant_catalog_id: 'text',
  repeat_unit: 'text',
  display_repeat_unit: 'text',
  ref_copies: 'double precision',
  alt_copies: 'text',
  repeat_length: 'bigint',
  str_status: 'text',
  normal_max: 'bigint',
  pathologic_min: 'bigint',
  disease: 'text',
  inheritance_mode: 'text',
  source_display: 'text',
  rank_score: 'text',
  locus_coverage: 'double precision',
  support_type: 'text',
  confidence_interval: 'text'
}

export type PostgresJsonImportFileType = 'simple' | 'object' | 'columnar'

export interface PostgresJsonImportRequest {
  filePath: string
  fileName: string
  caseName: string
  fileSize: number
  genomeBuild: string
  importFileType: PostgresJsonImportFileType
}

export interface PostgresJsonImportBatchResult {
  caseId: number
  variantCount: number
}

export interface PostgresJsonImportSession {
  readonly caseId: number
  insertVariantBatch(variants: Array<Record<string, unknown>>): Promise<number>
}

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

function hasExtensions(row: Record<string, unknown>): boolean {
  return (
    Array.isArray(row._transcripts) ||
    row._sv !== undefined ||
    row._cnv !== undefined ||
    row._str !== undefined
  )
}

function normalizeRecordsetValue(type: string, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null

  if (type === 'double precision') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }
    return null
  }

  if (type === 'bigint' || type === 'integer') {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null
    }
    return null
  }

  return value
}

function normalizeRecordsetPayload(
  row: Record<string, unknown>,
  typeMap: Record<string, string>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    normalized[key] =
      typeMap[key] === undefined ? value : normalizeRecordsetValue(typeMap[key], value)
  }
  return normalized
}

export class PostgresJsonImportRepository {
  private readonly schemaName: string

  // `_pool` is retained for API compatibility with Task 6's postgres-import-worker,
  // which constructs the repository with a stubbed pool and passes its own Client
  // through writeJsonImport(client, ...). The repository itself never opens a
  // connection; the executor (or worker) owns the transaction lifecycle.
  constructor(_pool: Pick<Pool, 'connect'>, schema: string) {
    this.schemaName = quoteIdentifier(schema)
  }

  async writeJsonImport(
    client: Pick<PoolClient, 'query'>,
    request: PostgresJsonImportRequest,
    writeVariants: (session: PostgresJsonImportSession) => Promise<void>
  ): Promise<PostgresJsonImportBatchResult> {
    // Duplicate-name check (single-file mode). Multi-file callers in Phase 9
    // perform pre-existing-case rejection at file 1; subsequent files look up
    // the case and append, so they bypass this check.
    const dupResult = await client.query(
      `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
      [request.caseName]
    )
    if (dupResult.rows.length > 0) {
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
    const caseId = toNumericId((caseInsert.rows[0] as { id: unknown } | undefined)?.id)

    let totalVariantCount = 0

    const session: PostgresJsonImportSession = {
      caseId,
      insertVariantBatch: async (variants) => {
        const inserted = await this.insertVariantBatch(client, caseId, variants)
        totalVariantCount += inserted
        return inserted
      }
    }

    await writeVariants(session)

    // case_data_info provenance.
    // IMPORTANT: use only columns from scripts/postgres/init-db/11-phase6-case-metadata.sql.
    // Do not add ad-hoc provenance columns here (e.g. import_date, imported_at).
    await client.query(
      `INSERT INTO ${this.schemaName}."case_data_info"
         (case_id, import_file_name, import_file_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (case_id) DO UPDATE SET
         import_file_name = EXCLUDED.import_file_name,
         import_file_type = EXCLUDED.import_file_type,
         updated_at = EXCLUDED.updated_at`,
      [caseId, request.fileName, request.importFileType, createdAt]
    )

    await client.query(`UPDATE ${this.schemaName}."cases" SET variant_count = $1 WHERE id = $2`, [
      totalVariantCount,
      caseId
    ])

    return { caseId, variantCount: totalVariantCount }
  }

  private async insertVariantBatch(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    variants: Array<Record<string, unknown>>
  ): Promise<number> {
    if (variants.length === 0) return 0

    const baseOnly: Array<Record<string, unknown>> = []
    const withExtensions: Array<Record<string, unknown>> = []
    for (const row of variants) {
      if (hasExtensions(row)) withExtensions.push(row)
      else baseOnly.push(row)
    }

    let insertedCount = 0

    // (a) Base-only rows: one batch INSERT via jsonb_to_recordset.
    if (baseOnly.length > 0) {
      await this.insertBaseOnlyBatch(client, caseId, baseOnly)
      insertedCount += baseOnly.length
    }

    // (b) Extension-bearing rows: insert one at a time to learn variant_id
    // deterministically, then do one jsonb_to_recordset call per extension
    // table.
    const transcriptPayload: Array<Record<string, unknown>> = []
    const svPayload: Array<Record<string, unknown>> = []
    const cnvPayload: Array<Record<string, unknown>> = []
    const strPayload: Array<Record<string, unknown>> = []

    for (const row of withExtensions) {
      const variantId = await this.insertBaseRowSingle(client, caseId, row)
      insertedCount += 1

      if (Array.isArray(row._transcripts)) {
        for (const t of row._transcripts as Array<Record<string, unknown>>) {
          transcriptPayload.push({ ...t, variant_id: variantId })
        }
      }
      if (row._sv !== undefined && row._sv !== null) {
        svPayload.push({ ...(row._sv as Record<string, unknown>), variant_id: variantId })
      }
      if (row._cnv !== undefined && row._cnv !== null) {
        cnvPayload.push({ ...(row._cnv as Record<string, unknown>), variant_id: variantId })
      }
      if (row._str !== undefined && row._str !== null) {
        strPayload.push({ ...(row._str as Record<string, unknown>), variant_id: variantId })
      }
    }

    if (transcriptPayload.length > 0) {
      await this.insertExtensionBatch(
        client,
        'variant_transcripts',
        VARIANT_TRANSCRIPT_COLUMNS as unknown as readonly string[],
        TRANSCRIPT_RECORDSET_TYPES,
        transcriptPayload.map((row) =>
          pickColumns(row, VARIANT_TRANSCRIPT_COLUMNS as unknown as readonly string[])
        )
      )
    }

    if (svPayload.length > 0) {
      await this.insertExtensionBatch(
        client,
        'variant_sv',
        VARIANT_SV_COLUMNS as unknown as readonly string[],
        SV_RECORDSET_TYPES,
        svPayload.map((row) => pickColumns(row, VARIANT_SV_COLUMNS as unknown as readonly string[]))
      )
    }

    if (cnvPayload.length > 0) {
      await this.insertExtensionBatch(
        client,
        'variant_cnv',
        VARIANT_CNV_COLUMNS as unknown as readonly string[],
        CNV_RECORDSET_TYPES,
        cnvPayload.map((row) =>
          pickColumns(row, VARIANT_CNV_COLUMNS as unknown as readonly string[])
        )
      )
    }

    if (strPayload.length > 0) {
      await this.insertExtensionBatch(
        client,
        'variant_str',
        VARIANT_STR_COLUMNS as unknown as readonly string[],
        STR_RECORDSET_TYPES,
        strPayload.map((row) =>
          pickColumns(row, VARIANT_STR_COLUMNS as unknown as readonly string[])
        )
      )
    }

    return insertedCount
  }

  private async insertBaseOnlyBatch(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    rows: Array<Record<string, unknown>>
  ): Promise<void> {
    const batchCols = Object.keys(VARIANT_BATCH_RECORDSET_TYPES)
    const recordsetSignature = batchCols
      .map((col) => `"${col}" ${VARIANT_BATCH_RECORDSET_TYPES[col]}`)
      .join(', ')

    const payload = rows.map((row) => {
      const picked = pickColumns(row, batchCols as readonly string[])
      // Default variant_type to 'snv' when not provided.
      if (picked.variant_type === null) {
        picked.variant_type = 'snv'
      }
      return normalizeRecordsetPayload(picked, VARIANT_BATCH_RECORDSET_TYPES)
    })

    // Embed case_id into the JSON payload so the batch INSERT has exactly one
    // bound parameter (the JSON), dodging PostgreSQL's 65,535 parameter cap.
    const payloadWithCaseId = payload.map((row) => ({ case_id: caseId, ...row }))

    const sql = `INSERT INTO ${this.schemaName}."variants"
      (${VARIANT_BASE_COLUMNS.map((c) => `"${c}"`).join(', ')})
      SELECT ${VARIANT_BASE_COLUMNS.map((c) => `v."${c}"`).join(', ')}
      FROM jsonb_to_recordset($1::jsonb) AS v(
        "case_id" bigint,
        ${recordsetSignature}
      )`

    await client.query(sql, [JSON.stringify(payloadWithCaseId)])
  }

  private async insertBaseRowSingle(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    row: Record<string, unknown>
  ): Promise<number> {
    const batchCols = Object.keys(VARIANT_BATCH_RECORDSET_TYPES)
    const recordsetSignature = batchCols
      .map((col) => `"${col}" ${VARIANT_BATCH_RECORDSET_TYPES[col]}`)
      .join(', ')

    const picked = normalizeRecordsetPayload(
      pickColumns(row, batchCols as readonly string[]),
      VARIANT_BATCH_RECORDSET_TYPES
    )
    if (picked.variant_type === null) picked.variant_type = 'snv'
    const payload = [{ case_id: caseId, ...picked }]

    const sql = `INSERT INTO ${this.schemaName}."variants"
      (${VARIANT_BASE_COLUMNS.map((c) => `"${c}"`).join(', ')})
      SELECT ${VARIANT_BASE_COLUMNS.map((c) => `v."${c}"`).join(', ')}
      FROM jsonb_to_recordset($1::jsonb) AS v(
        "case_id" bigint,
        ${recordsetSignature}
      )
      RETURNING id`

    const result = await client.query(sql, [JSON.stringify(payload)])
    return toNumericId((result.rows[0] as { id: unknown } | undefined)?.id)
  }

  private async insertExtensionBatch(
    client: Pick<PoolClient, 'query'>,
    table: string,
    columns: readonly string[],
    recordsetTypes: Record<string, string>,
    rows: Array<Record<string, unknown>>
  ): Promise<void> {
    if (rows.length === 0) return
    const recordsetSignature = columns
      .map((col) => `"${col}" ${recordsetTypes[col] ?? 'text'}`)
      .join(', ')

    const sql = `INSERT INTO ${this.schemaName}.${quoteIdentifier(table)}
      (${columns.map((c) => `"${c}"`).join(', ')})
      SELECT ${columns.map((c) => `v."${c}"`).join(', ')}
      FROM jsonb_to_recordset($1::jsonb) AS v(${recordsetSignature})`

    await client.query(sql, [
      JSON.stringify(rows.map((row) => normalizeRecordsetPayload(row, recordsetTypes)))
    ])
  }
}

export async function rebuildVariantFrequencyForCase(
  client: Pick<PoolClient, 'query'>,
  schema: string,
  caseId: number,
  includeProvisional = false
): Promise<void> {
  const schemaName = quoteIdentifier(schema)
  const variantsTable = includeProvisional ? 'variants_all' : 'variants'
  await client.query(
    `INSERT INTO ${schemaName}."variant_frequency" (chr, pos, ref, alt, case_count)
     SELECT chr, pos, ref, alt, 1
     FROM ${schemaName}.${quoteIdentifier(variantsTable)}
     WHERE case_id = $1
     GROUP BY chr, pos, ref, alt
     ON CONFLICT (coord_hash)
     DO UPDATE SET case_count = ${schemaName}."variant_frequency".case_count + 1`,
    [caseId]
  )
}
