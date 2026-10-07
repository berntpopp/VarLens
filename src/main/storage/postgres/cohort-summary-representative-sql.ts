/**
 * The representative annotation of a `cohort_variant_summary` row on PostgreSQL.
 *
 * A summary row shows the annotation of ONE carrier row: the most severe by
 * the stored severity ranks, with a bytewise tie-break (#469). The rule, the
 * column list and the comparison SQL are shared with SQLite:
 * src/shared/sql/cohort-representative.ts.
 *
 * rebuild() picks that row per key. The maintained paths must arrive at it too:
 *
 *   add      the added case's best row replaces the stored one when it comes
 *            strictly before it in the order (ON CONFLICT DO UPDATE)
 *   remove   recompute the rows whose stored representative the removed case
 *            supplied and no remaining carrier row equals
 *   switch   recompute the row of a variant whose selected transcript changed
 *
 * Every statement that writes the summary needs its write lock
 * (./cohort-summary-lock).
 */
import type { PoolClient } from 'pg'

import {
  REPRESENTATIVE_COLUMNS,
  precedesRepresentative,
  representativeColumnList,
  representativeOrderBy,
  sameRepresentative
} from '../../../shared/sql/cohort-representative'
import { CASE_AGG_TABLE, dropCaseAggregate, stageCaseAggregate } from './cohort-case-aggregate-sql'
import { dropEmptySummaryRows } from './cohort-unique-variants-sql'

type QueryClient = Pick<PoolClient, 'query'>
type Tbl = (table: string) => string

const KEY = ['chr', 'pos', 'ref', 'alt', 'variant_type', 'genome_build'] as const
const keyList = (alias: string): string => KEY.map((column) => `${alias}.${column}`).join(', ')
const keyMatch = (a: string, b: string): string =>
  KEY.map((column) => `${a}.${column} = ${b}.${column}`).join(' AND ')

const HET = "('0/1','1/0','0|1','1|0')"
const HOM = "('1/1','1|1')"

/**
 * PARTITION BY list for one summary key over variant alias `v` and case alias
 * `c`. `pos` leads and text is compared bytewise, so the sort behind the
 * window decides most comparisons on an integer.
 */
const KEY_PARTITION = (v: string, c: string): string =>
  `${v}.pos, ${v}.chr COLLATE "C", ${v}.ref COLLATE "C", ${v}.alt COLLATE "C", ${v}.variant_type COLLATE "C", ${c}.genome_build COLLATE "C"`

/**
 * CTEs ending in `per_case`: one case's contribution per summary key, i.e. its
 * best row by the representative order and its genotype (`$1 = caseId`).
 */
export function caseContributionCte(tbl: Tbl, includeProvisional = false): string {
  return `
  WITH ranked AS (
    SELECT ${keyList('v').replace('v.genome_build', 'c.genome_build')},
           ${representativeColumnList('v')},
           MAX(v.gt_num) OVER key_rows AS gt_num,
           ROW_NUMBER() OVER (key_rows ORDER BY ${representativeOrderBy('v', 'postgres')}) AS rn
    FROM ${tbl(includeProvisional ? 'variants_all' : 'variants')} v
    JOIN ${tbl(includeProvisional ? 'cases_all' : 'cases')} c ON c.id = v.case_id
    WHERE v.case_id = $1
    WINDOW key_rows AS (PARTITION BY ${KEY_PARTITION('v', 'c')})
  ),
  per_case AS (
    SELECT ${KEY.join(', ')},
           ${REPRESENTATIVE_COLUMNS.join(', ')},
           1 AS carrier_delta,
           CASE WHEN gt_num IN ${HET} THEN 1 ELSE 0 END AS het_delta,
           CASE WHEN gt_num IN ${HOM} THEN 1 ELSE 0 END AS hom_delta
    FROM ranked
    WHERE rn = 1
  )`
}

/**
 * CTEs ending in `agg`: every summary key of the visible variants with its
 * representative row and its carrier counts. A case counts once per key
 * whatever number of rows it has there.
 */
export function summaryRowsCte(tbl: Tbl): string {
  return `
      WITH case_rows AS (
        SELECT ${keyList('v').replace('v.genome_build', 'c.genome_build')}, v.case_id,
               ${representativeColumnList('v')},
               MAX(v.gt_num) OVER case_key AS gt_num,
               ROW_NUMBER() OVER (case_key ORDER BY ${representativeOrderBy('v', 'postgres')}) AS case_rn
        FROM ${tbl('variants')} v
        JOIN ${tbl('cases')} c ON c.id = v.case_id
        WINDOW case_key AS (PARTITION BY ${KEY_PARTITION('v', 'c')}, v.case_id)
      ),
      key_rows AS (
        SELECT d.*,
               COUNT(*) OVER summary_key AS carrier_count,
               SUM(CASE WHEN d.gt_num IN ${HET} THEN 1 ELSE 0 END) OVER summary_key AS het_count,
               SUM(CASE WHEN d.gt_num IN ${HOM} THEN 1 ELSE 0 END) OVER summary_key AS hom_count,
               ROW_NUMBER() OVER (summary_key ORDER BY ${representativeOrderBy('d', 'postgres')}) AS key_rn
        FROM case_rows d
        WHERE d.case_rn = 1
        WINDOW summary_key AS (PARTITION BY ${KEY_PARTITION('d', 'd')})
      ),
      agg AS (SELECT * FROM key_rows WHERE key_rn = 1)`
}

