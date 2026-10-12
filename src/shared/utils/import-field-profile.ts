/**
 * Import field-profile engine (spec §16), pure and shared by every importer
 * (varvis columnar, object JSON, VCF INFO + selected-transcript CSQ/ANN) and
 * by the renderer's field table, so the table shows the key an import writes.
 *
 * Fields mapped to a VarLens column never reach this module, except to feed a
 * canonical evidence key (`deriveOnly`). Everything else is resolved once per
 * source field to an `info.<KEY>` or skipped; keys are assigned in first-seen
 * order, so callers seed header fields first (INFO before CSQ, header order).
 */
import { isValidInfoKey } from '../filters/info-field-filter'
import {
  CANONICAL_EVIDENCE_FIELDS,
  DEFAULT_IMPORT_FIELD_PROFILE,
  IMPORT_FIELD_NAME_LIMITS,
  MAX_INFO_JSON_CHARS,
  MAX_INFO_JSON_FIELDS,
  type CanonicalEvidenceField,
  type FieldOrigin,
  type ImportFieldProfile
} from '../config/import-fields.config'

export class ImportFieldBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportFieldBudgetError'
  }
}

export function fieldProfileKey(origin: FieldOrigin, name: string): string {
  return `${origin}:${name}`
}

const CANONICAL_BY_ALIAS = new Map<string, CanonicalEvidenceField>()
for (const field of CANONICAL_EVIDENCE_FIELDS) {
  for (const alias of field.aliases) CANONICAL_BY_ALIAS.set(alias, field)
}

export function canonicalFieldFor(name: string): CanonicalEvidenceField | null {
  return CANONICAL_BY_ALIAS.get(name) ?? null
}

const MAX_KEY_CHARS = 64

/** A source name as an `info.<KEY>`: characters outside the INFO grammar become `_`. */
export function normaliseInfoKey(name: string): string {
  if (isValidInfoKey(name)) return name
  let key = name.replace(/[^0-9A-Za-z_.]/g, '_')
  if (!/^[A-Za-z_]/.test(key)) key = `_${key}`
  return key.slice(0, MAX_KEY_CHARS)
}

/**
 * Whether a field without a per-field choice is kept: `all` keeps every
 * field, `selected` the evidence aliases (canonical keys), `none` nothing.
 */
export function defaultKeep(profile: ImportFieldProfile, name: string): boolean {
  if (profile.keepUnknown === 'all') return true
  return profile.keepUnknown === 'selected' && canonicalFieldFor(name) !== null
}

/** Where one source field goes: an info key (null = skipped) and the canonical key it feeds. */
export interface ResolvedField {
  key: string | null
  canonical: CanonicalEvidenceField | null
}

/** A JSON export value as stored text; null when it holds nothing. */
export function jsonValueText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value === '' || value === '[]' ? null : value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map(jsonValueText).filter((part): part is string => part !== null)
    return parts.length > 0 ? parts.join(',') : null
  }
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>
    const label = item.abbreviation ?? item.name ?? item.label
    return label !== undefined && label !== null ? jsonValueText(label) : JSON.stringify(value)
  }
  return String(value)
}

function sourceLabel(origin: FieldOrigin, name: string): string {
  return `${origin}:${name}`
}

const SOURCE_LABEL_RE = /^(INFO|CSQ|ANN|JSON):(.+)$/
const CANONICAL_KEYS = new Set(CANONICAL_EVIDENCE_FIELDS.map((f) => f.key))

/** A resolved field with what the hot path needs cached. */
interface Resolved extends ResolvedField {
  label: string
  /** Already entered in the dictionary. */
  noted: boolean
}

/**
 * Resolves source fields against one profile for one imported file and
 * collects the per-case field dictionary (stored key → original source).
 */
export class FieldProfileResolver {
  // Per origin, so the per-record lookup builds no string.
  private readonly resolved: Record<FieldOrigin, Map<string, Resolved>> = {
    INFO: new Map(),
    CSQ: new Map(),
    ANN: new Map(),
    JSON: new Map()
  }
  private readonly taken = new Set<string>(CANONICAL_KEYS)
  /** Next suffix to try per normalised base, so collisions cost O(1) each. */
  private readonly nextSuffix = new Map<string, number>()
  private distinctFields = 0
  private nameChars = 0
  private readonly used = new Map<string, Set<string>>()

