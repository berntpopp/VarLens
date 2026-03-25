import { BaseRepository } from './BaseRepository'
import type { CaseRepository } from './CaseRepository'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { sql, type Kysely, type SelectQueryBuilder } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import type { Variant, VariantFilter, PaginatedResult, SortItem } from './types'
import type { FilterOptions } from '../../shared/types/api'
import type { ColumnFilterMeta } from '../../shared/types/column-filters'
import type { TranscriptInsertRow } from '../../shared/types/transcript'
import { createFTSTriggers } from './schema'
import { mainLogger } from '../services/MainLogger'

import { DATABASE_CONFIG } from '../../shared/config'

/** Kysely query builder type for variant queries */
type VariantQueryBuilder = SelectQueryBuilder<VarlensDatabase, 'variants', Record<string, unknown>>

const BATCH_SIZE = DATABASE_CONFIG.BATCH_INSERT_SIZE

const SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  omim_mim_number: 'omim_mim_number',
  func: 'func',
  consequence: 'consequence',
  transcript: 'transcript',
  cdna: 'cdna',
  aa_change: 'aa_change',
  gt_num: 'gt_num',
  gnomad_af: 'gnomad_af',
  cadd: 'cadd',
  qual: 'qual',
  hpo_sim_score: 'hpo_sim_score',
  clinvar: 'clinvar',
  moi: 'moi'
}

const NUMERIC_COLUMNS = new Set(['pos', 'gnomad_af', 'cadd', 'qual', 'hpo_sim_score'])

export class VariantRepository extends BaseRepository {
  private cases: CaseRepository

  constructor(db: DatabaseType, kysely: Kysely<VarlensDatabase>, cases: CaseRepository) {
    super(db, kysely)
    this.cases = cases
  }

  /**
   * Drop FTS triggers to avoid per-row overhead before a bulk insert session.
   * Must be paired with a subsequent call to `finishBulkInsert()`.
   */
  beginBulkInsert(): void {
    this.db.exec(`
      DROP TRIGGER IF EXISTS variants_fts_ai;
      DROP TRIGGER IF EXISTS variants_fts_ad;
      DROP TRIGGER IF EXISTS variants_fts_au;
    `)
  }

  /**
   * Insert a single batch of variants inside a transaction.
   * Call `beginBulkInsert()` before and `finishBulkInsert()` after all batches.
   * Does not update case variant_count — that is done in `finishBulkInsert()`.
   */
  insertBatch(
    variants: (Omit<Variant, 'id' | 'case_id'> & { _transcripts?: TranscriptInsertRow[] })[],
    caseId: number
  ): void {
    const runTransaction = this.db.transaction(
      (batch: (Omit<Variant, 'id' | 'case_id'> & { _transcripts?: TranscriptInsertRow[] })[]) => {
        for (const v of batch) {
          const result = this.execRun(
            this.kysely.insertInto('variants').values({
              case_id: caseId,
              chr: v.chr,
              pos: v.pos,
              ref: v.ref,
              alt: v.alt,
              gene_symbol: v.gene_symbol,
              omim_mim_number: v.omim_mim_number,
              consequence: v.consequence,
              gnomad_af: v.gnomad_af,
              cadd: v.cadd,
              clinvar: v.clinvar,
              gt_num: v.gt_num,
              func: v.func,
              qual: v.qual,
              hpo_sim_score: v.hpo_sim_score,
              transcript: v.transcript,
              cdna: v.cdna,
              aa_change: v.aa_change,
              moi: v.moi
            })
          )

          if (v._transcripts !== undefined && v._transcripts.length > 0) {
            const variantId = result.lastInsertRowid as number
            for (const t of v._transcripts) {
              this.execRun(
                this.kysely.insertInto('variant_transcripts').values({
                  variant_id: variantId,
                  transcript_id: t.transcript_id,
                  gene_symbol: t.gene_symbol,
                  consequence: t.consequence,
                  cdna: t.cdna,
                  aa_change: t.aa_change,
                  hpo_sim_score: t.hpo_sim_score,
                  moi: t.moi,
                  is_selected: t.is_selected
                })
              )
            }
          }
        }
      }
    )

    for (let i = 0; i < variants.length; i += BATCH_SIZE) {
      runTransaction(variants.slice(i, i + BATCH_SIZE))
    }
  }

