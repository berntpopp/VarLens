/**
 * Maintained per-gene cohort aggregates (migration 0023).
 *
 *   cohort_gene_variant_summary  one row per distinct (gene, chr, pos, ref, alt)
 *                                among the visible variant rows, with the number
 *                                of cases that carry the pair
 *   cohort_gene_summary          per gene: variant rows, distinct coordinates
 *                                (= its rows in the pair table) and cases
 *
 * They replace the per-read scans of every variant row behind the gene-burden
 * table and the "genes with variants" tile, and return the same numbers:
 *
 *   variant_count        COUNT(*)                              per gene
 *   unique_variant_count COUNT(DISTINCT (chr, pos, ref, alt))  per gene
 *   affected_case_count  COUNT(DISTINCT case_id)               per gene
 *
 * The pair table is what keeps unique_variant_count exact: the cohort variant
 * summary stores one gene per coordinate, but a coordinate counts under every
 * gene symbol any case annotated it with. Rows exist for every non-NULL gene
 * symbol, the empty string included (COUNT(DISTINCT gene_symbol) counts it);
 * the gene-burden read leaves the empty symbol out, as it always did.
 *
 * Every statement here must run inside a transaction that holds the summary
 * write lock (./cohort-summary-lock): one writer at a time, so the refcounts
 * are read and written without racing another publication or deletion.
 *
 * A contribution is either a whole case (publication, deletion) or a single
 * variant row (a transcript switch that changes the row's gene). Both cost
 * O(rows of that case); nothing here depends on the size of the cohort.
 */
import type { PoolClient } from 'pg'

type Queryable = Pick<PoolClient, 'query'>
type Tbl = (table: string) => string

const PAIR_KEY = ['gene_symbol', 'chr', 'pos', 'ref', 'alt'] as const
const pairMatch = (a: string, b: string): string =>
  PAIR_KEY.map((column) => `${a}.${column} = ${b}.${column}`).join(' AND ')

/**
 * `per_pair`: what one case contributes — its rows per (gene, coordinate).
 * The case carries every pair it has (carrier_delta 1) and is one affected
 * case of every gene it has (case_delta 1), however many rows repeat.
 */
function casePairsCte(tbl: Tbl, includeProvisional: boolean): string {
  return `per_pair AS (
    SELECT v.gene_symbol, v.chr, v.pos, v.ref, v.alt,
           COUNT(*)::bigint AS row_count, 1 AS carrier_delta, 1 AS case_delta
    FROM ${tbl(includeProvisional ? 'variants_all' : 'variants')} v
    WHERE v.case_id = $1 AND v.gene_symbol IS NOT NULL
    GROUP BY v.gene_symbol, v.chr, v.pos, v.ref, v.alt
  )`
}

/**
 * `per_pair`: what one visible variant row contributes. It carries its pair,
 * and makes its case an affected case of the gene, only when no other row of
 * the same case already does.
 */
function rowPairsCte(tbl: Tbl): string {
  const other = (extra: string): string =>
    `EXISTS (SELECT 1 FROM ${tbl('variants')} o
              WHERE o.case_id = t.case_id AND o.gene_symbol = t.gene_symbol
                AND o.id <> t.id${extra})`
  return `per_pair AS (
    SELECT t.gene_symbol, t.chr, t.pos, t.ref, t.alt, 1::bigint AS row_count,
           CASE WHEN ${other(' AND o.chr = t.chr AND o.pos = t.pos AND o.ref = t.ref AND o.alt = t.alt')}
                THEN 0 ELSE 1 END AS carrier_delta,
           CASE WHEN ${other('')} THEN 0 ELSE 1 END AS case_delta
    FROM ${tbl('variants')} t
    WHERE t.id = $1 AND t.gene_symbol IS NOT NULL
  )`
}

/**
 * Per-gene deltas: row and case counts from `per_pair`, plus the number of
 * pairs in `pairEvents` (pairs that appeared or disappeared).
 *
 * Deliberately one aggregate over a UNION ALL and not a join of two
 * aggregates: a case that was just imported has no planner statistics, so
 * PostgreSQL estimates one row for it and picks a nested loop that rescans
 * the second aggregate once per gene. That turned a 0.6 s statement into
 * several seconds per import. An aggregate has no join to get wrong.
 */
function perGeneSql(pairEvents: string): string {
  return `(
    SELECT gene_symbol,
           SUM(row_count)::bigint AS row_count,
           SUM(pair_count)::bigint AS pair_count,
           MAX(case_delta) AS case_delta
    FROM (
      SELECT gene_symbol, row_count, 0::bigint AS pair_count, case_delta FROM per_pair
      UNION ALL
      SELECT gene_symbol, 0::bigint, 1::bigint, 0 FROM ${pairEvents}
    ) deltas
    GROUP BY gene_symbol
  )`
}

