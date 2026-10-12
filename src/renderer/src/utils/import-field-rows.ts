/**
 * Rows of the import field-profile table (spec §16) and the profile edits it
 * makes. Keys come from the shared engine, so the table shows exactly the
 * `info.<KEY>` an import writes.
 */
import {
  ANN_COLUMN_FIELDS,
  CANONICAL_EVIDENCE_FIELDS,
  COLUMNAR_HEADER_TO_SLOT,
  COLUMNAR_SLOT_COLUMN,
  CSQ_COLUMN_FIELDS,
  VARVIS_SNV_COLUMN_TYPES,
  type FieldChoice,
  type FieldOrigin,
  type ImportFieldProfile
} from '../../../shared/config/import-fields.config'
import type { ImportFieldPreview } from '../../../shared/types/import'
import type { VcfPreviewResult } from '../../../shared/types/vcf'
import {
  canonicalFieldFor,
  defaultKeep,
  fieldProfileKey,
  FieldProfileResolver
} from '../../../shared/utils/import-field-profile'

export interface FieldRow extends ImportFieldPreview {
  id: string
  /** Stored as `info.<key>`; null when skipped or stored in a column. */
  key: string | null
  /** The canonical evidence key this field feeds, if any. */
  canonical: string | null
  canonicalLabel: string | null
  keep: boolean
  /** A column field: always imported, not editable. */
  locked: boolean
  /** The user's rename, if any. */
  rename: string | undefined
}

export function fieldRows(fields: ImportFieldPreview[], profile: ImportFieldProfile): FieldRow[] {
  const resolver = new FieldProfileResolver(profile)
  return fields.map((field) => {
    const id = fieldProfileKey(field.origin, field.name)
    const canonical = canonicalFieldFor(field.name)
    const base = {
      ...field,
      id,
      canonical: canonical?.key ?? null,
      canonicalLabel: canonical?.label ?? null,
      rename: profile.fields[id]?.key
    }
    if (field.column !== null) {
      const derives =
        canonical !== null && (profile.fields[id]?.keep ?? defaultKeep(profile, field.name))
      return {
        ...base,
        key: null,
        keep: true,
        locked: true,
        canonical: derives ? base.canonical : null
      }
    }
    const { key } = resolver.resolve(field.origin, field.name)
    return { ...base, key, keep: key !== null, locked: false }
  })
}

/** The profile with one field's choice; a choice equal to the default is dropped. */
export function withFieldChoice(
  profile: ImportFieldProfile,
  field: Pick<ImportFieldPreview, 'origin' | 'name'>,
  choice: FieldChoice
): ImportFieldProfile {
  const id = fieldProfileKey(field.origin, field.name)
  const fields = { ...profile.fields }
  const key = choice.key?.trim() === '' ? undefined : choice.key?.trim()
  if (key === undefined && choice.keep === defaultKeep(profile, field.name)) delete fields[id]
  else fields[id] = key === undefined ? { keep: choice.keep } : { keep: choice.keep, key }
  return { ...profile, fields }
}

/** Keep or skip every given (non-column) field, keeping renames. */
export function withAllKept(
  profile: ImportFieldProfile,
  fields: ImportFieldPreview[],
  keep: boolean
): ImportFieldProfile {
  return fields
    .filter((field) => field.column === null)
    .reduce((next, field) => {
      const rename = next.fields[fieldProfileKey(field.origin, field.name)]?.key
      return withFieldChoice(next, field, { keep, key: rename })
    }, profile)
}

/** A file's choices merged into the saved default ("Save as default"). */
export function mergeIntoDefault(
  saved: ImportFieldProfile,
  current: ImportFieldProfile
): ImportFieldProfile {
  return { keepUnknown: current.keepUnknown, fields: { ...saved.fields, ...current.fields } }
}

const COLUMN_BY_ANNOTATION: Record<string, Readonly<Record<string, string>>> = {
  csq: CSQ_COLUMN_FIELDS,
  ann: ANN_COLUMN_FIELDS
}

/** A VCF preview as table fields: INFO first, then the annotation subfields (import order). */
export function vcfPreviewFields(preview: VcfPreviewResult): ImportFieldPreview[] {
  const info: ImportFieldPreview[] = preview.infoFields.map((field) => ({
    origin: 'INFO',
    name: field.id,
    column: field.mapsToColumn,
    type:
      field.number === '1' || field.number === '0' ? field.type : `${field.type} (${field.number})`,
    fillRate: null,
    samples: [],
    description: field.description
  }))
  const columns = COLUMN_BY_ANNOTATION[preview.annotationType] ?? {}
  const origin: FieldOrigin = preview.annotationType === 'ann' ? 'ANN' : 'CSQ'
  const annotation: ImportFieldPreview[] = (preview.annotationFields ?? []).map((name) => ({
    origin,
    name,
    column: Object.prototype.hasOwnProperty.call(columns, name) ? columns[name] : null,
    type: '',
    fillRate: null,
    samples: []
  }))
  return [...info, ...annotation]
}

function parseFieldId(id: string): { origin: FieldOrigin; name: string } | null {
  const at = id.indexOf(':')
  const origin = id.slice(0, at)
  if (at < 0 || !['INFO', 'CSQ', 'ANN', 'JSON'].includes(origin)) return null
  return { origin: origin as FieldOrigin, name: id.slice(at + 1) }
}

/**
 * Fields the Settings editor lists without a file: the canonical evidence
 * aliases, the varvis SNV catalogue and every field the profile names.
 */
export function catalogueFields(profile: ImportFieldProfile): ImportFieldPreview[] {
  const seen = new Set<string>()
  const out: ImportFieldPreview[] = []
  const add = (origin: FieldOrigin, name: string, type = '', description?: string): void => {
    const id = fieldProfileKey(origin, name)
    if (seen.has(id)) return
    seen.add(id)
    const slot = origin === 'JSON' ? COLUMNAR_HEADER_TO_SLOT[name] : undefined
    const column = slot === undefined ? null : COLUMNAR_SLOT_COLUMN[slot]
    out.push({ origin, name, column, type, fillRate: null, samples: [], description })
  }
  for (const field of CANONICAL_EVIDENCE_FIELDS) {
    for (const alias of field.aliases) {
      const varvis = Object.prototype.hasOwnProperty.call(VARVIS_SNV_COLUMN_TYPES, alias)
      add(varvis ? 'JSON' : 'CSQ', alias, field.kind, field.label)
    }
  }
  for (const [name, type] of Object.entries(VARVIS_SNV_COLUMN_TYPES)) add('JSON', name, type)
  for (const id of Object.keys(profile.fields)) {
    const parsed = parseFieldId(id)
    if (parsed !== null) add(parsed.origin, parsed.name)
  }
  return out
}
