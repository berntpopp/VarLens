/**
 * The annotation columns of a `cohort_variant_summary` row on PostgreSQL.
 *
 * Transcript-level columns come together from the most severe carrier row;
 * variant-level facts (ClinVar, gnomAD, CADD, end) are aggregated over all
 * carriers (#469). The rule, the column lists and the comparison SQL are
 * shared with SQLite: src/shared/sql/cohort-representative.ts.
 *
 * rebuild() computes that per key. The maintained paths must arrive at it too:
 *
 *   add      the added case's transcript row replaces the stored one when it
 *            is more severe, and each fact where the case's value wins
 *            (ON CONFLICT DO UPDATE)
 *   remove   recompute the rows where the removed case supplied the transcript
 *            or held a fact and no remaining carrier row supplies all of it
 *   switch   recompute the row of a variant whose selected transcript changed
 *
 * Every statement that writes the summary needs its write lock
 * (./cohort-summary-lock).
 */
import type { PoolClient } from 'pg'

import {
  REPRESENTATIVE_COLUMNS,
  SUMMARY_TRANSCRIPT_COLUMNS,
  mergeFactAssignments,
  precedesTranscript,
  remainingRowCovers,
  removalAffectsSummary,
  sameSummaryColumns,
  summaryColumnsOverWindow,
  transcriptOrderBy,
  type CarrierRanks
} from '../../../shared/sql/cohort-representative'
import { impactRankCaseSql } from '../../../shared/config/severity.config'
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

/** The ClinVar rank of variant row `alias` from the `clinvar_severity` lookup (0 = unknown). */
export function clinvarLookupRankSql(alias: string, lookupTable: string): string {
  return `COALESCE((SELECT cs.rank FROM ${lookupTable} cs WHERE cs.raw = ${alias}.clinvar), 0)`
}

/**
 * The severity ranks of variant row `alias`: the stored rank, or, for a row
 * the background backfill has not reached yet (migration 0025 adds the
 * columns as NULL), the same rank computed on the fly. Every reader of a
 * variant row's rank goes through this, so results do not depend on how far
 * the backfill is.
 */
export function carrierRanks(alias: string, tbl: Tbl): CarrierRanks {
  return {
    impact: `COALESCE(${alias}.impact_rank, ${impactRankCaseSql(`${alias}.consequence`)})`,
    clinvar: `COALESCE(${alias}.clinvar_rank, ${clinvarLookupRankSql(alias, tbl('clinvar_severity'))})`
  }
}

/**
 * CTEs ending in `per_case`: one case's contribution per summary key, i.e. its
 * most severe transcript row, its variant-level facts and its genotype
 * (`$1 = caseId`).
 */
