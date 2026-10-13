/**
 * SV/CNV call columns of cohort reads (#573, #539), one SQL text for SQLite
 * and PostgreSQL. `table` qualifies a table name for the backend (identity on
 * SQLite, schema-qualified on PostgreSQL).
 */

const sameName = (name: string): string => name

/** Carrier rows of the summary row `cvs` (same identity as `getCarriers`). */
function carrierRowsSql(table: (name: string) => string): string {
  return `FROM ${table('variants')} cv JOIN ${table('cases')} cc ON cc.id = cv.case_id
      WHERE cv.chr = cvs.chr AND cv.pos = cvs.pos AND cv.ref = cvs.ref AND cv.alt = cvs.alt
        AND cv.variant_type = cvs.variant_type AND cc.genome_build = cvs.genome_build`
}

/**
 * `end_pos`, `sv_type`, `sv_length` of a cohort page row. The summary keeps
 * the highest end over carriers (cohort-representative.ts); type and length
 * are read from the carrier rows (coordinate index seek) and only for SV/CNV
 * rows. The length is that of the carriers at the summary's end, so End and
 * Length describe the same call. Unsigned: the sign only encodes DEL vs DUP.
 */
export function cohortCallColumnsSql(table: (name: string) => string = sameName): string {
  const rows = carrierRowsSql(table)
  return `cvs.end_pos,
      CASE WHEN cvs.variant_type IN ('sv', 'cnv') THEN (SELECT MAX(cv.sv_type) ${rows}) END AS sv_type,
      CASE WHEN cvs.variant_type IN ('sv', 'cnv') THEN (SELECT MAX(ABS(cv.sv_length)) ${rows}
        AND cv.end_pos = cvs.end_pos) END AS sv_length`
}

/**
 * Per-carrier call metrics for `getCarriers` (#539): `columns` aggregated per
 * case like the genotype (a case holds one call per identity; MAX only
 * collapses split rows), `joins` to place next to `variants v`.
 */
export function carrierCallSql(table: (name: string) => string = sameName): {
  columns: string
  joins: string
} {
  return {
    columns: `MAX(v.qual) AS qual,
         MAX(v.gq) AS gq,
         MAX(v.dp) AS dp,
         MAX(v.filter) AS filter,
         MAX(v.caller) AS caller,
         MAX(v.end_pos) AS end_pos,
         MAX(ABS(v.sv_length)) AS sv_length,
         MAX(sv.support) AS sv_support,
         MAX(sv.vaf) AS sv_vaf,
         MAX(cnv.copy_number) AS copy_number`,
    joins: `LEFT JOIN ${table('variant_sv')} sv ON sv.variant_id = v.id
       LEFT JOIN ${table('variant_cnv')} cnv ON cnv.variant_id = v.id`
  }
}
