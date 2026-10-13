/**
 * The carriers of one cohort row with their own call metrics (#539), one SQL
 * text for SQLite and PostgreSQL. Parameters: chr, pos, ref, alt,
 * variant_type, genome_build. `table` qualifies a table name for the backend
 * (identity on SQLite, schema-qualified on PostgreSQL).
 */
import type { SqlDialect } from './chromosome-order'
import { resolvedGtSql } from './genotype-dosage'

/** Call metrics, each read from the case's chosen call (`call_rank = 1`). */
const METRICS: ReadonlyArray<[expression: string, alias: string]> = [
  ['r.qual', 'qual'],
  ['r.gq', 'gq'],
  ['r.dp', 'dp'],
  ['r.filter', 'filter'],
  ['r.caller', 'caller'],
  ['r.end_pos', 'end_pos'],
  ['ABS(r.sv_length)', 'sv_length'],
  ['sv.support', 'sv_support'],
  ['sv.vaf', 'sv_vaf'],
  ['cnv.copy_number', 'copy_number']
]

/**
 * One row per carrying case. The genotype resolves all of the case's rows
 * (resolvedGtSql); the metrics all come from ONE row, so two calls of a case
 * (two appended SV files) are never mixed. That row is the one with the
 * highest end, the summary's end_pos rule (cohort-representative.ts), then
 * the first imported. SQLite's `cases` holds unfinished imports too, so only
 * ready cases count there; PostgreSQL's `cases` view shows ready cases only.
 */
export function cohortCarriersSql(
  dialect: SqlDialect,
  table: (name: string) => string = (name) => name
): string {
  const [chr, pos, ref, alt, type, build] =
    dialect === 'postgres' ? ['$1', '$2', '$3', '$4', '$5', '$6'] : Array<string>(6).fill('?')
  const ready = dialect === 'sqlite' ? "c.import_status = 'ready' AND " : ''
  const metrics = METRICS.map(
    ([expression, alias]) => `MAX(CASE WHEN r.call_rank = 1 THEN ${expression} END) AS ${alias}`
  )
  return `SELECT r.case_id, r.case_name, ${resolvedGtSql('r.gt_num', dialect)} AS gt_num,
         ${metrics.join(',\n         ')}
    FROM (
      SELECT v.id, v.case_id, c.name AS case_name, v.gt_num, v.qual, v.gq, v.dp, v.filter,
             v.caller, v.end_pos, v.sv_length,
             ROW_NUMBER() OVER (PARTITION BY v.case_id ORDER BY v.end_pos DESC NULLS LAST, v.id)
               AS call_rank
        FROM ${table('variants')} v
        JOIN ${table('cases')} c ON c.id = v.case_id
       WHERE ${ready}v.chr = ${chr} AND v.pos = ${pos} AND v.ref = ${ref} AND v.alt = ${alt}
         AND v.variant_type = ${type} AND c.genome_build = ${build}
    ) r
    LEFT JOIN ${table('variant_sv')} sv ON sv.variant_id = r.id
    LEFT JOIN ${table('variant_cnv')} cnv ON cnv.variant_id = r.id
   GROUP BY r.case_id, r.case_name
   ORDER BY r.case_name`
}
