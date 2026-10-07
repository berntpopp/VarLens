/**
 * Cohort-view column metadata, read from `cohort_variant_summary`.
 *
 * What the filter UI needs from it, and what stays exact:
 *   - min/max of every numeric column (slider bounds)
 *   - the number of distinct values of a column while it is small, and then
 *     the values themselves (dropdown lists)
 *
 * What it does not need is the exact distinct count of a high-cardinality
 * column (position, transcript, frequency, ...): the UI only asks whether the
 * count is at or below a threshold. Counting those exactly meant thirteen
 * sorted COUNT(DISTINCT) aggregates over every summary row, 2.8 s at 100
 * exomes, on every cohort refresh while an import is running. So a count
 * above the low-cardinality limit is reported as the limit plus one
 * ({@link COHORT_DISTINCT_COUNT_CAP}); SQLite reports the same.
 *
 * Two statements:
 *   1. a probe over a bounded prefix of the table. A column with more than
 *      the limit of distinct values in any subset has more than that in the
 *      whole table, so this proves most columns high-cardinality for a few ms.
 *   2. one scan with a hashed grouping set per remaining column, which also
 *      carries the min/max aggregates. Columns the probe could not rule out
 *      are counted exactly; one that turns out to be above the limit after
 *      all is capped like the others.
 */
import type { Pool } from 'pg'

import { offeredFilterValues } from '../../../shared/config/severity.config'

import {
  COHORT_DISTINCT_COUNT_CAP,
  COHORT_DISTINCT_VALUES_LIMIT,
  type ColumnFilterMeta
} from '../../../shared/types/column-filters'
import { runNamed, runNamedDynamic } from './named-query'

/** Rows the probe reads; any prefix is a valid lower bound. */
const PROBE_ROWS = 20_000

export interface CohortColumnMetaSpec {
  /** Filter-UI keys in output order. */
  keys: readonly string[]
  /** Key → SQL expression over `cvs` (and `bt`, the per-build case totals). */
  expressions: Readonly<Record<string, string>>
  numericKeys: ReadonlySet<string>
  /** `cohort_variant_summary cvs` joined with the build totals `bt`. */
  from: string
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function probeSql(spec: CohortColumnMetaSpec): string {
  const columns = spec.keys.map((key) => `${spec.expressions[key]} AS k_${key}`)
  const counts = spec.keys.map((key) => `COUNT(DISTINCT k_${key})::int AS cnt_${key}`)
  return `SELECT ${counts.join(', ')}
          FROM (SELECT ${columns.join(', ')} FROM ${spec.from} LIMIT ${PROBE_ROWS}) probe`
}

function exactSql(spec: CohortColumnMetaSpec, candidates: readonly string[]): string {
  const columns = spec.keys.map((key) => `${spec.expressions[key]} AS k_${key}`)
  const numeric = spec.keys.filter((key) => spec.numericKeys.has(key))
  const whenKey = candidates.map((key) => `WHEN GROUPING(k_${key}) = 0 THEN '${key}'`)
  const whenValue = candidates.map((key) => `WHEN GROUPING(k_${key}) = 0 THEN k_${key}::text`)
  const sets = ['()', ...candidates.map((key) => `(k_${key})`)]
  return `
    WITH src AS (SELECT ${columns.join(', ')} FROM ${spec.from}),
    grouped AS (
      SELECT ${candidates.length > 0 ? `CASE ${whenKey.join(' ')} ELSE '' END` : `''`} AS col_key,
             ${candidates.length > 0 ? `CASE ${whenValue.join(' ')} END` : 'NULL::text'} AS value
             ${numeric.map((key) => `, MIN(k_${key}) AS min_${key}, MAX(k_${key}) AS max_${key}`).join('')}
      FROM src
      GROUP BY GROUPING SETS (${sets.join(', ')})
    )
    SELECT col_key,
           COUNT(value)::int AS cnt,
           CASE WHEN COUNT(value) <= ${COHORT_DISTINCT_VALUES_LIMIT}
                THEN ARRAY_AGG(value) FILTER (WHERE value IS NOT NULL) END AS vals
           ${numeric
             .map(
               (key) =>
                 `, MIN(min_${key}) FILTER (WHERE col_key = '') AS min_${key}` +
                 `, MAX(max_${key}) FILTER (WHERE col_key = '') AS max_${key}`
             )
             .join('')}
    FROM grouped
    GROUP BY col_key`
}

export async function readCohortColumnMeta(
  pool: Pool,
  schema: string,
  spec: CohortColumnMetaSpec
): Promise<ColumnFilterMeta[]> {
  const probe = await runNamed<Record<string, unknown>>(pool, {
    name: 'cohort:column_meta_probe:v1',
    text: probeSql(spec),
    values: [],
    schema
  })
  const probeRow = probe.rows[0] ?? {}
  const candidates = spec.keys.filter(
    (key) => toNumber(probeRow[`cnt_${key}`]) <= COHORT_DISTINCT_VALUES_LIMIT
  )

  const exact = await runNamedDynamic<Record<string, unknown>>(pool, {
    baseName: 'cohort:column_meta_exact',
    text: exactSql(spec, candidates),
    values: [],
    schema
  })
  const byKey = new Map(exact.rows.map((row) => [String(row.col_key ?? ''), row]))
  const totals = byKey.get('') ?? {}

  return spec.keys.map((key) => {
    const isNumeric = spec.numericKeys.has(key)
    const row = byKey.get(key)
    // No row: the probe proved the column high-cardinality, or the table is empty.
    const counted = row !== undefined ? toNumber(row.cnt) : candidates.includes(key) ? 0 : Infinity
    const entry: ColumnFilterMeta = {
      key,
      dataType: isNumeric ? 'numeric' : 'text',
      distinctCount: Math.min(counted, COHORT_DISTINCT_COUNT_CAP)
    }
    if (isNumeric) {
      const min = toNullableNumber(totals[`min_${key}`])
      const max = toNullableNumber(totals[`max_${key}`])
      if (min !== null) entry.min = min
      if (max !== null) entry.max = max
    }
    if (row !== undefined && Array.isArray(row.vals) && row.vals.length > 0) {
      entry.distinctValues = offeredFilterValues(key, row.vals.map((value) => String(value)).sort())
    }
    return entry
  })
}
