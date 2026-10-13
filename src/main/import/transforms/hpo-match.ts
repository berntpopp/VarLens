/**
 * varvis `hpo_match` / `HpoMatch` (patient HPO terms that matched the gene) as
 * the stored `variants.hpo_match` text (#580): `HP:0004322 Short stature; …`.
 * Shared by the object and columnar JSON mappers.
 */

/** One term: a string as given, a varvis term object as `abbreviation name`. */
function termText(item: unknown): string | null {
  if (typeof item === 'string') {
    const text = item.trim()
    return text === '' || text === '[]' ? null : text
  }
  if (typeof item === 'number') return Number.isFinite(item) ? String(item) : null
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const { abbreviation, name } = item as Record<string, unknown>
    const text = [abbreviation, name]
      .filter((part) => typeof part === 'string' && part !== '')
      .join(' ')
    return text === '' ? null : text
  }
  return null
}

/** A list of terms or a single term as stored text; null when it holds none. */
export function hpoMatchText(value: unknown): string | null {
  const items = Array.isArray(value) ? value.flat() : [value]
  const terms = items.map(termText).filter((term): term is string => term !== null)
  return terms.length > 0 ? terms.join('; ') : null
}
