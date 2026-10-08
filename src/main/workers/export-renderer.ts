/** Format a cell value — applies numeric formatting for specific columns. */
export function formatCellValue(key: string, value: unknown): string | number | null {
  if (value === null || value === undefined) return ''
  if (key === 'gnomad_af' && typeof value === 'number') {
    return value.toExponential(2)
  }
  if (key === 'cadd' && typeof value === 'number') {
    return value.toFixed(2)
  }
  if (key === 'hpo_sim_score' && typeof value === 'number') {
    return value.toFixed(4)
  }
  return value as string | number | null
}

// Spreadsheets run a cell starting with one of these as a formula (CSV injection).
const FORMULA_LEAD = /^[=+\-@\t\r]/
// ...except a bare sign (e.g. an empty allele '-') or a signed number, which are inert.
const BARE_SIGN_OR_NUMBER = /^[+-](\d+(\.\d+)?(e[+-]?\d+)?)?$/i

/**
 * Escape a value for RFC 4180 CSV.
 * Wraps in double-quotes if the value contains a comma, double-quote, or newline.
 * Internal double-quotes are escaped by doubling them.
 * A string a spreadsheet would run as a formula gets a leading apostrophe; numbers are untouched.
 */
export function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  let str = String(value)
  if (typeof value === 'string' && FORMULA_LEAD.test(str) && !BARE_SIGN_OR_NUMBER.test(str)) {
    str = "'" + str
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}
