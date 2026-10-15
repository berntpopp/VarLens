/**
 * SQL of the inheritance predicates that both backends must read the same
 * way. Table names and parameter placeholders come from the caller; the
 * genotype classes come from ./genotype-dosage.ts.
 */
import { chrRankSql, chromosomeRank } from './chromosome-order'
import {
  ALT_GT_SQL,
  gtCallRankSql,
  HEMI_GT_SQL,
  HET_GT_SQL,
  HET_OR_HEMI_GT_SQL,
  HOM_GT_SQL,
  notReferenceGtSql
} from './genotype-dosage'
import { PAR_REGIONS } from '../utils/par-regions'

/** One variant, however many rows (transcripts, duplicates) a case stores for it. */
export function variantIdentitySql(alias: string): string {
  return `${alias}.chr || ':' || CAST(${alias}.pos AS TEXT) || ':' || ${alias}.ref || ':' || ${alias}.alt`
}

/** Columns a qualifying-rows subquery must expose to {@link candidateCompoundHetSql}. */
export const QUALIFYING_ROW_COLUMNS = ['gene_symbol', 'gt_num', 'chr', 'pos', 'ref', 'alt'] as const

/**
 * Row `row` is het and its gene has at least two distinct het variants among
 * `qualifyingRows`: a derived table (QUALIFYING_ROW_COLUMNS) of the case rows
 * that pass every other active filter (issue #579). Counting the whole case
 * instead let two common SNPs qualify any gene. Same idea as the evidence
 * shortlist, which counts het alleles among the gated candidates only.
 */
export function candidateCompoundHetSql(row: string, qualifyingRows: string): string {
  return `(${row}.gt_num IN ${HET_GT_SQL} AND ${row}.gene_symbol IN (
            SELECT qv.gene_symbol FROM ${qualifyingRows} qv
            WHERE qv.gt_num IN ${HET_GT_SQL} AND qv.gene_symbol IS NOT NULL
            GROUP BY qv.gene_symbol
            HAVING COUNT(DISTINCT ${variantIdentitySql('qv')}) >= 2
          ))`
}

export interface TrioSqlContext {
  /** The variants, analysis_group_members, cases and case_metadata tables, quoted as the backend needs. */
  variants: string
  members: string
  cases: string
  caseMetadata: string
  /** Placeholders (or markers the caller binds) for the proband case and the group. */
  caseParam: string
  groupParam: string
}