  /**
   * Rebuild FTS, recreate triggers, update case variant_count, run ANALYZE and optimize.
   * Call this once after all `insertBatch()` calls to complete a bulk insert session.
   */
  finishBulkInsert(caseId: number, totalInserted: number): void {
    this.cases.updateCaseVariantCount(caseId, totalInserted)

    // Always rebuild FTS and restore triggers, even if a step fails
    try {
      this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
    } catch (error) {
      mainLogger.error(`Failed to rebuild FTS index: ${error}`, 'VariantRepository')
    }

    try {
      this.db.exec(createFTSTriggers)
    } catch (error) {
      mainLogger.error(`Failed to recreate FTS triggers: ${error}`, 'VariantRepository')
    }

    // Update query planner statistics after bulk import
    try {
      this.db.exec('ANALYZE')
    } catch (error) {
      mainLogger.error(`Failed to run ANALYZE: ${error}`, 'VariantRepository')
    }

    // Optimize FTS5 index after bulk import
    try {
      this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('optimize')")
    } catch (error) {
      mainLogger.error(`Failed to optimize FTS index: ${error}`, 'VariantRepository')
    }
  }

  /**
   * Convenience method: drop FTS triggers, insert all variants in batches,
   * then rebuild FTS and restore triggers in a single call.
   *
   * For large imports with multiple logical batches, prefer calling
   * `beginBulkInsert()`, then `insertBatch()` per batch, then `finishBulkInsert()`
   * so that FTS is rebuilt only once.
   */
  insertVariantsBatch(
    caseId: number,
    variants: (Omit<Variant, 'id' | 'case_id'> & { _transcripts?: TranscriptInsertRow[] })[]
  ): number {
    this.cases.getCase(caseId)

    this.beginBulkInsert()

    try {
      this.insertBatch(variants, caseId)
    } finally {
      this.finishBulkInsert(caseId, variants.length)
    }

    return variants.length
  }

  getVariantCount(caseId: number): number {
    const result = this.execFirst<{ count: number }>(
      this.kysely
        .selectFrom('variants')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('case_id', '=', caseId)
    )
    return result?.count ?? 0
  }

  // ── Kysely query builder (DRY) ──────────────────────────────

