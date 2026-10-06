/**
 * The single "Links" column shared by the case, cohort and shortlist tables.
 *
 * External links configured with `column: 'virtual'` (VarSome, Franklin,
 * PubTator, ... plus any user-defined link) used to get one 80-106 px column
 * each, which pushed ClinVar and friends off-screen. They now render as
 * compact icon links in one column. Pure helpers only (no Vue, no store), so
 * the abbreviation and preference-migration rules are unit-testable.
 */

/** Column key of the merged link-out column. */
export const LINKS_COLUMN_KEY = '_links'

/** Prefix of the retired per-link column keys (`_link_<id>`). */
export const LEGACY_LINK_COLUMN_PREFIX = '_link_'

/** Row-view-model key a link resolves into (unchanged from the per-link columns). */
export function linkOutKey(linkId: string): string {
  return `${LEGACY_LINK_COLUMN_PREFIX}${linkId}`
}

/** Hand-picked short labels for the built-in links (readable at 2 characters). */
const BUILT_IN_ABBREVIATIONS: Readonly<Record<string, string>> = {
  varsome: 'VS',
  franklin: 'Fr',
  pubtator: 'PT',
  litvar: 'LV',
  decipher: 'DE',
  clingen: 'CG',
  ensembl: 'En',
  gnomad: 'gn',
  ucsc: 'UC',
  clinvar: 'CV'
}

/**
 * Two-character badge label for a link: the built-in label when there is one,
 * else the initials of a multi-word name ("My Lab DB" -> "ML"), else the
 * first two characters ("Mastermind" -> "Ma").
 */
export function linkAbbreviation(id: string, name: string): string {
  const builtIn = BUILT_IN_ABBREVIATIONS[id]
  if (builtIn !== undefined) return builtIn
  const words = name
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  const word = words[0] ?? '?'
  return word.length === 1 ? word.toUpperCase() : word[0].toUpperCase() + word[1]
}

/** Badge geometry (rem) — kept in sync with `.link-outs` in assets/styles/table-cells.scss. */
const BADGE_REM = 1.5
const BADGE_GAP_REM = 0.125
const CELL_PADDING_REM = 1.5

/** Fixed width of the Links column for `count` links, in rem (scales with text size). */
export function linksColumnWidthRem(count: number): number {
  const n = Math.max(1, count)
  return CELL_PADDING_REM + n * BADGE_REM + (n - 1) * BADGE_GAP_REM
}

interface StoredColumnPrefs {
  order: string[]
  visibility: Record<string, boolean>
  widths: Record<string, number>
}

function isLegacyLinkKey(key: string): boolean {
  return key.startsWith(LEGACY_LINK_COLUMN_PREFIX)
}

/**
 * Fold saved per-link column preferences into the merged Links column.
 *
 * - visibility: shown if any link column was explicitly shown, hidden if
 *   every saved link column was hidden; an existing `_links` choice wins.
 * - order: the Links column takes the slot of the first saved link column.
 * - widths: per-link widths are dropped (the Links width is computed).
 *
 * Returns `null` when there is nothing to migrate, so callers can skip the
 * write (and the storage event) on every load.
 */
export function migrateLinkColumnPrefs<T extends StoredColumnPrefs>(prefs: T): T | null {
  const visibilityKeys = Object.keys(prefs.visibility).filter(isLegacyLinkKey)
  const orderHasLegacy = prefs.order.some(isLegacyLinkKey)
  const widthKeys = Object.keys(prefs.widths).filter(isLegacyLinkKey)
  if (visibilityKeys.length === 0 && !orderHasLegacy && widthKeys.length === 0) return null

  const visibility: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(prefs.visibility)) {
    if (!isLegacyLinkKey(key)) visibility[key] = value
  }
  if (!(LINKS_COLUMN_KEY in visibility) && visibilityKeys.length > 0) {
    visibility[LINKS_COLUMN_KEY] = visibilityKeys.some((key) => prefs.visibility[key])
  }

  const order: string[] = []
  for (const key of prefs.order) {
    const mapped = isLegacyLinkKey(key) ? LINKS_COLUMN_KEY : key
    if (!order.includes(mapped)) order.push(mapped)
  }

  const widths: Record<string, number> = {}
  for (const [key, value] of Object.entries(prefs.widths)) {
    if (!isLegacyLinkKey(key)) widths[key] = value
  }

  return { ...prefs, order, visibility, widths }
}
