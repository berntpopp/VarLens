/**
 * Backfill of `impact_rank` / `clinvar_rank` on existing variant rows
 * (migration 0025, #469). New rows get their ranks from the import pipeline.
 *
 * Impact is a CASE generated from the severity configuration. A ClinVar
 * string can be multi-valued (`Pathogenic/Likely_pathogenic|risk_factor`),
 * which plain SQL cannot categorise, so the distinct stored strings are read,
 * ranked with the configuration's own normaliser and applied as a lookup
 * table: stored ranks are by construction what an import would have written.
 *
 * One UPDATE, touching only rows whose rank differs: running it again is a
 * no-op.
 */
import type { PoolClient } from 'pg'

import { clinvarRank, impactRankCaseSql } from '../../../../shared/config/severity.config'
import { quoteIdentifier } from '../identifiers'

type QueryClient = Pick<PoolClient, 'query'>

const RANK_TABLE = '"_varlens_clinvar_ranks"'

export async function backfillSeverityRanks(client: QueryClient, schema: string): Promise<void> {
  const variants = `${quoteIdentifier(schema)}."variants_all"`

  const distinct = await client.query(
    `SELECT DISTINCT clinvar FROM ${variants} WHERE clinvar IS NOT NULL`
  )
  const raw: string[] = []
  const ranks: number[] = []
  for (const row of distinct.rows as Array<{ clinvar: string }>) {
    const rank = clinvarRank(row.clinvar)
    if (rank === 0) continue
    raw.push(row.clinvar)
    ranks.push(rank)
  }

  await client.query(`DROP TABLE IF EXISTS pg_temp.${RANK_TABLE}`)
  await client.query(
    `CREATE TEMP TABLE ${RANK_TABLE} (raw TEXT PRIMARY KEY, rank SMALLINT NOT NULL) ON COMMIT DROP`
  )
  await client.query(
    `INSERT INTO pg_temp.${RANK_TABLE} (raw, rank)
     SELECT * FROM unnest($1::text[], $2::smallint[])`,
    [raw, ranks]
  )
  await client.query(`ANALYZE pg_temp.${RANK_TABLE}`)

  const impact = impactRankCaseSql('v.consequence')
  const clinvar = `CASE WHEN v.clinvar IS NULL THEN 0 ELSE COALESCE(
      (SELECT m.rank FROM pg_temp.${RANK_TABLE} m WHERE m.raw = v.clinvar), 0) END`
  await client.query(
    `UPDATE ${variants} v
        SET impact_rank = ${impact},
            clinvar_rank = ${clinvar}
      WHERE v.impact_rank <> ${impact}
         OR v.clinvar_rank <> ${clinvar}`
  )
  await client.query(`DROP TABLE pg_temp.${RANK_TABLE}`)
}