/**
 * SET assignment for `INSERT ... AS <existing> ... ON CONFLICT DO UPDATE`: the
 * added case's row replaces the stored representative, in every column at
 * once, when it precedes it. The comparison runs once per row (OFFSET 0 keeps
 * the planner from inlining it into every column).
 */
export function mergeRepresentativeAssignment(existing: string): string {
  return `(${REPRESENTATIVE_COLUMNS.join(', ')}) = (
          SELECT ${REPRESENTATIVE_COLUMNS.map(
            (column) =>
              `CASE WHEN w.replaces THEN EXCLUDED.${column} ELSE ${existing}.${column} END`
          ).join(',\n                 ')}
          FROM (SELECT ${precedesRepresentative('EXCLUDED', existing, 'postgres')} AS replaces OFFSET 0) w
        )`
}

/**
 * Set the representative of the keys in `keys` (alias `m`) to the best of
 * their visible carrier rows. `extraFilter` restricts the carrier rows `v`.
 */
function recomputeSql(tbl: Tbl, keysCte: string, extraFilter: string): string {
  return `
    WITH ${keysCte},
    best AS (
      SELECT * FROM (
        SELECT ${keyList('m')},
               ${representativeColumnList('v')},
               ROW_NUMBER() OVER (
                 PARTITION BY ${keyList('m')}
                 ORDER BY ${representativeOrderBy('v', 'postgres')}
               ) AS rn
        FROM keys m
        JOIN ${tbl('variants')} v
          ON v.chr = m.chr AND v.pos = m.pos AND v.ref = m.ref AND v.alt = m.alt
         AND v.variant_type = m.variant_type ${extraFilter}
        JOIN ${tbl('cases')} c ON c.id = v.case_id AND c.genome_build = m.genome_build
      ) ranked
      WHERE rn = 1
    )
    UPDATE ${tbl('cohort_variant_summary')} s
    SET ${REPRESENTATIVE_COLUMNS.map((column) => `${column} = best.${column}`).join(', ')}
    FROM best
    WHERE ${keyMatch('s', 'best')}
      AND NOT (${sameRepresentative('s', 'best', 'postgres')})`
}

/**
 * Keys whose representative may change when case `$1` goes: other carriers
 * remain, the case's best row IS the stored representative, and no remaining
 * carrier row equals it. The last check is an index probe that stops at the
 * first such row, so a cohort that annotates a variant uniformly (the normal
 * case) costs one probe per variant and recomputes nothing.
 */
function removalKeysCte(tbl: Tbl): string {
  return `keys AS MATERIALIZED (
      SELECT ${keyList('k')}
      FROM pg_temp.${CASE_AGG_TABLE} k
      JOIN ${tbl('cohort_variant_summary')} s ON ${keyMatch('s', 'k')}
      WHERE s.carrier_count > k.carrier_delta
        AND ${sameRepresentative('k', 's', 'postgres')}
        AND NOT EXISTS (
          SELECT 1
          FROM ${tbl('variants')} r
          JOIN ${tbl('cases')} rc ON rc.id = r.case_id
          WHERE r.chr = k.chr AND r.pos = k.pos AND r.ref = k.ref AND r.alt = k.alt
            AND r.variant_type = k.variant_type AND rc.genome_build = k.genome_build
            AND r.case_id <> $1
            AND ${sameRepresentative('r', 's', 'postgres')}
        )
    )`
}

/**
 * Subtract one visible case from the summary: recompute the representatives
 * it held, subtract its counters, drop the rows that lost their last carrier.
 * Call before the case is hidden or purged. `aggregateCte` defines the case's
 * `per_case` contribution (`$1 = caseId`).
 */
export async function removeCaseFromSummary(args: {
  schema: string
  client: QueryClient
  caseId: number
  aggregateCte: string
}): Promise<void> {
  const { schema, client, caseId, aggregateCte } = args
  const tbl: Tbl = (table) => `"${schema}"."${table}"`
  await stageCaseAggregate({ client, aggregateCte, caseId })
  await client.query(recomputeSql(tbl, removalKeysCte(tbl), 'AND v.case_id <> $1'), [caseId])
  await client.query(
    `UPDATE ${tbl('cohort_variant_summary')} s
     SET carrier_count = s.carrier_count - k.carrier_delta,
         het_count = s.het_count - k.het_delta,
         hom_count = s.hom_count - k.hom_delta
     FROM pg_temp.${CASE_AGG_TABLE} k
     WHERE ${keyMatch('s', 'k')}`
  )
  await dropEmptySummaryRows({ schema, client, touchedKeys: `pg_temp.${CASE_AGG_TABLE}` })
  await dropCaseAggregate(client)
}

/**
 * Recompute the summary row of one visible variant after its annotation
 * changed (transcript switch). A hidden variant has no summary row: no-op.
 */
export async function recomputeSummaryForVariant(args: {
  schema: string
  client: QueryClient
  variantId: number
}): Promise<void> {
  const tbl: Tbl = (table) => `"${args.schema}"."${table}"`
  const keysCte = `keys AS (
      SELECT t.chr, t.pos, t.ref, t.alt, t.variant_type, tc.genome_build
      FROM ${tbl('variants')} t
      JOIN ${tbl('cases')} tc ON tc.id = t.case_id
      WHERE t.id = $1
    )`
  await args.client.query(recomputeSql(tbl, keysCte, ''), [args.variantId])
}
