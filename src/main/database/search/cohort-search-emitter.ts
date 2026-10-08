import type { AstNode } from '../../../shared/utils/boolean-search'

/**
 * Emit LIKE-based SQL from a boolean search AST.
 * Used by cohort search which queries cohort_variant_summary table columns.
 */
export function emitCohortSearch(ast: AstNode): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = []

  function emit(node: AstNode): string {
    switch (node.type) {
      case 'term':
        return emitTerm(node.value, params)
      case 'and':
        return `(${emit(node.left)} AND ${emit(node.right)})`
      case 'or':
        return `(${emit(node.left)} OR ${emit(node.right)})`
      case 'not':
        return `(NOT (${emit(node.operand)}))`
    }
  }

  return { sql: emit(ast), params }
}

/**
 * Emit SQL for a single search term.
 * Handles genomic coordinates (chr:pos), HGVS (c./p.), and general LIKE.
 *
 * Column names use cvs. prefix matching cohort_variant_summary table alias.
 */
export function emitTerm(term: string, params: (string | number)[]): string {
  // Genomic coordinate: chr1:12345 or 1:12345. Import stores `chr` verbatim, so
  // match both spellings whichever one the user typed (#492).
  const coordMatch = term.match(/^(?:chr)?(\d{1,2}|X|Y|MT?):(\d+)$/i)
  if (coordMatch) {
    const chr = coordMatch[1].toUpperCase()
    params.push(chr, `chr${chr}`, Number(coordMatch[2]))
    return '(cvs.chr IN (?, ?) AND cvs.pos = ?)'
  }

  // HGVS pattern: c.1234A>G or p.Val600Glu
  if (/^[cp]\./.test(term)) {
    const searchPattern = `%${term}%`
    params.push(searchPattern, searchPattern)
    return '(cvs.cdna LIKE ? OR cvs.aa_change LIKE ?)'
  }

  // Default: LIKE-based search on gene_symbol, consequence, omim_mim_number
  const searchPattern = `%${term}%`
  params.push(searchPattern, searchPattern, searchPattern)
  return '(cvs.gene_symbol LIKE ? COLLATE NOCASE OR cvs.consequence LIKE ? COLLATE NOCASE OR cvs.omim_mim_number LIKE ? COLLATE NOCASE)'
}
