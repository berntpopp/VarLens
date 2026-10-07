/**
 * Sorting by severity (#469).
 *
 * The impact (`consequence`) and ClinVar (`clinvar`) columns hold category
 * names, so sorting them as text orders HIGH < LOW < MODERATE < MODIFIER and
 * 'Uncertain significance' above 'Pathogenic'. Both the case view and the
 * cohort view sort these two keys by the stored rank instead
 * (`impact_rank` / `clinvar_rank`, src/shared/config/severity.config.ts):
 * descending is most severe first. An unknown value (rank 0) and NULL sort
 * last in both directions, like every other NULL in these views; rows of
 * equal rank fall back to the text.
 *
 * Pure SQL text: safe in main, workers and both storage backends.
 */

/** Sort keys ordered by a stored severity rank, and the column that holds it. */
const SEVERITY_RANK_COLUMNS: Readonly<Record<string, string>> = {
  consequence: 'impact_rank',
  clinvar: 'clinvar_rank'
}

/**
 * ORDER BY terms (with direction) for a sort on `sortKey`, or null when the
 * key is not a severity column. `alias` qualifies the rank column ('' for
 * none); `textColumn` is the already whitelisted reference to the raw column.
 */
export function severitySortTerms(
  sortKey: string,
  alias: string,
  textColumn: string,
  direction: 'asc' | 'desc'
): string[] | null {
  const rankColumn = SEVERITY_RANK_COLUMNS[sortKey]
  if (rankColumn === undefined) return null
  const rank = alias === '' ? rankColumn : `${alias}.${rankColumn}`
  const dir = direction === 'desc' ? 'DESC' : 'ASC'
  return [`NULLIF(${rank}, 0) ${dir} NULLS LAST`, `${textColumn} ${dir} NULLS LAST`]
}
