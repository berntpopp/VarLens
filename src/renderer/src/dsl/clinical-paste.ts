/**
 * Smart clinical paste normalizer for DslSearchBar (#683).
 *
 * Rewrites pasted genomic intervals, VCF keys, and gene lists into
 * valid VarLens filter DSL syntax.
 */

const INTERVAL_REGEX = /^(?:chr)?([0-9]{1,2}|[XYM]|MT):([0-9,]+)(?:[-–—]|\.\.)([0-9,]+)$/i
const SINGLE_COORD_REGEX = /^(?:chr)?([0-9]{1,2}|[XYM]|MT):([0-9,]+)$/i
const VCF_KEY_REGEX = /^(?:chr)?([0-9]{1,2}|[XYM]|MT)[-:](\d+)[-:]([ACGTN*]+)[-:]([ACGTN*]+)$/i
const GENE_SYMBOL_REGEX = /^[A-Z][A-Z0-9-]{1,14}$/

export function normalizeClinicalPaste(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''

  // 1. Genomic interval (e.g. chr17:43,044,295-43,125,483 or 17:43044295..43125483)
  const intervalMatch = INTERVAL_REGEX.exec(trimmed)
  if (intervalMatch) {
    const chr = intervalMatch[1].toUpperCase()
    const p1 = Number(intervalMatch[2].replace(/,/g, ''))
    const p2 = Number(intervalMatch[3].replace(/,/g, ''))
    const min = Math.min(p1, p2)
    const max = Math.max(p1, p2)
    return `chr:=:${chr} AND pos:>=:${min} AND pos:<=:${max}`
  }

  // 2. Single genomic coordinate (e.g. chr17:43,094,464 or 17:43094464)
  const coordMatch = SINGLE_COORD_REGEX.exec(trimmed)
  if (coordMatch) {
    const chr = coordMatch[1].toUpperCase()
    const pos = Number(coordMatch[2].replace(/,/g, ''))
    return `chr:=:${chr} AND pos:=:${pos}`
  }

  // 3. VCF-style variant key (e.g. 17-43094464-G-A or chr17:43094464:G:A)
  const vcfMatch = VCF_KEY_REGEX.exec(trimmed)
  if (vcfMatch) {
    const chr = vcfMatch[1].toUpperCase()
    const pos = vcfMatch[2]
    const ref = vcfMatch[3].toUpperCase()
    const alt = vcfMatch[4].toUpperCase()
    return `chr:=:${chr} AND pos:=:${pos} AND ref:=:${ref} AND alt:=:${alt}`
  }

  // 4. Gene list: 2 or more uppercase symbols separated by comma, semicolon, whitespace, newline
  // Check if already contains DSL operators or presets
  if (trimmed.includes(':') || trimmed.startsWith('@')) {
    return trimmed
  }

  const tokens = trimmed
    .split(/[,;\s\r\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  if (
    tokens.length >= 2 &&
    tokens.every((token) => GENE_SYMBOL_REGEX.test(token) && token !== 'AND' && token !== 'OR')
  ) {
    const deduped = [...new Set(tokens)]
    return `(${deduped.map((g) => `gene_symbol:=:${g}`).join(' OR ')})`
  }

  return trimmed
}
