/**
 * The `info.<KEY>` fields of one case and where each came from (#596, #538).
 *
 * The import writes every kept annotation field into `variants.info_json`
 * under a normalised key and stores the per-case field dictionary
 * (`case_data_info.field_dictionary`, stored key → original source such as
 * `CSQ:REVEL_score`). That dictionary is the one source for the filter
 * autocomplete, the variant details INFO section and the case data-info list.
 * Cases imported before the dictionary existed (SQLite v46 / PostgreSQL 0029)
 * have none, so their keys are unknown here.
 */
import { isValidInfoKey } from '../filters/info-field-filter'

export interface CaseInfoField {
  /** Stored key, filtered as `info.<KEY>`. */
  key: string
  /** Original source field(s), e.g. `CSQ:REVEL_score` or `max(CSQ:A, CSQ:B)`. */
  source: string
}

function parseObject(text: string | null | undefined): Record<string, unknown> | null {
  if (text == null || text === '') return null
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** The fields of a stored field dictionary, sorted by key; [] when there is none. */
export function caseInfoFields(fieldDictionary: string | null | undefined): CaseInfoField[] {
  const parsed = parseObject(fieldDictionary)
  if (parsed === null) return []
  return Object.entries(parsed)
    .filter(
      (entry): entry is [string, string] => isValidInfoKey(entry[0]) && typeof entry[1] === 'string'
    )
    .map(([key, source]) => ({ key, source }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** The key/value pairs of one variant's `info_json`, in stored order; [] when none. */
export function infoJsonEntries(infoJson: string | null | undefined): [string, string][] {
  const parsed = parseObject(infoJson)
  if (parsed === null) return []
  return Object.entries(parsed).map(([key, value]): [string, string] => [
    key,
    typeof value === 'string' ? value : JSON.stringify(value)
  ])
}
