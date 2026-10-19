import type {
  AcmgClassification,
  CaseVariantAnnotation,
  VariantAnnotation
} from '../../../shared/types/database'
import { toNumber } from './identifiers'

export type GlobalAnnotationUpdates = Partial<
  Omit<
    Pick<VariantAnnotation, 'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'>,
    'starred'
  > & {
    starred: number | boolean
  }
>

export type PerCaseAnnotationUpdates = Partial<
  Omit<
    Pick<
      CaseVariantAnnotation,
      'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
    >,
    'starred'
  > & {
    starred: number | boolean
  }
>

export type VariantKey = { chr: string; pos: number; ref: string; alt: string }
export type GlobalKey = VariantKey & { genomeBuild: string }

export const nowExpression = '(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint'

export function toStarredNumber(value: unknown): number {
  return toNumber(value) === 0 ? 0 : 1
}

export function toGlobalAnnotation(row: Record<string, unknown>): VariantAnnotation {
  return {
    id: toNumber(row.id),
    chr: String(row.chr),
    pos: toNumber(row.pos),
    ref: String(row.ref),
    alt: String(row.alt),
    genome_build: String(row.genome_build),
    global_comment: row.global_comment === null ? null : String(row.global_comment),
    starred: toStarredNumber(row.starred),
    acmg_classification: (row.acmg_classification ?? null) as AcmgClassification | null,
    acmg_evidence: row.acmg_evidence === null ? null : String(row.acmg_evidence),
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at)
  }
}

export function toPerCaseAnnotation(row: Record<string, unknown>): CaseVariantAnnotation {
  return {
    id: toNumber(row.id),
    case_id: toNumber(row.case_id),
    variant_id: toNumber(row.variant_id),
    per_case_comment: row.per_case_comment === null ? null : String(row.per_case_comment),
    starred: toStarredNumber(row.starred),
    acmg_classification: (row.acmg_classification ?? null) as AcmgClassification | null,
    acmg_evidence: row.acmg_evidence === null ? null : String(row.acmg_evidence),
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at)
  }
}

export function variantKey(key: VariantKey): string {
  return `${key.chr}:${key.pos}:${key.ref}:${key.alt}`
}

export function buildGlobalLockAndGetSql(schemaName: string): string {
  return `
    SELECT *
    FROM ${schemaName}."variant_annotations"
    WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4 AND genome_build = $5
    LIMIT 1
    FOR UPDATE
  `
}

export function buildPerCaseLockAndGetSql(schemaName: string): string {
  return `
    SELECT *
    FROM ${schemaName}."case_variant_annotations"
    WHERE case_id = $1 AND variant_id = $2
    LIMIT 1
    FOR UPDATE
  `
}

export function buildGlobalUpsertSql(schemaName: string): string {
  return `
    INSERT INTO ${schemaName}."variant_annotations" (
      chr, pos, ref, alt, genome_build, global_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $13, $5, $6, $7, $8, ${nowExpression}, ${nowExpression})
    ON CONFLICT (chr, pos, ref, alt, genome_build) DO UPDATE SET
      global_comment = CASE WHEN $9 THEN EXCLUDED.global_comment ELSE variant_annotations.global_comment END,
      starred = CASE WHEN $10 THEN EXCLUDED.starred ELSE variant_annotations.starred END,
      acmg_classification = CASE WHEN $11 THEN EXCLUDED.acmg_classification ELSE variant_annotations.acmg_classification END,
      acmg_evidence = CASE WHEN $12 THEN EXCLUDED.acmg_evidence ELSE variant_annotations.acmg_evidence END,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `
}

export function buildPerCaseUpsertSql(schemaName: string): string {
  return `
    INSERT INTO ${schemaName}."case_variant_annotations" (
      case_id, variant_id, per_case_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, ${nowExpression}, ${nowExpression})
    ON CONFLICT (case_id, variant_id) DO UPDATE SET
      per_case_comment = CASE WHEN $7 THEN EXCLUDED.per_case_comment ELSE case_variant_annotations.per_case_comment END,
      starred = CASE WHEN $8 THEN EXCLUDED.starred ELSE case_variant_annotations.starred END,
      acmg_classification = CASE WHEN $9 THEN EXCLUDED.acmg_classification ELSE case_variant_annotations.acmg_classification END,
      acmg_evidence = CASE WHEN $10 THEN EXCLUDED.acmg_evidence ELSE case_variant_annotations.acmg_evidence END,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `
}

export function buildGlobalDeleteSql(schemaName: string): string {
  return `
    DELETE FROM ${schemaName}."variant_annotations"
    WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4 AND genome_build = $5
  `
}

export function buildPerCaseDeleteSql(schemaName: string): string {
  return `
    DELETE FROM ${schemaName}."case_variant_annotations"
    WHERE case_id = $1 AND variant_id = $2
  `
}

const poolWriteLocks = new WeakMap<object, Map<string, Promise<void>>>()

export async function acquireAnnotationWriteLocks(
  pool: object,
  schema: string,
  rawKeys: string[]
): Promise<() => void> {
  const sortedKeys = Array.from(new Set(rawKeys.map((k) => `${schema}:${k}`))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )
  let lockMap = poolWriteLocks.get(pool)
  if (!lockMap) {
    lockMap = new Map()
    poolWriteLocks.set(pool, lockMap)
  }
  const releases: Array<() => void> = []
  for (const key of sortedKeys) {
    while (lockMap.has(key)) {
      await lockMap.get(key)
    }
    let releaseKey!: () => void
    const p = new Promise<void>((resolve) => {
      releaseKey = () => {
        if (lockMap?.get(key) === p) lockMap.delete(key)
        resolve()
      }
    })
    lockMap.set(key, p)
    releases.push(releaseKey)
  }
  return () => {
    for (let i = releases.length - 1; i >= 0; i--) releases[i]()
  }
}
