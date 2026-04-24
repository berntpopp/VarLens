import { BaseRepository } from './BaseRepository'
import type {
  AvailableBuild,
  Case,
  CaseWithCohorts,
  CaseSearchParams,
  PaginatedResult,
  AffectedStatus,
  CaseSex
} from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors'
import { sqlPlaceholders } from './sql-utils'
import { createFTSTriggers } from './schema'
import { mainLogger } from '../services/MainLogger'

/** Whitelist of sortable columns to prevent SQL injection */
const CASE_SORTABLE_COLUMNS: Record<string, string> = {
  name: 'c.name',
  created_at: 'c.created_at',
  variant_count: 'c.variant_count'
}

/** Raw row shape returned by the query before post-processing */
interface CaseQueryRawRow {
  id: number
  name: string
  file_path: string
  file_size: number
  variant_count: number
  created_at: number
  genome_build: string
  affected_status: string | null
  sex: string | null
  cohorts_raw: string | null
}

export class CaseRepository extends BaseRepository {
  createCase(name: string, filePath: string, fileSize: number, genomeBuild = 'GRCh38'): number {
    try {
      const result = this.execRun(
        this.kysely.insertInto('cases').values({
          name,
          file_path: filePath,
          file_size: fileSize,
          variant_count: 0,
          created_at: Date.now(),
          genome_build: genomeBuild
        })
      )
      return Number(result.lastInsertRowid)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') === true) {
        throw new UniqueConstraintError('name', name)
      }
      throw new DatabaseError(
        `Failed to create case: ${name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  getCase(id: number): Case {
    const result = this.execFirst<Case>(
      this.kysely.selectFrom('cases').selectAll().where('id', '=', id)
    )
    if (!result) throw new NotFoundError('Case', id)
    return result
  }

  getCaseByName(name: string): Case {
    const result = this.execFirst<Case>(
      this.kysely.selectFrom('cases').selectAll().where('name', '=', name)
    )
    if (!result) throw new NotFoundError('Case', name)
    return result
  }

  /** Returns set of case names that already exist in the database. */
  getExistingCaseNames(names: string[]): Set<string> {
    if (names.length === 0) return new Set()

    // SQLite has a maximum number of bound parameters (commonly 999), so we
    // chunk the input to avoid "too many SQL variables" errors on large batches.
    const MAX_SQLITE_VARIABLES = 999
    const existingNames = new Set<string>()

    for (let i = 0; i < names.length; i += MAX_SQLITE_VARIABLES) {
      const batch = names.slice(i, i + MAX_SQLITE_VARIABLES)
      const placeholders = sqlPlaceholders(batch.length)
      const rows = this.db
        .prepare(`SELECT name FROM cases WHERE name IN (${placeholders})`)
        .all(...batch) as Array<{ name: string }>
      for (const row of rows) {
        existingNames.add(row.name)
      }
    }

    return existingNames
  }

  getAllCases(): Case[] {
    return this.execAll<Case>(
      this.kysely.selectFrom('cases').selectAll().orderBy('created_at', 'desc')
    )
  }

  /**
   * Return distinct genome builds used across cases with per-build case counts.
   * Sorted so the most-represented build appears first — the renderer uses
   * the first entry as the default selection in the cohort view.
   */
  getAvailableGenomeBuilds(): AvailableBuild[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            COALESCE(genome_build, 'GRCh38') AS build,
            COUNT(*) AS caseCount
          FROM cases
          GROUP BY build
          ORDER BY caseCount DESC
        `
      )
      .all() as Array<{
      build: string | null
      caseCount: number
    }>
    return rows.map((row) => ({
      build: row.build ?? 'GRCh38',
      caseCount: Number(row.caseCount)
    }))
  }