export interface DeNovoQualityThresholds {
  minGq?: number | string
  minDp?: number | string
  minProbandAb?: number | string
  maxParentAb?: number | string
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

/** Ranks of X, Y and MT in {@link chrRankSql}: every spelling, with or without `chr`. */
const NON_AUTOSOME_RANKS = ['X', 'Y', 'MT'].map(chromosomeRank).join(', ')

function memberRankSql(ctx: TrioSqlContext, row: string): string {
  // One digit per row, so MAX needs no collation and the text is the same on both backends.
  return `(
              SELECT MAX(${gtCallRankSql('par.gt_num')}) FROM ${ctx.variants} par
              WHERE par.case_id = agm.case_id
                AND par.chr = ${row}.chr AND par.pos = ${row}.pos
                AND par.ref = ${row}.ref AND par.alt = ${row}.alt
            )`
}

function parXExclusionSql(row: string, regions: readonly { start: number; end: number }[]): string {
  return `NOT (${regions.map((r) => `${row}.pos BETWEEN ${r.start} AND ${r.end}`).join(' OR ')})`
}

/** Row `row` is on chrX outside the genome build's pseudoautosomal regions (PAR1/PAR2). */
export function nonParXSql(row: string, cases: string): string {
  const buildSql = `(SELECT c.genome_build FROM ${cases} c WHERE c.id = ${row}.case_id)`
  return `(${row}.chr IN ('X', 'chrX') AND CASE WHEN ${buildSql} = 'GRCh37' THEN ${parXExclusionSql(row, PAR_REGIONS.GRCh37.X)} ELSE ${parXExclusionSql(row, PAR_REGIONS.GRCh38.X)} END)`
}

/**
 * One copy in the proband; neither parent has a row there other than an
 * explicit reference call (or a row that fails quality thresholds, #626).
 */
export function deNovoSql(
  ctx: TrioSqlContext,
  row: string,
  thresholds?: DeNovoQualityThresholds
): string {
  const probandQuality: string[] = []
  if (thresholds?.minGq !== undefined) {
    probandQuality.push(`AND (${row}.gq IS NULL OR ${row}.gq >= ${thresholds.minGq})`)
  }
  if (thresholds?.minDp !== undefined) {
    probandQuality.push(`AND (${row}.dp IS NULL OR ${row}.dp >= ${thresholds.minDp})`)
  }
  if (thresholds?.minProbandAb !== undefined) {
    probandQuality.push(`AND (${row}.ab IS NULL OR ${row}.ab >= ${thresholds.minProbandAb})`)
  }
  const probandQualitySql =
    probandQuality.length > 0 ? `\n            ${probandQuality.join('\n            ')}` : ''

  const parentQualityFail: string[] = []
  if (thresholds?.minGq !== undefined) {
    parentQualityFail.push(` OR (f.gq IS NOT NULL AND f.gq < ${thresholds.minGq})`)
  }
  if (thresholds?.minDp !== undefined) {
    parentQualityFail.push(` OR (f.dp IS NOT NULL AND f.dp < ${thresholds.minDp})`)
  }
  if (thresholds?.maxParentAb !== undefined) {
    parentQualityFail.push(` OR (f.ab IS NOT NULL AND f.ab > ${thresholds.maxParentAb})`)
  }
  const parentWithholdSql =
    parentQualityFail.length > 0
      ? `(${notReferenceGtSql('f.gt_num')}${parentQualityFail.join('')})`
      : notReferenceGtSql('f.gt_num')

  // A male chrX call written diploid (1/1) is one copy too.
  return `(
            (${row}.gt_num IN ${HET_OR_HEMI_GT_SQL} OR ${xHemizygousSql(row, ctx.caseMetadata, true)})${probandQualitySql}
            AND ${row}.id NOT IN (
              SELECT p.id FROM ${ctx.variants} p
              INNER JOIN ${ctx.members} agm_f
                ON agm_f.group_id = ${ctx.groupParam} AND agm_f.role = 'father'
              INNER JOIN ${ctx.variants} f
                ON f.case_id = agm_f.case_id
                AND f.chr = p.chr AND f.pos = p.pos AND f.ref = p.ref AND f.alt = p.alt
                AND ${parentWithholdSql}
              WHERE p.case_id = ${ctx.caseParam}
            )
            AND ${row}.id NOT IN (
              SELECT p.id FROM ${ctx.variants} p
              INNER JOIN ${ctx.members} agm_m
                ON agm_m.group_id = ${ctx.groupParam} AND agm_m.role = 'mother'
              INNER JOIN ${ctx.variants} f
                ON f.case_id = agm_m.case_id
                AND f.chr = p.chr AND f.pos = p.pos AND f.ref = p.ref AND f.alt = p.alt
                AND ${parentWithholdSql}
              WHERE p.case_id = ${ctx.caseParam}
            )
          )`
}

/**
 * Row `row` is an autosomal homozygous call of the proband and every parent of
 * the group is a het carrier of it (issue #518).
 *
 * Each parent is read once, by its resolved call (the highest dosage of its
 * rows, as everywhere: gtCallKeySql). Het passes. Reference, homozygous or
 * haploid fails, and so does a parent without a row, which is read as
 * reference. A parent with only uncalled genotypes passes, so that a parental
 * dropout does not hide a candidate. A group without a parent does not constrain.
 */
export function autosomalRecessiveSql(ctx: TrioSqlContext, row: string): string {
  const parentRank = memberRankSql(ctx, row)
  return `(
          ${row}.gt_num IN ${HOM_GT_SQL}
          AND ${row}.case_id = ${ctx.caseParam}
          AND ${chrRankSql(`${row}.chr`)} NOT IN (${NON_AUTOSOME_RANKS})
          AND NOT EXISTS (
            SELECT 1 FROM ${ctx.members} agm
            WHERE agm.group_id = ${ctx.groupParam} AND agm.role IN ('father', 'mother')
              AND COALESCE(${parentRank}, '1') NOT IN ('3', '0')
          )
        )`
}

/**
 * Autosomal dominant (#627): autosomal het in the proband, at least one other
 * affected group member exists, every other affected group member carries the
 * variant, and every unaffected group member is reference/uncalled.
 */
export function autosomalDominantSql(ctx: TrioSqlContext, row: string): string {
  const memberRank = memberRankSql(ctx, row)
  return `(
          ${row}.gt_num IN ${HET_GT_SQL}
          AND ${row}.case_id = ${ctx.caseParam}
          AND ${chrRankSql(`${row}.chr`)} NOT IN (${NON_AUTOSOME_RANKS})
          AND EXISTS (
            SELECT 1 FROM ${ctx.members} agm
            WHERE agm.group_id = ${ctx.groupParam}
              AND agm.case_id <> ${row}.case_id
              AND agm.affected_status = 'affected'
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${ctx.members} agm
            WHERE agm.group_id = ${ctx.groupParam}
              AND agm.case_id <> ${row}.case_id
              AND agm.affected_status = 'affected'
              AND COALESCE(${memberRank}, '1') = '1'
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${ctx.members} agm
            WHERE agm.group_id = ${ctx.groupParam}
              AND agm.case_id <> ${row}.case_id
              AND agm.affected_status = 'unaffected'
              AND COALESCE(${memberRank}, '1') NOT IN ('1', '0')
          )
        )`
}

/**
 * X-linked recessive (#627): non-PAR chrX, male hemizygous or female hom in
 * the proband, mother (if in group) is het carrier, and unaffected father (if
 * in group) is reference/uncalled.
 */
export function xRecessiveSql(ctx: TrioSqlContext, row: string): string {
  const memberRank = memberRankSql(ctx, row)
  return `(
          ${nonParXSql(row, ctx.cases)}
          AND ${row}.case_id = ${ctx.caseParam}
          AND (${xHemizygousSql(row, ctx.caseMetadata, true)} OR ${row}.gt_num IN ${HOM_GT_SQL})
          AND NOT EXISTS (
            SELECT 1 FROM ${ctx.members} agm
            WHERE agm.group_id = ${ctx.groupParam} AND agm.role = 'mother'
              AND COALESCE(${memberRank}, '1') NOT IN ('3', '0')
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${ctx.members} agm
            WHERE agm.group_id = ${ctx.groupParam} AND agm.role = 'father'
              AND agm.affected_status = 'unaffected'
              AND COALESCE(${memberRank}, '1') NOT IN ('1', '0')
          )
        )`
}

/**
 * X-linked dominant (#627): non-PAR chrX, het or male hemizygous in the
 * proband, every other affected group member carries the variant, and every
 * unaffected group member is reference/uncalled.
 */
export function xDominantSql(ctx: TrioSqlContext, row: string): string {
  const memberRank = memberRankSql(ctx, row)
  return `(
          ${nonParXSql(row, ctx.cases)}
          AND ${row}.case_id = ${ctx.caseParam}
          AND (${row}.gt_num IN ${HET_GT_SQL} OR ${xHemizygousSql(row, ctx.caseMetadata, true)})
          AND NOT EXISTS (
            SELECT 1 FROM ${ctx.members} agm
            WHERE agm.group_id = ${ctx.groupParam}
              AND agm.case_id <> ${row}.case_id
              AND agm.affected_status = 'affected'
              AND COALESCE(${memberRank}, '1') = '1'
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${ctx.members} agm
            WHERE agm.group_id = ${ctx.groupParam}
              AND agm.case_id <> ${row}.case_id
              AND agm.affected_status = 'unaffected'
              AND COALESCE(${memberRank}, '1') NOT IN ('1', '0')
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
