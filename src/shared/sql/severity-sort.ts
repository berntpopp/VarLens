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

/** SQL for the two ranks of a row, where they are not plain stored columns. */
export interface SeverityRankSql {
  impact: string
  clinvar: string
}

/**
 * ORDER BY terms (with direction) for a sort on `sortKey`, or null when the
 * key is not a severity column. `alias` qualifies the rank column ('' for
 * none); `textColumn` is the already whitelisted reference to the raw column.
 * `ranks` replaces the stored columns where a rank may still be missing
 * (PostgreSQL variant rows before the backfill reaches them).
 */
export function severitySortTerms(
  sortKey: string,
  alias: string,
  textColumn: string,
  direction: 'asc' | 'desc',
  ranks?: SeverityRankSql
): string[] | null {
  const rankColumn = SEVERITY_RANK_COLUMNS[sortKey]
  if (rankColumn === undefined) return null
  const stored = alias === '' ? rankColumn : `${alias}.${rankColumn}`
  const rank = ranks === undefined ? stored : sortKey === 'clinvar' ? ranks.clinvar : ranks.impact
  const dir = direction === 'desc' ? 'DESC' : 'ASC'
  return [`NULLIF(${rank}, 0) ${dir} NULLS LAST`, `${textColumn} ${dir} NULLS LAST`]
}
