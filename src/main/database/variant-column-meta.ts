import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
import type { ColumnFilterMeta } from '../../shared/types/column-filters'
import { withOfferedValues } from '../../shared/config'
import { NUMERIC_COLUMN_FILTER_KEYS } from '../../shared/filters/column-filter-validation'
import { BASE_SORTABLE_COLUMNS } from './VariantFilterBuilder'
import { comparedColumnSql } from '../../shared/sql/unsigned-columns'
import { isExtensionColumnKey, resolveExtensionColumnKey } from './variant-extension-registry'

export const COMPUTED_COLUMNS = new Set(['internal_af'])

const totalChangesStatements = new WeakMap<DatabaseType, Statement>()

export function getCaseStamp(db: DatabaseType, mutationSeq: number): string {
  let dataVersion = 0
  try {
    const dv = db.pragma('data_version', { simple: true })
    if (typeof dv === 'number' || typeof dv === 'string' || typeof dv === 'bigint') {
      dataVersion = Number(dv)
    }
  } catch {
    // Ignore if pragma fails
  }

  let totalChanges = 0
  try {
    let stmt = totalChangesStatements.get(db)
    if (stmt === undefined) {
      stmt = db.prepare('SELECT total_changes() AS total_changes')
      totalChangesStatements.set(db, stmt)
    }
    const row = stmt.get() as { total_changes: number } | undefined
    totalChanges = row?.total_changes ?? 0
  } catch {
    // Ignore
  }

  return `${dataVersion}:${totalChanges}:${mutationSeq}`
}

export function computeAllColumnMetas(db: DatabaseType, caseId: number): ColumnFilterMeta[] {
  const DISTINCT_THRESHOLD = 50
  // Exclude computed columns (e.g. internal_af) which don't exist as physical table columns
  const columns = Object.entries(BASE_SORTABLE_COLUMNS).filter(
    ([key]) => !COMPUTED_COLUMNS.has(key)
  )

  // Query 1: Single scan — COUNT(DISTINCT col) for all columns + MIN/MAX for numeric columns
  const selectParts: string[] = []
  for (const [key, sqlCol] of columns) {
    selectParts.push(`COUNT(DISTINCT "${sqlCol}") AS "cnt_${key}"`)
    if (NUMERIC_COLUMN_FILTER_KEYS.has(key)) {
      selectParts.push(`MIN(${comparedColumnSql(key, `"${sqlCol}"`)}) AS "min_${key}"`)
      selectParts.push(`MAX(${comparedColumnSql(key, `"${sqlCol}"`)}) AS "max_${key}"`)
    }
  }
  const aggSql = `SELECT ${selectParts.join(', ')} FROM variants WHERE case_id = ?`
  const aggRow = db.prepare(aggSql).get(caseId) as Record<string, number | null>

  // Build initial meta entries from aggregate results
  const meta: ColumnFilterMeta[] = []
  const lowCardinalityColumns: [string, string][] = []

  for (const [key, sqlCol] of columns) {
    const isNumeric = NUMERIC_COLUMN_FILTER_KEYS.has(key)
    const distinctCount = (aggRow[`cnt_${key}`] as number) ?? 0

    const entry: ColumnFilterMeta = {
      key,
      dataType: isNumeric ? 'numeric' : 'text',
      distinctCount
    }

    if (isNumeric) {
      const minVal = aggRow[`min_${key}`]
      const maxVal = aggRow[`max_${key}`]
      entry.min = minVal ?? undefined
      entry.max = maxVal ?? undefined
    }

    if (distinctCount > 0 && distinctCount <= DISTINCT_THRESHOLD) {
      lowCardinalityColumns.push([key, sqlCol])
    }

    meta.push(entry)
  }

  // Query 2: UNION ALL for distinct values of all low-cardinality columns
  if (lowCardinalityColumns.length > 0) {
    // SAFETY: sqlCol values come from hardcoded BASE_SORTABLE_COLUMNS constant
    const unionParts = lowCardinalityColumns.map(
      ([key, sqlCol]) =>
        `SELECT '${key}' AS col_key, CAST("${sqlCol}" AS TEXT) AS val FROM variants WHERE case_id = ? AND "${sqlCol}" IS NOT NULL GROUP BY "${sqlCol}"`
    )
    const unionSql = unionParts.join(' UNION ALL ')
    const params = lowCardinalityColumns.map(() => caseId)
    const rows = db.prepare(unionSql).all(...params) as {
      col_key: string
      val: string
    }[]

    // Group results by column key
    const valuesByKey = new Map<string, string[]>()
    for (const row of rows) {
      let arr = valuesByKey.get(row.col_key)
      if (arr === undefined) {
        arr = []
        valuesByKey.set(row.col_key, arr)
      }
      arr.push(row.val)
    }

    // Attach sorted distinct values to corresponding meta entries
    for (const entry of meta) {
      const values = valuesByKey.get(entry.key)
      if (values !== undefined) {
        entry.distinctValues = values.sort((a, b) => a.localeCompare(b))
      }
    }
  }

  return meta.map(withOfferedValues)
}

export function computeColumnMeta(
  db: DatabaseType,
  scope: { caseId: number } | { caseIds: number[] },
  columnKey: string
): ColumnFilterMeta {
  if (isExtensionColumnKey(columnKey)) {
    return computeExtensionColumnMeta(db, scope, columnKey)
  }
  return computeBaseColumnMeta(db, scope, columnKey)
}