export function caseContributionCte(tbl: Tbl, includeProvisional = false): string {
  const ranks = carrierRanks('v', tbl)
  return `
  WITH ranked AS (
    SELECT ${keyList('v').replace('v.genome_build', 'c.genome_build')},
           ${summaryColumnsOverWindow('v', 'key_rows', 'postgres', ranks)},
           MAX(v.gt_num) OVER key_rows AS gt_num,
           ROW_NUMBER() OVER (key_rows ORDER BY ${transcriptOrderBy('v', 'postgres', ranks)}) AS rn
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
 * CTEs ending in `agg`: every summary key of the visible variants matching
 * `variantFilter` (a predicate on `v`, or empty) with its annotation columns
 * and its carrier counts. A case counts once per key whatever number of rows
 * it has there.
 */
export function summaryRowsCte(tbl: Tbl, variantFilter = ''): string {
  const ranks = carrierRanks('v', tbl)
  return `
      WITH case_rows AS (
        SELECT ${keyList('v').replace('v.genome_build', 'c.genome_build')}, v.case_id,
               ${summaryColumnsOverWindow('v', 'case_key', 'postgres', ranks)},
               MAX(v.gt_num) OVER case_key AS gt_num,
               ROW_NUMBER() OVER (case_key ORDER BY ${transcriptOrderBy('v', 'postgres', ranks)}) AS case_rn
        FROM ${tbl('variants')} v
        JOIN ${tbl('cases')} c ON c.id = v.case_id
        ${variantFilter === '' ? '' : `WHERE ${variantFilter}`}
        WINDOW case_key AS (PARTITION BY ${KEY_PARTITION('v', 'c')}, v.case_id)
      ),
      key_rows AS (
        SELECT ${keyList('d')},
               ${summaryColumnsOverWindow('d', 'summary_key', 'postgres')},
               COUNT(*) OVER summary_key AS carrier_count,
               SUM(CASE WHEN d.gt_num IN ${HET} THEN 1 ELSE 0 END) OVER summary_key AS het_count,
               SUM(CASE WHEN d.gt_num IN ${HOM} THEN 1 ELSE 0 END) OVER summary_key AS hom_count,
               ROW_NUMBER() OVER (summary_key ORDER BY ${transcriptOrderBy('d', 'postgres')}) AS key_rn
        FROM case_rows d
        WHERE d.case_rn = 1
        WINDOW summary_key AS (PARTITION BY ${KEY_PARTITION('d', 'd')})
      ),
      agg AS (SELECT * FROM key_rows WHERE key_rn = 1)`
}

/**
 * SET assignments for `INSERT ... AS <existing> ... ON CONFLICT DO UPDATE`.
 * The added case's transcript-level columns replace the stored ones, all at
 * once, when its row is more severe; the comparison runs once per row
 * (OFFSET 0 keeps the planner from inlining it into every column). Each
 * variant-level fact is replaced where the case's value wins.
 */
export function mergeRepresentativeAssignment(existing: string): string {
  return `(${SUMMARY_TRANSCRIPT_COLUMNS.join(', ')}) = (
          SELECT ${SUMMARY_TRANSCRIPT_COLUMNS.map(
            (column) =>
              `CASE WHEN w.replaces THEN EXCLUDED.${column} ELSE ${existing}.${column} END`
          ).join(',\n                 ')}
          FROM (SELECT ${precedesTranscript('EXCLUDED', existing, 'postgres')} AS replaces OFFSET 0) w
        ),
        ${mergeFactAssignments('EXCLUDED', existing, 'postgres').join(',\n        ')}`
}

/**
 * Set the annotation columns of the keys in `keys` (alias `m`) from their
 * visible carrier rows. `extraFilter` restricts the carrier rows `v`.
 */
function recomputeSql(tbl: Tbl, keysCte: string, extraFilter: string): string {
  const ranks = carrierRanks('v', tbl)
  return `
    WITH ${keysCte},
    best AS (
      SELECT * FROM (
        SELECT ${keyList('m')},
               ${summaryColumnsOverWindow('v', 'key_rows', 'postgres', ranks)},
               ROW_NUMBER() OVER (key_rows ORDER BY ${transcriptOrderBy('v', 'postgres', ranks)}) AS rn
        FROM keys m
        JOIN ${tbl('variants')} v
          ON v.chr = m.chr AND v.pos = m.pos AND v.ref = m.ref AND v.alt = m.alt
         AND v.variant_type = m.variant_type ${extraFilter}
        JOIN ${tbl('cases')} c ON c.id = v.case_id AND c.genome_build = m.genome_build
        WINDOW key_rows AS (PARTITION BY ${keyList('m')})
      ) ranked
      WHERE rn = 1
    )
    UPDATE ${tbl('cohort_variant_summary')} s
    SET ${REPRESENTATIVE_COLUMNS.map((column) => `${column} = best.${column}`).join(', ')}
    FROM best
    WHERE ${keyMatch('s', 'best')}
      AND NOT (${sameSummaryColumns('s', 'best', 'postgres')})`
}

/**
 * Keys whose annotation may change when case `$1` goes: other carriers
 * remain, the case supplies the transcript or holds a variant-level fact, and
 * no single remaining carrier row supplies all of that. The last check is an
 * index probe that stops at the first such row, so a cohort that annotates a
 * variant uniformly (the normal case) costs one probe per variant and
 * recomputes nothing.
 */
function removalKeysCte(tbl: Tbl): string {
  return `keys AS MATERIALIZED (
      SELECT ${keyList('k')}
      FROM pg_temp.${CASE_AGG_TABLE} k
      JOIN ${tbl('cohort_variant_summary')} s ON ${keyMatch('s', 'k')}
      WHERE s.carrier_count > k.carrier_delta
        AND (${removalAffectsSummary('k', 's', 'postgres')})
        AND NOT EXISTS (
          SELECT 1
          FROM ${tbl('variants')} r
          JOIN ${tbl('cases')} rc ON rc.id = r.case_id
          WHERE r.chr = k.chr AND r.pos = k.pos AND r.ref = k.ref AND r.alt = k.alt
            AND r.variant_type = k.variant_type AND rc.genome_build = k.genome_build
            AND r.case_id <> $1
            AND ${remainingRowCovers('r', 'k', 's', 'postgres')}
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
