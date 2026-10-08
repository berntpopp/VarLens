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
  NUMERIC_FACTS,
  REPRESENTATIVE_COLUMNS,
  SUMMARY_TRANSCRIPT_COLUMNS,
  TRANSCRIPT_COLUMNS,
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
import {
  HET_GT_SQL as HET,
  HOM_GT_SQL as HOM,
  resolvedGtSql
} from '../../../shared/sql/genotype-dosage'
import { CASE_AGG_TABLE, dropCaseAggregate, stageCaseAggregate } from './cohort-case-aggregate-sql'
import { dropEmptySummaryRows } from './cohort-unique-variants-sql'

type QueryClient = Pick<PoolClient, 'query'>
type Tbl = (table: string) => string

const KEY = ['chr', 'pos', 'ref', 'alt', 'variant_type', 'genome_build'] as const
const keyList = (alias: string): string => KEY.map((column) => `${alias}.${column}`).join(', ')
const keyMatch = (a: string, b: string): string =>
  KEY.map((column) => `${a}.${column} = ${b}.${column}`).join(' AND ')

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

/*
 * Aggregate form of the rule, for the two statements that read many variant
 * rows (a case's contribution, the rebuild). The shared module states the rule
 * as an order (ROW_NUMBER over a window); a window needs a sort of the wide
 * rows and a pass per partition, which cost a third more than the hash
 * aggregate it replaced. The same order as one aggregate per key:
 *
 *   transcript row   MAX() of a text array, compared bytewise: the impact rank
 *                    as one character, then per transcript-level column a
 *                    '1'/'0' presence flag and the value. Arrays compare
 *                    element by element, so this is impact rank DESC, then
 *                    each column DESC with NULL last: transcriptOrderBy().
 *   ClinVar          MAX() of the rank character followed by the string
 *   numeric facts    MIN() / MAX() as configured
 *
 * The recompute of single keys keeps the window form; the drift and parity
 * tests hold both forms, and SQLite, to the same rows.
 */

/** Ranks are single characters from '@' (0) upwards; they stay far below 60. */
const rankCharacter = (rank: string): string => `chr(64 + ${rank})`

/** The array whose bytewise maximum is the transcript row of `alias`. */
function transcriptKeySql(alias: string, ranks: CarrierRanks): string {
  const elements = TRANSCRIPT_COLUMNS.map(
    (column) =>
      `CASE WHEN ${alias}.${column} IS NULL THEN '0' ELSE '1' END, COALESCE(${alias}.${column}, '')`
  )
  return `ARRAY[${rankCharacter(ranks.impact)}, ${elements.join(', ')}] COLLATE "C"`
}

/** Aggregates over the variant rows `alias` of one group: transcript key and facts. */
function carrierAggregates(alias: string, ranks: CarrierRanks): string {
  return [
    `MAX(${transcriptKeySql(alias, ranks)}) AS transcript_key`,
    `MAX((${rankCharacter(ranks.clinvar)} || ${alias}.clinvar) COLLATE "C") AS clinvar_key`,
    `MAX(${ranks.clinvar}) AS clinvar_rank`,
    ...NUMERIC_FACTS.map(
      (fact) => `${fact.keep === 'min' ? 'MIN' : 'MAX'}(${alias}.${fact.name}) AS ${fact.name}`
    )
  ].join(',\n           ')
}

/** The same aggregates over rows `alias` that are themselves such aggregates. */
function mergedAggregates(alias: string): string {
  return [
    `MAX(${alias}.transcript_key COLLATE "C") AS transcript_key`,
    `MAX(${alias}.clinvar_key COLLATE "C") AS clinvar_key`,
    `MAX(${alias}.clinvar_rank) AS clinvar_rank`,
    ...NUMERIC_FACTS.map(
      (fact) => `${fact.keep === 'min' ? 'MIN' : 'MAX'}(${alias}.${fact.name}) AS ${fact.name}`
    )
  ].join(',\n               ')
}

/** Every annotation column of the summary, decoded from an aggregated row `alias`. */
function decodedSummaryColumns(alias: string): string {
  const key = `${alias}.transcript_key`
  return [
    ...TRANSCRIPT_COLUMNS.map(
      (column, index) =>
        `CASE WHEN ${key}[${2 + 2 * index}] = '1' THEN ${key}[${3 + 2 * index}] END AS ${column}`
    ),
    `(ascii(${key}[1]) - 64)::smallint AS impact_rank`,
    `substr(${alias}.clinvar_key, 2) AS clinvar`,
    `${alias}.clinvar_rank::smallint AS clinvar_rank`,
    ...NUMERIC_FACTS.map((fact) => `${alias}.${fact.name}`)
  ].join(',\n           ')
}

/**
 * CTEs ending in `per_case`: one case's contribution per summary key, i.e. its
 * most severe transcript row, its variant-level facts and its genotype
 * (`$1 = caseId`).
 */
export function caseContributionCte(tbl: Tbl, includeProvisional = false): string {
  return `
  WITH grouped AS (
    SELECT ${keyList('v').replace('v.genome_build', 'c.genome_build')},
           ${carrierAggregates('v', carrierRanks('v', tbl))},
           ${resolvedGtSql('v.gt_num', 'postgres')} AS gt_num
    FROM ${tbl(includeProvisional ? 'variants_all' : 'variants')} v
    JOIN ${tbl(includeProvisional ? 'cases_all' : 'cases')} c ON c.id = v.case_id
    WHERE v.case_id = $1
    GROUP BY ${keyList('v').replace('v.genome_build', 'c.genome_build')}
  ),
  per_case AS (
    SELECT ${keyList('g')},
           ${decodedSummaryColumns('g')},
           1 AS carrier_delta,
           CASE WHEN g.gt_num IN ${HET} THEN 1 ELSE 0 END AS het_delta,
           CASE WHEN g.gt_num IN ${HOM} THEN 1 ELSE 0 END AS hom_delta
    FROM grouped g
  )`
}

/**
 * CTEs ending in `agg`: every summary key of the visible variants matching
 * `variantFilter` (a predicate on `v`, or empty) with its annotation columns
 * and its carrier counts. A case counts once per key whatever number of rows
 * it has there.
 */
export function summaryRowsCte(tbl: Tbl, variantFilter = ''): string {
  const caseKey = `${keyList('v').replace('v.genome_build', 'c.genome_build')}, v.case_id`
  return `
      WITH case_rows AS (
        SELECT ${caseKey},
               ${carrierAggregates('v', carrierRanks('v', tbl))},
               ${resolvedGtSql('v.gt_num', 'postgres')} AS gt_num
        FROM ${tbl('variants')} v
        JOIN ${tbl('cases')} c ON c.id = v.case_id
        ${variantFilter === '' ? '' : `WHERE ${variantFilter}`}
        GROUP BY ${caseKey}
      ),
      key_rows AS (
        SELECT ${keyList('d')},
               ${mergedAggregates('d')},
               COUNT(*) AS carrier_count,
               SUM(CASE WHEN d.gt_num IN ${HET} THEN 1 ELSE 0 END) AS het_count,
               SUM(CASE WHEN d.gt_num IN ${HOM} THEN 1 ELSE 0 END) AS hom_count
        FROM case_rows d
        GROUP BY ${keyList('d')}
      ),
      agg AS (
        SELECT ${keyList('k')},
               ${decodedSummaryColumns('k')},
               k.carrier_count, k.het_count, k.hom_count
        FROM key_rows k
      )`
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
