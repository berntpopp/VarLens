/**
 * Backfill of `impact_rank` / `clinvar_rank` on existing variant rows
 * (migration 0025, #469). New rows get their ranks from the import pipeline.
 *
 * Impact is a CASE generated from the severity configuration. A ClinVar
 * string can be multi-valued (`Pathogenic/Likely_pathogenic|risk_factor`),
 * which plain SQL cannot categorise, so the distinct stored strings are read
 * and ranked with the configuration's own normaliser: the stored ranks are by
 * construction what an import would have written.
 *
 * The ranks are written by rewriting the table once (ALTER COLUMN ... USING),
 * not by an UPDATE: every row changes, the table has a dozen indexes and its
 * pages are full, so an UPDATE writes a second copy of every row and a new
 * entry in every index (measured on 1.26 million variants: 77 s and twice the
 * table size, against 9 s for the rewrite, which also leaves no dead rows).
 * The rewrite is only possible while no view uses the columns, so it runs
 * before the `variants` view is redefined to expose them. When the view has
 * them already (the step runs again), rows are corrected in place instead,
 * and only those whose rank differs.
 */
import { escapeLiteral, type PoolClient } from 'pg'

import { clinvarRank, impactRankCaseSql } from '../../../../shared/config/severity.config'
import { quoteIdentifier } from '../identifiers'

type QueryClient = Pick<PoolClient, 'query'>

/** The distinct stored ClinVar strings that have a rank, with that rank. */
async function rankedClinvarStrings(
  client: QueryClient,
  variants: string
): Promise<Array<{ raw: string; rank: number }>> {
  const distinct = await client.query(
    `SELECT DISTINCT clinvar FROM ${variants} WHERE clinvar IS NOT NULL`
  )
  return (distinct.rows as Array<{ clinvar: string }>)
    .map(({ clinvar }) => ({ raw: clinvar, rank: clinvarRank(clinvar) }))
    .filter(({ rank }) => rank > 0)
}

/** `CASE <column> WHEN '<raw>' THEN <rank> ... ELSE 0 END` over the ranked strings. */
function clinvarRankCaseSql(column: string, ranked: Array<{ raw: string; rank: number }>): string {
  if (ranked.length === 0) return '0'
  const whens = ranked.map(({ raw, rank }) => `WHEN ${escapeLiteral(raw)} THEN ${rank}`)
  return `CASE ${column} ${whens.join(' ')} ELSE 0 END`
}

async function viewExposesRanks(client: QueryClient, schema: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'variants' AND column_name = 'impact_rank'`,
    [schema]
  )
  return result.rows.length > 0
}

export async function backfillSeverityRanks(client: QueryClient, schema: string): Promise<void> {
  const schemaName = quoteIdentifier(schema)
  const variants = `${schemaName}."variants_all"`
  const impact = impactRankCaseSql('consequence')
  const clinvar = clinvarRankCaseSql('clinvar', await rankedClinvarStrings(client, variants))

  if (await viewExposesRanks(client, schema)) {
    await client.query(
      `UPDATE ${variants}
          SET impact_rank = ${impact}, clinvar_rank = ${clinvar}
        WHERE impact_rank <> ${impact} OR clinvar_rank <> ${clinvar}`
    )
    return
  }

  await client.query(
    `ALTER TABLE ${variants}
       ALTER COLUMN impact_rank TYPE SMALLINT USING (${impact}),
       ALTER COLUMN clinvar_rank TYPE SMALLINT USING (${clinvar})`
  )
  // The view was created as SELECT v.*, which is expanded when the view is
  // defined: it is redefined to expose the new columns. They come last, so
  // CREATE OR REPLACE is allowed and nothing that depends on the view breaks.
  await client.query(
    `CREATE OR REPLACE VIEW ${schemaName}."variants" AS
       SELECT v.* FROM ${variants} v
       WHERE EXISTS (
         SELECT 1 FROM ${schemaName}."cases_all" c
         WHERE c.id = v.case_id AND c.import_status = 'ready'
       )`
  )
}
