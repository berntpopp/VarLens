/**
 * afterApply step of migration 0025 (#469): fill `clinvar_severity`, the
 * lookup of every distinct stored ClinVar string to its severity rank.
 *
 * A ClinVar string can be multi-valued (`Pathogenic/Likely_pathogenic|risk_factor`),
 * which plain SQL cannot categorise, so the distinct strings are read once and
 * ranked with the configuration's own normaliser. Readers use the lookup for
 * variant rows whose `clinvar_rank` is not backfilled yet, and the background
 * backfill (../severity-rank-backfill-job.ts) writes the stored ranks from it,
 * so a stored rank is by construction what an import would have written.
 *
 * This reads `variants_all` once (no lock beyond the reader's, no write to
 * it). Strings without a rank are left out: a missing entry means rank 0.
 * Running it again refreshes the ranks from the current configuration.
 */
import type { PoolClient } from 'pg'

import { clinvarRank } from '../../../../shared/config/severity.config'
import { quoteIdentifier } from '../identifiers'

type QueryClient = Pick<PoolClient, 'query'>

/** Longer strings cannot be keys of the lookup's index; they rank as unknown. */
const MAX_LOOKUP_KEY_LENGTH = 2000

export async function fillClinvarSeverityLookup(
  client: QueryClient,
  schema: string
): Promise<void> {
  const schemaName = quoteIdentifier(schema)
  const distinct = await client.query(
    `SELECT DISTINCT clinvar FROM ${schemaName}."variants_all"
      WHERE clinvar IS NOT NULL AND length(clinvar) <= ${MAX_LOOKUP_KEY_LENGTH}`
  )
  const raw: string[] = []
  const ranks: number[] = []
  for (const row of distinct.rows as Array<{ clinvar: string }>) {
    const rank = clinvarRank(row.clinvar)
    if (rank === 0) continue
    raw.push(row.clinvar)
    ranks.push(rank)
  }
  await client.query(
    `INSERT INTO ${schemaName}."clinvar_severity" (raw, rank)
     SELECT * FROM unnest($1::text[], $2::smallint[])
     ON CONFLICT (raw) DO UPDATE SET rank = EXCLUDED.rank`,
    [raw, ranks]
  )
}
