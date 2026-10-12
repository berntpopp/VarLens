/**
 * Row-side reading of one `info.<KEY>` value, with the classification the SQL
 * emitters in `info-field-filter.ts` apply: a JSON-number shape of at most 64
 * characters with an exponent of at most three digits is numeric; an absent
 * key or the VCF missing value `.` is missing; `''` (a Flag) is present.
 */
const JSON_NUMBER_RE = /^[ \t\n\r]*-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]{1,3})?[ \t\n\r]*$/

export interface InfoValue {
  present: boolean
  /** The stored text; `.` is kept here (a substring match still sees it) but is not present. */
  text: string | null
  num: number | null
}

export function isJsonNumberText(text: string): boolean {
  return text.length <= 64 && JSON_NUMBER_RE.test(text)
}

const MISSING: InfoValue = { present: false, text: null, num: null }

export function readInfoValue(infoJson: string | null | undefined, key: string): InfoValue {
  if (infoJson == null || infoJson === '') return MISSING
  let parsed: unknown
  try {
    parsed = JSON.parse(infoJson)
  } catch {
    return MISSING
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return MISSING
  if (!Object.prototype.hasOwnProperty.call(parsed, key)) return MISSING
  const raw = (parsed as Record<string, unknown>)[key]
  if (raw === null || raw === undefined) return MISSING
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  if (text === '.') return { present: false, text, num: null }
  return { present: true, text, num: isJsonNumberText(text) ? Number(text) : null }
}