  constructor(readonly profile: ImportFieldProfile = DEFAULT_IMPORT_FIELD_PROFILE) {}

  /** Resolve fields in a fixed order before any record (header order). */
  seed(origin: FieldOrigin, names: Iterable<string>): void {
    for (const name of names) this.resolve(origin, name)
  }

  /**
   * Keep the keys an earlier file of the same case assigned (its stored field
   * dictionary), so one key means one source field across the whole case.
   */
  adopt(dictionary: Record<string, string> | null): void {
    for (const [key, source] of Object.entries(dictionary ?? {})) {
      const match = SOURCE_LABEL_RE.exec(source)
      if (match === null || CANONICAL_KEYS.has(key) || this.taken.has(key)) continue
      const origin = match[1] as FieldOrigin
      const name = match[2]
      if (this.resolved[origin].has(name)) continue
      this.taken.add(key)
      const keep = this.isKept(origin, name)
      const canonical = keep ? canonicalFieldFor(name) : null
      this.resolved[origin].set(name, {
        key: keep ? key : null,
        canonical,
        label: source,
        noted: false
      })
    }
  }

  resolve(origin: FieldOrigin, name: string): Resolved {
    const byName = this.resolved[origin]
    let field = byName.get(name)
    if (field === undefined) {
      this.countNewField(name)
      field = { ...this.decide(origin, name), label: sourceLabel(origin, name), noted: false }
      byName.set(name, field)
    }
    return field
  }

  /** Field names come from the file: bound how many, and how much text, one import keeps. */
  private countNewField(name: string): void {
    const { maxDistinctFields, maxNameChars } = IMPORT_FIELD_NAME_LIMITS
    if (this.distinctFields + 1 > maxDistinctFields) {
      throw new ImportFieldBudgetError(
        `The file has more than ${maxDistinctFields} distinct annotation fields`
      )
    }
    if (this.nameChars + name.length > maxNameChars) {
      throw new ImportFieldBudgetError(
        `The file's annotation field names exceed ${maxNameChars} characters in total`
      )
    }
    this.distinctFields += 1
    this.nameChars += name.length
  }

  isKept(origin: FieldOrigin, name: string): boolean {
    return (
      this.profile.fields[fieldProfileKey(origin, name)]?.keep ?? defaultKeep(this.profile, name)
    )
  }

  private decide(origin: FieldOrigin, name: string): ResolvedField {
    const choice = this.profile.fields[fieldProfileKey(origin, name)]
    const canonical = canonicalFieldFor(name)
    if (!this.isKept(origin, name)) return { key: null, canonical: null }
    // A synonym is stored under its canonical key; a component of a derived
    // maximum (the four SpliceAI scores) keeps its own key as well, and so
    // does a VCF INFO field, whose key existing filters may already use.
    const synonym = canonical?.combine === 'first' && origin !== 'INFO' ? canonical.key : undefined
    const requested = choice?.key ?? synonym ?? name
    if (canonical !== null && requested === canonical.key) return { key: requested, canonical }
    return { key: this.uniqueKey(normaliseInfoKey(requested)), canonical }
  }

  private uniqueKey(base: string): string {
    let key = base
    let n = this.nextSuffix.get(base) ?? 2
    while (this.taken.has(key)) {
      const suffix = `_${n++}`
      key = base.slice(0, MAX_KEY_CHARS - suffix.length) + suffix
    }
    this.nextSuffix.set(base, n)
    this.taken.add(key)
    return key
  }

  noteUse(key: string, label: string): void {
    let sources = this.used.get(key)
    if (sources === undefined) this.used.set(key, (sources = new Set()))
    sources.add(label)
  }

  record(): FieldRecord {
    return new FieldRecord(this)
  }

