import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
import type { ColumnFilterMeta } from '../../shared/types/column-filters'
import { withOfferedValues } from '../../shared/config'
import { NUMERIC_COLUMN_FILTER_KEYS } from '../../shared/filters/column-filter-validation'
import { BASE_SORTABLE_COLUMNS } from './VariantFilterBuilder'
import { comparedColumnSql } from '../../shared/sql/unsigned-columns'

export const COMPUTED_COLUMNS = new Set(['internal_af'])

const initializedDbs = new WeakSet<DatabaseType>()
const revStatements = new WeakMap<DatabaseType, Statement>()

export function ensureCaseMetaRevSchema(db: DatabaseType): void {
  if (initializedDbs.has(db)) return
  try {
    const queryOnly = db.pragma('query_only', { simple: true })
    if (queryOnly === 1 || queryOnly === true) {
      initializedDbs.add(db)
      return
    }
  } catch {
    // Ignore pragma check failures
  }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _case_meta_rev (case_id INTEGER PRIMARY KEY, rev INTEGER NOT NULL DEFAULT 0);
      CREATE TRIGGER IF NOT EXISTS _variants_case_meta_rev_ai AFTER INSERT ON variants BEGIN
        INSERT INTO _case_meta_rev(case_id, rev) VALUES (NEW.case_id, 1)
        ON CONFLICT(case_id) DO UPDATE SET rev = rev + 1;
      END;
      CREATE TRIGGER IF NOT EXISTS _variants_case_meta_rev_ad AFTER DELETE ON variants BEGIN
        INSERT INTO _case_meta_rev(case_id, rev) VALUES (OLD.case_id, 1)
        ON CONFLICT(case_id) DO UPDATE SET rev = rev + 1;
      END;
      CREATE TRIGGER IF NOT EXISTS _variants_case_meta_rev_au AFTER UPDATE ON variants BEGIN
        INSERT INTO _case_meta_rev(case_id, rev) VALUES (NEW.case_id, 1)
        ON CONFLICT(case_id) DO UPDATE SET rev = rev + 1;
        INSERT INTO _case_meta_rev(case_id, rev) SELECT OLD.case_id, 1 WHERE OLD.case_id != NEW.case_id
        ON CONFLICT(case_id) DO UPDATE SET rev = rev + 1;
      END;
    `)
    initializedDbs.add(db)
  } catch {
    // If tables variants or cases don't exist yet, retry on next call
  }
}

export function bumpCaseMetaRev(db: DatabaseType, caseId?: number): void {
  ensureCaseMetaRevSchema(db)
  try {
    if (caseId !== undefined) {
      db.prepare(
        `INSERT INTO _case_meta_rev(case_id, rev) VALUES (?, 1)
         ON CONFLICT(case_id) DO UPDATE SET rev = rev + 1;`
      ).run(caseId)
    } else {
      db.prepare(`UPDATE _case_meta_rev SET rev = rev + 1;`).run()
    }
  } catch {
    // Ignore
  }
}

export function getCaseStamp(db: DatabaseType, caseId: number, mutationSeq: number): string {
  ensureCaseMetaRevSchema(db)
  let dataVersion = 0
  try {
    const dv = db.pragma('data_version', { simple: true })
    if (typeof dv === 'number' || typeof dv === 'string' || typeof dv === 'bigint') {
      dataVersion = Number(dv)
    }
  } catch {
    // Ignore if pragma fails
  }

  let rev = 0
  try {
    let stmt = revStatements.get(db)
    if (stmt === undefined) {
      stmt = db.prepare('SELECT rev FROM _case_meta_rev WHERE case_id = ?')
      revStatements.set(db, stmt)
    }
    const row = stmt.get(caseId) as { rev: number } | undefined
    rev = row?.rev ?? 0
  } catch {
    // Ignore
  }

  return `${dataVersion}:${mutationSeq}:${rev}`
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

export class VariantColumnMetaCache {
  private static readonly MAX_META_CACHE_SIZE = 50
  private readonly cache = new Map<number, { stamp: string; data: ColumnFilterMeta[] }>()
  private mutationSeq = 0

  constructor(private readonly db: DatabaseType) {}

  clear(caseId?: number): void {
    this.mutationSeq++
    bumpCaseMetaRev(this.db, caseId)
    if (caseId !== undefined) {
      this.cache.delete(caseId)
    } else {
      this.cache.clear()
    }
  }

  getAllColumnMetas(caseId: number): ColumnFilterMeta[] {
    const stamp = getCaseStamp(this.db, caseId, this.mutationSeq)
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
