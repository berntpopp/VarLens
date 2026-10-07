/**
 * Exact maintained count of the distinct (chr, pos, ref, alt) in the cohort
 * (#460), kept in `cohort_summary_state.unique_variant_count` (migration 0024).
 *
 * The cohort and overview tiles show it. Counting it per read meant grouping
 * every summary row (0.33 s at 100 exomes, linear in distinct variants);
 * `COUNT(*)` of the summary is no substitute, because the summary is keyed by
 * variant type and genome build as well, so a coordinate present under two of
 * them would count twice.
 *
 * It moves with the summary, in the same statements and therefore under the
 * same summary write lock and in the same transaction:
 *
 *   add      + coordinates whose first summary row this statement inserts
 *   remove   - coordinates whose last summary row this statement deletes
 *   rebuild  recounted from the rebuilt summary
 *
 * Both deltas are the main query of a data-modifying WITH: its subqueries see
 * the summary as it was before the statement, which is exactly "had no row
 * before" and "keeps a row afterwards".
 */
import type { PoolClient } from 'pg'

type QueryClient = Pick<PoolClient, 'query'>
type Tbl = (table: string) => string

const COORD = ['chr', 'pos', 'ref', 'alt'] as const
const coordMatch = (a: string, b: string): string =>
  COORD.map((column) => `${a}.${column} = ${b}.${column}`).join(' AND ')

/** RETURNING list for the summary upsert; `inserted` is false for a conflict update. */
export const UPSERT_RETURNING_SQL = `RETURNING chr, pos, ref, alt, (xmax = 0) AS inserted`

/**
 * Main query for `WITH upserted AS (INSERT … ${UPSERT_RETURNING_SQL})`: add the
 * coordinates that had no summary row before, and stamp the maintenance time.
 */
export function countAddedCoordinatesSql(tbl: Tbl): string {
  return `UPDATE ${tbl('cohort_summary_state')}
     SET unique_variant_count = unique_variant_count + (
           SELECT COUNT(*) FROM (
             SELECT DISTINCT u.chr, u.pos, u.ref, u.alt
             FROM upserted u
             WHERE u.inserted
               AND NOT EXISTS (
                 SELECT 1 FROM ${tbl('cohort_variant_summary')} s WHERE ${coordMatch('s', 'u')}
               )
           ) first_rows
         ),
         last_incremental_at = now()
   WHERE id = 1`
}

/**
 * Delete the rows that lost their last carrier and subtract the coordinates
 * that are gone. `touchedKeys` is a relation with the summary key columns of
 * the rows that may have dropped to zero (the removed case's aggregate), so
 * the delete is a key lookup per row and never scans the summary.
 */
export async function dropEmptySummaryRows(args: {
  schema: string
  client: QueryClient
  touchedKeys: string
}): Promise<void> {
  const tbl: Tbl = (table) => `"${args.schema}"."${table}"`
  await args.client.query(
    `WITH gone AS (
       DELETE FROM ${tbl('cohort_variant_summary')} d
        USING ${args.touchedKeys} k
        WHERE ${coordMatch('d', 'k')}
          AND d.variant_type = k.variant_type AND d.genome_build = k.genome_build
          AND d.carrier_count <= 0
       RETURNING d.chr, d.pos, d.ref, d.alt
     )
     UPDATE ${tbl('cohort_summary_state')}
        SET unique_variant_count = unique_variant_count - (
              SELECT COUNT(*) FROM (
                SELECT DISTINCT g.chr, g.pos, g.ref, g.alt
                FROM gone g
                WHERE NOT EXISTS (
                  SELECT 1 FROM ${tbl('cohort_variant_summary')} s
                  WHERE ${coordMatch('s', 'g')} AND s.carrier_count > 0
                )
              ) last_rows
            )
      WHERE id = 1`
  )
}

/** Recount from the summary (rebuild, and the reference the tests compare against). */
export function recountUniqueVariantsSql(tbl: Tbl): string {
  return `SELECT COUNT(*)::bigint FROM (
            SELECT 1 FROM ${tbl('cohort_variant_summary')} GROUP BY chr, pos, ref, alt
          ) unique_coordinates`
}

export async function recountUniqueVariants(args: {
  schema: string
  client: QueryClient
}): Promise<void> {
  const tbl: Tbl = (table) => `"${args.schema}"."${table}"`
  await args.client.query(
    `UPDATE ${tbl('cohort_summary_state')}
        SET unique_variant_count = (${recountUniqueVariantsSql(tbl)})
      WHERE id = 1`
  )
}

/** The tile read: one row of the state table, no scan of summary or variants. */
export function uniqueVariantsSql(tbl: Tbl): string {
  return `SELECT COALESCE(
            (SELECT unique_variant_count FROM ${tbl('cohort_summary_state')} WHERE id = 1), 0
          )::bigint`
}
