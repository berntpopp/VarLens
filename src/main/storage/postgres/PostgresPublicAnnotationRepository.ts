import type { Pool } from 'pg'

import type {
  PublicAnnotationBatchReferences,
  PublicAnnotationReferences,
  PublicAnnotationSnapshotSummary,
  PublicAnnotationVariantRecord
} from '../../../shared/types/api'

type QueryablePool = Pick<Pool, 'query'>

interface VariantKey {
  chr: string
  pos: number
  ref: string
  alt: string
}

const SNAPSHOT_TABLE = 'public_annotation_snapshots'
const FILE_TABLE = 'public_annotation_files'
const VARIANT_RECORD_TABLE = 'public_annotation_variant_records'
const DEFAULT_SNAPSHOT_LIMIT = 20
const DEFAULT_VARIANT_RECORD_LIMIT = 500
const METADATA_CACHE_TTL_MS = 60_000
const VARIANT_RECORD_COLUMNS = [
  'chr',
  'pos',
  'ref',
  'alt',
  'snapshot_id',
  'source_id',
  'field_name',
  'field_value',
  'evidence_json',
  'provenance_json'
] as const

function variantKey(key: VariantKey): string {
  return `${key.chr}:${key.pos}:${key.ref}:${key.alt}`
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  if (typeof value === 'bigint') return Number(value)
  return 0
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value === 'true' || value === '1'
  return false
}

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function toSnapshot(row: Record<string, unknown>): PublicAnnotationSnapshotSummary {
  return {
    snapshotId: String(row.snapshot_id),
    bundleId: toNullableString(row.bundle_id),
    genomeBuild: toNullableString(row.genome_build),
    mappingVersion: String(row.mapping_version),
    contentHash: String(row.content_hash),
    manifestChecksum: String(row.manifest_checksum),
    licenseMatrixChecksum: String(row.license_matrix_checksum),
    publicFileCount: toNumber(row.public_file_count),
    privateCaseData: toBoolean(row.private_case_data),
    ingestedAt: toNullableString(row.ingested_at)
  }
}

function toVariantRecord(row: Record<string, unknown>): PublicAnnotationVariantRecord {
  return {
    snapshotId: String(row.snapshot_id),
    sourceId: toNullableString(row.source_id),
    fieldName: String(row.field_name),
    fieldValue: row.field_value ?? null,
    evidence: row.evidence_json ?? null,
    provenance: row.provenance_json ?? null
  }
}

export class PostgresPublicAnnotationRepository {
  private readonly tableExistsCache = new Map<string, { value: boolean; expiresAt: number }>()
  private readonly tableColumnsCache = new Map<string, { value: boolean; expiresAt: number }>()
  private snapshotCache: { value: PublicAnnotationSnapshotSummary[]; expiresAt: number } | null =
    null

  constructor(private readonly pool: QueryablePool) {}

  async getReferencesForVariant(key: VariantKey): Promise<PublicAnnotationReferences> {
    const batch = await this.getBatchReferences([key])
    return batch[variantKey(key)] ?? { snapshots: [], variantRecords: [] }
  }