  /**
   * Build a Kysely SELECT query from a VariantFilter.
   * Used by both getVariants() and getAllVariantsForExport().
   */
  private buildVariantQuery(filter: VariantFilter): VariantQueryBuilder {
    let query: VariantQueryBuilder = this.kysely
      .selectFrom('variants')
      .selectAll()
      .where('case_id', '=', filter.case_id)

    // Simple filters via $if
    query = query.$if(filter.gene_symbol !== undefined && filter.gene_symbol !== '', (qb) =>
      qb.where('gene_symbol', 'like', `%${filter.gene_symbol}%`)
    )

    // consequence vs consequences — mutually exclusive
    query = query.$if((filter.consequences?.length ?? 0) > 0, (qb) =>
      qb.where('consequence', 'in', filter.consequences!)
    )
    query = query.$if(
      (filter.consequences === undefined || filter.consequences.length === 0) &&
        filter.consequence !== undefined &&
        filter.consequence !== '',
      (qb) => qb.where('consequence', '=', filter.consequence!)
    )

    // Array filters
    query = query
      .$if((filter.funcs?.length ?? 0) > 0, (qb) => qb.where('func', 'in', filter.funcs!))
      .$if((filter.clinvars?.length ?? 0) > 0, (qb) => qb.where('clinvar', 'in', filter.clinvars!))

    // Range filters with NULL handling
    query = query
      .$if(filter.gnomad_af_max !== undefined, (qb) =>
        qb.where(({ or, eb }) =>
          or([eb('gnomad_af', 'is', null), eb('gnomad_af', '<=', filter.gnomad_af_max!)])
        )
      )
      .$if(filter.cadd_min !== undefined, (qb) =>
        qb.where(({ or, eb }) => or([eb('cadd', 'is', null), eb('cadd', '>=', filter.cadd_min!)]))
      )

    // FTS5 search
    if (filter.search_query != null && filter.search_query !== '') {
      query = this.applySearchFilter(query, filter.search_query)
    }

    // Exact variant match
    query = query
      .$if(filter.chr != null && filter.chr !== '', (qb) => qb.where('chr', '=', filter.chr!))
      .$if(filter.pos != null, (qb) => qb.where('pos', '=', filter.pos!))
      .$if(filter.ref != null && filter.ref !== '', (qb) => qb.where('ref', '=', filter.ref!))
      .$if(filter.alt != null && filter.alt !== '', (qb) => qb.where('alt', '=', filter.alt!))

    // Tag filter
    query = query.$if((filter.tag_ids?.length ?? 0) > 0, (qb) =>
      qb.where(
        'id',
        'in',
        this.kysely
          .selectFrom('variant_tags')
          .select('variant_id')
          .where('case_id', '=', filter.case_id)
          .where('tag_id', 'in', filter.tag_ids!)
      )
    )

    // Starred filter (scope-dependent)
    query = query.$if(filter.starred_only === true, (qb) => {
      if (filter.annotation_scope === 'all') {
        return qb.where(({ or, exists, selectFrom, eb }) =>
          or([
            eb(
              'id',
              'in',
              selectFrom('case_variant_annotations')
                .select('variant_id')
                .where('case_id', '=', filter.case_id)
                .where('starred', '=', 1)
            ),
            exists(
              selectFrom('variant_annotations as va')
                .select(sql`1`.as('one'))
                .whereRef('va.chr', '=', 'variants.chr')
                .whereRef('va.pos', '=', 'variants.pos')
                .whereRef('va.ref', '=', 'variants.ref')
                .whereRef('va.alt', '=', 'variants.alt')
                .where('va.starred', '=', 1)
            )
          ])
        )
      }
      return qb.where(
        'id',
        'in',
        this.kysely
          .selectFrom('case_variant_annotations')
          .select('variant_id')
          .where('case_id', '=', filter.case_id)
          .where('starred', '=', 1)
      )
    })

    // Comment filter (scope-dependent)
    query = query.$if(filter.has_comment === true, (qb) => {
      if (filter.annotation_scope === 'all') {
        return qb.where(({ or, exists, selectFrom, eb }) =>
          or([
            eb(
              'id',
              'in',
              selectFrom('case_variant_annotations')
                .select('variant_id')
                .where('case_id', '=', filter.case_id)
                .where('per_case_comment', 'is not', null)
                .where('per_case_comment', '!=', '')
            ),
            exists(
              selectFrom('variant_annotations as va')
                .select(sql`1`.as('one'))
                .whereRef('va.chr', '=', 'variants.chr')
                .whereRef('va.pos', '=', 'variants.pos')
                .whereRef('va.ref', '=', 'variants.ref')
                .whereRef('va.alt', '=', 'variants.alt')
                .where('va.global_comment', 'is not', null)
                .where('va.global_comment', '!=', '')
            )
          ])
        )
      }
      return qb.where(
        'id',
        'in',
        this.kysely
          .selectFrom('case_variant_annotations')
          .select('variant_id')
          .where('case_id', '=', filter.case_id)
          .where('per_case_comment', 'is not', null)
          .where('per_case_comment', '!=', '')
      )
    })

    // ACMG classification filter (scope-dependent)
    query = query.$if((filter.acmg_classifications?.length ?? 0) > 0, (qb) => {
      if (filter.annotation_scope === 'all') {
        return qb.where(({ or, exists, selectFrom, eb }) =>
          or([
            eb(
              'id',
              'in',
              selectFrom('case_variant_annotations')
                .select('variant_id')
                .where('case_id', '=', filter.case_id)
                .where('acmg_classification', 'in', filter.acmg_classifications!)
            ),
            exists(
              selectFrom('variant_annotations as va')
                .select(sql`1`.as('one'))
                .whereRef('va.chr', '=', 'variants.chr')
                .whereRef('va.pos', '=', 'variants.pos')
                .whereRef('va.ref', '=', 'variants.ref')
                .whereRef('va.alt', '=', 'variants.alt')
                .where('va.acmg_classification', 'in', filter.acmg_classifications!)
            )
          ])
        )
      }
      return qb.where(
        'id',
        'in',
        this.kysely
          .selectFrom('case_variant_annotations')
          .select('variant_id')
          .where('case_id', '=', filter.case_id)
          .where('acmg_classification', 'in', filter.acmg_classifications!)
      )
    })

    // Column filters (dynamic, type-aware)
    if (filter.column_filters !== undefined) {
      for (const [column, filterDef] of Object.entries(filter.column_filters)) {
        if (SORTABLE_COLUMNS[column] === undefined) continue
        const sqlColumn = SORTABLE_COLUMNS[column]
        const { operator, value } = filterDef

        if (operator === 'in' && Array.isArray(value)) {
          if (value.length === 0) continue
          // Parameterized IN clause using sql.join
          const params = sql.join(value.map((v) => sql`${String(v)}`))
          query = query.where(sql<boolean>`${sql.ref(sqlColumn)} IN (${params})`)
        } else if (operator === 'like' && typeof value === 'string') {
          if (value.trim() === '') continue // Skip empty — LIKE '%%' excludes NULLs unnecessarily
          query = query.where(sql`${sql.ref(sqlColumn)} COLLATE NOCASE`, 'like', `%${value}%`)
        } else if (
          (operator === '=' || operator === '!=') &&
          (typeof value === 'string' || typeof value === 'number')
        ) {
          // Exact match — NULLs excluded (user is looking for specific values)
          const num = Number(value)
          const compValue = typeof value === 'number' ? value : Number.isFinite(num) ? num : value
          query = query.where(sqlColumn as keyof Variant, operator as '=' | '!=', compValue)
        } else if (
          (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
          (typeof value === 'string' || typeof value === 'number')
        ) {
          // Range comparison — includeEmpty defaults to true (don't lose unannotated variants)
          const num = Number(value)
          const compValue = typeof value === 'number' ? value : Number.isFinite(num) ? num : value
          const col = sqlColumn as keyof Variant
          const op = operator as '<' | '>' | '<=' | '>='
          const includeNulls = filterDef.includeEmpty !== false
          if (includeNulls) {
            query = query.where(({ or, eb }) => or([eb(col, 'is', null), eb(col, op, compValue)]))
          } else {
            query = query.where(col, op, compValue)
          }
        }
      }
    }

    return query
  }

  // ── Search / sort helpers ─────────────────────────────────────

  /**
   * Apply FTS5 search filter to a Kysely query.
   * Handles boolean operators (AND/OR/NOT) and HGVS pattern matching.
   */
  private applySearchFilter(query: VariantQueryBuilder, searchQuery: string): VariantQueryBuilder {
    const term = searchQuery.trim()
    const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)

    if (!hasBooleanOps) {
      return this.applySingleSearchToken(query, term)
    }

    // For complex boolean queries, build raw SQL since Kysely
    // can't compose FTS5 MATCH with boolean logic natively
    const parts = term
      .split(/\b(AND|OR|NOT)\b/)
      .map((p) => p.trim())
      .filter((p) => p !== '')

    const sqlParts: string[] = []
    const params: (string | number)[] = []

    for (const part of parts) {
      if (part === 'AND') {
        sqlParts.push('AND')
      } else if (part === 'OR') {
        sqlParts.push('OR')
      } else if (part === 'NOT') {
        // Use 'NOT' when at start or after another operator; 'AND NOT' otherwise
        const lastPart = sqlParts[sqlParts.length - 1]
        const isAfterOperator =
          sqlParts.length === 0 ||
          lastPart === 'AND' ||
          lastPart === 'OR' ||
          lastPart === 'NOT' ||
          lastPart === 'AND NOT'
        sqlParts.push(isAfterOperator ? 'NOT' : 'AND NOT')
      } else {
        const hgvsPattern = /^[cp]\./
        if (hgvsPattern.test(part)) {
          sqlParts.push('(cdna LIKE ? OR aa_change LIKE ?)')
          params.push(`%${part}%`, `%${part}%`)
        } else {
          const ftsQuery = `"${part.replace(/"/g, '""')}"*`
          sqlParts.push('id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)')
          params.push(ftsQuery)
        }
      }
    }

    // Build a sql template literal with interpolated parameters
    const fullExpr = `(${sqlParts.join(' ')})`
    const segments = fullExpr.split('?')
    let paramIdx = 0

    // Start from the first segment
    let rawExpr = sql<boolean>`${sql.raw(segments[0])}`
    for (let i = 1; i < segments.length; i++) {
      rawExpr = sql<boolean>`${rawExpr}${params[paramIdx++]}${sql.raw(segments[i])}`
    }
    return query.where(rawExpr)
  }

