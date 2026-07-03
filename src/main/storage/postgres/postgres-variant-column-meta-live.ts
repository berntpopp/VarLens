import type { Pool } from 'pg'

import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import { runNamedDynamic } from './named-query'
import type { PostgresVariantColumnDefinition } from './postgres-variant-columns'

/**
 * Live-aggregation per-column metadata for the multi-case and extension-column
 * scopes (Sprint A PR-3 C4). The per-case base-column scope reads the
 * materialised cohort_column_meta cache instead; these helpers cover the
 * branches that cannot read that cache without overcounting (multi-case
 * cross-case distinct — Pass-5 MED #1) or that are not materialised there
 * (extension columns sv.*, cnv.*, str.*).
 */

const DISTINCT_THRESHOLD = 50

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

/** LEFT JOIN to the extension table backing an `sv.*` / `cnv.*` / `str.*` key. */
export function buildColumnMetaJoins(schemaName: string, columnKey: string): string {
  if (columnKey.startsWith('sv.')) {
    return `LEFT JOIN ${schemaName}."variant_sv" sv ON sv.variant_id = v.id`
  }
  if (columnKey.startsWith('cnv.')) {
    return `LEFT JOIN ${schemaName}."variant_cnv" cnv ON cnv.variant_id = v.id`
  }
  if (columnKey.startsWith('str.')) {
    return `LEFT JOIN ${schemaName}."variant_str" str_ext ON str_ext.variant_id = v.id`
  }
  return ''
}

export async function getNumericColumnMetaLive(
  pool: Pool,
  schema: string,
  schemaName: string,
  caseIds: number[],
  definition: PostgresVariantColumnDefinition
): Promise<ColumnFilterMeta> {
  const result = await runNamedDynamic<{ distinct_count: unknown; min: unknown; max: unknown }>(
    pool,
    {
      baseName: 'variants:column_meta',
      text: `SELECT COUNT(DISTINCT ${definition.sql})::int AS distinct_count,
              MIN(${definition.sql}) AS min,
              MAX(${definition.sql}) AS max
       FROM ${schemaName}."variants" v
       ${buildColumnMetaJoins(schemaName, definition.key)}
       WHERE v.case_id = ANY($1::bigint[])`,
      values: [caseIds],
      schema
    }
  )
  const row = result.rows[0] as
    { distinct_count?: unknown; min?: unknown; max?: unknown } | undefined
  const meta: ColumnFilterMeta = {
    key: definition.key,
    dataType: 'numeric',
    distinctCount: toNumber(row?.distinct_count)
  }
  const min = toOptionalNumber(row?.min)
  const max = toOptionalNumber(row?.max)
  if (min !== undefined) meta.min = min
  if (max !== undefined) meta.max = max
  return meta
}

export async function getCategoricalColumnMetaLive(
  pool: Pool,
  schema: string,
  schemaName: string,
  caseIds: number[],
  definition: PostgresVariantColumnDefinition
): Promise<ColumnFilterMeta> {
  const joins = buildColumnMetaJoins(schemaName, definition.key)
  const countResult = await runNamedDynamic<{ distinct_count: unknown }>(pool, {
    baseName: 'variants:column_meta',
    text: `SELECT COUNT(DISTINCT ${definition.sql})::int AS distinct_count
       FROM ${schemaName}."variants" v
       ${joins}
       WHERE v.case_id = ANY($1::bigint[])`,
    values: [caseIds],
    schema
  })
  const distinctCount = toNumber(
    (countResult.rows[0] as { distinct_count?: unknown } | undefined)?.distinct_count
  )
  const meta: ColumnFilterMeta = {
    key: definition.key,
    dataType: 'text',
    distinctCount
  }

  if (distinctCount > 0 && distinctCount <= DISTINCT_THRESHOLD) {
    const valuesResult = await runNamedDynamic<{ value: unknown }>(pool, {
      baseName: 'variants:column_meta',
      text: `SELECT DISTINCT ${definition.sql} AS value
         FROM ${schemaName}."variants" v
         ${joins}
         WHERE v.case_id = ANY($1::bigint[])
           AND ${definition.sql} IS NOT NULL
         ORDER BY ${definition.sql}`,
      values: [caseIds],
      schema
    })
    meta.distinctValues = (valuesResult.rows as Array<{ value: unknown }>).map((row) =>
      String(row.value)
    )
  }

  return meta
}