  updateCaseVariantCount(id: number, count: number): void {
    const result = this.execRun(
      this.kysely.updateTable('cases').set({ variant_count: count }).where('id', '=', id)
    )
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  /**
   * Insert a case_import_files row recording that a VCF file was imported
   * into this case with the given variant type and caller. Used by the
   * multi-file import session to preserve per-file provenance.
   */
  insertImportFile(params: {
    case_id: number
    file_path: string
    file_size: number
    variant_type: string
    caller: string | null
    variant_count: number
    annotation_format: string | null
  }): number {
    const result = this.execRun(
      this.kysely.insertInto('case_import_files').values({
        case_id: params.case_id,
        file_path: params.file_path,
        file_size: params.file_size,
        variant_type: params.variant_type,
        caller: params.caller,
        variant_count: params.variant_count,
        annotation_format: params.annotation_format,
        imported_at: Date.now()
      })
    )
    return Number(result.lastInsertRowid)
  }

  /**
   * Get all import files recorded for a case, ordered by import time.
   */
  getImportFiles(caseId: number): Array<{
    id: number
    case_id: number
    file_path: string
    file_size: number
    variant_type: string
    caller: string | null
    variant_count: number
    annotation_format: string | null
    imported_at: number
  }> {
    return this.execAll(
      this.kysely
        .selectFrom('case_import_files')
        .selectAll()
        .where('case_id', '=', caseId)
        .orderBy('imported_at', 'asc')
    )
  }

  deleteCase(id: number): void {
    const result = this.execRun(this.kysely.deleteFrom('cases').where('id', '=', id))
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  deleteAllCases(): number {
    // Drop FTS triggers before bulk delete to avoid per-row FTS updates
    // which cause severe blocking on large databases.
    // Concurrency note: better-sqlite3 is synchronous and single-threaded
    // per connection. The import worker uses its own separate connection,
    // but imports and deleteAll should not run concurrently by design
    // (the UI prevents this).
    this.dropFtsTriggers()

    try {
      const changes = this.runTransaction(() => {
        return this.execRun(this.kysely.deleteFrom('cases')).changes
      })

      this.rebuildFtsAndRestoreTriggers()
      return changes
    } catch (error) {
      this.restoreFtsTriggersSafe()
      throw error
    }
  }

  /**
   * Paginated case query with cohort names, metadata, sorting, and filtering.
   *
   * Returns cases enriched with cohort_names[], cohort_ids[], affected_status, and sex
   * in a single JOIN query — replacing the previous N+1 pattern of per-case metadata lookups.
   */
  queryCases(params: CaseSearchParams): PaginatedResult<CaseWithCohorts> {
    const {
      limit,
      offset = 0,
      sort_by,
      sort_order = 'desc',
      search_term,
      cohort_ids,
      hpo_ids
    } = params
    const countNeeded = params._count_needed !== false

    // Build WHERE clauses and parameters
    const whereClauses: string[] = []
    const whereParams: (string | number)[] = []

    // Search filter (LIKE on case name)
    if (search_term !== undefined && search_term !== '') {
      whereClauses.push('c.name LIKE ?')
      whereParams.push(`%${search_term}%`)
    }

    // Cohort filter
    if (cohort_ids !== undefined && cohort_ids.length > 0) {
      const placeholders = sqlPlaceholders(cohort_ids.length)
      whereClauses.push(
        `c.id IN (SELECT case_id FROM case_cohort_links WHERE cohort_id IN (${placeholders}))`
      )
      whereParams.push(...cohort_ids)
    }

    // HPO term filter
    if (hpo_ids !== undefined && hpo_ids.length > 0) {
      const placeholders = sqlPlaceholders(hpo_ids.length)
      whereClauses.push(
        `c.id IN (SELECT case_id FROM case_hpo_terms WHERE hpo_id IN (${placeholders}))`
      )
      whereParams.push(...hpo_ids)
    }

    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''

    // Sort column (whitelist-validated)
    const sortColumn =
      sort_by !== undefined ? (CASE_SORTABLE_COLUMNS[sort_by] ?? 'c.created_at') : 'c.created_at'
    const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC'

    // Scalar subqueries avoid row multiplication from LEFT JOIN + GROUP BY.
    // Cohort id+name are fetched in a single subquery (one join pass) and
    // split in post-processing to avoid duplicating the ccl→cg join.
    const dataSQL = `
      SELECT c.id, c.name, c.file_path, c.file_size, c.variant_count, c.created_at,
             c.genome_build,
             (SELECT cm.affected_status FROM case_metadata cm WHERE cm.case_id = c.id) AS affected_status,
             (SELECT cm.sex FROM case_metadata cm WHERE cm.case_id = c.id) AS sex,
             (SELECT GROUP_CONCAT(cg.id || ':' || cg.name, '|')
              FROM case_cohort_links ccl
              JOIN cohort_groups cg ON cg.id = ccl.cohort_id
              WHERE ccl.case_id = c.id) AS cohorts_raw
      FROM cases c
      ${whereSQL}
      ORDER BY ${sortColumn} ${sortDir}
      LIMIT ? OFFSET ?
    `

    const dataParams = [...whereParams, limit, offset]
    const rawRows = this.db.prepare(dataSQL).all(...dataParams) as CaseQueryRawRow[]

    // Post-process: split "id:name|id:name" into separate arrays
    const data: CaseWithCohorts[] = rawRows.map((row) => {
      const pairs =
        row.cohorts_raw !== null && row.cohorts_raw !== ''
          ? row.cohorts_raw.split('|').map((pair) => {
              const sep = pair.indexOf(':')
              return { id: Number(pair.slice(0, sep)), name: pair.slice(sep + 1) }
            })
          : []
      return {
        id: row.id,
        name: row.name,
        file_path: row.file_path,
        file_size: row.file_size,
        variant_count: row.variant_count,
        created_at: row.created_at,
        genome_build: row.genome_build ?? 'GRCh38',
        affected_status: (row.affected_status as AffectedStatus | null) ?? null,
        sex: (row.sex as CaseSex | null) ?? null,
        cohort_names: pairs.map((p) => p.name),
        cohort_ids: pairs.map((p) => p.id)
      }
    })

    // Count query (optional)
    let totalCount = 0
    if (countNeeded) {
      // Cohort filter uses a subquery in WHERE, so no JOIN needed for counting
      const countSQL = `
        SELECT COUNT(*) AS cnt
        FROM cases c
        ${whereSQL}
      `
      // Count query uses same where params but without LIMIT/OFFSET
      const countRow = this.db.prepare(countSQL).get(...whereParams) as { cnt: number } | undefined
      totalCount = countRow?.cnt ?? 0
    }

    return { data, total_count: totalCount }
  }

  deleteCasesBatch(ids: number[]): number {
    if (ids.length === 0) return 0

    // For small batches, let FTS triggers handle per-row updates normally.
    // The trigger-drop optimization is only worthwhile for larger deletes
    // where per-row FTS overhead dominates.
    const useOptimization = ids.length > 5
    if (useOptimization) {
      this.dropFtsTriggers()
    }

    try {
      const changes = this.runTransaction(() => {
        return this.execRun(this.kysely.deleteFrom('cases').where('id', 'in', ids)).changes
      })

      if (useOptimization) {
        this.rebuildFtsAndRestoreTriggers()
      }
      return changes
    } catch (error) {
      if (useOptimization) {
        this.restoreFtsTriggersSafe()
      }
      throw error
    }
  }

  private dropFtsTriggers(): void {
    this.db.exec('DROP TRIGGER IF EXISTS variants_fts_ai')
    this.db.exec('DROP TRIGGER IF EXISTS variants_fts_ad')
    this.db.exec('DROP TRIGGER IF EXISTS variants_fts_au')
  }

  private rebuildFtsAndRestoreTriggers(): void {
    try {
      this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
    } catch (error) {
      mainLogger.error(`Failed to rebuild FTS index: ${error}`, 'CaseRepository')
    }
    try {
      this.db.exec(createFTSTriggers)
    } catch (error) {
      mainLogger.error(`Failed to recreate FTS triggers: ${error}`, 'CaseRepository')
    }
  }

  private restoreFtsTriggersSafe(): void {
    try {
      this.db.exec(createFTSTriggers)
    } catch (error) {
      mainLogger.error(`Failed to restore FTS triggers after error: ${error}`, 'CaseRepository')
    }
  }
}