  /**
   * Apply a single search token (FTS5 or HGVS pattern).
   */
  private applySingleSearchToken(query: VariantQueryBuilder, token: string): VariantQueryBuilder {
    const hgvsPattern = /^[cp]\./
    if (hgvsPattern.test(token)) {
      return query.where(({ or, eb }) =>
        or([eb('cdna', 'like', `%${token}%`), eb('aa_change', 'like', `%${token}%`)])
      )
    }
    const ftsQuery = `"${token.replace(/"/g, '""')}"*`
    return query.where(
      sql<boolean>`id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ${ftsQuery})`
    )
  }

  /**
   * Apply ORDER BY to a Kysely query using sql template literals
   * for NULLS FIRST/LAST support (not natively available in Kysely 0.28.x).
   */
  private applySort(query: VariantQueryBuilder, sortBy?: SortItem[]): VariantQueryBuilder {
    if (!sortBy || sortBy.length === 0) {
      return query.orderBy(sql`pos ASC NULLS LAST`).orderBy(sql`id ASC`)
    }

    let sorted = query
    let hasIdSort = false

    for (const sort of sortBy) {
      const sqlColumn = SORTABLE_COLUMNS[sort.key]
      if (sqlColumn === undefined) {
        mainLogger.warn(`Invalid sort column rejected: ${sort.key}`, 'VariantRepository')
        continue
      }
      const dir = sort.order === 'desc' ? 'DESC' : 'ASC'
      const nulls = 'NULLS LAST'
      sorted = sorted.orderBy(sql`${sql.ref(sqlColumn)} ${sql.raw(dir)} ${sql.raw(nulls)}`)
      if (sort.key === 'id') hasIdSort = true
    }

    if (!hasIdSort) {
      sorted = sorted.orderBy(sql`id ASC`)
    }

    return sorted
  }