function computeBaseColumnMeta(
  db: DatabaseType,
  scope: { caseId: number } | { caseIds: number[] },
  columnKey: string
): ColumnFilterMeta {
  const sqlCol = BASE_SORTABLE_COLUMNS[columnKey]
  if (sqlCol === undefined || COMPUTED_COLUMNS.has(columnKey)) {
    return { key: columnKey, dataType: 'text', distinctCount: 0 }
  }

  const DISTINCT_THRESHOLD = 50
  const isNumeric = NUMERIC_COLUMN_FILTER_KEYS.has(columnKey)
  const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
  if (caseIds.length === 0) {
    return {
      key: columnKey,
      dataType: isNumeric ? 'numeric' : 'text',
      distinctCount: 0
    }
  }
  const placeholders = caseIds.map(() => '?').join(', ')

  const aggParts = [`COUNT(DISTINCT "${sqlCol}") AS distinctCount`]
  if (isNumeric) {
    const compared = comparedColumnSql(columnKey, `"${sqlCol}"`)
    aggParts.push(`MIN(${compared}) AS min`, `MAX(${compared}) AS max`)
  }
  const aggSql = `SELECT ${aggParts.join(', ')} FROM variants WHERE case_id IN (${placeholders})`
  const aggRow = db.prepare(aggSql).get(...caseIds) as {
    distinctCount: number | null
    min?: number | null
    max?: number | null
  }

  const entry: ColumnFilterMeta = {
    key: columnKey,
    dataType: isNumeric ? 'numeric' : 'text',
    distinctCount: aggRow.distinctCount ?? 0
  }
  if (isNumeric) {
    entry.min = aggRow.min ?? undefined
    entry.max = aggRow.max ?? undefined
  }

  if (entry.distinctCount > 0 && entry.distinctCount <= DISTINCT_THRESHOLD) {
    // SAFETY: sqlCol comes from hardcoded BASE_SORTABLE_COLUMNS
    const valRows = db
      .prepare(
        `SELECT DISTINCT CAST("${sqlCol}" AS TEXT) AS v
         FROM variants
         WHERE case_id IN (${placeholders}) AND "${sqlCol}" IS NOT NULL
         ORDER BY "${sqlCol}"`
      )
      .all(...caseIds) as { v: string }[]
    entry.distinctValues = valRows.map((r) => r.v)
  }

  return withOfferedValues(entry)
}

function computeExtensionColumnMeta(
  db: DatabaseType,
  scope: { caseId: number } | { caseIds: number[] },
  columnKey: string
): ColumnFilterMeta {
  const resolved = resolveExtensionColumnKey(columnKey)
  if (resolved === null) {
    return { key: columnKey, dataType: 'text', distinctCount: 0 }
  }
  const DISTINCT_THRESHOLD = 50
  const { def, column, columnDef } = resolved
  const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
  if (caseIds.length === 0) {
    const type = columnDef.kind === 'number' ? 'numeric' : 'text'
    return { key: columnKey, dataType: type, distinctCount: 0 }
  }
  const placeholders = caseIds.map(() => '?').join(', ')
  // Driven from the small extension table (CROSS JOIN fixes the loop order),
  // each row's case looked up by primary key (#560).
  const scoped = `FROM ${def.table} e CROSS JOIN variants v ON v.id = e.variant_id
         WHERE v.case_id IN (${placeholders})`

  if (columnDef.kind === 'number') {
    const row = db
      .prepare(
        `SELECT MIN(e."${column}") AS min, MAX(e."${column}") AS max, COUNT(DISTINCT e."${column}") AS distinctCount ${scoped}`
      )
      .get(...caseIds) as { min: number | null; max: number | null; distinctCount: number }
    return {
      key: columnKey,
      dataType: 'numeric',
      distinctCount: row.distinctCount ?? 0,
      min: row.min ?? undefined,
      max: row.max ?? undefined
    }
  }

  const countRow = db
    .prepare(`SELECT COUNT(DISTINCT e."${column}") AS distinctCount ${scoped}`)
    .get(...caseIds) as { distinctCount: number }

  const entry: ColumnFilterMeta = {
    key: columnKey,
    dataType: 'text',
    distinctCount: countRow.distinctCount ?? 0
  }

  if (entry.distinctCount > 0 && entry.distinctCount <= DISTINCT_THRESHOLD) {
    const valRows = db
      .prepare(
        `SELECT DISTINCT e."${column}" AS v ${scoped}
           AND e."${column}" IS NOT NULL
         ORDER BY e."${column}"`
      )
      .all(...caseIds) as { v: string | number | null }[]
    entry.distinctValues = valRows.map((r) => String(r.v))
  }

  return entry
}

export class VariantColumnMetaCache {
  private static readonly MAX_META_CACHE_SIZE = 50
  private readonly cache = new Map<number, { stamp: string; data: ColumnFilterMeta[] }>()
  private mutationSeq = 0

  constructor(private readonly db: DatabaseType) {}

  clear(caseId?: number): void {
    this.mutationSeq++
    if (caseId !== undefined) {
      this.cache.delete(caseId)
    } else {
      this.cache.clear()
    }
  }

  getAllColumnMetas(caseId: number): ColumnFilterMeta[] {
    const stamp = getCaseStamp(this.db, this.mutationSeq)
    const cached = this.cache.get(caseId)
    if (cached !== undefined && cached.stamp === stamp) {
      this.cache.delete(caseId)
      this.cache.set(caseId, cached)
      return cached.data
    }

    const result = computeAllColumnMetas(this.db, caseId)

    if (this.cache.size >= VariantColumnMetaCache.MAX_META_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }
    this.cache.set(caseId, { stamp, data: result })
    return result
  }
}
