/**
 * Staging table for one case's per-coordinate summary contribution.
 *
 * A case that was just imported has no planner statistics: PostgreSQL would
 * estimate one row for it and join the annotation flags with a nested loop
 * that rescans them per variant. The aggregate is therefore materialised into
 * a temporary table and ANALYZEd, so the summary upsert that reads it is
 * planned with real row counts.
 */
import type { PoolClient } from 'pg'

type QueryClient = Pick<PoolClient, 'query'>

/** Session-local; referenced as `pg_temp.<name>` by the summary upsert. */
export const CASE_AGG_TABLE = '"_varlens_case_summary_delta"'

const DROP_IF_EXISTS_SQL = `DROP TABLE IF EXISTS pg_temp.${CASE_AGG_TABLE}`
const ANALYZE_SQL = `ANALYZE pg_temp.${CASE_AGG_TABLE}`
const DROP_SQL = `DROP TABLE pg_temp.${CASE_AGG_TABLE}`

/**
 * Materialise and ANALYZE the case's aggregate. `aggregateCte` must define a
 * `per_case` CTE parameterised by `$1 = caseId`.
 */
export async function stageCaseAggregate(args: {
  client: QueryClient
  aggregateCte: string
  caseId: number
}): Promise<void> {
  const { client, aggregateCte, caseId } = args
  await client.query(DROP_IF_EXISTS_SQL)
  await client.query(
    `CREATE TEMP TABLE ${CASE_AGG_TABLE} AS
     ${aggregateCte}
     SELECT * FROM per_case`,
    [caseId]
  )
  await client.query(ANALYZE_SQL)
}

export async function dropCaseAggregate(client: QueryClient): Promise<void> {
  await client.query(DROP_SQL)
}
