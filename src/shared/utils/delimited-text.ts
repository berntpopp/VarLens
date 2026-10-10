// Spreadsheets run a cell starting with one of these as a formula.
const FORMULA_LEAD = /^[=+\-@\t\r]/
// Bare signs and signed numbers are inert.
const BARE_SIGN_OR_NUMBER = /^[+-](\d+(\.\d+)?(e[+-]?\d+)?)?$/i

/** Quote CSV/TSV cells and keep imported strings from becoming spreadsheet formulas. */
export function escapeDelimitedCell(
  value: string | number | null,
  delimiter: ',' | '\t' = ','
): string {
  if (value === null || value === undefined) return ''
  let str = String(value)
  if (typeof value === 'string' && FORMULA_LEAD.test(str) && !BARE_SIGN_OR_NUMBER.test(str)) {
    str = "'" + str
  }
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}
