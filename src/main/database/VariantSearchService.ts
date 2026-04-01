import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import type { Variant } from './types'
import type { VariantQueryBuilder } from './VariantFilterBuilder'
import { tokenize, parse } from '../../shared/utils/boolean-search'
import { emitFts5Search } from './search/fts5-search-emitter'
import { mainLogger } from '../services/MainLogger'

/**
 * FTS5 search and gene symbol lookup for variants.
 *
 * Extracted from VariantRepository to isolate search logic
 * (boolean parsing, HGVS fallback, FTS5 MATCH) into a focused module.
 */
export class VariantSearchService {
  constructor(
    private readonly db: DatabaseType,
    private readonly kysely: Kysely<VarlensDatabase>
  ) {}

  /**
   * Apply FTS5 search filter to a Kysely query.
   * Handles boolean operators (AND/OR/NOT) and HGVS pattern matching.
   */
  applySearchFilter(query: VariantQueryBuilder, searchQuery: string): VariantQueryBuilder {
    const term = searchQuery.trim()
    const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)

    if (!hasBooleanOps) {
      return this.applySingleSearchToken(query, term)
    }

    // Parse boolean expression into AST and emit FTS5-compatible SQL
    const tokens = tokenize(term)
    if (tokens.length === 0) return query
    let ast
    try {
      ast = parse(tokens)
    } catch (e) {
      // Malformed boolean expression — fall back to single-term search
      mainLogger.warn(
        'Malformed boolean search expression, falling back to single-term: ' +
          (e instanceof Error ? e.message : String(e)),
        'VariantSearchService'
      )
      return this.applySingleSearchToken(query, term)
    }
    const { sql: boolExpr, params } = emitFts5Search(ast)

    // Build a sql template literal with interpolated parameters
    const fullExpr = `(${boolExpr})`
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
  applySingleSearchToken(query: VariantQueryBuilder, token: string): VariantQueryBuilder {
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
   * Search variants using FTS5 full-text index, ranked by BM25.
   */
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

  /**
   * Get distinct gene symbols matching a query prefix.
   */
  getGeneSymbols(caseId: number, query: string, limit: number = 50): string[] {
    const compiled = this.kysely
      .selectFrom('variants')
      .select('gene_symbol')
      .distinct()
      .where('case_id', '=', caseId)
      .where('gene_symbol', 'like', `${query}%`)
      .where('gene_symbol', 'is not', null)
      .orderBy('gene_symbol')
      .limit(limit)
      .compile()
    const results = this.db.prepare(compiled.sql).all(...compiled.parameters) as {
      gene_symbol: string
    }[]
    return results.map((r) => r.gene_symbol)
  }
}
