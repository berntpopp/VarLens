/**
 * The `info.<KEY>` fields of one case and where each came from (#596, #538).
 *
 * The import writes every kept annotation field into `variants.info_json`
 * under a normalised key and stores the per-case field dictionary
 * (`case_data_info.field_dictionary`, stored key → {@link FieldDictionaryEntry}:
 * the original source such as `CSQ:REVEL_score`, plus the VCF header Type and
 * Number of an INFO field; older cases store the source string alone). That dictionary is the one source for the filter
 * autocomplete, the variant details INFO section and the case data-info list.
 * Cases imported before the dictionary existed (SQLite v46 / PostgreSQL 0029)
 * have none, so their keys are unknown here.
 */
import { isValidInfoKey } from '../filters/info-field-filter'

/** One stored dictionary value; `type`/`number` only when a VCF header declared them. */
export interface FieldDictionaryEntry {
  /** Original source field(s), e.g. `CSQ:REVEL_score` or `max(CSQ:A, CSQ:B)`. */
  source: string
  /** VCF INFO header Type: `Integer` | `Float` | `Flag` | `Character` | `String`. */
  type?: string
  /** VCF INFO header Number: `0`, `1`, `A`, `R`, `G`, `.` or a count. */
  number?: string
}

export interface CaseInfoField extends FieldDictionaryEntry {
  /** Stored key, filtered as `info.<KEY>`. */
  key: string
}

/** A stored dictionary value in either shape (a pre-#538 source string or an entry); null when invalid. */
export function fieldDictionaryEntry(value: unknown): FieldDictionaryEntry | null {
  if (typeof value === 'string') return { source: value }
  if (value === null || typeof value !== 'object') return null
  const { source, type, number } = value as Record<string, unknown>
  if (typeof source !== 'string') return null
  return {
    source,
    ...(typeof type === 'string' ? { type } : {}),
    ...(typeof number === 'string' ? { number } : {})
  }
}

/**
 * Why an `info.<KEY>` filter cannot compare this field's values; null when it can
 * or the header did not say. A Flag has no value, and a list (Number other than 1)
 * is not compared element-wise (`info-field-filter.ts`).
 */
export function infoFieldLimitation(field: FieldDictionaryEntry): string | null {
  if (field.type === 'Flag')
    return 'Flag field: has no value to compare, only is:null / is:notnull apply'
  if (field.number !== undefined && field.number !== '1') {
    return `List field (Number=${field.number}): values are not compared element-wise`
  }
  return null
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
    .flatMap(([key, value]) => {
      const entry = isValidInfoKey(key) ? fieldDictionaryEntry(value) : null
      return entry === null ? [] : [{ key, ...entry }]
    })
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
