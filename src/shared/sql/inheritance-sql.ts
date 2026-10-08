/**
 * SQL of the inheritance predicates that both backends must read the same
 * way. Table names and parameter placeholders come from the caller; the
 * genotype classes come from ./genotype-dosage.ts.
 */
import {
  ALT_GT_SQL,
  HEMI_GT_SQL,
  HET_GT_SQL,
  HOM_GT_SQL,
  HOM_OR_HEMI_GT_SQL,
  notReferenceGtSql
} from './genotype-dosage'

/** One variant, however many rows (transcripts, duplicates) a case stores for it. */
export function variantIdentitySql(alias: string): string {
  return `${alias}.chr || ':' || CAST(${alias}.pos AS TEXT) || ':' || ${alias}.ref || ':' || ${alias}.alt`
}

export interface TrioSqlContext {
  /** The variants and analysis_group_members tables, quoted as the backend needs. */
  variants: string
  members: string
  /** Placeholders (or markers the caller binds) for the proband case and the group. */
  caseParam: string
  groupParam: string
}

/** A row of the group's `role` parent at the variant of row `p` whose genotype meets `condition`. */
function parentRowSql(ctx: TrioSqlContext, role: 'father' | 'mother', condition: string): string {
  return `EXISTS (
          SELECT 1 FROM ${ctx.members} agm
          INNER JOIN ${ctx.variants} par
            ON par.case_id = agm.case_id
           AND par.chr = p.chr AND par.pos = p.pos AND par.ref = p.ref AND par.alt = p.alt
          WHERE agm.group_id = ${ctx.groupParam} AND agm.role = '${role}' AND ${condition}
        )`
}

/**
 * Row `row` is homozygous in the proband and every parent of the group is a
 * het carrier of it (issue #518).
 *
 * A parent with a reference, homozygous or haploid call, or without a row,
 * fails the variant: that pattern points to a de novo second hit, uniparental
 * disomy or a deletion. A parent whose genotype is uncalled passes, so that a
 * parental dropout does not hide a recessive candidate. A parent with several
 * rows is read by its highest dosage: one hom or haploid row fails it. A group
 * without a parent does not constrain.
 */
export function autosomalRecessiveSql(ctx: TrioSqlContext, row: string): string {
  const parentRow = (alias: string, condition: string): string => `EXISTS (
                SELECT 1 FROM ${ctx.variants} ${alias}
                WHERE ${alias}.case_id = agm.case_id
                  AND ${alias}.chr = ${row}.chr AND ${alias}.pos = ${row}.pos
                  AND ${alias}.ref = ${row}.ref AND ${alias}.alt = ${row}.alt
                  AND ${condition}
              )`
  return `(
          ${row}.gt_num IN ${HOM_GT_SQL}
          AND ${row}.case_id = ${ctx.caseParam}
          AND NOT EXISTS (
            SELECT 1 FROM ${ctx.members} agm
            WHERE agm.group_id = ${ctx.groupParam} AND agm.role IN ('father', 'mother')
              AND (NOT ${parentRow('par', `${notReferenceGtSql('par.gt_num')} AND (par.gt_num IS NULL OR par.gt_num NOT IN ${HOM_OR_HEMI_GT_SQL})`)}
                OR ${parentRow('hom', `hom.gt_num IN ${HOM_OR_HEMI_GT_SQL}`)})
          )
        )`
}

/**
 * Row `row` is a hemizygous chrX call: haploid, or `1/1` from a caller that
 * wrote it diploid — unless the case is recorded as female, whose `1/1` is
 * homozygous. Pseudoautosomal regions are not told apart. With `maleOnly`, a
 * `1/1` counts only for a case recorded as male (de novo: one copy must be sure).
 */
export function xHemizygousSql(row: string, caseMetadata: string, maleOnly = false): string {
  return `(${row}.chr IN ('X', 'chrX') AND (
          ${row}.gt_num IN ${HEMI_GT_SQL}
          OR (${row}.gt_num IN ${HOM_GT_SQL} AND ${maleOnly ? '' : 'NOT '}EXISTS (
            SELECT 1 FROM ${caseMetadata} cm
            WHERE cm.case_id = ${row}.case_id AND cm.sex = '${maleOnly ? 'male' : 'female'}'
          ))
        ))`
}

/**
 * Ids of the proband's het variants that form a compound-het pair inherited
 * from opposite parents.
 *
 * A variant has an origin when one parent carries it and the other parent has
 * no row there except an explicit reference call. A variant both parents
 * carry, one neither carries, or one with an uncalled parent has none: its
 * phase is not established. A gene qualifies when it has a paternal and a
 * maternal variant, and only those variants are returned — never the gene's
 * other het rows. Two rows of one variant share one origin, so they never
 * pair with each other.
 *
 * Not established: a parent without a row is read as a non-carrier (reference
 * and uncovered sites are not stored), and a de novo variant in trans with an
 * inherited one is not found.
 */
export function compoundHetPairIdsSql(ctx: TrioSqlContext): string {
  const carries = (role: 'father' | 'mother'): string =>
    parentRowSql(ctx, role, `par.gt_num IN ${ALT_GT_SQL}`)
  const notReference = (role: 'father' | 'mother'): string =>
    parentRowSql(ctx, role, notReferenceGtSql('par.gt_num'))
  return `SELECT o.id FROM (
      SELECT t.id, t.origin,
        MIN(t.origin) OVER (PARTITION BY t.gene_symbol) AS first_origin,
        MAX(t.origin) OVER (PARTITION BY t.gene_symbol) AS last_origin
      FROM (
        SELECT p.id, p.gene_symbol,
          CASE
            WHEN ${carries('father')} AND NOT ${notReference('mother')} THEN 'father'
            WHEN ${carries('mother')} AND NOT ${notReference('father')} THEN 'mother'
          END AS origin
        FROM ${ctx.variants} p
        WHERE p.case_id = ${ctx.caseParam}
          AND p.gt_num IN ${HET_GT_SQL}
          AND p.gene_symbol IS NOT NULL
      ) t
    ) o
    WHERE o.origin IS NOT NULL AND o.first_origin <> o.last_origin`
}
