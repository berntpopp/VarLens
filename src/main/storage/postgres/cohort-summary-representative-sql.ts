/**
 * The representative annotation of a `cohort_variant_summary` row.
 *
 * A summary row stands for every carrier of one (chr, pos, ref, alt,
 * variant_type, genome_build), but cases can annotate the same coordinate
 * differently (another transcript, another annotation release). The row
 * stores one value per annotation column, and the rule is the same on every
 * path and on both backends (#461):
 *
 *   the NULL-ignoring MAX() of the column over all visible carrier rows,
 *   text compared bytewise (COLLATE "C", which is how SQLite compares)
 *
 * rebuild() aggregates it. The maintained paths must arrive at the same row:
 *
 *   add      merge with GREATEST() on conflict (NULL-ignoring, like MAX)
 *   remove   recompute the rows where the removed case held a stored maximum
 *            and no remaining carrier row holds all of those maxima
 *   switch   recompute the row of a variant whose selected transcript changed
 *
 * Every statement here needs the summary write lock (./cohort-summary-lock).
 */
import type { PoolClient } from 'pg'

import { CASE_AGG_TABLE, dropCaseAggregate, stageCaseAggregate } from './cohort-case-aggregate-sql'

type QueryClient = Pick<PoolClient, 'query'>
type Tbl = (table: string) => string

/** Annotation columns of the summary, in table order; `text` ones compare bytewise. */
export const SUMMARY_MAX_COLUMNS = [
  { name: 'end_pos', text: false },
  { name: 'gene_symbol', text: true },
  { name: 'cdna', text: true },
  { name: 'aa_change', text: true },
  { name: 'consequence', text: true },
  { name: 'func', text: true },
  { name: 'clinvar', text: true },
  { name: 'gnomad_af', text: false },
  { name: 'cadd', text: false },
  { name: 'transcript', text: true },
  { name: 'omim_mim_number', text: true }
] as const

type MaxColumn = (typeof SUMMARY_MAX_COLUMNS)[number]

const KEY = ['chr', 'pos', 'ref', 'alt', 'variant_type', 'genome_build'] as const
const keyList = (alias: string): string => KEY.map((column) => `${alias}.${column}`).join(', ')
const keyMatch = (a: string, b: string): string =>
  KEY.map((column) => `${a}.${column} = ${b}.${column}`).join(' AND ')

/** A column reference that compares the way the rule says. */
const comparable = (column: MaxColumn, alias: string): string =>
  column.text ? `${alias}.${column.name} COLLATE "C"` : `${alias}.${column.name}`

/** `MAX(<alias>.col) AS col, ...` for every annotation column. */
export function maxSelectList(alias: string): string {
  return SUMMARY_MAX_COLUMNS.map(
    (column) => `MAX(${comparable(column, alias)}) AS ${column.name}`
  ).join(',\n           ')
}

/** SET list merging an added case into an existing row (ON CONFLICT DO UPDATE). */
export function mergeMaxAssignments(existing: string): string {
  return SUMMARY_MAX_COLUMNS.map(
    (column) =>
      `${column.name} = GREATEST(${comparable(column, existing)}, ${comparable(column, 'EXCLUDED')})`
  ).join(',\n        ')
}

/**
 * The row's maxima over its visible carriers, for the keys in `keys`
 * (alias `m`). `extraFilter` restricts the carrier rows `v`.
 */
function recomputeSql(tbl: Tbl, keysCte: string, extraFilter: string): string {
  return `
    WITH ${keysCte},
    agg AS (
      SELECT ${keyList('m')},
             ${maxSelectList('v')}
      FROM keys m
      JOIN ${tbl('variants')} v
        ON v.chr = m.chr AND v.pos = m.pos AND v.ref = m.ref AND v.alt = m.alt
       AND v.variant_type = m.variant_type ${extraFilter}
      JOIN ${tbl('cases')} c ON c.id = v.case_id AND c.genome_build = m.genome_build
      GROUP BY ${keyList('m')}
    )
    UPDATE ${tbl('cohort_variant_summary')} s
    SET ${SUMMARY_MAX_COLUMNS.map((column) => `${column.name} = agg.${column.name}`).join(', ')}
    FROM agg
    WHERE ${keyMatch('s', 'agg')}
      AND (${SUMMARY_MAX_COLUMNS.map(
        (column) => `${comparable(column, 's')} IS DISTINCT FROM ${comparable(column, 'agg')}`
      ).join(' OR ')})`
}

/** The case's value `k` cannot have been the stored maximum `s`. */
const unaffected = (column: MaxColumn): string =>
  `(k.${column.name} IS NULL OR ${comparable(column, 'k')} < ${comparable(column, 's')})`

/**
 * Keys whose representative may change when case `$1` goes: other carriers
 * remain, the case holds at least one stored maximum, and no single remaining
 * carrier row holds all the maxima it holds. The last check is an index probe
 * that stops at the first such row, so a cohort that annotates a coordinate
 * uniformly (the normal case) costs one probe per coordinate and recomputes
 * nothing.
 */
function removalKeysCte(tbl: Tbl): string {
  return `keys AS MATERIALIZED (
      SELECT ${keyList('k')}
      FROM pg_temp.${CASE_AGG_TABLE} k
      JOIN ${tbl('cohort_variant_summary')} s ON ${keyMatch('s', 'k')}
      WHERE s.carrier_count > k.carrier_delta
        AND NOT (${SUMMARY_MAX_COLUMNS.map(unaffected).join(' AND ')})
        AND NOT EXISTS (
          SELECT 1
          FROM ${tbl('variants')} r
          JOIN ${tbl('cases')} rc ON rc.id = r.case_id
          WHERE r.chr = k.chr AND r.pos = k.pos AND r.ref = k.ref AND r.alt = k.alt
            AND r.variant_type = k.variant_type AND rc.genome_build = k.genome_build
            AND r.case_id <> $1
            AND ${SUMMARY_MAX_COLUMNS.map(
              (column) =>
                `(${unaffected(column)} OR ${comparable(column, 'r')} = ${comparable(column, 'k')})`
            ).join('\n            AND ')}
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
  await client.query(`DELETE FROM ${tbl('cohort_variant_summary')} WHERE carrier_count <= 0`)
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