  async getBatchReferences(keys: VariantKey[]): Promise<PublicAnnotationBatchReferences> {
    const result: PublicAnnotationBatchReferences = {}
    const uniqueKeys = new Map<string, VariantKey>()
    for (const key of keys) {
      const id = variantKey(key)
      uniqueKeys.set(id, key)
      result[id] = { snapshots: [], variantRecords: [] }
    }
    if (uniqueKeys.size === 0) return result

    const snapshots = await this.listSnapshots()
    for (const id of uniqueKeys.keys()) {
      result[id].snapshots = snapshots
    }
    if (snapshots.length === 0) return result

    const variantRecordTableReady = await this.tableHasColumns(
      VARIANT_RECORD_TABLE,
      VARIANT_RECORD_COLUMNS
    )
    if (!variantRecordTableReady) return result

    const orderedKeys = [...uniqueKeys.values()]
    const query = await this.pool.query(
      `
        WITH input_keys AS (
          SELECT *
          FROM UNNEST($1::text[], $2::bigint[], $3::text[], $4::text[])
            AS k(chr, pos, ref, alt)
        ),
        ranked_records AS (
          SELECT
            k.chr AS key_chr,
            k.pos AS key_pos,
            k.ref AS key_ref,
            k.alt AS key_alt,
            r.snapshot_id,
            r.source_id,
            r.field_name,
            r.field_value,
            r.evidence_json,
            r.provenance_json,
            ROW_NUMBER() OVER (
              PARTITION BY k.chr, k.pos, k.ref, k.alt
              ORDER BY r.snapshot_id DESC, r.source_id NULLS LAST, r.field_name ASC
            ) AS rn
          FROM input_keys k
          INNER JOIN public.public_annotation_variant_records r
            ON r.chr = k.chr
           AND r.pos = k.pos
           AND r.ref = k.ref
           AND r.alt = k.alt
        )
        SELECT
          key_chr,
          key_pos,
          key_ref,
          key_alt,
          snapshot_id,
          source_id,
          field_name,
          field_value,
          evidence_json,
          provenance_json
        FROM ranked_records
        WHERE rn <= $5
        ORDER BY key_chr, key_pos, key_ref, key_alt, rn
      `,
      [
        orderedKeys.map((key) => key.chr),
        orderedKeys.map((key) => key.pos),
        orderedKeys.map((key) => key.ref),
        orderedKeys.map((key) => key.alt),
        DEFAULT_VARIANT_RECORD_LIMIT
      ]
    )
    for (const row of query.rows as Record<string, unknown>[]) {
      const id = variantKey({
        chr: String(row.key_chr),
        pos: toNumber(row.key_pos),
        ref: String(row.key_ref),
        alt: String(row.key_alt)
      })
      result[id]?.variantRecords.push(toVariantRecord(row))
    }

    return result
  }

  private async listSnapshots(): Promise<PublicAnnotationSnapshotSummary[]> {
    const now = Date.now()
    if (this.snapshotCache !== null && this.snapshotCache.expiresAt > now) {
      return this.snapshotCache.value
    }

    const schemaReady =
      (await this.tableExists(SNAPSHOT_TABLE)) && (await this.tableExists(FILE_TABLE))
    if (!schemaReady) {
      this.snapshotCache = { value: [], expiresAt: now + METADATA_CACHE_TTL_MS }
      return []
    }

    const result = await this.pool.query(
      `
        SELECT
          s.snapshot_id,
          s.bundle_id,
          s.genome_build,
          s.mapping_version,
          s.content_hash,
          s.manifest_checksum,
          s.license_matrix_checksum,
          COUNT(f.path)::int AS public_file_count,
          s.private_case_data,
          s.ingested_at::text AS ingested_at
        FROM public.public_annotation_snapshots s
        LEFT JOIN public.public_annotation_files f
          ON f.snapshot_id = s.snapshot_id
        GROUP BY
          s.snapshot_id,
          s.bundle_id,
          s.genome_build,
          s.mapping_version,
          s.content_hash,
          s.manifest_checksum,
          s.license_matrix_checksum,
          s.private_case_data,
          s.ingested_at
        ORDER BY s.ingested_at DESC, s.snapshot_id DESC
        LIMIT $1
      `,
      [DEFAULT_SNAPSHOT_LIMIT]
    )
    const snapshots = (result.rows as Record<string, unknown>[]).map(toSnapshot)
    this.snapshotCache = { value: snapshots, expiresAt: now + METADATA_CACHE_TTL_MS }
    return snapshots
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const now = Date.now()
    const cached = this.tableExistsCache.get(tableName)
    if (cached !== undefined && cached.expiresAt > now) return cached.value

    const result = await this.pool.query('SELECT to_regclass($1) IS NOT NULL AS exists', [
      `public.${tableName}`
    ])
    const value = toBoolean(result.rows[0]?.exists)
    this.tableExistsCache.set(tableName, { value, expiresAt: now + METADATA_CACHE_TTL_MS })
    return value
  }

  private async tableHasColumns(tableName: string, columns: readonly string[]): Promise<boolean> {
    const cacheKey = `${tableName}:${columns.join(',')}`
    const now = Date.now()
    const cached = this.tableColumnsCache.get(cacheKey)
    if (cached !== undefined && cached.expiresAt > now) return cached.value

    if (!(await this.tableExists(tableName))) return false
    const result = await this.pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = ANY($2::text[])
      `,
      [tableName, [...columns]]
    )
    const present = new Set(result.rows.map((row) => String(row.column_name)))
    const value = columns.every((column) => present.has(column))
    this.tableColumnsCache.set(cacheKey, { value, expiresAt: now + METADATA_CACHE_TTL_MS })
    return value
  }
}