  /** Stored key → original source (`CSQ:REVEL_score`), for keys any record wrote; null when none. */
  dictionary(): Record<string, string> | null {
    if (this.used.size === 0) return null
    const entries = [...this.used].map(([key, sources]): [string, string] => {
      const list = [...sources].join(', ')
      const canonical = CANONICAL_EVIDENCE_FIELDS.find((f) => f.key === key)
      return [key, canonical?.combine === 'max' && sources.size > 1 ? `max(${list})` : list]
    })
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
  }
}

/** The `info_json` of one variant. */
export class FieldRecord {
  private readonly values = new Map<string, string>()
  private readonly candidates = new Map<CanonicalEvidenceField, Map<string, Candidate>>()

  constructor(private readonly resolver: FieldProfileResolver) {}

  /** A source value; `text` is stored as given (a VCF Flag is `''`). */
  set(origin: FieldOrigin, name: string, text: string): void {
    const field = this.resolver.resolve(origin, name)
    const { key, canonical } = field
    if (key === null) return
    if (canonical !== null) this.addCandidate(canonical, field.label, name, text)
    if (canonical !== null && key === canonical.key) return
    this.values.set(key, text)
    if (!field.noted) {
      field.noted = true
      this.resolver.noteUse(key, field.label)
    }
  }

  /** A value already stored in a column that also feeds a canonical key. */
  deriveOnly(origin: FieldOrigin, name: string, text: string): void {
    const canonical = canonicalFieldFor(name)
    if (canonical === null || !this.resolver.isKept(origin, name)) return
    this.addCandidate(canonical, sourceLabel(origin, name), name, text)
  }

  private addCandidate(
    canonical: CanonicalEvidenceField,
    label: string,
    name: string,
    text: string
  ): void {
    let byAlias = this.candidates.get(canonical)
    if (byAlias === undefined) this.candidates.set(canonical, (byAlias = new Map()))
    byAlias.set(name, { label, text })
  }

  /** The record as `info_json` text, or null when it holds nothing. */
  toJson(): string | null {
    for (const [canonical, byAlias] of this.candidates) {
      const derived = deriveCanonical(canonical, byAlias)
      if (derived === null) continue
      this.values.set(canonical.key, derived.value)
      for (const source of derived.sources) this.resolver.noteUse(canonical.key, source)
    }
    if (this.values.size === 0) return null
    if (this.values.size > MAX_INFO_JSON_FIELDS) {
      throw new ImportFieldBudgetError(
        `Variant has more than ${MAX_INFO_JSON_FIELDS} annotation fields to keep`
      )
    }
    const json = JSON.stringify(Object.fromEntries(this.values))
    if (json.length > MAX_INFO_JSON_CHARS) {
      throw new ImportFieldBudgetError(
        `Variant annotation fields exceed ${MAX_INFO_JSON_CHARS} characters`
      )
    }
    return json
  }
}

interface Candidate {
  label: string
  text: string
}

function numbersIn(text: string): number[] {
  const nums: number[] = []
  for (const part of text.split(/[&,|]/)) {
    const trimmed = part.trim()
    if (trimmed === '' || trimmed === '.') continue
    const num = Number(trimmed)
    if (Number.isFinite(num)) nums.push(num)
  }
  return nums
}

function canonicalText(text: string): string | null {
  const value = text.replace(/&/g, ',').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return value === '' || value === '.' ? null : value.toLowerCase()
}

/** The canonical value from its aliases' values, in the table's alias order. */
function deriveCanonical(
  field: CanonicalEvidenceField,
  byAlias: Map<string, Candidate>
): { value: string; sources: string[] } | null {
  let best: number | null = null
  const sources: string[] = []
  for (const alias of field.aliases) {
    const candidate = byAlias.get(alias)
    if (candidate === undefined) continue
    const { label } = candidate
    if (field.kind === 'text') {
      const value = canonicalText(candidate.text)
      if (value !== null) return { value, sources: [label] }
      continue
    }
    const nums = numbersIn(candidate.text)
    if (nums.length === 0) continue
    const value = Math.max(...nums)
    sources.push(label)
    if (field.combine === 'first') return { value: String(value), sources }
    best = best === null ? value : Math.max(best, value)
  }
  return best === null ? null : { value: String(best), sources }
}
