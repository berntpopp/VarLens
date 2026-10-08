import type { AstNode } from '../../../shared/utils/boolean-search'
import type { ExtensionFtsTableEntry } from '../variant-extension-registry'

/**
 * Structured search clause tree that mirrors the boolean AST but separates
 * FTS term leaves from HGVS term leaves so a composer can expand each type
 * appropriately: FTS term leaves become UNION subqueries across all present
 * FTS tables; HGVS term leaves stay as base-table LIKE predicates.
 */
export type SearchClause =
  | { type: 'fts'; term: string }
  | { type: 'hgvs'; term: string }
  | { type: 'and'; left: SearchClause; right: SearchClause }
  | { type: 'or'; left: SearchClause; right: SearchClause }
  | { type: 'not'; operand: SearchClause }

export interface PresentFtsTables {
  baseFts: 'variants_fts'
  extensionFts: readonly ExtensionFtsTableEntry[]
}

/** Walk the boolean AST and classify each term leaf as FTS or HGVS. */
export function classifySearchAst(ast: AstNode): SearchClause {
  switch (ast.type) {
    case 'term':
      return /^[cp]\./.test(ast.value)
        ? { type: 'hgvs', term: ast.value }
        : { type: 'fts', term: ast.value }
    case 'and':
      return {
        type: 'and',
        left: classifySearchAst(ast.left),
        right: classifySearchAst(ast.right)
      }
    case 'or':
      return {
        type: 'or',
        left: classifySearchAst(ast.left),
        right: classifySearchAst(ast.right)
      }
    case 'not':
      return { type: 'not', operand: classifySearchAst(ast.operand) }
  }
}

/**
 * Compose structured search clauses into SQL + parameters.
 *
 * Parameters are pushed into the returned array in the same left-to-right
 * order in which `?` placeholders appear in the generated SQL, so callers
 * can split on `?` and interpolate via Kysely's `sql` template pattern.
 */
export function composeSearchClauses(
  clause: SearchClause,
  present: PresentFtsTables
): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = []

  function compose(node: SearchClause): string {
    switch (node.type) {
      case 'fts':
        return composeFtsTermUnion(node.term, present, params)
      case 'hgvs':
        return composeHgvsTerm(node.term, params)
      case 'and':
        return `(${compose(node.left)} AND ${compose(node.right)})`
      case 'or':
        return `(${compose(node.left)} OR ${compose(node.right)})`
      case 'not':
        return `(NOT (${compose(node.operand)}))`
    }
  }

  return { sql: compose(clause), params }
}

/**
 * Expand an FTS term into a UNION of rowid subqueries across every present
 * FTS table (base `variants_fts` + every extension FTS table derived from
 * the registry). Each arm pushes one `?` parameter into `params`.
 */
function composeFtsTermUnion(
  term: string,
  present: PresentFtsTables,
  params: (string | number)[]
): string {
  const ftsQuery = `"${term.replace(/"/g, '""')}"*`
  const arms: string[] = [`SELECT rowid FROM ${present.baseFts} WHERE ${present.baseFts} MATCH ?`]
  params.push(ftsQuery)
  for (const entry of present.extensionFts) {
    arms.push(`SELECT rowid FROM ${entry.ftsTable} WHERE ${entry.ftsTable} MATCH ?`)
    params.push(ftsQuery)
  }
  return `id IN (${arms.join(' UNION ')})`
}

/**
 * `term` as the body of a LIKE pattern that matches it literally, for use
 * with `ESCAPE '\'`. HGVS uses `_` all the time (`c.1_2del`); unescaped it
 * is a wildcard and also matches `c.112del`.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&')
}

/**
 * Expand an HGVS term into a base-table LIKE predicate. Pushes two `?`
 * parameters (one for `cdna`, one for `aa_change`).
 */
function composeHgvsTerm(term: string, params: (string | number)[]): string {
  const pattern = `%${escapeLikePattern(term)}%`
  params.push(pattern, pattern)
  return "(cdna LIKE ? ESCAPE '\\' OR aa_change LIKE ? ESCAPE '\\')"
}
