/**
 * Annotation flags of a cohort summary row (has_star, has_comment, acmg_best),
 * derived from `variant_annotations` (global, per coordinate) and
 * `case_variant_annotations` (per case, per variant row).
 *
 * The flags used to be five correlated subqueries evaluated for every summary
 * row being written, three of which looked up every carrier of the row's
 * coordinate in `variants`. That cost grew with the cohort: an import of
 * 60,000 variants did 60,000 index scans over all carriers of each variant.
 * Here each annotation table is aggregated once and joined, so the cost is
 * the size of the annotation tables, which is tiny next to the variants.
 *
 * Usage: append `annotationFlagCtes(tbl)` to a WITH list, add
 * `annotationFlagJoins(alias)` after the FROM item whose alias carries
 * chr/pos/ref/alt/variant_type, and select `ANNOTATION_FLAG_COLUMNS`.
 */

/** ACMG rank ladder, mirroring src/shared/sql/cohort-summary-rebuild.ts. Higher wins. */
const ACMG_RANK_SQL = (col: string): string => `CASE ${col}
  WHEN 'Pathogenic' THEN 5
  WHEN 'Likely pathogenic' THEN 4
  WHEN 'Uncertain significance' THEN 3
  WHEN 'Likely benign' THEN 2
  WHEN 'Benign' THEN 1
  ELSE 0 END`

/** `va_flags` and `cva_flags` CTEs (without the leading WITH or comma). */
export function annotationFlagCtes(tbl: (table: string) => string): string {
  return `va_flags AS (
    SELECT va.chr, va.pos, va.ref, va.alt,
           bool_or(va.starred = 1) AS star,
           bool_or(va.global_comment IS NOT NULL AND va.global_comment <> '') AS has_comment,
           MAX(${ACMG_RANK_SQL('va.acmg_classification')}) AS acmg_rank
    FROM ${tbl('variant_annotations')} va
    GROUP BY va.chr, va.pos, va.ref, va.alt
  ),
  cva_flags AS (
    SELECT v.chr, v.pos, v.ref, v.alt, v.variant_type,
           bool_or(cva.starred = 1) AS star,
           bool_or(cva.per_case_comment IS NOT NULL AND cva.per_case_comment <> '') AS has_comment,
           MAX(${ACMG_RANK_SQL('cva.acmg_classification')}) AS acmg_rank
    FROM ${tbl('case_variant_annotations')} cva
    JOIN ${tbl('variants')} v ON v.id = cva.variant_id
    GROUP BY v.chr, v.pos, v.ref, v.alt, v.variant_type
  )`
}

/** Joins the two flag CTEs to the row source aliased `alias`. */
export function annotationFlagJoins(alias: string): string {
  return `LEFT JOIN va_flags vaf
         ON vaf.chr = ${alias}.chr AND vaf.pos = ${alias}.pos
        AND vaf.ref = ${alias}.ref AND vaf.alt = ${alias}.alt
       LEFT JOIN cva_flags cvf
         ON cvf.chr = ${alias}.chr AND cvf.pos = ${alias}.pos
        AND cvf.ref = ${alias}.ref AND cvf.alt = ${alias}.alt
        AND cvf.variant_type = ${alias}.variant_type`
}

/** has_star, has_comment, acmg_best in that order, for a select list. */
export const ANNOTATION_FLAG_COLUMNS = `(COALESCE(vaf.star, false) OR COALESCE(cvf.star, false)) AS has_star,
        (COALESCE(vaf.has_comment, false) OR COALESCE(cvf.has_comment, false)) AS has_comment,
        (CASE GREATEST(COALESCE(vaf.acmg_rank, 0), COALESCE(cvf.acmg_rank, 0))
          WHEN 5 THEN 'Pathogenic'
          WHEN 4 THEN 'Likely pathogenic'
          WHEN 3 THEN 'Uncertain significance'
          WHEN 2 THEN 'Likely benign'
          WHEN 1 THEN 'Benign'
          ELSE NULL
        END) AS acmg_best`