  // ── Query methods ────────────────────────────────────────────

  getVariants(
    filter: VariantFilter,
    limit: number,
    offset: number = 0,
    sortBy?: SortItem[]
  ): PaginatedResult<Variant> {
    // Count query — apply same filters but select count
    const dataQuery = this.buildVariantQuery(filter)
    const compiled = dataQuery.compile()
    const countSql = compiled.sql.replace(/^select \* from/i, 'select count(*) as count from')
    const countResult = this.db.prepare(countSql).get(...compiled.parameters) as { count: number }
    const total_count = countResult.count

    // Data query with sort + pagination
    const sortedQuery = this.applySort(dataQuery, sortBy).limit(limit).offset(offset)
    const data = this.execAll<Variant>(sortedQuery)

    return { data, total_count }
  }

  searchVariants(caseId: number, query: string, limit: number = 50): Variant[] {
    const ftsQuery = `"${query.replace(/"/g, '""')}"*`
    const results = this.db
      .prepare(
        `
      SELECT v.* FROM variants v
      JOIN variants_fts fts ON v.id = fts.rowid
      WHERE v.case_id = ? AND variants_fts MATCH ?
      ORDER BY bm25(variants_fts)
      LIMIT ?
    `
      )
      .all(caseId, ftsQuery, limit) as Variant[]
    return results
  }

  getGeneSymbols(caseId: number, query: string, limit: number = 50): string[] {
    const results = this.execAll<{ gene_symbol: string }>(
      this.kysely
        .selectFrom('variants')
        .select('gene_symbol')
        .distinct()
        .where('case_id', '=', caseId)
        .where('gene_symbol', 'like', `%${query}%`)
        .where('gene_symbol', 'is not', null)
        .orderBy('gene_symbol')
        .limit(limit)
    )
    return results.map((r) => r.gene_symbol)
  }