function addSql(tbl: Tbl, perPairCte: string): string {
  const pairs = tbl('cohort_gene_variant_summary')
  return `
  WITH ${perPairCte},
  pair_upsert AS (
    INSERT INTO ${pairs} AS e (gene_symbol, chr, pos, ref, alt, carrier_count)
    SELECT gene_symbol, chr, pos, ref, alt, 1 FROM per_pair WHERE carrier_delta > 0
    ON CONFLICT (gene_symbol, chr, pos, ref, alt) DO UPDATE SET
      carrier_count = e.carrier_count + 1
    RETURNING e.gene_symbol, e.carrier_count
  ),
  fresh AS (
    -- A pair that now has exactly one carrier did not exist before: rows are
    -- deleted when their last carrier goes, so an existing one had at least 1.
    SELECT gene_symbol FROM pair_upsert WHERE carrier_count = 1
  )
  INSERT INTO ${tbl('cohort_gene_summary')} AS s
    (gene_symbol, variant_count, unique_variant_count, affected_case_count)
  SELECT g.gene_symbol, g.row_count, g.pair_count, g.case_delta
  FROM ${perGeneSql('fresh')} g
  ON CONFLICT (gene_symbol) DO UPDATE SET
    variant_count = s.variant_count + EXCLUDED.variant_count,
    unique_variant_count = s.unique_variant_count + EXCLUDED.unique_variant_count,
    affected_case_count = s.affected_case_count + EXCLUDED.affected_case_count`
}

function removeSql(tbl: Tbl, perPairCte: string): string {
  const pairs = tbl('cohort_gene_variant_summary')
  return `
  WITH ${perPairCte},
  pair_gone AS (
    DELETE FROM ${pairs} e USING per_pair p
    WHERE ${pairMatch('e', 'p')} AND p.carrier_delta > 0 AND e.carrier_count <= p.carrier_delta
    RETURNING e.gene_symbol
  ),
  pair_kept AS (
    UPDATE ${pairs} e SET carrier_count = e.carrier_count - p.carrier_delta
    FROM per_pair p
    WHERE ${pairMatch('e', 'p')} AND p.carrier_delta > 0 AND e.carrier_count > p.carrier_delta
  )
  UPDATE ${tbl('cohort_gene_summary')} s
  SET variant_count = s.variant_count - g.row_count,
      unique_variant_count = s.unique_variant_count - g.pair_count,
      affected_case_count = s.affected_case_count - g.case_delta
  FROM ${perGeneSql('pair_gone')} g
  WHERE s.gene_symbol = g.gene_symbol`
}

/** One row per gene: bounded by the number of gene symbols, not by the cohort. */
const dropEmptyGenesSql = (tbl: Tbl): string =>
  `DELETE FROM ${tbl('cohort_gene_summary')} WHERE variant_count <= 0`

const schemaTbl =
  (schema: string): Tbl =>
  (table) =>
    `"${schema}"."${table}"`

interface CaseScope {
  schema: string
  client: Queryable
  caseId: number
}

/** Add one case's rows. `includeProvisional` reads a case that is being published. */
export async function addCaseToGeneSummary({
  schema,
  client,
  caseId,
  includeProvisional = false
}: CaseScope & { includeProvisional?: boolean }): Promise<void> {
  const tbl = schemaTbl(schema)
  await client.query(addSql(tbl, casePairsCte(tbl, includeProvisional)), [caseId])
}

/** Subtract one visible case's rows; call before the case is hidden or purged. */
export async function removeCaseFromGeneSummary({
  schema,
  client,
  caseId
}: CaseScope): Promise<void> {
  const tbl = schemaTbl(schema)
  await client.query(removeSql(tbl, casePairsCte(tbl, false)), [caseId])
  await client.query(dropEmptyGenesSql(tbl))
}

interface VariantScope {
  schema: string
  client: Queryable
  variantId: number
}

/** Subtract one visible variant row; call before its gene_symbol is changed. */
export async function removeVariantFromGeneSummary({
  schema,
  client,
  variantId
}: VariantScope): Promise<void> {
  const tbl = schemaTbl(schema)
  await client.query(removeSql(tbl, rowPairsCte(tbl)), [variantId])
  await client.query(dropEmptyGenesSql(tbl))
}

