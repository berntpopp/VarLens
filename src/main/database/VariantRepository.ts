import { BaseRepository } from './BaseRepository'
import type { CaseRepository } from './CaseRepository'
import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import type { Variant, VariantFilter, PaginationCursor, PaginatedResult, SortItem } from './types'
import type { FilterOptions } from '../../shared/types/api'
import type { TranscriptInsertRow } from '../../shared/types/transcript'
import { createFTSTriggers } from './schema'
import { mainLogger } from '../services/MainLogger'

import { DATABASE_CONFIG } from '../../shared/config'

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

  constructor(
    db: DatabaseType,
    kysely: Kysely<VarlensDatabase>,
    statementCache: Map<string, Statement>,
    cases: CaseRepository
  ) {
    super(db, kysely, statementCache)
    this.cases = cases
  }

  insertVariantsBatch(
    caseId: number,
    variants: (Omit<Variant, 'id' | 'case_id'> & { _transcripts?: TranscriptInsertRow[] })[]
  ): number {
    this.cases.getCase(caseId)

    // Drop FTS triggers to avoid per-row overhead during bulk insert
    this.db.exec(`
      DROP TRIGGER IF EXISTS variants_fts_ai;
      DROP TRIGGER IF EXISTS variants_fts_ad;
      DROP TRIGGER IF EXISTS variants_fts_au;
    `)

    try {
      const insert = this.stmt(`
        INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, moi)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertTranscript = this.stmt(`
        INSERT INTO variant_transcripts (variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi, is_selected)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertBatch = this.db.transaction(
        (batch: (Omit<Variant, 'id' | 'case_id'> & { _transcripts?: TranscriptInsertRow[] })[]) => {
          for (const v of batch) {
            const result = insert.run(
              caseId,
              v.chr,
              v.pos,
              v.ref,
              v.alt,
              v.gene_symbol,
              v.omim_mim_number,
              v.consequence,
              v.gnomad_af,
              v.cadd,
              v.clinvar,
              v.gt_num,
              v.func,
              v.qual,
              v.hpo_sim_score,
              v.transcript,
              v.cdna,
              v.aa_change,
              v.moi
            )

            if (v._transcripts !== undefined && v._transcripts.length > 0) {
              const variantId = result.lastInsertRowid as number
              for (const t of v._transcripts) {
                insertTranscript.run(
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
        }
      )

      for (let i = 0; i < variants.length; i += BATCH_SIZE) {
        const batch = variants.slice(i, i + BATCH_SIZE)
        insertBatch(batch)
      }

      this.cases.updateCaseVariantCount(caseId, variants.length)
    } finally {
      // Always rebuild FTS and restore triggers, even if insert fails
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

    return variants.length
  }

  getVariantCount(caseId: number): number {
    const result = this.stmt('SELECT COUNT(*) as count FROM variants WHERE case_id = ?').get(
      caseId
    ) as { count: number }
    return result.count
  }

  private buildSortClause(sortBy?: SortItem[]): string {
    if (!sortBy || sortBy.length === 0) {
      return 'pos ASC NULLS LAST, id ASC'
    }

    const clauses: string[] = []
    for (const sort of sortBy) {
      const sqlColumn = SORTABLE_COLUMNS[sort.key]
      if (sqlColumn === undefined) {
        mainLogger.warn(`Invalid sort column rejected: ${sort.key}`, 'VariantRepository')
        continue
      }
      const direction = sort.order === 'desc' ? 'DESC' : 'ASC'
      const nulls = sort.order === 'desc' ? 'NULLS FIRST' : 'NULLS LAST'
      clauses.push(`${sqlColumn} ${direction} ${nulls}`)
    }

    if (clauses.length === 0) {
      return 'pos ASC NULLS LAST, id ASC'
    }

    if (clauses.some((c) => c.startsWith('id ')) === false) {
      clauses.push('id ASC')
    }

    return clauses.join(', ')
  }

  private buildSearchCondition(query: string, params: (string | number | null)[]): string {
    const term = query.trim()
    const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)

    if (!hasBooleanOps) {
      return this.buildSingleSearchToken(term, params)
    }

    const parts = term
      .split(/\b(AND|OR|NOT)\b/)
      .map((p) => p.trim())
      .filter((p) => p !== '')

    const sqlParts: string[] = []
    for (const part of parts) {
      if (part === 'AND') {
        sqlParts.push('AND')
      } else if (part === 'OR') {
        sqlParts.push('OR')
      } else if (part === 'NOT') {
        sqlParts.push('AND NOT')
      } else {
        sqlParts.push(this.buildSingleSearchToken(part, params))
      }
    }

    return `(${sqlParts.join(' ')})`
  }

  private buildSingleSearchToken(token: string, params: (string | number | null)[]): string {
    const hgvsPattern = /^[cp]\./
    if (hgvsPattern.test(token)) {
      const searchPattern = `%${token}%`
      params.push(searchPattern, searchPattern)
      return '(cdna LIKE ? OR aa_change LIKE ?)'
    }

    const ftsQuery = `"${token.replace(/"/g, '""')}"*`
    params.push(ftsQuery)
    return 'id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)'
  }

  private buildCursorCondition(
    cursor: PaginationCursor,
    sortBy?: SortItem[]
  ): { condition: string; params: (string | number | null)[] } {
    const sortItem = sortBy?.[0]
    const sortKey = sortItem?.key ?? 'pos'
    const sortDirection = sortItem?.order ?? 'asc'
    const sqlColumn = SORTABLE_COLUMNS[sortKey] ?? 'pos'

    if (cursor.sort_key !== sortKey) {
      return { condition: '1 = 0', params: [] }
    }

    const params: (string | number | null)[] = []
    let condition: string

    if (cursor.sort_value === null) {
      if (sortDirection === 'asc') {
        condition = `(${sqlColumn} IS NULL AND id > ?)`
        params.push(cursor.id)
      } else {
        condition = `(${sqlColumn} IS NULL AND id > ?) OR (${sqlColumn} IS NOT NULL)`
        params.push(cursor.id)
      }
    } else {
      const compareOp = sortDirection === 'desc' ? '<' : '>'
      if (sortDirection === 'asc') {
        condition = `(${sqlColumn} ${compareOp} ? OR (${sqlColumn} = ? AND id > ?) OR ${sqlColumn} IS NULL)`
        params.push(cursor.sort_value, cursor.sort_value, cursor.id)
      } else {
        condition = `(${sqlColumn} ${compareOp} ? OR (${sqlColumn} = ? AND id > ?))`
        params.push(cursor.sort_value, cursor.sort_value, cursor.id)
      }
    }

    return { condition, params }
  }

  getVariants(
    filter: VariantFilter,
    limit: number,
    cursor?: PaginationCursor,
    sortBy?: SortItem[]
  ): PaginatedResult<Variant> {
    const conditions: string[] = ['case_id = ?']
    const params: (string | number | null)[] = [filter.case_id]

    if (filter.gene_symbol !== undefined && filter.gene_symbol !== '') {
      conditions.push('gene_symbol LIKE ?')
      params.push(`%${filter.gene_symbol}%`)
    }

    if (filter.consequences !== undefined && filter.consequences.length > 0) {
      const placeholders = filter.consequences.map(() => '?').join(', ')
      conditions.push(`consequence IN (${placeholders})`)
      params.push(...filter.consequences)
    } else if (filter.consequence !== undefined && filter.consequence !== '') {
      conditions.push('consequence = ?')
      params.push(filter.consequence)
    }

    if (filter.funcs !== undefined && filter.funcs.length > 0) {
      const placeholders = filter.funcs.map(() => '?').join(', ')
      conditions.push(`func IN (${placeholders})`)
      params.push(...filter.funcs)
    }

    if (filter.clinvars !== undefined && filter.clinvars.length > 0) {
      const placeholders = filter.clinvars.map(() => '?').join(', ')
      conditions.push(`clinvar IN (${placeholders})`)
      params.push(...filter.clinvars)
    }

    if (filter.gnomad_af_max !== undefined) {
      conditions.push('(gnomad_af IS NULL OR gnomad_af <= ?)')
      params.push(filter.gnomad_af_max)
    }

    if (filter.cadd_min !== undefined) {
      conditions.push('(cadd IS NULL OR cadd >= ?)')
      params.push(filter.cadd_min)
    }

    if (filter.search_query != null && filter.search_query !== '') {
      const searchCondition = this.buildSearchCondition(filter.search_query, params)
      conditions.push(searchCondition)
    }

    if (filter.chr != null && filter.chr !== '') {
      conditions.push('chr = ?')
      params.push(filter.chr)
    }
    if (filter.pos != null) {
      conditions.push('pos = ?')
      params.push(filter.pos)
    }
    if (filter.ref != null && filter.ref !== '') {
      conditions.push('ref = ?')
      params.push(filter.ref)
    }
    if (filter.alt != null && filter.alt !== '') {
      conditions.push('alt = ?')
      params.push(filter.alt)
    }

    if (filter.tag_ids !== undefined && filter.tag_ids.length > 0) {
      const placeholders = filter.tag_ids.map(() => '?').join(', ')
      conditions.push(
        `id IN (SELECT variant_id FROM variant_tags WHERE case_id = ? AND tag_id IN (${placeholders}))`
      )
      params.push(filter.case_id, ...filter.tag_ids)
    }

    if (filter.starred_only === true) {
      conditions.push(
        `id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND starred = 1)`
      )
      params.push(filter.case_id)
    }

    if (filter.has_comment === true) {
      conditions.push(
        `(id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND per_case_comment IS NOT NULL AND per_case_comment != '')
          OR EXISTS (
            SELECT 1 FROM variant_annotations va
            WHERE va.chr = variants.chr AND va.pos = variants.pos
              AND va.ref = variants.ref AND va.alt = variants.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
          ))`
      )
      params.push(filter.case_id)
    }

    if (filter.acmg_classifications !== undefined && filter.acmg_classifications.length > 0) {
      const placeholders = filter.acmg_classifications.map(() => '?').join(', ')
      conditions.push(
        `id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND acmg_classification IN (${placeholders}))`
      )
      params.push(filter.case_id, ...filter.acmg_classifications)
    }

    if (filter.column_filters !== undefined) {
      for (const [column, value] of Object.entries(filter.column_filters)) {
        if (value === '' || SORTABLE_COLUMNS[column] === undefined) continue
        const sqlColumn = SORTABLE_COLUMNS[column]
        conditions.push(
          NUMERIC_COLUMNS.has(column)
            ? `CAST(${sqlColumn} AS TEXT) LIKE ? COLLATE NOCASE`
            : `${sqlColumn} LIKE ? COLLATE NOCASE`
        )
        params.push(`%${value}%`)
      }
    }

    const orderByClause = this.buildSortClause(sortBy)
    const primarySortKey =
      (sortBy && sortBy.find((item) => SORTABLE_COLUMNS[item.key] !== undefined))?.key ?? 'pos'

    const countWhereClause = conditions.join(' AND ')
    const countSql = `SELECT COUNT(*) as count FROM variants WHERE ${countWhereClause}`
    const countResult = this.db.prepare(countSql).get(...params) as { count: number }
    const total_count = countResult.count

    let cursorCondition = ''
    let cursorParams: (string | number | null)[] = []
    if (cursor) {
      const cursorResult = this.buildCursorCondition(cursor, sortBy)
      cursorCondition = cursorResult.condition
      cursorParams = cursorResult.params
    }

    const dataConditions = cursor ? [...conditions, cursorCondition] : conditions
    const dataWhereClause = dataConditions.join(' AND ')
    const dataSql = `SELECT * FROM variants WHERE ${dataWhereClause} ORDER BY ${orderByClause} LIMIT ?`
    const dataParams = [...params, ...cursorParams, limit + 1]
    const results = this.db.prepare(dataSql).all(...dataParams) as Variant[]

    const has_more = results.length > limit
    const data = has_more ? results.slice(0, limit) : results

    let next_cursor: PaginationCursor | null = null
    if (has_more && data.length > 0) {
      const lastItem = data[data.length - 1]
      const sortValue =
        (lastItem[primarySortKey as keyof Variant] as number | string | null | undefined) ?? null
      next_cursor = {
        id: lastItem.id,
        sort_value: sortValue,
        sort_key: primarySortKey
      }
    }

    return { data, next_cursor, has_more, total_count }
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
    const results = this.db
      .prepare(
        `
      SELECT DISTINCT gene_symbol
      FROM variants
      WHERE case_id = ? AND gene_symbol LIKE ?
      ORDER BY gene_symbol
      LIMIT ?
    `
      )
      .all(caseId, `%${query}%`, limit) as Array<{ gene_symbol: string | null }>
    return results.map((r) => r.gene_symbol).filter((g): g is string => g !== null)
  }

  getAllVariantsForExport(filter: VariantFilter): Variant[] {
    const conditions: string[] = ['case_id = ?']
    const params: (string | number | null)[] = [filter.case_id]

    if (filter.gene_symbol !== undefined && filter.gene_symbol !== '') {
      conditions.push('gene_symbol LIKE ?')
      params.push(`%${filter.gene_symbol}%`)
    }

    if (filter.consequences !== undefined && filter.consequences.length > 0) {
      const placeholders = filter.consequences.map(() => '?').join(', ')
      conditions.push(`consequence IN (${placeholders})`)
      params.push(...filter.consequences)
    } else if (filter.consequence !== undefined && filter.consequence !== '') {
      conditions.push('consequence = ?')
      params.push(filter.consequence)
    }

    if (filter.funcs !== undefined && filter.funcs.length > 0) {
      const placeholders = filter.funcs.map(() => '?').join(', ')
      conditions.push(`func IN (${placeholders})`)
      params.push(...filter.funcs)
    }

    if (filter.clinvars !== undefined && filter.clinvars.length > 0) {
      const placeholders = filter.clinvars.map(() => '?').join(', ')
      conditions.push(`clinvar IN (${placeholders})`)
      params.push(...filter.clinvars)
    }

    if (filter.gnomad_af_max !== undefined) {
      conditions.push('(gnomad_af IS NULL OR gnomad_af <= ?)')
      params.push(filter.gnomad_af_max)
    }

    if (filter.cadd_min !== undefined) {
      conditions.push('(cadd IS NULL OR cadd >= ?)')
      params.push(filter.cadd_min)
    }

    if (filter.search_query != null && filter.search_query !== '') {
      const searchCondition = this.buildSearchCondition(filter.search_query, params)
      conditions.push(searchCondition)
    }

    if (filter.chr != null && filter.chr !== '') {
      conditions.push('chr = ?')
      params.push(filter.chr)
    }
    if (filter.pos != null) {
      conditions.push('pos = ?')
      params.push(filter.pos)
    }
    if (filter.ref != null && filter.ref !== '') {
      conditions.push('ref = ?')
      params.push(filter.ref)
    }
    if (filter.alt != null && filter.alt !== '') {
      conditions.push('alt = ?')
      params.push(filter.alt)
    }

    if (filter.tag_ids !== undefined && filter.tag_ids.length > 0) {
      const placeholders = filter.tag_ids.map(() => '?').join(', ')
      conditions.push(
        `id IN (SELECT variant_id FROM variant_tags WHERE case_id = ? AND tag_id IN (${placeholders}))`
      )
      params.push(filter.case_id, ...filter.tag_ids)
    }

    if (filter.starred_only === true) {
      conditions.push(
        `id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND starred = 1)`
      )
      params.push(filter.case_id)
    }

    if (filter.has_comment === true) {
      conditions.push(
        `(id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND per_case_comment IS NOT NULL AND per_case_comment != '')
          OR EXISTS (
            SELECT 1 FROM variant_annotations va
            WHERE va.chr = variants.chr AND va.pos = variants.pos
              AND va.ref = variants.ref AND va.alt = variants.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
          ))`
      )
      params.push(filter.case_id)
    }

    if (filter.acmg_classifications !== undefined && filter.acmg_classifications.length > 0) {
      const placeholders = filter.acmg_classifications.map(() => '?').join(', ')
      conditions.push(
        `id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND acmg_classification IN (${placeholders}))`
      )
      params.push(filter.case_id, ...filter.acmg_classifications)
    }

    const whereClause = conditions.join(' AND ')
    const sql = `SELECT * FROM variants WHERE ${whereClause} ORDER BY chr, pos`
    return this.db.prepare(sql).all(...params) as Variant[]
  }

  getFilterOptions(caseId: number): FilterOptions {
    const consequences = (
      this.stmt(
        'SELECT DISTINCT consequence FROM variants WHERE case_id = ? AND consequence IS NOT NULL ORDER BY consequence'
      ).all(caseId) as { consequence: string }[]
    ).map((r) => r.consequence)

    const funcs = (
      this.stmt(
        'SELECT DISTINCT func FROM variants WHERE case_id = ? AND func IS NOT NULL ORDER BY func'
      ).all(caseId) as { func: string }[]
    ).map((r) => r.func)

    const clinvars = (
      this.stmt(
        'SELECT DISTINCT clinvar FROM variants WHERE case_id = ? AND clinvar IS NOT NULL ORDER BY clinvar'
      ).all(caseId) as { clinvar: string }[]
    ).map((r) => r.clinvar)

    const caddRange = this.stmt(
      'SELECT MIN(cadd) as min_cadd, MAX(cadd) as max_cadd FROM variants WHERE case_id = ? AND cadd IS NOT NULL'
    ).get(caseId) as { min_cadd: number | null; max_cadd: number | null } | undefined

    const afRange = this.stmt(
      'SELECT MIN(gnomad_af) as min_af, MAX(gnomad_af) as max_af FROM variants WHERE case_id = ? AND gnomad_af IS NOT NULL'
    ).get(caseId) as { min_af: number | null; max_af: number | null } | undefined

    return {
      consequences,
      funcs,
      clinvars,
      minCadd: caddRange?.min_cadd ?? null,
      maxCadd: caddRange?.max_cadd ?? null,
      minGnomadAf: afRange?.min_af ?? null,
      maxGnomadAf: afRange?.max_af ?? null
    }
  }
}