  getAllVariantsForExport(filter: VariantFilter): Variant[] {
    const query = this.buildVariantQuery(filter).orderBy('chr', 'asc').orderBy('pos', 'asc')
    return this.execAll<Variant>(query)
  }

  /**
   * Count variants matching export filter without loading data.
   * Used to enforce hard limit before spawning export worker.
   */
  getExportCount(filter: VariantFilter): number {
    const compiled = this.buildVariantQuery(filter).compile()
    const countSql = compiled.sql.replace(/^select \* from/i, 'select count(*) as count from')
    const result = this.db.prepare(countSql).get(...compiled.parameters) as { count: number }
    return result.count
  }

  /**
   * Compile the export query to SQL+params for worker thread execution.
   * The worker receives compiled SQL and runs it directly, avoiding
   * filter logic duplication.
   */
  compileExportQuery(
    filter: VariantFilter,
    limit: number
  ): { sql: string; parameters: readonly unknown[] } {
    const query = this.buildVariantQuery(filter)
      .orderBy('chr', 'asc')
      .orderBy('pos', 'asc')
      .limit(limit)
    return query.compile()
  }

  /**
   * Gather per-column metadata for filter UI auto-detection.
   * Consolidated: one aggregate query for all COUNT DISTINCT + MIN/MAX,
   * then one UNION ALL query for distinct values of low-cardinality columns.
   */
  private getColumnMeta(caseId: number): ColumnFilterMeta[] {
    const DISTINCT_THRESHOLD = 50
    const columns = Object.entries(SORTABLE_COLUMNS)

    // Query 1: Single scan — COUNT(DISTINCT col) for all columns + MIN/MAX for numeric columns
    const selectParts: string[] = []
    for (const [key, sqlCol] of columns) {
      selectParts.push(`COUNT(DISTINCT "${sqlCol}") AS "cnt_${key}"`)
      if (NUMERIC_COLUMNS.has(key)) {
        selectParts.push(`MIN("${sqlCol}") AS "min_${key}"`)
        selectParts.push(`MAX("${sqlCol}") AS "max_${key}"`)
      }
    }
    const aggSql = `SELECT ${selectParts.join(', ')} FROM variants WHERE case_id = ?`
    const aggRow = this.db.prepare(aggSql).get(caseId) as Record<string, number | null>

    // Build initial meta entries from aggregate results
    const meta: ColumnFilterMeta[] = []
    const lowCardinalityColumns: [string, string][] = []

    for (const [key, sqlCol] of columns) {
      const isNumeric = NUMERIC_COLUMNS.has(key)
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
      // SAFETY: sqlCol values come from hardcoded SORTABLE_COLUMNS constant
      const unionParts = lowCardinalityColumns.map(
        ([key, sqlCol]) =>
          `SELECT '${key}' AS col_key, CAST("${sqlCol}" AS TEXT) AS val FROM variants WHERE case_id = ? AND "${sqlCol}" IS NOT NULL GROUP BY "${sqlCol}"`
      )
      const unionSql = unionParts.join(' UNION ALL ')
      const params = lowCardinalityColumns.map(() => caseId)
      const rows = this.db.prepare(unionSql).all(...params) as {
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

    return meta
  }

  getFilterOptions(caseId: number): FilterOptions {
    const columnMeta = this.getColumnMeta(caseId)

    // Extract legacy FilterOptions fields from column metadata
    const metaByKey = new Map(columnMeta.map((m) => [m.key, m]))

    const consequenceMeta = metaByKey.get('consequence')
    const consequences = consequenceMeta?.distinctValues ?? []

    const funcMeta = metaByKey.get('func')
    const funcs = funcMeta?.distinctValues ?? []

    const clinvarMeta = metaByKey.get('clinvar')
    const clinvars = clinvarMeta?.distinctValues ?? []

    const caddMeta = metaByKey.get('cadd')
    const gnomadAfMeta = metaByKey.get('gnomad_af')

    return {
      consequences,
      funcs,
      clinvars,
      minCadd: caddMeta?.min ?? null,
      maxCadd: caddMeta?.max ?? null,
      minGnomadAf: gnomadAfMeta?.min ?? null,
      maxGnomadAf: gnomadAfMeta?.max ?? null,
      columnMeta
    }
  }
}