/** Add one visible variant row; call after its gene_symbol was changed. */
export async function addVariantToGeneSummary({
  schema,
  client,
  variantId
}: VariantScope): Promise<void> {
  const tbl = schemaTbl(schema)
  await client.query(addSql(tbl, rowPairsCte(tbl)), [variantId])
}

/** Recompute both tables from the visible variants (one scan). */
export async function rebuildGeneSummary({
  schema,
  client
}: {
  schema: string
  client: Queryable
}): Promise<void> {
  const tbl = schemaTbl(schema)
  // DELETE, not TRUNCATE, for the same reason as the variant summary: readers
  // keep the previous rows until the rebuild commits.
  await client.query(`DELETE FROM ${tbl('cohort_gene_variant_summary')}`)
  await client.query(`DELETE FROM ${tbl('cohort_gene_summary')}`)
  await client.query(`
    WITH per_case_pair AS MATERIALIZED (
      SELECT v.gene_symbol, v.chr, v.pos, v.ref, v.alt, v.case_id, COUNT(*) AS row_count
      FROM ${tbl('variants')} v
      WHERE v.gene_symbol IS NOT NULL
      GROUP BY v.gene_symbol, v.chr, v.pos, v.ref, v.alt, v.case_id
    ),
    pairs AS (
      INSERT INTO ${tbl('cohort_gene_variant_summary')}
        (gene_symbol, chr, pos, ref, alt, carrier_count)
      SELECT gene_symbol, chr, pos, ref, alt, COUNT(*)
      FROM per_case_pair
      GROUP BY gene_symbol, chr, pos, ref, alt
    )
    INSERT INTO ${tbl('cohort_gene_summary')}
      (gene_symbol, variant_count, unique_variant_count, affected_case_count)
    SELECT gene_symbol,
           SUM(row_count)::bigint,
           COUNT(DISTINCT (chr, pos, ref, alt))::bigint,
           COUNT(DISTINCT case_id)::bigint
    FROM per_case_pair
    GROUP BY gene_symbol`)
}

/**
 * Take the summary write lock and, when the row is visible and its gene is
 * about to change, subtract it. Returns whether the caller must add the row
 * back (addVariantToGeneSummary) after updating it. A switch that keeps the
 * gene takes no lock and writes nothing.
 */
export async function beginVariantGeneChange(
  scope: VariantScope & { nextGeneSymbol: string | null },
  lock: (client: Queryable, schema: string) => Promise<void>
): Promise<boolean> {
  const { schema, client, variantId, nextGeneSymbol } = scope
  const current = await client.query<{ changes: boolean }>(
    `SELECT (gene_symbol IS DISTINCT FROM $2::text) AS changes
       FROM ${schemaTbl(schema)('variants')} WHERE id = $1`,
    [variantId, nextGeneSymbol]
  )
  if (current.rows[0]?.changes !== true) return false
  // An import publishes within seconds; wait for it rather than fail.
  await client.query('SET LOCAL lock_timeout = 0')
  await lock(client, schema)
  await removeVariantFromGeneSummary({ schema, client, variantId })
  return true
}

/** Gene-burden rows, most affected cases first. The empty symbol is not a gene. */
export function geneBurdenSql(tbl: Tbl): string {
  return `SELECT g.gene_symbol, g.variant_count, g.unique_variant_count, g.affected_case_count,
                 (SELECT COUNT(*)::bigint FROM ${tbl('cases')}) AS total_cases
          FROM ${tbl('cohort_gene_summary')} g
          WHERE g.gene_symbol <> ''
          ORDER BY g.affected_case_count DESC, g.variant_count DESC`
}

/**
 * The three cohort-wide variant figures without reading a variant row:
 *   total_variants       every publication stores the case's exact row count
 *                        in cases.variant_count
 *   unique_variants      distinct (chr, pos, ref, alt); the variant summary is
 *                        keyed by variant type and genome build as well, so
 *                        its row count would overstate it
 *   genes_with_variants  distinct non-NULL gene symbols
 */
export function cohortVariantTotalsSql(tbl: Tbl): {
  totalVariants: string
  uniqueVariants: string
  genesWithVariants: string
} {
  return {
    totalVariants: `SELECT COALESCE(SUM(variant_count), 0)::bigint FROM ${tbl('cases')}`,
    uniqueVariants: `SELECT COUNT(*)::bigint FROM (
        SELECT 1 FROM ${tbl('cohort_variant_summary')} GROUP BY chr, pos, ref, alt
      ) unique_coordinates`,
    genesWithVariants: `SELECT COUNT(*)::bigint FROM ${tbl('cohort_gene_summary')}`
  }
}
